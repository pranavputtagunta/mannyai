import math
import re
from typing import Any


def _normalize_shape(prompt_lc: str) -> str:
	if any(word in prompt_lc for word in ["sphere", "ball", "circle", "circles", "round", "orb"]):
		return "sphere"
	if any(word in prompt_lc for word in ["box", "boxes", "cube", "square", "squares", "block"]):
		return "box"
	return "box"


def _extract_color(prompt_lc: str) -> str | None:
	hex_match = re.search(r"#([0-9a-f]{6}|[0-9a-f]{3})\b", prompt_lc)
	if hex_match:
		hex_value = hex_match.group(0)
		if len(hex_value) == 4:
			r = hex_value[1]
			g = hex_value[2]
			b = hex_value[3]
			return f"#{r}{r}{g}{g}{b}{b}"
		return hex_value

	color_map = {
		"red": "#ef4444",
		"green": "#22c55e",
		"blue": "#3b82f6",
		"yellow": "#eab308",
		"orange": "#f97316",
		"purple": "#a855f7",
		"pink": "#ec4899",
		"white": "#f5f5f5",
		"black": "#171717",
		"gray": "#9ca3af",
		"grey": "#9ca3af",
		"silver": "#c0c0c0",
		"gold": "#d4af37",
		"teal": "#14b8a6",
	}

	for name, color in color_map.items():
		if re.search(rf"\b{name}\b", prompt_lc):
			return color

	if any(word in prompt_lc for word in ["default color", "reset color", "original color"]):
		return "default"

	return None


def _extract_resize_factor(prompt_lc: str) -> float | None:
	pattern = re.search(
		r"(\d+(?:\.\d+)?)\s*(x|times?)\s*(bigger|larger|increase|grow|big|smaller|reduce|shrink|small)",
		prompt_lc,
	)
	if not pattern:
		pattern = re.search(
			r"(bigger|larger|increase|grow|big|smaller|reduce|shrink|small)\s*by\s*(\d+(?:\.\d+)?)\s*(x|times?)",
			prompt_lc,
		)
		if not pattern:
			return None
		word = pattern.group(1)
		amount = float(pattern.group(2))
	else:
		amount = float(pattern.group(1))
		word = pattern.group(3)

	if amount <= 0:
		return None

	if word in {"smaller", "reduce", "shrink", "small"}:
		return 1.0 / amount
	return amount


