from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os

router = APIRouter()

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "assets")
USE_CASE_FILE = os.path.join(ASSETS_DIR, "use_case.txt")

# Ensure assets directory exists
os.makedirs(ASSETS_DIR, exist_ok=True)

class UseCaseRequest(BaseModel):
    use_case: str

@router.post("/use-case")
async def save_use_case(request: UseCaseRequest):
    try:
        with open(USE_CASE_FILE, "w") as f:
            f.write(request.use_case)
        return {"message": "Use case saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save use case: {str(e)}")

@router.get("/use-case")
async def get_use_case():
    try:
        if os.path.exists(USE_CASE_FILE):
            with open(USE_CASE_FILE, "r") as f:
                return {"use_case": f.read()}
        return {"use_case": ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read use case: {str(e)}")
