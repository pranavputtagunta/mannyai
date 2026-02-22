from __future__ import annotations

import os, shutil, uuid
from pathlib import Path
from typing import Dict, Literal

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import cadquery as cq
import trimesh

from services.timeline import get_timeline

router = APIRouter()

DATA_DIR = Path(os.environ.get("AGENTFIX_DATA_DIR", "./_agentfix_data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_UPLOADS = {".step", ".stp"}
MODELS: Dict[str, Path] = {}  # model_id -> step_path

OpType = Literal["translate", "scale", "add_box_handle"]

class ApplyOpRequest(BaseModel):
    op: OpType
    dx: float = 0.0
    dy: float = 0.0
    dz: float = 0.0
    scale: float = 1.0
    handle_width: float = 50.0
    handle_depth: float = 14.0
    handle_height: float = 22.0
    handle_lift: float = 2.0
    handle_wall: float = 4.0


def _require_model(model_id: str) -> Path:
    p = MODELS.get(model_id)
    if not p or not p.exists():
        raise HTTPException(404, "Model not found.")
    return p

def _load_step(step_path: Path) -> cq.Workplane:
    try:
        return cq.importers.importStep(str(step_path))
    except Exception as e:
        raise HTTPException(400, f"Failed to import STEP: {e}")

def _export_step(wp: cq.Workplane, out_path: Path) -> None:
    try:
        cq.exporters.export(wp, str(out_path), exportType="STEP")
    except Exception as e:
        raise HTTPException(500, f"Failed to export STEP: {e}")

def _export_stl(wp: cq.Workplane, out_path: Path) -> None:
    try:
        # DEMO FAST MODE:
        # 0.1 = super detailed (slow)
        # 1.0–3.0 = demo quality (fast)
        cq.exporters.export(wp, str(out_path), exportType="STL", tolerance=2.0)
    except Exception as e:
        raise HTTPException(500, f"Failed to export STL: {e}")

def _stl_to_glb(stl_path: Path, glb_path: Path) -> None:
    try:
        # process=False avoids expensive repair/merge work
        mesh = trimesh.load_mesh(str(stl_path), force="mesh", process=False)

        if isinstance(mesh, trimesh.Scene):
            mesh = trimesh.util.concatenate([g for g in mesh.geometry.values()])

        glb_path.write_bytes(trimesh.exchange.gltf.export_glb(mesh))
    except Exception as e:
        raise HTTPException(500, f"Failed STL->GLB: {e}")

def _regen_preview(step_path: Path) -> None:
    model_dir = step_path.parent
    stl_path = model_dir / "preview.stl"
    glb_path = model_dir / "preview.glb"
    preview_step_path = model_dir / "preview.step"
    wp = _load_step(step_path)
    _export_stl(wp, stl_path)
    _stl_to_glb(stl_path, glb_path)
    # Also create preview.step for version control consistency
    _export_step(wp, preview_step_path)

def _apply_op(wp: cq.Workplane, req: ApplyOpRequest) -> cq.Workplane:
    if req.op == "translate":
        return wp.translate((req.dx, req.dy, req.dz))

    if req.op == "scale":
        if req.scale <= 0:
            raise HTTPException(400, "scale must be > 0")
        return wp.scale(req.scale)

    if req.op == "add_box_handle":
        bb = wp.val().BoundingBox()
        cx = (bb.xmin + bb.xmax) / 2.0
        cy = (bb.ymin + bb.ymax) / 2.0
        top = bb.zmax

        W = max(1.0, req.handle_width)
        D = max(1.0, req.handle_depth)
        H = max(1.0, req.handle_height)
        wall = max(0.5, req.handle_wall)
        lift = max(0.0, req.handle_lift)

        outer = (cq.Workplane("XY")
                 .center(cx, cy)
                 .workplane(offset=top + lift + H/2.0)
                 .box(W, D, H, centered=(True, True, True)))

        inner = (cq.Workplane("XY")
                 .center(cx, cy)
                 .workplane(offset=top + lift + (H-wall)/2.0)
                 .box(max(1.0, W-2*wall), max(1.0, D-2*wall), max(1.0, H-wall),
                      centered=(True, True, True)))

        handle = outer.cut(inner)

        footH = max(1.0, lift + wall)
        left_foot = (cq.Workplane("XY")
                     .center(cx - (W/2.0 - wall/2.0), cy)
                     .workplane(offset=top + footH/2.0)
                     .box(wall, D, footH, centered=(True, True, True)))
        right_foot = (cq.Workplane("XY")
                      .center(cx + (W/2.0 - wall/2.0), cy)
                      .workplane(offset=top + footH/2.0)
                      .box(wall, D, footH, centered=(True, True, True)))

        return wp.union(handle).union(left_foot).union(right_foot)

    raise HTTPException(400, f"Unsupported op: {req.op}")


@router.post("/upload")
async def upload_step(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_UPLOADS:
        raise HTTPException(400, f"Upload .step/.stp only. Got {ext}")

    model_id = uuid.uuid4().hex
    model_dir = DATA_DIR / model_id
    model_dir.mkdir(parents=True, exist_ok=True)

    step_path = model_dir / "model.step"
    with step_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    _ = _load_step(step_path)
    _regen_preview(step_path)

    # Initialize version history with initial commit
    timeline = get_timeline(model_id, model_dir)
    timeline.save_revision(
        message="Initial upload",
        files=["model.step", "preview.step", "preview.stl", "preview.glb"]
    )

    MODELS[model_id] = step_path
    return {
        "status": "success",
        "model_id": model_id,
        "glb_url": f"/api/cad/{model_id}/download/glb",
        "step_url": f"/api/cad/{model_id}/download/step",
    }


@router.post("/{model_id}/apply")
@router.post("/{model_id}/apply")
async def apply(model_id: str, req: ApplyOpRequest):
    step_path = _require_model(model_id)

    # 1) Import once
    wp = _load_step(step_path)

    # 2) Apply op
    wp2 = _apply_op(wp, req)

    # 3) Export STEP (keep for download)
    _export_step(wp2, step_path)

    # 4) Export preview directly from wp2 (NO re-import)
    model_dir = step_path.parent
    stl_path = model_dir / "preview.stl"
    glb_path = model_dir / "preview.glb"

    _export_stl(wp2, stl_path)     # make this coarse (next section)
    _stl_to_glb(stl_path, glb_path)

    return {
        "status": "success",
        "model_id": model_id,
        "glb_url": f"/api/cad/{model_id}/download/glb",
        "step_url": f"/api/cad/{model_id}/download/step",
        "message": f"Applied {req.op}.",
    }

@router.get("/{model_id}/download/step")
async def download_step(model_id: str):
    step_path = _require_model(model_id)
    return FileResponse(str(step_path), filename="model.step", media_type="application/step")


@router.get("/{model_id}/download/glb")
async def download_glb(model_id: str):
    step_path = _require_model(model_id)
    glb_path = step_path.parent / "preview.glb"
    if not glb_path.exists():
        _regen_preview(step_path)
    return FileResponse(str(glb_path), filename="preview.glb", media_type="model/gltf-binary")


@router.get("/{model_id}/download/heatmap")
async def download_heatmap(model_id: str):
    """Download the heatmap-colored GLB file for analysis visualization."""
    step_path = _require_model(model_id)
    heatmap_path = step_path.parent / "heatmap.glb"
    if not heatmap_path.exists():
        raise HTTPException(404, "No heatmap analysis available. Run an analysis query first.")
    return FileResponse(str(heatmap_path), filename="heatmap.glb", media_type="model/gltf-binary")


@router.post("/{model_id}/save")
async def save_checkpoint(model_id: str):
    step_path = _require_model(model_id)
    model_dir = step_path.parent
    preview_stl = model_dir / "preview.stl"

    # Load the current preview and overwrite the base STEP
    if not preview_stl.exists():
        raise HTTPException(400, "No modified model to save yet.")

    # Re-export preview STL back to STEP as the new base
    model = cq.importers.importStep(str(step_path))
    preview_step = model_dir / "preview.step"

    if preview_step.exists():
        # preview.step exists if we saved it — use that as new base
        import shutil
        shutil.copy(preview_step, step_path)
    else:
        raise HTTPException(400, "No preview STEP found. Run a modification first.")

    return {"status": "saved", "message": "Model checkpoint saved as new base."}