def parse_box_operation(prompt: str) -> dict[str, Any] | None:
	prompt_lc = prompt.lower()

	color = _extract_color(prompt_lc)
	recolor_intent = any(word in prompt_lc for word in ["recolor", "colour", "color", "paint", "tint"])
	natural_recolor_intent = (
		color is not None
		and any(word in prompt_lc for word in ["make", "set", "turn", "change"])
		and any(word in prompt_lc for word in ["red", "green", "blue", "yellow", "orange", "purple", "pink", "white", "black", "gray", "grey", "silver", "gold", "teal", "#"])
	)
	if color and (recolor_intent or natural_recolor_intent):
		has_sphere_target = any(word in prompt_lc for word in ["sphere", "ball", "circle", "orb"])
		has_background_target = any(word in prompt_lc for word in ["background", "base", "main body", "body", "plate", "wall", "box"])
		has_all_target = any(word in prompt_lc for word in ["all", "everything", "whole", "entire", "full model", "entire model"])
		has_model_target = any(word in prompt_lc for word in ["model", "part"])

		if color == "default" and not (has_sphere_target or has_background_target or has_all_target or has_model_target):
			target = "all"
		elif has_sphere_target:
			target = "sphere"
		elif has_background_target:
			target = "background"
		elif has_all_target:
			target = "all"
		elif has_model_target:
			target = "model"
		else:
			target = "background"

		return {
			"action": "recolor_model",
			"color": color,
			"target": target,
		}

	value_match = re.search(r"(\d+(?:\.\d+)?)\s*(mm|millimeter|millimeters)?", prompt_lc)
	value_mm = float(value_match.group(1)) if value_match else 3.0

	shape = _normalize_shape(prompt_lc)

	if any(word in prompt_lc for word in ["change", "switch", "convert", "turn"]) and " to " in prompt_lc:
		if any(word in prompt_lc for word in ["circle", "sphere", "ball", "round"]):
			target_shape = "sphere"
		elif any(word in prompt_lc for word in ["square", "box", "cube", "block"]):
			target_shape = "box"
		else:
			target_shape = shape

		return {
			"action": "replace_last_shape",
			"shape": target_shape,
			"size_mm": max(0.1, value_mm) if value_match else None,
		}

	has_resize_intent = any(
		word in prompt_lc
		for word in ["bigger", "larger", "increase", "grow", "big", "smaller", "reduce", "shrink", "small"]
	)
	if has_resize_intent:
		factor = _extract_resize_factor(prompt_lc)
		if factor is None:
			if any(word in prompt_lc for word in ["smaller", "reduce", "shrink", "small"]):
				factor = 0.75
			elif any(word in prompt_lc for word in ["really", "very", "much"]):
				factor = 1.8
			else:
				factor = 1.3

		if value_match and value_match.group(2):
			return {
				"action": "resize_last_shape",
				"size_mm": max(0.1, value_mm),
				"shape": shape,
			}

		return {
			"action": "resize_last_shape",
			"factor": factor,
			"shape": shape,
		}
	count_match = re.search(r"(\d+)\s*(times|instances|copies|boxes)?", prompt_lc)
	count = int(count_match.group(1)) if count_match else 4

	if "pattern" in prompt_lc and ("box" in prompt_lc or "boxes" in prompt_lc):
		return {
			"action": "pattern_boxes",
			"size_mm": max(0.1, value_mm),
			"count": max(2, min(12, count)),
			"shape": shape,
		}

	if "slot" in prompt_lc:
		return {
			"action": "cut_slot",
			"size_mm": max(0.1, value_mm),
		}

	if "hole" in prompt_lc or "drill" in prompt_lc:
		return {
			"action": "drill_hole",
			"diameter_mm": max(0.1, value_mm),
		}

	if "boss" in prompt_lc or ("extrude" in prompt_lc and ("up" in prompt_lc or "above" in prompt_lc or "add" in prompt_lc)):
		return {
			"action": "add_boss",
			"height_mm": max(0.1, value_mm),
		}

	if any(word in prompt_lc for word in ["mound", "dome", "bump", "nub", "knob"]):
		return {
			"action": "add_mound",
			"height_mm": max(0.1, value_mm),
		}

	if "pocket" in prompt_lc or ("cut" in prompt_lc and "box" not in prompt_lc and "boxes" not in prompt_lc):
		return {
			"action": "cut_pocket",
			"depth_mm": max(0.1, value_mm),
		}

	if "fillet" in prompt_lc:
		return {
			"action": "fillet_request",
			"radius_mm": max(0.1, value_mm),
		}

	if "chamfer" in prompt_lc:
		return {
			"action": "chamfer_request",
			"distance_mm": max(0.1, value_mm),
		}

	has_box_keyword = any(
		word in prompt_lc
		for word in ["box", "boxes", "cube", "square", "squares", "circle", "circles", "sphere", "ball"]
	)
	size_mm = value_mm
	if not has_box_keyword:
		if shape != "box":
			if "add" in prompt_lc or "create" in prompt_lc or "place" in prompt_lc:
				if "below" in prompt_lc or "under" in prompt_lc or "bottom" in prompt_lc:
					action = "add_box_below"
				elif "above" in prompt_lc or "top" in prompt_lc or "up" in prompt_lc:
					action = "add_box_above"
				else:
					action = "add_center_box"
				return {
					"action": action,
					"size_mm": max(0.1, size_mm),
					"shape": shape,
				}
		return None

	if "each side" in prompt_lc or "both side" in prompt_lc or "both sides" in prompt_lc:
		action = "add_boxes_each_side"
	elif "all sides" in prompt_lc or "around" in prompt_lc or "surround" in prompt_lc:
		action = "add_boxes_all_sides"
	elif "below" in prompt_lc or "under" in prompt_lc or "bottom" in prompt_lc:
		action = "add_box_below"
	elif "above" in prompt_lc or "top" in prompt_lc or "up" in prompt_lc:
		action = "add_box_above"
	else:
		action = "add_center_box"

	return {
		"action": action,
		"size_mm": max(0.1, size_mm),
		"shape": shape,
	}


