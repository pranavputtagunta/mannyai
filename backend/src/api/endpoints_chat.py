# backend/api/endpoints_chat.py
from __future__ import annotations

import glob
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import trimesh
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

import cadquery as cq

from api.endpoints_cad import _require_model, _export_step, _export_stl, _stl_to_glb
from services.cq_ai_exec import run_ai_cadquery
from services.timeline import get_timeline, get_model_versions

from core.config import settings

router = APIRouter()

API_KEY = settings.OPENAI_API_KEY
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
    intent: str = "modification"  # modification, query, help, unknown
    code: str | None = None  # Only present for modifications
    glb_url: str | None = None  # Only present for modifications
    step_url: str | None = None  # Only present for modifications
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

def _get_chat_history_for_prompt(model_id: str, max_messages: int = 10) -> str:
    """
    Format recent chat history for inclusion in agent prompts.
    Returns a formatted string of the conversation.
    """
    messages = chat_histories.get(model_id, [])
    if not messages:
        return "No previous conversation."
    
    # Get the most recent messages (excluding the current one being processed)
    recent = messages[-max_messages:]
    
    formatted = []
    for msg in recent:
        role = "User" if msg["role"] == "user" else "Assistant"
        formatted.append(f"{role}: {msg['content']}")
    
    return "\n\n".join(formatted) if formatted else "No previous conversation."


# ============== INTENT CLASSIFICATION ==============

class IntentType:
    MODIFICATION = "modification"
    QUERY = "query"
    HELP = "help"
    ANALYSIS = "analysis"  # Heatmap/spatial analysis questions
    UNKNOWN = "unknown"


def _classify_intent(prompt: str, model_id: str) -> Dict[str, Any]:
    """
    Classify the user's intent using an LLM.
    Returns the intent type and any extracted parameters.
    Includes chat history for context.
    """
    chat_history = _get_chat_history_for_prompt(model_id, max_messages=6)
    schema = {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": ["modification", "query", "help", "analysis", "unknown"]
            },
            "confidence": {
                "type": "number"
            },
            "reasoning": {
                "type": "string"
            }
        },
        "required": ["intent", "confidence", "reasoning"],
        "additionalProperties": False,
    }

    system = """
You are an intent classifier for a CAD (Computer-Aided Design) assistant.

Classify the user's message into ONE of these categories:

1. "modification" - User wants to CHANGE the 3D model. Examples:
   - "Add a hole in the center"
   - "Scale the model by 2x"
   - "Cut a slot on the top"
   - "Make it taller"
   - "Round the edges"

2. "query" - User is ASKING about the model or wants information. Examples:
   - "What are the dimensions?"
   - "How big is this?"
   - "What is the volume?"
   - "Describe this model"
   - "What material should I use?"

3. "help" - User needs help with the tool or is confused. Examples:
   - "What can you do?"
   - "How do I use this?"
   - "Help"
   - "What commands are available?"

4. "analysis" - User wants SPATIAL ANALYSIS with visual heatmap highlighting. Examples:
   - "Where would water collect?"
   - "Which areas are susceptible to vibration damage?"
   - "Where would air get trapped?"
   - "Show me the stress concentration points"
   - "Highlight thin wall sections"
   - "Where are the weak points?"
   - "Which regions would heat up first?"
   - "Show areas prone to cracking"

5. "unknown" - Message doesn't fit the above categories clearly.

Use the conversation history to understand context (e.g., "make it bigger" refers to previous discussion).

OUTPUT JSON ONLY with intent, confidence (0-1), and brief reasoning.
""".strip()

    user_message = f"""
Conversation history:
{chat_history}

Current message to classify:
{prompt}
""".strip()

    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_message}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "IntentClassification",
                    "schema": schema,
                    "strict": True,
                }
            },
        )

        raw = resp.choices[0].message.content
        if not raw:
            return {"intent": IntentType.UNKNOWN, "confidence": 0.0, "reasoning": "Empty response"}
        
        data = json.loads(raw)
        print(f"[INTENT] {data['intent']} (conf: {data['confidence']:.2f}) - {data['reasoning']}", flush=True)
        return data
    except Exception as e:
        print(f"[INTENT ERROR] {e}", flush=True)
        return {"intent": IntentType.UNKNOWN, "confidence": 0.0, "reasoning": str(e)}


