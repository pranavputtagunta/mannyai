from models.schemas import ChatPromptRequest, ChatPromptResponse


def process_chat_prompt(payload: ChatPromptRequest) -> ChatPromptResponse:
	region = payload.region_selection or {}
	selected_region = region.get("selected_region") if isinstance(region, dict) else {}
	topology_id = (
		selected_region.get("topology_id")
		if isinstance(selected_region, dict)
		else None
	)

	summary = "Prompt captured and region JSON prepared for LLM handoff."
	if topology_id:
		summary = f"Prompt captured for topology {topology_id}; region JSON prepared for LLM handoff."

	return ChatPromptResponse(
		message=summary,
		llm_ready=True,
		has_region_selection=bool(payload.region_selection),
		region_topology_id=topology_id,
	)
