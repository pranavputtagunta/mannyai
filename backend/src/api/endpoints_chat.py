# backend/api/endpoints_chat.py
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

import cadquery as cq

from api.endpoints_cad import _require_model, _export_step, _export_stl, _stl_to_glb
from services.cq_ai_exec import run_ai_cadquery

from core.config import settings

router = APIRouter()

client = OpenAI(api_key=settings.OPENAI_API_KEY)

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")


class ChatPromptRequest(BaseModel):
    model_id: str
    prompt: str
    params: Dict[str, Any] = Field(default_factory=dict)


class ChatPromptResponse(BaseModel):
    status: str
    message: str
    code: str
    glb_url: str
    step_url: str
    model_config = {"protected_namespaces": ()}


def _bbox_sig(wp: cq.Workplane):
    bb = wp.val().BoundingBox()
    return (round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3))


def _tlog(name: str, t0: float):
    print(f"[T] {name}: {time.time() - t0:.3f}s", flush=True)


def _openai_generate_cadquery(prompt: str, params: Dict[str, Any]) -> str:
    schema = {
        "type": "object",
        "properties": {"code": {"type": "string"}},
        "required": ["code"],
        "additionalProperties": False,
    }

    system = """
You are a CAD automation engineer using CadQuery (Python).

OUTPUT JSON ONLY: {"code": "..."} (no markdown).

You MUST define EXACTLY this function:

def modify(model: cq.Workplane, *, params: dict) -> cq.Workplane:
    ...
    return out

RULES:
- Do NOT import anything.
- Do NOT read/write files.
- Use ONLY CadQuery via `cq` and the passed `model`.
- Units are millimeters.
- You MUST make a visible change. If the request is "add X", it must be unioned to the model.
- ALWAYS union onto the original model (never forget to combine).
- If params does not provide a placement point, you MUST place new geometry at the model's bounding box top center + a small offset so it is visible.
""".strip()

    user = f"""
User request:
{prompt}

params JSON:
{json.dumps(params, indent=2)}
""".strip()

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
    if not raw:
        raise RuntimeError("OpenAI returned empty response.")

    data = json.loads(raw)
    return data["code"].strip()


@router.post("/prompt", response_model=ChatPromptResponse)
async def chat_prompt(req: ChatPromptRequest):

    t_all = time.time()

    step_path = _require_model(req.model_id)
    model_dir = step_path.parent

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

            t3 = time.time()
            _stl_to_glb(stl_path, glb_path)
            _tlog("stl_to_glb", t3)

            _tlog("TOTAL_ROUTE_TIME", t_all)

            return {
                "status": "success",
                "message": f"Applied modification (attempt {attempt + 1}).",
                "code": last_code,
                "glb_url": f"/api/cad/{req.model_id}/download/glb",
                "step_url": f"/api/cad/{req.model_id}/download/step",
            }

        except Exception as e:
            last_err = str(e)
            print(f"[ERR] Attempt {attempt + 1} failed: {last_err}", flush=True)

    raise HTTPException(
        500,
        detail=f"Failed after {MAX_RETRIES} attempts. Last error: {last_err}",
    )