def _handle_query(prompt: str, model_id: str, step_path: str) -> str:
    """
    Handle a query about the model - analyze it and respond with information.
    Includes chat history for context.
    """
    chat_history = _get_chat_history_for_prompt(model_id, max_messages=8)
    
    # Load the model to get its properties
    try:
        model = cq.importers.importStep(step_path)
        bb = model.val().BoundingBox()
        
        model_info = f"""
Model dimensions:
- Width (X): {bb.xlen:.2f} mm
- Depth (Y): {bb.ylen:.2f} mm  
- Height (Z): {bb.zlen:.2f} mm
- Bounding box: ({bb.xmin:.2f}, {bb.ymin:.2f}, {bb.zmin:.2f}) to ({bb.xmax:.2f}, {bb.ymax:.2f}, {bb.zmax:.2f})
""".strip()
    except Exception as e:
        model_info = f"Could not analyze model: {e}"

    system = f"""
You are a helpful CAD assistant. The user is asking about their 3D model.

Current model information:
{model_info}

Conversation history:
{chat_history}

Answer the user's question concisely based on the model information and conversation context.
If you cannot answer based on available data, explain what information is missing.
""".strip()

    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
        )
        return resp.choices[0].message.content or "I couldn't generate a response."
    except Exception as e:
        return f"Error processing query: {e}"


def _handle_help() -> str:
    """Return help information about available commands."""
    return """I can help you with your CAD model! Here's what I can do:

**Modifications** - Tell me to change the model:
• "Add a hole in the center"
• "Scale the model by 1.5x"
• "Fillet the edges with 2mm radius"
• "Cut a rectangular slot on top"

**Queries** - Ask me about the model:
• "What are the dimensions?"
• "How tall is this?"

**Analysis** - Ask about regions with heatmap visualization:
• "Where would water collect?"
• "Which areas are susceptible to vibration damage?"
• "Where would air get trapped?"
• "Show me stress concentration points"
• "Highlight thin wall sections"

**Tips**:
• Be specific about sizes (use millimeters)
• Mention locations (top, bottom, center, etc.)
• Analysis questions will show a colored heatmap overlay

What would you like to do?"""


# ============== ANALYSIS/HEATMAP AGENT ==============

class AnalysisType:
    """Types of spatial analysis supported."""
    WATER_COLLECTION = "water_collection"  # Low points where water would pool
    AIR_TRAPPING = "air_trapping"  # Enclosed/concave regions
    THIN_WALLS = "thin_walls"  # Thin sections prone to failure
    STRESS_CONCENTRATION = "stress_concentration"  # Sharp corners, notches
    HEAT_DISSIPATION = "heat_dissipation"  # Areas that would heat up
    VIBRATION = "vibration"  # Areas susceptible to vibration damage
    GENERIC = "generic"  # Custom analysis


def _classify_analysis_type(prompt: str) -> Dict[str, Any]:
    """
    Classify what type of spatial analysis the user is asking for.
    """
    schema = {
        "type": "object",
        "properties": {
            "analysis_type": {
                "type": "string",
                "enum": ["water_collection", "air_trapping", "thin_walls", 
                        "stress_concentration", "heat_dissipation", "vibration", "generic"]
            },
            "description": {
                "type": "string"
            },
            "highlight_criteria": {
                "type": "string"
            }
        },
        "required": ["analysis_type", "description", "highlight_criteria"],
        "additionalProperties": False,
    }

    system = """
You are an engineering analysis classifier. Given a user's question about a 3D model,
determine what type of spatial analysis they need.

Analysis types:
- water_collection: Where water would pool/collect (low points, concave areas)
- air_trapping: Where air would get trapped (enclosed cavities, dead-end channels)
- thin_walls: Thin sections that might be weak (narrow cross-sections)
- stress_concentration: Points of high stress (sharp corners, notches, holes)
- heat_dissipation: Areas that would heat up first or retain heat
- vibration: Areas susceptible to vibration/fatigue damage
- generic: Any other spatial analysis

Provide:
- analysis_type: one of the types above
- description: brief explanation of what we're looking for
- highlight_criteria: geometric criteria to identify these regions (e.g., "vertices with low Z coordinates", "faces with high curvature")

OUTPUT JSON ONLY.
""".strip()

    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "AnalysisClassification",
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        raw = resp.choices[0].message.content
        if not raw:
            return {"analysis_type": "generic", "description": "General analysis", "highlight_criteria": "unknown"}
        data = json.loads(raw)
        print(f"[ANALYSIS] Type: {data['analysis_type']} - {data['description']}", flush=True)
        return data
    except Exception as e:
        print(f"[ANALYSIS ERROR] {e}", flush=True)
        return {"analysis_type": "generic", "description": str(e), "highlight_criteria": "unknown"}


