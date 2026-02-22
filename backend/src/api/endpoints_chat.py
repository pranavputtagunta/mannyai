from fastapi import APIRouter, HTTPException

from models.schemas import ChatPromptRequest
from services.agentic_loop import process_chat_prompt

router = APIRouter()


@router.post("/prompt")
async def prompt_chat(payload: ChatPromptRequest):
	try:
		return process_chat_prompt(payload)
	except Exception as exc:
		raise HTTPException(
			status_code=500,
			detail=f"Failed to process chat prompt: {str(exc)}",
		)
