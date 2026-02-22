# backend/api/endpoints_chat.py
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List
import glob
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

import cadquery as cq

from api.endpoints_cad import _require_model, _export_step, _export_stl, _stl_to_glb
from services.cq_ai_exec import run_ai_cadquery
from services.timeline import get_timeline, get_model_versions

from core.config import settings

router = APIRouter()

API_KEY = ""
client = OpenAI(api_key=API_KEY)

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "o3-mini")

# In-memory chat history storage (keyed by model_id)
chat_histories: Dict[str, List[Dict[str, Any]]] = {}


class ChatPromptRequest(BaseModel):
    model_id: str
    prompt: str
    params: Dict[str, Any] = Field(default_factory=dict)
    from_version: int | None = None  # Version being edited from (for truncation)


class ChatPromptResponse(BaseModel):
    status: str
    message: str
    code: str
    glb_url: str
    step_url: str
    model_config = {"protected_namespaces": ()}


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: str


class ChatHistoryResponse(BaseModel):
    model_id: str
    messages: List[ChatMessage]
    model_config = {"protected_namespaces": ()}


class VersionInfo(BaseModel):
    version: int
    commit_hash: str
    message: str
    timestamp: str


class VersionHistoryResponse(BaseModel):
    model_id: str
    versions: List[VersionInfo]
    current_version: int | None
    model_config = {"protected_namespaces": ()}


class RevertRequest(BaseModel):
    version: int


def _bbox_sig(wp: cq.Workplane):
    solid = wp.val()
    # Rounding to 3 decimals handles floating point jitter
    return (round(solid.Volume(), 3), round(solid.Area(), 3))


def _tlog(name: str, t0: float):
    print(f"[T] {name}: {time.time() - t0:.3f}s", flush=True)


def _load_cadquery_database() -> str:
    """Reads all Python scripts from the cad_examples folder to use as reference."""
    examples_dir = os.path.join(os.path.dirname(__file__), "..", "cad_examples")
    db_text = ""
    
    # Check if folder exists and grab all .py files
    if os.path.exists(examples_dir):
        for filepath in glob.glob(os.path.join(examples_dir, "*.py")):
            filename = os.path.basename(filepath)
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
                db_text += f"\n--- REFERENCE SCRIPT: {filename} ---\n{content}\n"
    return db_text

def _openai_generate_cadquery(prompt: str, params: Dict[str, Any]) -> str:
    schema = {
        "type": "object",
        "properties": {
            "thought_process": {
                "type": "string",
                "description": "Plan the geometry. Which reference script techniques will you use?"
            },
            "code": {"type": "string"}
        },
        "required": ["thought_process", "code"],
        "additionalProperties": False,
    }

    # Load the cadquery-contrib scripts!
    cq_database = _load_cadquery_database()

    system = f"""
You are a master CAD automation engineer using CadQuery (Python).

OUTPUT JSON ONLY. Plan your geometry in `thought_process`, then output the `code`.

You MUST define EXACTLY this function:
def modify(model: cq.Workplane, *, params: dict) -> cq.Workplane:
    ...
    return out

RULES:
- Do NOT import anything. `math` and `cq` are available in the global namespace. 
- Units are millimeters.
- ALWAYS return a modified model. 
- DEFAULT BEHAVIOR: Boolean (union/cut) your new features onto the original model.
- REPLACEMENT BEHAVIOR: If the user explicitly asks to "replace" or "clear" the model, DO NOT boolean. Create a brand new `cq.Workplane` and return it as the final output.

UNIVERSAL ADVANCED CAD TECHNIQUES:
- **Lofting (Boats, Wings, Organic Shapes):** To avoid "More than one wire required" errors, you MUST chain `.workplane(offset=X)` directly with drawing commands before calling `.loft()`.
  `boat = cq.Workplane("XY").rect(20, 10).workplane(offset=10).ellipse(15, 8).workplane(offset=10).circle(2).loft()`
- **Sweeping (Pipes, Tubes):** Draw a path, then a profile, then sweep.
  `path = cq.Workplane("XZ").spline([(0,0), (10,10), (20,0)])`
  `pipe = cq.Workplane("XY").circle(2).sweep(path)`
- **Shelling (Hollowing objects):** `hollow_boat = boat.faces(">Z").shell(-1.5)`

DATABASE OF ADVANCED CADQUERY EXAMPLES:
Study these scripts. Use their syntax and techniques to fulfill the user's request.
{cq_database}

TARGETING GEOMETRY (If params contains 'selection_summary'):
  cx, cy, cz = params["selection_summary"]["centroid"]
  xmin, xmax = params["selection_summary"]["x_range"]
  ymin, ymax = params["selection_summary"]["y_range"]
  zmin, zmax = params["selection_summary"]["z_range"]
  
  pad = 5.0
  target_edges = model.edges(cq.selectors.BoxSelector((xmin-pad, ymin-pad, zmin-pad), (xmax+pad, ymax+pad, zmax+pad)))
""".strip()

    user = f"User request:\n{prompt}\n\nparams JSON:\n{json.dumps(params, indent=2)}"

    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "CadQueryCode",
                "schema": schema,
                "strict": True,
            }
        },
    )

    raw = resp.choices[0].message.content
    data = json.loads(raw)
    
    # ---------------------------------------------------------
    # FIX: Safely encode/decode to prevent Windows charmap crash
    # ---------------------------------------------------------
    safe_thought = data['thought_process'].encode('ascii', 'replace').decode('ascii')
    print(f"\n[AI THOUGHT PROCESS]\n{safe_thought}\n", flush=True)
    
    return data["code"].strip()