def _compute_vertex_scores(mesh: trimesh.Trimesh, analysis_type: str) -> np.ndarray:
    """
    Compute a score (0-1) for each vertex based on the analysis type.
    Higher scores = more relevant to the analysis (will be highlighted).
    """
    vertices = mesh.vertices
    normals = mesh.vertex_normals
    n_verts = len(vertices)
    scores = np.zeros(n_verts)
    
    if analysis_type == AnalysisType.WATER_COLLECTION:
        # Low Z values = water collection points
        # Also consider concave regions (normals pointing up in valleys)
        z_vals = vertices[:, 2]
        z_min, z_max = z_vals.min(), z_vals.max()
        z_range = z_max - z_min if z_max > z_min else 1.0
        
        # Invert so low Z = high score
        z_scores = 1.0 - (z_vals - z_min) / z_range
        
        # Boost score for upward-facing normals at low points (collecting surfaces)
        up_facing = np.clip(normals[:, 2], 0, 1)  # How much normal points up
        
        scores = z_scores * 0.7 + (z_scores * up_facing) * 0.3
        
    elif analysis_type == AnalysisType.AIR_TRAPPING:
        # High Z values in enclosed/concave regions
        # Downward-facing surfaces at high points
        z_vals = vertices[:, 2]
        z_min, z_max = z_vals.min(), z_vals.max()
        z_range = z_max - z_min if z_max > z_min else 1.0
        
        # High Z = potential air trap
        z_scores = (z_vals - z_min) / z_range
        
        # Downward-facing normals (ceiling surfaces trap air)
        down_facing = np.clip(-normals[:, 2], 0, 1)
        
        scores = z_scores * 0.5 + down_facing * 0.5
        
    elif analysis_type == AnalysisType.THIN_WALLS:
        # Use ray casting to estimate wall thickness
        # For each vertex, cast ray inward and measure distance to opposite surface
        try:
            # Simplified: use distance to centroid as proxy
            centroid = mesh.centroid
            distances = np.linalg.norm(vertices - centroid, axis=1)
            d_min, d_max = distances.min(), distances.max()
            d_range = d_max - d_min if d_max > d_min else 1.0
            
            # Points closer to edges might be thinner (simplified heuristic)
            # Use vertex mean curvature as proxy for thin sections
            if hasattr(mesh, 'vertex_defects'):
                curvatures = np.abs(mesh.vertex_defects)
                c_max = curvatures.max() if curvatures.max() > 0 else 1.0
                scores = curvatures / c_max
            else:
                # Fallback: use distance from centroid (outer = potentially thinner)
                scores = (distances - d_min) / d_range
        except Exception:
            scores = np.random.rand(n_verts) * 0.3  # Fallback
            
    elif analysis_type == AnalysisType.STRESS_CONCENTRATION:
        # Sharp corners and edges = high stress
        # Use vertex curvature/defect angle
        try:
            if hasattr(mesh, 'vertex_defects'):
                defects = np.abs(mesh.vertex_defects)
                d_max = defects.max() if defects.max() > 0 else 1.0
                scores = defects / d_max
            else:
                # Approximate: vertices connected to more faces = smoother
                # Fewer face connections = sharper
                face_counts = np.zeros(n_verts)
                for face in mesh.faces:
                    for v in face:
                        face_counts[v] += 1
                f_min, f_max = face_counts.min(), face_counts.max()
                f_range = f_max - f_min if f_max > f_min else 1.0
                # Invert: fewer faces = sharper = higher score
                scores = 1.0 - (face_counts - f_min) / f_range
        except Exception:
            scores = np.random.rand(n_verts) * 0.3
            
    elif analysis_type == AnalysisType.HEAT_DISSIPATION:
        # Thin sections and extremities heat up first
        # Use distance from centroid (further = heats faster)
        centroid = mesh.centroid
        distances = np.linalg.norm(vertices - centroid, axis=1)
        d_min, d_max = distances.min(), distances.max()
        d_range = d_max - d_min if d_max > d_min else 1.0
        scores = (distances - d_min) / d_range
        
    elif analysis_type == AnalysisType.VIBRATION:
        # Thin sections and cantilevered parts vibrate more
        # Approximate: points far from centroid in XY plane, especially at extremes
        centroid = mesh.centroid
        xy_dist = np.linalg.norm(vertices[:, :2] - centroid[:2], axis=1)
        z_dist = np.abs(vertices[:, 2] - centroid[2])
        
        xy_max = xy_dist.max() if xy_dist.max() > 0 else 1.0
        z_max = z_dist.max() if z_dist.max() > 0 else 1.0
        
        # Combine XY extension and Z extension
        scores = (xy_dist / xy_max) * 0.6 + (z_dist / z_max) * 0.4
        
    else:  # generic
        # Default: highlight outer surfaces based on distance from center
        centroid = mesh.centroid
        distances = np.linalg.norm(vertices - centroid, axis=1)
        d_min, d_max = distances.min(), distances.max()
        d_range = d_max - d_min if d_max > d_min else 1.0
        scores = (distances - d_min) / d_range
    
    # Normalize scores to 0-1
    s_min, s_max = scores.min(), scores.max()
    if s_max > s_min:
        scores = (scores - s_min) / (s_max - s_min)
    
    return scores


