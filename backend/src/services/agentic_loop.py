import json
import os
import time
import math
from collections import deque

import requests

from core.config import settings
from models.schemas import ChatPromptRequest, ChatPromptResponse
from services.featurescript import (
	apply_safety_mm,
	build_boss_script,
	build_box_above_script,
	build_box_below_script,
	build_boxes_all_sides_script,
	build_boxes_each_side_script,
	build_center_box_script,
	build_hole_cut_script,
	build_fillet_script,
	build_chamfer_script,
	build_pattern_boxes_script,
	build_pocket_cut_script,
	build_slot_cut_script,
	parse_box_operation,
)
from services.onshape_api import onshape_client


_EXECUTION_HISTORY: deque[dict] = deque(maxlen=50)
_HISTORY_PATH = os.path.join(os.path.dirname(__file__), "../data/chat_execution_history.json")


def _load_history_from_disk() -> None:
	if not os.path.exists(_HISTORY_PATH):
		return
	try:
		with open(_HISTORY_PATH, "r", encoding="utf-8") as history_file:
			items = json.load(history_file)
		if isinstance(items, list):
			for item in items[:50]:
				if isinstance(item, dict):
					_EXECUTION_HISTORY.append(item)
	except Exception:
		return


def _save_history_to_disk() -> None:
	os.makedirs(os.path.dirname(_HISTORY_PATH), exist_ok=True)
	with open(_HISTORY_PATH, "w", encoding="utf-8") as history_file:
		json.dump(list(_EXECUTION_HISTORY), history_file)


_load_history_from_disk()


def get_execution_history() -> list[dict]:
	return list(_EXECUTION_HISTORY)


def clear_generated_edits_for_context(
	document_id: str,
	workspace_type: str,
	workspace_id: str,
	element_id: str,
) -> tuple[int, int]:
	wvm = workspace_type if workspace_type in {"w", "v", "m"} else "w"
	matching_items = [
		item
		for item in list(_EXECUTION_HISTORY)
		if isinstance(item, dict)
		and item.get("status") == "executed"
		and item.get("document_id") == document_id
		and item.get("workspace_id") == workspace_id
		and item.get("element_id") == element_id
	]

	feature_ids: list[str] = []
	for item in matching_items:
		transform_feature_id = item.get("transform_feature_id")
		created_feature_id = item.get("created_feature_id")
		if isinstance(transform_feature_id, str) and transform_feature_id:
			feature_ids.append(transform_feature_id)
		if isinstance(created_feature_id, str) and created_feature_id:
			feature_ids.append(created_feature_id)

	deleted_count = 0
	for feature_id in feature_ids:
		try:
			onshape_client.delete_feature(
				document_id,
				wvm,
				workspace_id,
				element_id,
				feature_id,
			)
			deleted_count += 1
		except Exception:
			continue

	remaining_items: deque[dict] = deque(maxlen=50)
	for item in list(_EXECUTION_HISTORY):
		if not isinstance(item, dict):
			continue
		is_same_context = (
			item.get("document_id") == document_id
			and item.get("workspace_id") == workspace_id
			and item.get("element_id") == element_id
		)
		has_created_feature = bool(item.get("created_feature_id") or item.get("transform_feature_id"))
		if is_same_context and has_created_feature:
			continue
		remaining_items.append(item)

	_EXECUTION_HISTORY.clear()
	_EXECUTION_HISTORY.extend(remaining_items)
	_save_history_to_disk()

	return deleted_count, len(feature_ids)


def _latest_created_shape_entry() -> dict | None:
	for item in _EXECUTION_HISTORY:
		if not isinstance(item, dict):
			continue
		if item.get("status") != "executed":
			continue
		if item.get("created_feature_id") and item.get("created_shape") and item.get("size_mm") is not None:
			return item
	return None


