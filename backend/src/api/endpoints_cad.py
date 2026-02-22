from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
from core.config import settings
from services.onshape_api import onshape_client
from models.schemas import CADModificationRequest, ChatMessage
from services.agentic_loop import determine_intent, run_cad_agent

router = APIRouter()

class FeatureScriptRequest(BaseModel):
    script: str

@router.get("/health/edit-capability")
async def get_edit_capability_health():
    """
    Reports whether backend model editing is configured and reachable.
    """
    missing_env = []
    if not settings.ONSHAPE_ACCESS_KEY:
        missing_env.append("ONSHAPE_ACCESS_KEY")
    if not settings.ONSHAPE_SECRET_KEY:
        missing_env.append("ONSHAPE_SECRET_KEY")
    if not settings.GEMINI_API_KEY:
        missing_env.append("GEMINI_API_KEY")

    try:
        health_response = requests.get(
            f"{settings.ONSHAPE_BASE_URL}/api/users/sessioninfo",
            auth=(settings.ONSHAPE_ACCESS_KEY, settings.ONSHAPE_SECRET_KEY),
            timeout=8,
        )
        connectivity = {
            "ok": health_response.ok,
            "status_code": health_response.status_code,
            "error": "" if health_response.ok else health_response.text[:300],
        }
    except requests.RequestException as exc:
        connectivity = {
            "ok": False,
            "status_code": None,
            "error": str(exc),
        }

    onshape_ok = connectivity.get("ok", False)

    return {
        "status": "success",
        "editing_enabled": len(missing_env) == 0 and onshape_ok,
        "mode": "native-built-in-features",
        "missing_env": missing_env,
        "onshape": connectivity,
    }

@router.get("/export/{document_id}/{wvm}/{workspace_id}/{element_id}")
async def export_cad_model(document_id: str, wvm: str, workspace_id: str, element_id: str):
    """
    Export a 3D model from Onshape as GLTF for the frontend viewer.
    """
    try:
        # This will return the GLTF JSON structure
        gltf_data = onshape_client.export_gltf(document_id, wvm, workspace_id, element_id)
        return gltf_data
    except Exception as e:
        # THIS is what you need to see
        raise HTTPException(status_code=500, detail=repr(e))
    
@router.post("/chat")
async def chat_with_agent(request: CADModificationRequest):
    """
    Step 1 & 2: The user sends a message, and the chatbot determines if a change is required.
    Returns the intent and a confirmation/chat response.
    """
    try:
        current_features = onshape_client.get_features(request.did, 'w', request.wid, request.eid)
        current_parts = onshape_client.get_parts(request.did, 'w', request.wid, request.eid)
        model_context = {
            "features": current_features,
            "parts": current_parts
        }

        # Determine intent
        intent_data = determine_intent(request, model_context)
        
        # Update history with the chatbot's response
        updated_history = request.chat_history + [
            ChatMessage(role="user", content=request.user_message),
            ChatMessage(role="assistant", content=intent_data.get("response", "I'm here to help."))
        ]
        
        return {
            "status": "success",
            "intent": intent_data.get("intent", "chat"),
            "assistant_message": intent_data.get("response", "I'm here to help."),
            "updated_history": [h.dict() for h in updated_history]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/modify")
async def modify_model(request: CADModificationRequest):
    """
    Step 3, 3a, 4: The modification agent generates FeatureScript and executes it.
    """
    try:
        # Get current CAD context
        current_features = onshape_client.get_features(request.did, 'w', request.wid, request.eid)
        current_parts = onshape_client.get_parts(request.did, 'w', request.wid, request.eid)
        model_context = {
            "features": current_features,
            "parts": current_parts
        }
        
        # Run the Agentic Loop to generate and execute FeatureScript
        result = run_cad_agent(request, model_context)
        
        return {
            "status": "success",
            "message": result["message"],
            "script": "",
            "feature_payload": result.get("feature_payload", {}),
            "api_response": result.get("api_response", {})
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/featurescript/{document_id}/{wvm}/{workspace_id}/{element_id}")
async def run_featurescript(document_id: str, wvm: str, workspace_id: str, element_id: str, request: FeatureScriptRequest):
    """
    Execute a custom FeatureScript to query or modify the model.
    """
    try:
        result = onshape_client.execute_featurescript(document_id, wvm, workspace_id, element_id, request.script)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute FeatureScript: {str(e)}")
