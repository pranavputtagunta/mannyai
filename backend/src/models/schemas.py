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
