# JSON → LLM Connection (Quick Guide)

This project already sends selection JSON from frontend to backend.  
You only need to replace the backend stub with a real LLM call.

## Current flow

1. User selects region in UI and submits prompt.
2. Frontend stores JSON in browser localStorage key:
   - `agentfix.regionSelectionForLlm`
3. Frontend sends chat payload to backend:
   - Endpoint: `POST /api/chat/prompt`
   - Body includes:
     - `prompt`
     - `coordinates`
     - `region_selection`
4. Backend parses payload in:
   - `backend/src/api/endpoints_chat.py`
   - `backend/src/models/schemas.py`
5. Backend currently uses a stub processor in:
   - `backend/src/services/agentic_loop.py`

## Where to plug in real LLM

Replace `process_chat_prompt()` in `backend/src/services/agentic_loop.py`.

Use:
- `payload.prompt` as user instruction
- `payload.region_selection` as structured CAD context

## Suggested prompt assembly

- **System message**: CAD-edit assistant behavior + safety constraints.
- **User message**:
  - Plain text request (`payload.prompt`)
  - JSON context (`payload.region_selection`) serialized once.

## Minimal pseudo-code

```python
from models.schemas import ChatPromptRequest, ChatPromptResponse

def process_chat_prompt(payload: ChatPromptRequest) -> ChatPromptResponse:
    llm_input = {
        "instruction": payload.prompt,
        "region_context": payload.region_selection,
    }

    # TODO: call provider SDK here (OpenAI/Azure/etc.)
    # result = llm_client.responses.create(...)

    return ChatPromptResponse(
        message="LLM response placeholder",
        llm_ready=True,
        has_region_selection=bool(payload.region_selection),
        region_topology_id=(payload.region_selection or {})
            .get("selected_region", {})
            .get("topology_id"),
    )
```

## Quick test payload

```json
{
  "prompt": "Add a 3mm fillet to this selected edge band",
  "coordinates": null,
  "region_selection": {
    "intent": { "user_prompt": "Add a 3mm fillet" },
    "selected_region": { "topology_id": "mesh:12" }
  }
}
```

## Notes

- Browser `localStorage` is frontend-only; backend/LLM cannot read it directly.
- The JSON must always be passed over HTTP (already implemented).
- Keep backend as the only place where LLM keys/secrets are used.
