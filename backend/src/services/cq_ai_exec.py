# backend/services/cq_ai_exec.py
from __future__ import annotations

import multiprocessing as mp
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, Optional
import math
import cadquery as cq


@dataclass
class ExecResult:
    ok: bool
    error: Optional[str]
    step_path: Optional[str]


def _worker(code: str, step_path: str, params: Dict[str, Any], q: mp.Queue):
    try:
        base = cq.importers.importStep(step_path)

        safe_globals: Dict[str, Any] = {
            "__builtins__": {
                "__import__": __import__,  # <--- CRITICAL FIX: Allows Python to parse 'import' without crashing
                "abs": abs, "min": min, "max": max, "sum": sum, "len": len,
                "range": range, "enumerate": enumerate, "zip": zip,
                "float": float, "int": int, "str": str, "bool": bool,
                "dict": dict, "list": list, "set": set, "tuple": tuple,
                "print": print, "round": round,
            },
            "cq": cq,
            "math": math
        }

        local_env: Dict[str, Any] = {}
        exec(compile(code, "<ai_cadquery>", "exec"), safe_globals, local_env)

        modify = local_env.get("modify") or safe_globals.get("modify")
        if not callable(modify):
            q.put(("error", "AI code must define a callable modify(model, *, params) function."))
            return

        out = modify(base, params=params)
        if not isinstance(out, cq.Workplane):
            q.put(("error", "modify() must return a cadquery.Workplane."))
            return

        # Export to temp file — Workplane can't be pickled across processes
        tmp = tempfile.NamedTemporaryFile(suffix=".step", delete=False)
        tmp.close()
        cq.exporters.export(out, tmp.name)
        q.put(("ok", tmp.name))

    except Exception as e:
        q.put(("error", str(e)))


def run_ai_cadquery(
    code: str,
    step_path: str,
    params: Dict[str, Any],
    timeout_s: float = 30.0
) -> ExecResult:
    q: mp.Queue = mp.Queue()
    p = mp.Process(target=_worker, args=(code, step_path, params, q), daemon=True)
    p.start()
    p.join(timeout=timeout_s)

    if p.is_alive():
        p.kill()
        return ExecResult(
            ok=False,
            error=f"Timed out after {timeout_s}s running CadQuery code.",
            step_path=None
        )

    if q.empty():
        return ExecResult(
            ok=False,
            error="No result returned from worker (possible pickle or import error).",
            step_path=None
        )

    tag, payload = q.get()
    if tag == "ok":
        return ExecResult(ok=True, error=None, step_path=payload)
    return ExecResult(ok=False, error=payload, step_path=None)