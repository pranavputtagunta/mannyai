from pydantic import BaseModel
from typing import List

class ChatMessage(BaseModel):
    role: str # 'user', 'assistant', or 'system'
    content: str

class CADModificationRequest(BaseModel):
    did: str # Onshape Document ID
    wid: str # Onshape Workspace ID
    eid: str # Onshape Element ID
    use_case: str = ""
    user_message: str
    chat_history: List[ChatMessage] = []