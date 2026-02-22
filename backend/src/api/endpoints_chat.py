from fastapi import APIRouter, HTTPException

from models.schemas import ChatPromptRequest, ClearAllRequest, ClearAllResponse
from services.agentic_loop import (
	clear_generated_edits_for_context,
	get_execution_history,
	process_chat_prompt,
)

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


@router.get("/history")
async def prompt_history():
	return {
		"items": get_execution_history(),
	}


@router.post("/clear-all", response_model=ClearAllResponse)
async def clear_all(payload: ClearAllRequest):
	try:
		deleted_count, _ = clear_generated_edits_for_context(
			payload.document_id,
			payload.workspace_type,
			payload.workspace_id,
			payload.element_id,
		)
		return ClearAllResponse(
			message=f"Clear all completed. Removed {deleted_count} generated features.",
			cleared_count=deleted_count,
			executed=True,
		)
	except Exception as exc:
		raise HTTPException(
			status_code=500,
			detail=f"Failed to clear generated edits: {str(exc)}",
		)