def apply_safety_mm(requested_mm: float, bbox: tuple[float, float, float, float, float, float]) -> float:
	min_x, min_y, min_z, max_x, max_y, max_z = bbox
	dx = abs(max_x - min_x)
	dy = abs(max_y - min_y)
	dz = abs(max_z - min_z)
	bbox_scale_mm = max(dx, dy, dz) * 1000.0
	max_allowed_mm = max(1.0, min(25.0, bbox_scale_mm * 1.5))
	return max(0.1, min(float(requested_mm), max_allowed_mm))


def _as_tuple3(value: Any, fallback: tuple[float, float, float]) -> tuple[float, float, float]:
	if not isinstance(value, (list, tuple)) or len(value) != 3:
		return fallback
	try:
		return float(value[0]), float(value[1]), float(value[2])
	except Exception:
		return fallback


def build_boxes_each_side_script(
	region_selection: dict[str, Any],
	size_mm: float,
) -> str:
	selected_region = region_selection.get("selected_region", {}) if isinstance(region_selection, dict) else {}
	spatial = selected_region.get("spatial_math", {}) if isinstance(selected_region, dict) else {}

	center = _as_tuple3(spatial.get("center_of_mass"), (0.0, 0.0, 0.0))
	normal = _as_tuple3(spatial.get("surface_normal"), (0.0, 0.0, 1.0))
	bbox = spatial.get("bounding_box") if isinstance(spatial, dict) else None

	bmin = _as_tuple3((bbox or {}).get("min"), (center[0] - 0.005, center[1] - 0.005, center[2] - 0.005))
	bmax = _as_tuple3((bbox or {}).get("max"), (center[0] + 0.005, center[1] + 0.005, center[2] + 0.005))

	nx, ny, nz = normal
	length = math.sqrt(nx * nx + ny * ny + nz * nz)
	if length < 1e-9:
		nx, ny, nz = 0.0, 0.0, 1.0
	else:
		nx, ny, nz = nx / length, ny / length, nz / length

	half = size_mm * 0.0005
	offset = size_mm * 0.001

	min_x, min_y, min_z = bmin
	max_x, max_y, max_z = bmax

	ex1_min = min_x + nx * offset - half
	ex1_max = max_x + nx * offset + half
	ey1_min = min_y + ny * offset - half
	ey1_max = max_y + ny * offset + half
	ez1_min = min_z + nz * offset - half
	ez1_max = max_z + nz * offset + half

	ex2_min = min_x - nx * offset - half
	ex2_max = max_x - nx * offset + half
	ey2_min = min_y - ny * offset - half
	ey2_max = max_y - ny * offset + half
	ez2_min = min_z - nz * offset - half
	ez2_max = max_z - nz * offset + half

	return f'''
FeatureScript 1833;
import(path : "onshape/std/geometry.fs", version : "1833.0");
import(path : "onshape/std/topology.fs", version : "1833.0");

annotation {{"Feature Type Name" : "AgentFix Symmetric Boxes"}}
export const agentfixSymmetricBoxes = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {{ }}
    {{
        opBox(context, id + "boxA", {{
            "corner1" : vector({ex1_min}, {ey1_min}, {ez1_min}) * meter,
            "corner2" : vector({ex1_max}, {ey1_max}, {ez1_max}) * meter
        }});

        opBox(context, id + "boxB", {{
            "corner1" : vector({ex2_min}, {ey2_min}, {ez2_min}) * meter,
            "corner2" : vector({ex2_max}, {ey2_max}, {ez2_max}) * meter
        }});
    }});
'''.strip()


