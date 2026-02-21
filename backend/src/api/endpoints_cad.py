from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.onshape_api import onshape_client

router = APIRouter()

class FeatureScriptRequest(BaseModel):
    script: str

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.onshape_api import onshape_client

router = APIRouter()

class FeatureScriptRequest(BaseModel):
    script: str

@router.get("/export/{document_id}/{wvm}/{wvmid}/{element_id}")
async def export_cad_model(document_id: str, wvm: str, wvmid: str, element_id: str):
    try:
        return onshape_client.export_gltf(document_id, wvm, wvmid, element_id)
    except HTTPException:
        raise
    except Exception as e:
        # THIS is what you need to see
        raise HTTPException(status_code=500, detail=repr(e))

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