def _add_to_history(model_id: str, role: str, content: str):
    """Add a message to the chat history for a model."""
    if model_id not in chat_histories:
        chat_histories[model_id] = []
    chat_histories[model_id].append({
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow().isoformat(),
    })


@router.get("/history/{model_id}", response_model=ChatHistoryResponse)
async def get_chat_history(model_id: str):
    """Retrieve chat history for a specific model."""
    messages = chat_histories.get(model_id, [])
    return ChatHistoryResponse(
        model_id=model_id,
        messages=[ChatMessage(**msg) for msg in messages],
    )


@router.delete("/history/{model_id}")
async def clear_chat_history(model_id: str):
    """Clear chat history for a specific model."""
    if model_id in chat_histories:
        chat_histories[model_id] = []
    return {"status": "success", "message": "Chat history cleared."}


@router.get("/versions/{model_id}", response_model=VersionHistoryResponse)
async def get_versions(model_id: str):
    """Get version history for a model."""
    step_path = _require_model(model_id)
    model_dir = step_path.parent
    
    timeline = get_timeline(model_id, model_dir)
    versions = timeline.get_history()
    
    current = timeline.get_current_version()
    current_version = current["version"] if current else None
    
    return VersionHistoryResponse(
        model_id=model_id,
        versions=[VersionInfo(**v) for v in versions],
        current_version=current_version,
    )


@router.post("/versions/{model_id}/checkout")
async def checkout_version(model_id: str, req: RevertRequest):
    """
    Checkout files from a specific version for viewing.
    This is NON-DESTRUCTIVE - history is preserved and you can switch to any version.
    """
    step_path = _require_model(model_id)
    model_dir = step_path.parent
    
    timeline = get_timeline(model_id, model_dir)
    versions = timeline.get_history()
    
    # Find the commit hash for the requested version
    target_version = None
    for v in versions:
        if v["version"] == req.version:
            target_version = v
            break
    
    if not target_version:
        raise HTTPException(404, f"Version {req.version} not found.")
    
    # Checkout files from that version (non-destructive)
    timeline.checkout_version(target_version["commit_hash"])
    
    return {
        "status": "success",
        "message": f"Viewing version {req.version}.",
        "version": req.version,
        "commit_hash": target_version["commit_hash"],
        "glb_url": f"/api/cad/{model_id}/download/glb",
        "step_url": f"/api/cad/{model_id}/download/step",
    }


