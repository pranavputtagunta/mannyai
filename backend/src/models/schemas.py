from typing import Any

from pydantic import BaseModel


class Coordinate(BaseModel):
	x: float
	y: float
	z: float


class ChatPromptRequest(BaseModel):
	prompt: str
	coordinates: Coordinate | None = None
	region_selection: dict[str, Any] | None = None


class ChatPromptResponse(BaseModel):
	message: str
	llm_ready: bool
	has_region_selection: bool
	region_topology_id: str | None = None
	topology_status: str | None = None
	executed: bool = False
	action: str | None = None
	operation_id: str | None = None
	undo_available: bool = False
	undo_hint: str | None = None
	model_color: str | None = None
	model_color_target: str | None = None
	model_color_anchor: list[float] | None = None


class ClearAllRequest(BaseModel):
	document_id: str
	workspace_type: str = "w"
	workspace_id: str
	element_id: str


class ClearAllResponse(BaseModel):
	message: str
	cleared_count: int
	executed: bool