def _script_from_boxes(boxes: list[tuple[tuple[float, float, float], tuple[float, float, float]]]) -> str:
	op_lines = []
	for index, (corner1, corner2) in enumerate(boxes):
		op_lines.append(
			f'''
        opBox(context, id + "box{index}", {{
            "corner1" : vector({corner1[0]}, {corner1[1]}, {corner1[2]}) * meter,
            "corner2" : vector({corner2[0]}, {corner2[1]}, {corner2[2]}) * meter
        }});
'''.rstrip()
		)

	ops_body = "\n".join(op_lines)
	return f'''
FeatureScript 1833;
import(path : "onshape/std/geometry.fs", version : "1833.0");
import(path : "onshape/std/topology.fs", version : "1833.0");

annotation {{"Feature Type Name" : "AgentFix Generated Boxes"}}
export const agentfixGeneratedBoxes = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {{ }}
    {{
{ops_body}
    }});
'''.strip()


def _region_spatial(region_selection: dict[str, Any]) -> dict[str, Any]:
	selected_region = region_selection.get("selected_region", {}) if isinstance(region_selection, dict) else {}
	spatial = selected_region.get("spatial_math", {}) if isinstance(selected_region, dict) else {}
	center = _as_tuple3(spatial.get("center_of_mass"), (0.0, 0.0, 0.0))
	bbox = spatial.get("bounding_box") if isinstance(spatial, dict) else None
	bmin = _as_tuple3((bbox or {}).get("min"), (center[0] - 0.005, center[1] - 0.005, center[2] - 0.005))
	bmax = _as_tuple3((bbox or {}).get("max"), (center[0] + 0.005, center[1] + 0.005, center[2] + 0.005))
	normal = _as_tuple3(spatial.get("surface_normal"), (0.0, 0.0, 1.0))

	nx, ny, nz = normal
	length = math.sqrt(nx * nx + ny * ny + nz * nz)
	if length < 1e-9:
		nx, ny, nz = 0.0, 0.0, 1.0
	else:
		nx, ny, nz = nx / length, ny / length, nz / length

	return {
		"center": center,
		"bmin": bmin,
		"bmax": bmax,
		"normal": (nx, ny, nz),
		"bbox": (bmin[0], bmin[1], bmin[2], bmax[0], bmax[1], bmax[2]),
	}


def build_box_above_script(region_selection: dict[str, Any], size_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]
	(nx, ny, nz) = spatial["normal"]
	offset = size_mm * 0.001
	half = size_mm * 0.0005

	corner1 = (min_x + nx * offset - half, min_y + ny * offset - half, min_z + nz * offset - half)
	corner2 = (max_x + nx * offset + half, max_y + ny * offset + half, max_z + nz * offset + half)
	return _script_from_boxes([(corner1, corner2)])


def build_box_below_script(region_selection: dict[str, Any], size_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]
	(nx, ny, nz) = spatial["normal"]
	offset = size_mm * 0.001
	half = size_mm * 0.0005

	corner1 = (min_x - nx * offset - half, min_y - ny * offset - half, min_z - nz * offset - half)
	corner2 = (max_x - nx * offset + half, max_y - ny * offset + half, max_z - nz * offset + half)
	return _script_from_boxes([(corner1, corner2)])