@router.post("/prompt", response_model=ChatPromptResponse)
async def chat_prompt(req: ChatPromptRequest):

    t_all = time.time()

    # Store user message in history
    _add_to_history(req.model_id, "user", req.prompt)

    step_path = _require_model(req.model_id)
    model_dir = step_path.parent

    if req.params.get("selection"):
        pts = req.params["selection"]
        if pts and len(pts) > 0:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            zs = [p[2] for p in pts]
            req.params["selection_summary"] = {
                "point_count": len(pts),
                "centroid": [round(sum(xs)/len(xs), 3), round(sum(ys)/len(ys), 3), round(sum(zs)/len(zs), 3)],
                "x_range": [round(min(xs), 3), round(max(xs), 3)],
                "y_range": [round(min(ys), 3), round(max(ys), 3)],
                "z_range": [round(min(zs), 3), round(max(zs), 3)],
            }
            del req.params["selection"]  # ← never send raw points to LLM

    MAX_RETRIES = 3
    last_err = "Unknown"
    last_code = ""

    for attempt in range(MAX_RETRIES):
        try:
            # 1) Generate CadQuery code
            t0 = time.time()
            last_code = _openai_generate_cadquery(req.prompt, req.params)  # ← fixed: pass params
            _tlog("openai_generate", t0)

            # 2) Execute AI CadQuery
            t1 = time.time()
            exec_res = run_ai_cadquery(
                code=last_code,
                step_path=str(step_path),
                params=req.params,
                timeout_s=45.0,
            )
            _tlog("run_ai_cadquery", t1)

            # 3) Check execution succeeded — use step_path not model
            if not exec_res.ok or exec_res.step_path is None:  # ← fixed: step_path
                last_err = exec_res.error or "Unknown execution error"
                req.prompt = (
                    f"{req.prompt}\n\n"
                    f"Previous code failed with:\n{last_err}\n"
                    "Rewrite modify() to fix this."
                )
                continue

            # 4) Load result from temp step file
            result_model = cq.importers.importStep(exec_res.step_path)  # ← fixed: load from path

            # 5) Verify geometry changed
            before = _bbox_sig(cq.importers.importStep(str(step_path)))
            after  = _bbox_sig(result_model)

            if before == after:
                last_err = "Model volume and area did not change. The modification had no visible effect."
                req.prompt = (
                    f"{req.prompt}\n\n"
                    f"Your previous attempt produced no change to the model's volume or area.\n"
                    f"You MUST make a visible modification. Try a different approach.\n"
                    f"Ensure your BoxSelector is targeting the right geometry."
                )
                continue
            print("[SIG] before:", before, "after:", after, flush=True)

            # 6) Export preview
            stl_path = model_dir / "preview.stl"
            glb_path = model_dir / "preview.glb"

            t2 = time.time()
            cq.exporters.export(
                result_model,       # ← fixed: use loaded model not exec_res.model
                str(stl_path),
                exportType="STL",
                tolerance=4.0,
            )
            _tlog("export_stl", t2)

            # Export to both preview.step and model.step (for version control)
            cq.exporters.export(result_model, str(model_dir / "preview.step"))
            cq.exporters.export(result_model, str(step_path))  # Update model.step

            t3 = time.time()
            _stl_to_glb(stl_path, glb_path)
            _tlog("stl_to_glb", t3)

            # Commit to version history
            timeline = get_timeline(req.model_id, model_dir)
            
            # If editing from a specific version, use save_revision_from to handle truncation
            if req.from_version is not None:
                # Find the commit hash for the from_version
                versions = timeline.get_history()
                from_commit = None
                for v in versions:
                    if v["version"] == req.from_version:
                        from_commit = v["commit_hash"]
                        break
                
                if from_commit:
                    timeline.save_revision_from(
                        from_commit_hash=from_commit,
                        message=req.prompt[:100],
                        files=["model.step", "preview.step", "preview.stl", "preview.glb"]
                    )
                else:
                    # Fallback to normal save if version not found
                    timeline.save_revision(
                        message=req.prompt[:100],
                        files=["model.step", "preview.step", "preview.stl", "preview.glb"]
                    )
            else:
                timeline.save_revision(
                    message=req.prompt[:100],
                    files=["model.step", "preview.step", "preview.stl", "preview.glb"]
                )

            _tlog("TOTAL_ROUTE_TIME", t_all)

            # Store assistant response in history (without the code)
            assistant_message = f"Applied modification (attempt {attempt + 1})."
            _add_to_history(req.model_id, "assistant", assistant_message)

            return {
                "status": "success",
                "message": assistant_message,
                "code": last_code,
                "glb_url": f"/api/cad/{req.model_id}/download/glb",
                "step_url": f"/api/cad/{req.model_id}/download/step",
            }

        except Exception as e:
            last_err = str(e)
            # ---------------------------------------------------------
            # FIX: Safely encode/decode errors during the retry loop
            # ---------------------------------------------------------
            safe_err = last_err.encode('ascii', 'replace').decode('ascii')
            print(f"[ERR] Attempt {attempt + 1} failed: {safe_err}", flush=True)

    # Store error response in history
    # ---------------------------------------------------------
    # FIX: Safely output final error string
    # ---------------------------------------------------------
    safe_final_err = last_err.encode('ascii', 'replace').decode('ascii')
    error_message = f"Failed after {MAX_RETRIES} attempts. Last error: {safe_final_err}"
    _add_to_history(req.model_id, "assistant", error_message)

    raise HTTPException(
        500,
        detail=error_message,
    )