def _scores_to_colors(scores: np.ndarray, colormap: str = "hot") -> np.ndarray:
    """
    Convert scores (0-1) to RGBA colors using a heatmap colormap.
    Returns array of shape (n_vertices, 4) with uint8 values.
    """
    n_verts = len(scores)
    colors = np.zeros((n_verts, 4), dtype=np.uint8)
    
    # Simple hot colormap: blue (low) -> yellow -> red (high)
    for i, score in enumerate(scores):
        if score < 0.25:
            # Blue to cyan
            t = score / 0.25
            r, g, b = 0, int(255 * t), 255
        elif score < 0.5:
            # Cyan to green
            t = (score - 0.25) / 0.25
            r, g, b = 0, 255, int(255 * (1 - t))
        elif score < 0.75:
            # Green to yellow
            t = (score - 0.5) / 0.25
            r, g, b = int(255 * t), 255, 0
        else:
            # Yellow to red
            t = (score - 0.75) / 0.25
            r, g, b = 255, int(255 * (1 - t)), 0
        
        # Alpha based on score (more visible at high scores)
        alpha = int(128 + 127 * score)
        colors[i] = [r, g, b, alpha]
    
    return colors


def _handle_analysis(prompt: str, model_id: str, step_path: str, model_dir: Path) -> Dict[str, Any]:
    """
    Handle spatial analysis request - generate heatmap visualization.
    Returns dict with message, analysis_type, and glb_url.
    """
    t0 = time.time()
    
    # 1) Classify what type of analysis
    analysis_info = _classify_analysis_type(prompt)
    analysis_type = analysis_info["analysis_type"]
    _tlog("classify_analysis", t0)
    
    # 2) Load the STL mesh
    stl_path = model_dir / "preview.stl"
    if not stl_path.exists():
        # Generate STL from STEP if needed
        try:
            model = cq.importers.importStep(step_path)
            cq.exporters.export(model, str(stl_path), exportType="STL")
        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to load model for analysis: {e}",
                "analysis_type": analysis_type,
            }
    
    t1 = time.time()
    try:
        loaded = trimesh.load_mesh(str(stl_path))
        # Ensure we have a single Trimesh, not a Scene
        if isinstance(loaded, trimesh.Scene):
            # Concatenate all geometries in the scene
            meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
            if meshes:
                mesh = trimesh.util.concatenate(meshes)
            else:
                raise ValueError("No valid meshes found in scene")
        elif isinstance(loaded, trimesh.Trimesh):
            mesh = loaded
        else:
            raise ValueError(f"Unexpected mesh type: {type(loaded)}")
    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to load mesh: {e}",
            "analysis_type": analysis_type,
        }
    _tlog("load_mesh", t1)
    
    # 3) Compute vertex scores based on analysis type
    t2 = time.time()
    scores = _compute_vertex_scores(mesh, analysis_type)
    _tlog("compute_scores", t2)
    
    # 4) Convert scores to vertex colors
    t3 = time.time()
    colors = _scores_to_colors(scores)
    mesh.visual.vertex_colors = colors
    _tlog("apply_colors", t3)
    
    # 5) Export colored mesh as GLB
    t4 = time.time()
    heatmap_glb_path = model_dir / "heatmap.glb"
    mesh.export(str(heatmap_glb_path), file_type="glb")
    _tlog("export_glb", t4)
    
    # 6) Generate explanation message
    explanation = f"""**Analysis: {analysis_info['description']}**

I've highlighted the model based on: {analysis_info['highlight_criteria']}

**Color Legend:**
🔵 Blue/Cyan = Low relevance
🟢 Green = Moderate
🟡 Yellow = High relevance  
🔴 Red = Critical areas

The heatmap shows regions that are most relevant to your question about "{prompt.strip()}"."""

    _tlog("total_analysis", t0)
    
    return {
        "success": True,
        "message": explanation,
        "analysis_type": analysis_type,
        "glb_url": f"/api/cad/{model_id}/download/heatmap",
    }


