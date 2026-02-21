from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.onshape_api import onshape_client

router = APIRouter()

class FeatureScriptRequest(BaseModel):
    script: str

@router.get("/export/{document_id}/{workspace_id}/{element_id}")
async def export_cad_model(document_id: str, workspace_id: str, element_id: str):
    """
    Export a 3D model from Onshape as GLTF for the frontend viewer.
    """
    try:
        # This will return the GLTF JSON structure
        gltf_data = onshape_client.export_gltf(document_id, workspace_id, element_id)
        return gltf_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export model: {str(e)}")

@router.post("/featurescript/{document_id}/{workspace_id}/{element_id}")
async def run_featurescript(document_id: str, workspace_id: str, element_id: str, request: FeatureScriptRequest):
    """
    Execute a custom FeatureScript to query or modify the model.
    """
    try:
        result = onshape_client.execute_featurescript(document_id, workspace_id, element_id, request.script)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute FeatureScript: {str(e)}")