def build_center_box_script(region_selection: dict[str, Any], size_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(cx, cy, cz) = spatial["center"]
	half = size_mm * 0.0005
	corner1 = (cx - half, cy - half, cz - half)
	corner2 = (cx + half, cy + half, cz + half)
	return _script_from_boxes([(corner1, corner2)])


def build_boxes_all_sides_script(region_selection: dict[str, Any], size_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]

	offset = size_mm * 0.001
	half = size_mm * 0.0005

	box_pos_x = (
		(max_x + offset - half, min_y - half, min_z - half),
		(max_x + offset + half, max_y + half, max_z + half),
	)
	box_neg_x = (
		(min_x - offset - half, min_y - half, min_z - half),
		(min_x - offset + half, max_y + half, max_z + half),
	)
	box_pos_y = (
		(min_x - half, max_y + offset - half, min_z - half),
		(max_x + half, max_y + offset + half, max_z + half),
	)
	box_neg_y = (
		(min_x - half, min_y - offset - half, min_z - half),
		(max_x + half, min_y - offset + half, max_z + half),
	)

	return _script_from_boxes([box_pos_x, box_neg_x, box_pos_y, box_neg_y])


def build_pocket_cut_script(region_selection: dict[str, Any], depth_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]
	(nx, ny, nz) = spatial["normal"]

	pad = depth_mm * 0.00035
	depth = depth_mm * 0.001

	# Start slightly above the selected face region and cut inward along surface normal.
	start_min = (
		min_x + nx * pad - pad,
		min_y + ny * pad - pad,
		min_z + nz * pad - pad,
	)
	start_max = (
		max_x + nx * pad + pad,
		max_y + ny * pad + pad,
		max_z + nz * pad + pad,
	)

	end_min = (
		start_min[0] - nx * depth,
		start_min[1] - ny * depth,
		start_min[2] - nz * depth,
	)
	end_max = (
		start_max[0] - nx * depth,
		start_max[1] - ny * depth,
		start_max[2] - nz * depth,
	)

	tool_corner1 = (
		min(start_min[0], end_min[0]),
		min(start_min[1], end_min[1]),
		min(start_min[2], end_min[2]),
	)
	tool_corner2 = (
		max(start_max[0], end_max[0]),
		max(start_max[1], end_max[1]),
		max(start_max[2], end_max[2]),
	)

	return f'''
FeatureScript 1833;
import(path : "onshape/std/geometry.fs", version : "1833.0");
import(path : "onshape/std/topology.fs", version : "1833.0");
import(path : "onshape/std/boolean.fs", version : "1833.0");
import(path : "onshape/std/query.fs", version : "1833.0");

annotation {{"Feature Type Name" : "AgentFix Pocket Cut"}}
export const agentfixPocketCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {{ }}
    {{
        opBox(context, id + "cutTool", {{
            "corner1" : vector({tool_corner1[0]}, {tool_corner1[1]}, {tool_corner1[2]}) * meter,
            "corner2" : vector({tool_corner2[0]}, {tool_corner2[1]}, {tool_corner2[2]}) * meter
        }});

        opBoolean(context, id + "subtractTool", {{
            "tools" : qCreatedBy(id + "cutTool", EntityType.BODY),
            "targets" : qAllModifiableSolidBodiesNoMesh(),
            "operationType" : BooleanOperationType.SUBTRACTION
        }});
    }});
'''.strip()


def build_boss_script(region_selection: dict[str, Any], height_mm: float) -> str:
	# Boss is an additive center box elevated along normal.
	return build_box_above_script(region_selection, height_mm)


def build_hole_cut_script(region_selection: dict[str, Any], diameter_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(cx, cy, cz) = spatial["center"]
	(nx, ny, nz) = spatial["normal"]
	half = diameter_mm * 0.0005
	depth = max(0.001, diameter_mm * 0.002)

	start = (cx + nx * half, cy + ny * half, cz + nz * half)
	end = (start[0] - nx * depth, start[1] - ny * depth, start[2] - nz * depth)

	min_corner = (
		min(start[0], end[0]) - half,
		min(start[1], end[1]) - half,
		min(start[2], end[2]) - half,
	)
	max_corner = (
		max(start[0], end[0]) + half,
		max(start[1], end[1]) + half,
		max(start[2], end[2]) + half,
	)

	return f'''
function(context is Context, queries)
{{
		const holeToolId = makeId("agentfixHoleTool");
		const subtractId = makeId("agentfixHoleSubtract");

		opBox(context, holeToolId, {{
			"corner1" : vector({min_corner[0]}, {min_corner[1]}, {min_corner[2]}) * meter,
			"corner2" : vector({max_corner[0]}, {max_corner[1]}, {max_corner[2]}) * meter
		}});

		opBoolean(context, subtractId, {{
			"tools" : qCreatedBy(holeToolId, EntityType.BODY),
			"targets" : qAllModifiableSolidBodiesNoMesh(),
			"operationType" : BooleanOperationType.SUBTRACTION
		}});

		return true;
}}
'''.strip()


def build_slot_cut_script(region_selection: dict[str, Any], size_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]
	(nx, ny, nz) = spatial["normal"]

	offset = size_mm * 0.0005
	depth = max(0.001, size_mm * 0.001)

	slot_start = (
		min_x - offset + nx * offset,
		min_y - offset + ny * offset,
		min_z - offset + nz * offset,
	)
	slot_end = (
		max_x + offset - nx * depth,
		max_y + offset - ny * depth,
		max_z + offset - nz * depth,
	)

	min_corner = (
		min(slot_start[0], slot_end[0]),
		min(slot_start[1], slot_end[1]),
		min(slot_start[2], slot_end[2]),
	)
	max_corner = (
		max(slot_start[0], slot_end[0]),
		max(slot_start[1], slot_end[1]),
		max(slot_start[2], slot_end[2]),
	)

	return build_pocket_cut_script(
		{
			"selected_region": {
				"spatial_math": {
					"surface_normal": [nx, ny, nz],
					"bounding_box": {"min": list(min_corner), "max": list(max_corner)},
				}
			}
		},
		size_mm,
	)


def build_pattern_boxes_script(region_selection: dict[str, Any], size_mm: float, count: int) -> str:
	spatial = _region_spatial(region_selection)
	(cx, cy, cz) = spatial["center"]
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]
	span_x = max(0.001, abs(max_x - min_x))
	half = size_mm * 0.0005

	count = max(2, min(12, int(count)))
	step = span_x / max(1, count - 1)
	start_x = cx - (step * (count - 1) / 2)

	boxes: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
	for index in range(count):
		x = start_x + index * step
		boxes.append(((x - half, cy - half, cz - half), (x + half, cy + half, cz + half)))

	return _script_from_boxes(boxes)


def build_fillet_script(region_selection: dict[str, Any], radius_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]

	pad = radius_mm * 0.001
	min_corner = (min_x - pad, min_y - pad, min_z - pad)
	max_corner = (max_x + pad, max_y + pad, max_z + pad)

	return f'''
FeatureScript 1833;
import(path : "onshape/std/geometry.fs", version : "1833.0");
import(path : "onshape/std/topology.fs", version : "1833.0");
import(path : "onshape/std/query.fs", version : "1833.0");
import(path : "onshape/std/fillet.fs", version : "1833.0");

annotation {{"Feature Type Name" : "AgentFix Fillet"}}
export const agentfixFillet = defineFeature(function(context is Context, id is Id, definition is map)
	precondition {{ }}
	{{
		const box = box3d(
			vector({min_corner[0]}, {min_corner[1]}, {min_corner[2]}) * meter,
			vector({max_corner[0]}, {max_corner[1]}, {max_corner[2]}) * meter
		);

		const candidateEdges = qWithinBox(qEverything(EntityType.EDGE), box);

		opFillet(context, id + "fillet", {{
			"entities" : candidateEdges,
			"radius" : {radius_mm} * millimeter
		}});
	}});
'''.strip()


def build_chamfer_script(region_selection: dict[str, Any], distance_mm: float) -> str:
	spatial = _region_spatial(region_selection)
	(min_x, min_y, min_z) = spatial["bmin"]
	(max_x, max_y, max_z) = spatial["bmax"]

	pad = distance_mm * 0.001
	min_corner = (min_x - pad, min_y - pad, min_z - pad)
	max_corner = (max_x + pad, max_y + pad, max_z + pad)

	return f'''
FeatureScript 1833;
import(path : "onshape/std/geometry.fs", version : "1833.0");
import(path : "onshape/std/topology.fs", version : "1833.0");
import(path : "onshape/std/query.fs", version : "1833.0");
import(path : "onshape/std/chamfer.fs", version : "1833.0");

annotation {{"Feature Type Name" : "AgentFix Chamfer"}}
export const agentfixChamfer = defineFeature(function(context is Context, id is Id, definition is map)
	precondition {{ }}
	{{
		const box = box3d(
			vector({min_corner[0]}, {min_corner[1]}, {min_corner[2]}) * meter,
			vector({max_corner[0]}, {max_corner[1]}, {max_corner[2]}) * meter
		);

		const candidateEdges = qWithinBox(qEverything(EntityType.EDGE), box);

		opChamfer(context, id + "chamfer", {{
			"entities" : candidateEdges,
			"chamferType" : ChamferType.EQUAL_OFFSETS,
			"width" : {distance_mm} * millimeter
		}});
	}});
'''.strip()