def _latest_shape_entry_with_center(shape_names: set[str]) -> dict | None:
	for item in _EXECUTION_HISTORY:
		if not isinstance(item, dict):
			continue
		if item.get("status") != "executed":
			continue
		created_shape = str(item.get("created_shape", "")).lower().strip()
		if created_shape not in shape_names:
			continue
		center_m = item.get("center_m")
		if isinstance(center_m, list) and len(center_m) == 3:
			return item
	return None


def _support_point_from_bbox(
	bbox_tuple: tuple[float, float, float, float, float, float],
	center: tuple[float, float, float],
	nx: float,
	ny: float,
	nz: float,
	positive: bool,
) -> tuple[float, float, float]:
	min_x, min_y, min_z, max_x, max_y, max_z = bbox_tuple
	cx, cy, cz = center

	dx = max_x - min_x
	dy = max_y - min_y
	dz = max_z - min_z
	half_extent_along_normal = 0.5 * (abs(nx) * dx + abs(ny) * dy + abs(nz) * dz)
	sign = 1.0 if positive else -1.0

	return (
		cx + nx * half_extent_along_normal * sign,
		cy + ny * half_extent_along_normal * sign,
		cz + nz * half_extent_along_normal * sign,
	)


def _topology_status(region: dict) -> str:
	selected_region = region.get("selected_region") if isinstance(region, dict) else {}
	if not isinstance(selected_region, dict):
		return "missing"

	native_edges = selected_region.get("native_edge_ids")
	native_face = selected_region.get("native_face_id")
	if isinstance(native_edges, list) and len(native_edges) > 0:
		return "native_edges_present"
	if isinstance(native_face, str) and native_face:
		return "native_face_present"
	if selected_region.get("topology_id"):
		return "mesh_topology_only"
	return "missing"


def _planner_prompt(prompt: str) -> str:
	return (
		"Convert user CAD edit request into JSON with fields: "
		"action (add_boxes_each_side|add_boxes_all_sides|add_box_above|add_box_below|"
		"add_center_box|resize_last_shape|replace_last_shape|recolor_model|cut_pocket|add_boss|add_mound|drill_hole|cut_slot|pattern_boxes|fillet_request|chamfer_request), "
		"size_mm or depth_mm or height_mm or diameter_mm and count if needed. "
		f"User request: {prompt}"
	)


def _try_llm_plan(prompt: str) -> dict | None:
	if not settings.ENABLE_LLM_PLANNER or not settings.OPENAI_API_KEY:
		return None

	headers = {
		"Authorization": f"Bearer {settings.OPENAI_API_KEY}",
		"Content-Type": "application/json",
	}
	payload = {
		"model": settings.OPENAI_MODEL,
		"input": _planner_prompt(prompt),
		"temperature": 0,
	}
	try:
		response = requests.post("https://api.openai.com/v1/responses", headers=headers, json=payload, timeout=20)
		response.raise_for_status()
		data = response.json()
		text = data.get("output_text", "")
		if not text:
			return None
		return json.loads(text)
	except Exception:
		return None