# ============== MODIFICATION AGENT ==============
def _openai_generate_cadquery(prompt: str, params: Dict[str, Any], model_id: str) -> str:
    """
    Generate CadQuery code for a modification request.
    Includes chat history for context.
    """
    chat_history = _get_chat_history_for_prompt(model_id, max_messages=8)
    cq_database = _load_cadquery_database()  # Load reference scripts for the LLM to learn from
    
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

    system = f"""
You are a CAD automation engineer using CadQuery (Python).

OUTPUT JSON ONLY: {{"code": "..."}} (no markdown).

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
  target_edges = model.edges(
      cq.selectors.BoxSelector(
          (xmin - pad, ymin - pad, zmin - pad),
          (xmax + pad, ymax + pad, zmax + pad)
      )
  )
  
  if len(target_edges.vals()) == 0:
      # Fallback: If the bounding box misses, apply a small safe operation to the whole model
      return model.edges().fillet(1.0) # Adjust fallback operation to match user intent
  
  # CRITICAL: Apply the user's requested operation to target_edges here. 
  # DO NOT blindly use 2.0. Extract the operation (fillet/chamfer) and radius/length from the user's prompt.
  # Example: return target_edges.fillet(5.0) 
  
FOR ADD/SUBTRACT operations without selection:
Place geometry at the bounding box top center or origin depending on the request.

Conversation history (for context on what the user has been working on):
{chat_history}
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

    # ============== INTENT CLASSIFICATION ==============
    t_classify = time.time()
    intent_result = _classify_intent(req.prompt, req.model_id)
    intent = intent_result["intent"]
    _tlog("classify_intent", t_classify)

    # ============== ROUTE BY INTENT ==============
    
    # Handle HELP intent
    if intent == IntentType.HELP:
        help_message = _handle_help()
        _add_to_history(req.model_id, "assistant", help_message)
        return {
            "status": "success",
            "message": help_message,
            "intent": "help",
            "code": None,
            "glb_url": None,
            "step_url": None,
        }
    
    # Handle QUERY intent
    if intent == IntentType.QUERY:
        query_response = _handle_query(req.prompt, req.model_id, str(step_path))
        _add_to_history(req.model_id, "assistant", query_response)
        return {
            "status": "success",
            "message": query_response,
            "intent": "query",
            "code": None,
            "glb_url": None,
            "step_url": None,
        }
    
    # Handle ANALYSIS intent (heatmap visualization)
    if intent == IntentType.ANALYSIS:
        analysis_result = _handle_analysis(req.prompt, req.model_id, str(step_path), model_dir)
        _add_to_history(req.model_id, "assistant", analysis_result["message"])
        
        if analysis_result["success"]:
            return {
                "status": "success",
                "message": analysis_result["message"],
                "intent": "analysis",
                "code": None,
                "glb_url": analysis_result["glb_url"],
                "step_url": None,
            }
        else:
            return {
                "status": "error",
                "message": analysis_result["message"],
                "intent": "analysis",
                "code": None,
                "glb_url": None,
                "step_url": None,
            }
    
    # Handle UNKNOWN intent - try to be helpful
    if intent == IntentType.UNKNOWN and intent_result["confidence"] < 0.5:
        unclear_message = (
            "I'm not sure what you'd like me to do. "
            "Try asking me to modify the model (e.g., 'add a hole') "
            "or ask a question about it (e.g., 'what are the dimensions?')."
        )
        _add_to_history(req.model_id, "assistant", unclear_message)
        return {
            "status": "success",
            "message": unclear_message,
            "intent": "unknown",
            "code": None,
            "glb_url": None,
            "step_url": None,
        }

    # ============== MODIFICATION INTENT ==============
    # Fall through for modification or high-confidence unknown

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
            last_code = _openai_generate_cadquery(req.prompt, req.params, req.model_id)
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
                "intent": "modification",
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