def process_chat_prompt(payload: ChatPromptRequest) -> ChatPromptResponse:
	region = payload.region_selection or {}
	topology_status = _topology_status(region)
	selected_region = region.get("selected_region") if isinstance(region, dict) else {}
	topology_id = (
		selected_region.get("topology_id")
		if isinstance(selected_region, dict)
		else None
	)

	cad_context = region.get("cad_context") if isinstance(region, dict) else {}
	document_id = cad_context.get("document_id") if isinstance(cad_context, dict) else None
	workspace_type = cad_context.get("workspace_type") if isinstance(cad_context, dict) else None
	workspace_id = cad_context.get("workspace_id") if isinstance(cad_context, dict) else None
	element_id = cad_context.get("element_id") if isinstance(cad_context, dict) else None

	parsed = parse_box_operation(payload.prompt)
	llm_plan = _try_llm_plan(payload.prompt)
	if isinstance(llm_plan, dict) and llm_plan.get("action"):
		parsed = llm_plan

	if not parsed:
		return ChatPromptResponse(
			message=(
				"Prompt received. I’m ready to execute geometric edits from your selected region. "
				"Try: 'add 3mm boxes on each side'."
			),
			llm_ready=True,
			has_region_selection=bool(payload.region_selection),
			region_topology_id=topology_id,
			topology_status=topology_status,
			executed=False,
			action=None,
		)

	action = str(parsed.get("action", ""))
	if action == "recolor_model":
		color = str(parsed.get("color", "default"))
		target = str(parsed.get("target", "model"))
		color_anchor: list[float] | None = None
		if target == "sphere":
			entry = _latest_shape_entry_with_center({"sphere", "ball"})
			if isinstance(entry, dict):
				center_m = entry.get("center_m")
				if isinstance(center_m, list) and len(center_m) == 3:
					try:
						color_anchor = [float(center_m[0]), float(center_m[1]), float(center_m[2])]
					except Exception:
						color_anchor = None
		message = (
			"Applied visual update: restored default color."
			if color == "default"
			else f"Applied visual update: recolored {target} to {color}."
		)
		return ChatPromptResponse(
			message=message,
			llm_ready=True,
			has_region_selection=bool(payload.region_selection),
			region_topology_id=topology_id,
			topology_status=topology_status,
			executed=True,
			action=action,
			model_color=color,
			model_color_target=target,
			model_color_anchor=color_anchor,
		)

	if not (document_id and workspace_id and element_id) and action in {"resize_last_shape", "replace_last_shape"}:
		entry = _latest_created_shape_entry()
		if isinstance(entry, dict):
			document_id = entry.get("document_id")
			workspace_type = entry.get("workspace_type")
			workspace_id = entry.get("workspace_id")
			element_id = entry.get("element_id")

	if not (document_id and workspace_id and element_id):
		return ChatPromptResponse(
			message="Selection JSON is missing CAD context (document/workspace/element). Please reselect and submit again.",
			llm_ready=True,
			has_region_selection=bool(payload.region_selection),
			region_topology_id=topology_id,
			topology_status=topology_status,
			executed=False,
			action=parsed["action"],
		)

	wvm = workspace_type if workspace_type in {"w", "v", "m"} else "w"

	if parsed["action"] in {
		"add_boxes_each_side",
		"add_boxes_all_sides",
		"add_box_above",
		"add_box_below",
		"add_center_box",
		"resize_last_shape",
		"replace_last_shape",
		"cut_pocket",
		"add_boss",
		"add_mound",
		"drill_hole",
		"cut_slot",
		"pattern_boxes",
		"fillet_request",
		"chamfer_request",
	}:
		action = parsed["action"]
		shape = str(parsed.get("shape", "box"))

		if action == "resize_last_shape":
			entry = _latest_created_shape_entry()
			if not entry:
				return ChatPromptResponse(
					message="No previous generated shape found to resize. Add one first, then ask to make it bigger or smaller.",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=False,
					action=action,
				)

			current_size = float(entry.get("size_mm", 3.0))
			if parsed.get("size_mm") is not None:
				target_size = max(0.1, float(parsed["size_mm"]))
			else:
				factor = float(parsed.get("factor", 1.2))
				target_size = max(0.1, current_size * factor)

			feature_id = str(entry.get("created_feature_id"))
			created_shape = str(entry.get("created_shape", "box"))

			try:
				onshape_client.update_primitive_feature_size(
					document_id,
					workspace_id,
					element_id,
					feature_id,
					created_shape,
					target_size,
				)
				operation_id = f"op_{int(time.time() * 1000)}"
				_EXECUTION_HISTORY.appendleft(
					{
						"operation_id": operation_id,
						"timestamp": int(time.time()),
						"status": "executed",
						"action": action,
						"prompt": payload.prompt,
						"document_id": document_id,
						"workspace_type": wvm,
						"workspace_id": workspace_id,
						"element_id": element_id,
						"region_topology_id": topology_id,
						"topology_status": topology_status,
						"created_feature_id": feature_id,
						"created_shape": created_shape,
						"size_mm": target_size,
						"center_m": entry.get("center_m"),
					},
				)
				_save_history_to_disk()
				return ChatPromptResponse(
					message=f"Applied edit: resized last {created_shape} to {target_size:g} mm.",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=True,
					action=action,
					operation_id=operation_id,
					undo_available=False,
					undo_hint="Use Onshape feature rollback/history to undo this operation.",
				)
			except Exception as exc:
				return ChatPromptResponse(
					message=f"Resize parsed but execution failed: {str(exc)}",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=False,
					action=action,
				)

		if action == "replace_last_shape":
			entry = _latest_created_shape_entry()
			if not entry:
				return ChatPromptResponse(
					message="No previous generated shape found to replace. Add one first, then ask to convert it.",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=False,
					action=action,
				)

			target_shape = str(parsed.get("shape", entry.get("created_shape", "box"))).lower().strip()
			if target_shape not in {"box", "sphere", "ball"}:
				target_shape = "box"

			current_shape = str(entry.get("created_shape", "box"))
			target_size = (
				max(0.1, float(parsed["size_mm"]))
				if parsed.get("size_mm") is not None
				else max(0.1, float(entry.get("size_mm", 3.0)))
			)

			center_m = entry.get("center_m")
			if not (isinstance(center_m, list) and len(center_m) == 3):
				return ChatPromptResponse(
					message="Could not locate the last shape center to convert. Add a new shape and retry.",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=False,
					action=action,
				)

			try:
				transform_feature_id = entry.get("transform_feature_id")
				primitive_feature_id = entry.get("created_feature_id")
				if isinstance(transform_feature_id, str) and transform_feature_id:
					onshape_client.delete_feature(document_id, wvm, workspace_id, element_id, transform_feature_id)
				if isinstance(primitive_feature_id, str) and primitive_feature_id:
					onshape_client.delete_feature(document_id, wvm, workspace_id, element_id, primitive_feature_id)

				created = onshape_client.add_cube_at_position(
					document_id,
					wvm,
					workspace_id,
					element_id,
					target_size,
					float(center_m[0]),
					float(center_m[1]),
					float(center_m[2]),
					shape=target_shape,
				)

				operation_id = f"op_{int(time.time() * 1000)}"
				_EXECUTION_HISTORY.appendleft(
					{
						"operation_id": operation_id,
						"timestamp": int(time.time()),
						"status": "executed",
						"action": action,
						"prompt": payload.prompt,
						"document_id": document_id,
						"workspace_type": wvm,
						"workspace_id": workspace_id,
						"element_id": element_id,
						"region_topology_id": topology_id,
						"topology_status": topology_status,
						"created_feature_id": created.get("primitive_feature_id"),
						"transform_feature_id": created.get("transform_feature_id"),
						"created_shape": target_shape,
						"size_mm": target_size,
						"center_m": created.get("center_m"),
					},
				)
				_save_history_to_disk()
				return ChatPromptResponse(
					message=f"Applied edit: converted last {current_shape} to {target_shape} at {target_size:g} mm.",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=True,
					action=action,
					operation_id=operation_id,
				)
			except Exception as exc:
				return ChatPromptResponse(
					message=f"Shape conversion failed: {str(exc)}",
					llm_ready=True,
					has_region_selection=bool(payload.region_selection),
					region_topology_id=topology_id,
					topology_status=topology_status,
					executed=False,
					action=action,
				)

		selected_spatial = selected_region.get("spatial_math") if isinstance(selected_region, dict) else {}
		bbox = selected_spatial.get("bounding_box") if isinstance(selected_spatial, dict) else None
		bbox_min = (bbox or {}).get("min") if isinstance(bbox, dict) else None
		bbox_max = (bbox or {}).get("max") if isinstance(bbox, dict) else None
		center = selected_spatial.get("center_of_mass") if isinstance(selected_spatial, dict) else None
		normal = selected_spatial.get("surface_normal") if isinstance(selected_spatial, dict) else None
		support_point_outward = selected_spatial.get("support_point_outward") if isinstance(selected_spatial, dict) else None
		support_point_inward = selected_spatial.get("support_point_inward") if isinstance(selected_spatial, dict) else None
		selection_view = selected_region.get("selection_view") if isinstance(selected_region, dict) else None
		camera_position = selection_view.get("camera_position") if isinstance(selection_view, dict) else None
		bbox_tuple = (
			float(bbox_min[0]),
			float(bbox_min[1]),
			float(bbox_min[2]),
			float(bbox_max[0]),
			float(bbox_max[1]),
			float(bbox_max[2]),
		) if isinstance(bbox_min, list) and isinstance(bbox_max, list) and len(bbox_min) == 3 and len(bbox_max) == 3 else (-0.01, -0.01, -0.01, 0.01, 0.01, 0.01)

		center_x = float(center[0]) if isinstance(center, list) and len(center) == 3 else 0.0
		center_y = float(center[1]) if isinstance(center, list) and len(center) == 3 else 0.0
		center_z = float(center[2]) if isinstance(center, list) and len(center) == 3 else 0.0

		nx = float(normal[0]) if isinstance(normal, list) and len(normal) == 3 else 0.0
		ny = float(normal[1]) if isinstance(normal, list) and len(normal) == 3 else 0.0
		nz = float(normal[2]) if isinstance(normal, list) and len(normal) == 3 else 1.0
		norm = math.sqrt(nx * nx + ny * ny + nz * nz)
		if norm < 1e-9:
			nx, ny, nz = 0.0, 0.0, 1.0
		else:
			nx, ny, nz = nx / norm, ny / norm, nz / norm

		if isinstance(camera_position, list) and len(camera_position) == 3:
			cam_x = float(camera_position[0])
			cam_y = float(camera_position[1])
			cam_z = float(camera_position[2])
			to_camera_x = cam_x - center_x
			to_camera_y = cam_y - center_y
			to_camera_z = cam_z - center_z
			if (nx * to_camera_x + ny * to_camera_y + nz * to_camera_z) < 0:
				nx, ny, nz = -nx, -ny, -nz

		bbox_dx = abs(bbox_tuple[3] - bbox_tuple[0])
		bbox_dy = abs(bbox_tuple[4] - bbox_tuple[1])
		bbox_dz = abs(bbox_tuple[5] - bbox_tuple[2])
		bbox_span_m = max(0.001, max(bbox_dx, bbox_dy, bbox_dz))
		half_extent_along_normal = 0.5 * (abs(nx) * bbox_dx + abs(ny) * bbox_dy + abs(nz) * bbox_dz)
		shape_norm = shape.lower().strip()
		is_sphere_shape = shape_norm in {"sphere", "ball"}

		def center_distance_outside_selection_m(size_mm_value: float) -> float:
			half_size_m = float(size_mm_value) * 0.0005
			radius_m = float(size_mm_value) * 0.0005
			box_along_normal_m = half_size_m * (abs(nx) + abs(ny) + abs(nz))
			shape_extent_m = radius_m if is_sphere_shape else box_along_normal_m
			clearance_m = max(shape_extent_m * 0.6, bbox_span_m * 0.035, 0.0012)
			return half_extent_along_normal + shape_extent_m + clearance_m

		contact_outward = (
			(float(support_point_outward[0]), float(support_point_outward[1]), float(support_point_outward[2]))
			if isinstance(support_point_outward, list) and len(support_point_outward) == 3
			else _support_point_from_bbox(bbox_tuple, (center_x, center_y, center_z), nx, ny, nz, positive=True)
		)
		contact_inward = (
			(float(support_point_inward[0]), float(support_point_inward[1]), float(support_point_inward[2]))
			if isinstance(support_point_inward, list) and len(support_point_inward) == 3
			else _support_point_from_bbox(bbox_tuple, (center_x, center_y, center_z), nx, ny, nz, positive=False)
		)

		if action == "add_boxes_each_side":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = None
			summary = f"Applied edit: added symmetric boxes of {size_mm:g} mm around the selected region."
			distance_m = center_distance_outside_selection_m(size_mm)
			target_positions = [
				(center_x + nx * distance_m, center_y + ny * distance_m, center_z + nz * distance_m),
				(center_x - nx * distance_m, center_y - ny * distance_m, center_z - nz * distance_m),
			]
		elif action == "add_boxes_all_sides":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = None
			summary = f"Applied edit: added boxes on all sides with {size_mm:g} mm sizing."
			off_m = max(size_mm * 0.001, bbox_span_m * 0.6)
			target_positions = [
				(center_x + off_m, center_y, center_z),
				(center_x - off_m, center_y, center_z),
				(center_x, center_y + off_m, center_z),
				(center_x, center_y - off_m, center_z),
			]
		elif action == "add_box_above":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = None
			summary = f"Applied edit: added one {shape} above the selected region ({size_mm:g} mm), tangent to surface."
			distance_m = center_distance_outside_selection_m(size_mm)
			target_positions = [
				(center_x + nx * distance_m, center_y + ny * distance_m, center_z + nz * distance_m),
			]
		elif action == "add_box_below":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = None
			summary = f"Applied edit: added one {shape} below the selected region ({size_mm:g} mm), tangent to surface."
			distance_m = center_distance_outside_selection_m(size_mm)
			target_positions = [
				(center_x - nx * distance_m, center_y - ny * distance_m, center_z - nz * distance_m),
			]
		elif action == "cut_pocket":
			depth_mm = apply_safety_mm(float(parsed["depth_mm"]), bbox_tuple)
			script = build_pocket_cut_script(region, depth_mm)
			summary = f"Applied edit: cut a pocket of {depth_mm:g} mm depth at the selected region."
		elif action == "add_boss":
			height_mm = apply_safety_mm(float(parsed["height_mm"]), bbox_tuple)
			script = build_boss_script(region, height_mm)
			summary = f"Applied edit: added boss of {height_mm:g} mm on selected region."
		elif action == "add_mound":
			height_mm = apply_safety_mm(float(parsed["height_mm"]), bbox_tuple)
			script = None
			size_mm = max(0.1, height_mm * 1.8)
			distance_m = center_distance_outside_selection_m(size_mm)
			target_positions = [
				(center_x + nx * distance_m, center_y + ny * distance_m, center_z + nz * distance_m),
			]
			shape = "sphere"
			summary = f"Applied edit: added mound on selected region ({height_mm:g} mm height intent)."
		elif action == "drill_hole":
			diameter_mm = apply_safety_mm(float(parsed["diameter_mm"]), bbox_tuple)
			script = None
			size_mm = diameter_mm
			radius_m = size_mm * 0.0005
			inset_m = max(radius_m * 0.7, bbox_span_m * 0.01, 0.0004)
			target_positions = [
				(center_x - nx * inset_m, center_y - ny * inset_m, center_z - nz * inset_m),
			]
			shape = "sphere"
			summary = f"Applied edit: created hole marker ({diameter_mm:g} mm) on selected region."
		elif action == "cut_slot":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = build_slot_cut_script(region, size_mm)
			summary = f"Applied edit: cut slot at selected region with {size_mm:g} mm scale."
		elif action == "pattern_boxes":
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			count = int(parsed.get("count", 4))
			script = build_pattern_boxes_script(region, size_mm, count)
			summary = f"Applied edit: patterned {count} boxes of {size_mm:g} mm near selected region."
		elif action == "fillet_request":
			radius_mm = apply_safety_mm(float(parsed["radius_mm"]), bbox_tuple)
			script = build_fillet_script(region, radius_mm)
			summary = f"Applied edit: added fillet of {radius_mm:g} mm to edges in selected region volume."
		elif action == "chamfer_request":
			distance_mm = apply_safety_mm(float(parsed["distance_mm"]), bbox_tuple)
			script = build_chamfer_script(region, distance_mm)
			summary = f"Applied edit: added chamfer of {distance_mm:g} mm to edges in selected region volume."
		else:
			size_mm = apply_safety_mm(float(parsed["size_mm"]), bbox_tuple)
			script = None
			summary = f"Applied edit: added one {shape} on the selected region boundary ({size_mm:g} mm), tangent to surface."
			distance_m = center_distance_outside_selection_m(size_mm)
			target_positions = [
				(center_x + nx * distance_m, center_y + ny * distance_m, center_z + nz * distance_m)
			]

		try:
			created_records: list[dict] = []
			if action in {"add_box_above", "add_box_below", "add_center_box", "add_mound", "drill_hole"}:
				for tx, ty, tz in target_positions:
					created_records.append(
						onshape_client.add_cube_at_position(document_id, wvm, workspace_id, element_id, size_mm, tx, ty, tz, shape=shape)
					)
			elif action == "add_boxes_each_side":
				for tx, ty, tz in target_positions:
					created_records.append(
						onshape_client.add_cube_at_position(document_id, wvm, workspace_id, element_id, size_mm, tx, ty, tz, shape=shape)
					)
			elif action == "add_boxes_all_sides":
				for tx, ty, tz in target_positions:
					created_records.append(
						onshape_client.add_cube_at_position(document_id, wvm, workspace_id, element_id, size_mm, tx, ty, tz, shape=shape)
					)
			else:
				onshape_client.execute_featurescript(
					document_id,
					wvm,
					workspace_id,
					element_id,
					script,
				)
			operation_id = f"op_{int(time.time() * 1000)}"
			_EXECUTION_HISTORY.appendleft(
				{
					"operation_id": operation_id,
					"timestamp": int(time.time()),
					"status": "executed",
					"action": action,
					"prompt": payload.prompt,
					"document_id": document_id,
					"workspace_type": wvm,
					"workspace_id": workspace_id,
					"element_id": element_id,
					"region_topology_id": topology_id,
					"topology_status": topology_status,
					"created_feature_id": created_records[0].get("primitive_feature_id") if created_records else None,
					"transform_feature_id": created_records[0].get("transform_feature_id") if created_records else None,
					"created_shape": shape if created_records else None,
					"size_mm": size_mm if created_records else None,
					"center_m": created_records[0].get("center_m") if created_records else None,
				},
			)
			_save_history_to_disk()
			return ChatPromptResponse(
				message=summary,
				llm_ready=True,
				has_region_selection=bool(payload.region_selection),
				region_topology_id=topology_id,
				topology_status=topology_status,
				executed=True,
				action=action,
				operation_id=operation_id,
				undo_available=False,
				undo_hint="Use Onshape feature rollback/history to undo this operation.",
			)
		except Exception as exc:
			operation_id = f"op_{int(time.time() * 1000)}"
			_EXECUTION_HISTORY.appendleft(
				{
					"operation_id": operation_id,
					"timestamp": int(time.time()),
					"status": "failed",
					"action": action,
					"prompt": payload.prompt,
					"document_id": document_id,
					"workspace_type": wvm,
					"workspace_id": workspace_id,
					"element_id": element_id,
					"region_topology_id": topology_id,
					"topology_status": topology_status,
					"error": str(exc),
				},
			)
			_save_history_to_disk()
			return ChatPromptResponse(
				message=f"Action parsed but execution failed: {str(exc)}",
				llm_ready=True,
				has_region_selection=bool(payload.region_selection),
				region_topology_id=topology_id,
				topology_status=topology_status,
				executed=False,
				action=action,
				operation_id=operation_id,
				undo_available=False,
			)

	return ChatPromptResponse(
		message="Prompt was parsed, but no executable operation matched.",
		llm_ready=True,
		has_region_selection=bool(payload.region_selection),
		region_topology_id=topology_id,
		topology_status=topology_status,
		executed=False,
		action=None,
	)
