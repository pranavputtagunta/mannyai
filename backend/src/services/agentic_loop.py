import traceback
import json
import typing
from pydantic import BaseModel, Field

# New Unified SDK Imports
from google import genai
from google.genai import types

from services.onshape_api import onshape_client
from core.config import settings

# --- GLOBAL CONFIGURATION ---
# Using gemini-2.5-flash as the standard high-performance, low-latency model
MODEL_ID = "gemini-2.5-flash" 

# Initialize the client (SDK v1.0+)
client = genai.Client(api_key=settings.GEMINI_API_KEY)

MAX_RETRIES = 3

# --- PYDANTIC SCHEMAS ---
class IntentResponse(BaseModel):
    intent: typing.Literal["modify", "chat", "clarify"] = Field(
        description="Whether the user wants to modify the CAD model, just chat, or if you need more information to make a modification."
    )
    response: str = Field(
        description="The response to show to the user. If clarify, ask the user for the missing information."
    )

class BuiltInFeatureResponse(BaseModel):
    feature: typing.Dict[str, typing.Any] = Field(
        description="Native Onshape feature definition object for POST /features."
    )
    serializationVersion: str = Field(
        default="1.1.20",
        description="Onshape serialization version for the add-feature payload."
    )

SERIALIZATION_VERSION = "1.1.20"


def _safe_json_snippet(data: typing.Any, max_chars: int = 12000) -> str:
    try:
        serialized = json.dumps(data, default=str)
    except Exception:
        serialized = str(data)
    return serialized[:max_chars]


def _extract_features_list(features_payload: typing.Any) -> typing.List[typing.Any]:
    if isinstance(features_payload, dict):
        features_list = features_payload.get("features", [])
        return features_list if isinstance(features_list, list) else []
    if isinstance(features_payload, list):
        return features_payload
    return []


def _extract_part_names(parts_payload: typing.Any) -> typing.List[str]:
    if not isinstance(parts_payload, list):
        return []

    names: typing.List[str] = []
    for part in parts_payload[:20]:
        if isinstance(part, dict):
            names.append(part.get("name") or part.get("partId") or "unnamed-part")
    return names


def _extract_feature_names(features_list: typing.List[typing.Any]) -> typing.List[str]:
    names: typing.List[str] = []
    for feature in features_list[:40]:
        if not isinstance(feature, dict):
            continue
        message = feature.get("message", {}) if isinstance(feature.get("message"), dict) else {}
        names.append(
            message.get("name")
            or message.get("featureType")
            or feature.get("typeName")
            or "unnamed-feature"
        )
    return names


def _summarize_model_context(model_context: typing.Any) -> typing.Dict[str, typing.Any]:
    if not isinstance(model_context, dict):
        return {"feature_count": 0, "part_count": 0, "part_names": [], "feature_names": []}

    features_payload = model_context.get("features", {})
    parts_payload = model_context.get("parts", [])
    features_list = _extract_features_list(features_payload)
    part_names = _extract_part_names(parts_payload)
    feature_names = _extract_feature_names(features_list)

    return {
        "feature_count": len(features_list),
        "part_count": len(parts_payload) if isinstance(parts_payload, list) else 0,
        "part_names": part_names,
        "feature_names": feature_names,
    }


def _is_describe_request(user_message: str) -> bool:
    text = user_message.lower()
    describe_terms = [
        "describe",
        "what model",
        "what does",
        "looks like",
        "current model",
        "what am i looking at",
    ]
    return any(term in text for term in describe_terms)


def _looks_like_modify_request(user_message: str) -> bool:
    text = user_message.lower()
    modify_terms = [
        "make",
        "change",
        "add",
        "remove",
        "increase",
        "decrease",
        "resize",
        "modify",
        "fillet",
        "chamfer",
        "hole",
        "extrude",
    ]
    return any(term in text for term in modify_terms)


def _build_model_summary_reply(model_summary: typing.Dict[str, typing.Any]) -> str:
    part_names = model_summary.get("part_names", [])[:5]
    feature_names = model_summary.get("feature_names", [])[:6]
    part_count = model_summary.get("part_count", 0)
    feature_count = model_summary.get("feature_count", 0)

    part_text = ", ".join(part_names) if part_names else "no named parts"
    feature_text = ", ".join(feature_names) if feature_names else "no recognizable features"

    return (
        f"I can see {part_count} part(s) and {feature_count} feature(s). "
        f"Top part names: {part_text}. "
        f"Top feature names: {feature_text}."
    )


def _build_add_feature_payload(response_data: typing.Dict[str, typing.Any]) -> typing.Dict[str, typing.Any]:
    feature = response_data.get("feature", {})
    serialization_version = response_data.get("serializationVersion", SERIALIZATION_VERSION)

    if not isinstance(feature, dict):
        raise ValueError("Model generated invalid feature; expected an object.")
    if feature.get("btType") != "BTMFeature-134":
        feature["btType"] = "BTMFeature-134"
    if not feature.get("name"):
        feature["name"] = "API Generated Feature"
    if "suppressed" not in feature:
        feature["suppressed"] = False
    if "parameters" not in feature:
        feature["parameters"] = []
    if not isinstance(feature.get("parameters"), list):
        raise ValueError("Model generated invalid feature.parameters; expected an array.")

    return {
        "feature": feature,
        "serializationVersion": serialization_version
    }

# --- AGENT FUNCTIONS ---

def determine_intent(request, current_features):
    """
    Step 2: The chatbot LLM determines if a change is required based on the user's message.
    """
    model_context_summary = _summarize_model_context(current_features)

    system_instruction = f"""
    You are 'AgentFix', a Senior Mechanical Engineer AI.
    The user is looking at a CAD model with the following use case: {request.use_case}
    Current CAD Model Context Summary (JSON): {model_context_summary}
    
    Determine if the user is asking to modify the CAD model, or just asking a question/chatting.
    CRITICAL: If the user is asking to modify the model, but their request is ambiguous or missing necessary parameters (e.g., they say "add a hole" but don't specify where or how big), you MUST return "clarify" as the intent and ask them for the missing information in the response.
    CRITICAL: This system modifies CAD by appending native Onshape feature JSON via POST /features.
    ONLY return "modify" if you have enough information to create a valid built-in feature payload.
    Use model context semantics (part names and feature names) to resolve references like "wheel", "frame", "left side".
    If the reference cannot be matched to the provided model context, return "clarify" and ask a precise follow-up.
    NEVER include raw JSON, code, payloads, or API schema details in the response shown to the user.
    If intent is "modify", the response must be one short natural sentence confirming the change (max 16 words).
    """
    
    # Transform chat history to the new SDK 'Content' format
    history_contents = []
    for msg in request.chat_history:
        role = "user" if msg.role == "user" else "model"
        history_contents.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=msg.content)]
            )
        )
        
    try:
        # Create chat session with structured output config
        chat = client.chats.create(
            model=MODEL_ID,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=IntentResponse,
                temperature=0.1 # Low temperature for deterministic routing
            ),
            history=history_contents
        )
        
        response = chat.send_message(request.user_message)
        response_text = response.text or "{}"
        
        # In the new SDK, response.text is the generated content.
        # Since we enforced JSON schema, this is safe to parse.
        intent_data = json.loads(response_text)

        if intent_data.get("intent") == "modify":
            intent_data["response"] = "Sure — I can do that. Applying the edit now."

        return intent_data
        
    except Exception:
        traceback.print_exc()
        if _is_describe_request(request.user_message):
            return {
                "intent": "chat",
                "response": _build_model_summary_reply(model_context_summary)
            }

        if _looks_like_modify_request(request.user_message):
            return {
                "intent": "modify",
                "response": "Sure — I can do that. Applying the edit now."
            }

        return {
            "intent": "chat",
            "response": "I’m ready to help. Tell me what you want to change in the model."
        }

def run_cad_agent(request, current_features):
    """
    Step 3: The modification agent generates an Onshape native Add Feature JSON definition.
    Includes an agentic loop to self-correct based on API errors.
    """
    model_context_summary = _summarize_model_context(current_features)
    model_context_snippet = _safe_json_snippet(current_features, max_chars=15000)

    system_instruction = f"""
    You are the 'Modification Agent', an expert in Onshape native built-in features.
    Your goal is to modify an Onshape CAD model based on user requests.
    
    Part Use Case: {request.use_case}
    Current CAD Model Context Summary (JSON): {model_context_summary}
    Current CAD Model Context Snippet (truncated JSON): {model_context_snippet}
    
    Return ONLY a JSON object with keys: feature, serializationVersion.
    - feature must be a valid native feature object for Onshape POST /features.
    - feature.btType should be "BTMFeature-134".
    - Include featureType, name, suppressed, and parameters when required by the feature.
    - Use serializationVersion "1.1.20" unless better value is obvious from context.
    - Ground edits to available model context. Use part/feature names present in context.
    - If context is insufficient to produce valid references, do not guess; fail with missing-context reasoning in notices.
    
    Do not return markdown or explanations.
    """

    history_contents = []
    for msg in request.chat_history:
        role = "user" if msg.role == "user" else "model"
        history_contents.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=msg.content)]
            )
        )
    
    # Initialize chat for the agent loop
    chat = client.chats.create(
        model=MODEL_ID,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
                response_schema=BuiltInFeatureResponse,
            temperature=0.2
        ),
        history=history_contents
    )
    
    current_prompt = request.user_message

    for _ in range(MAX_RETRIES):
        try:
            # 1. Generate native feature payload
            response = chat.send_message(current_prompt)
            response_text = response.text or "{}"
            response_data = json.loads(response_text)
            payload = _build_add_feature_payload(response_data)

            # 2. Append feature via Onshape API
            api_response = onshape_client.add_feature(
                did=request.did, 
                wid=request.wid, 
                eid=request.eid, 
                feature_payload=payload
            )
            
            # 3. Check for Onshape API notices/errors
            if "notices" in api_response:
                errors = [
                    n.get("message") for n in api_response["notices"] 
                    if n.get("level") == "ERROR"
                ]
                if errors:
                    raise RuntimeError(f"Add Feature API Error: {'; '.join(errors)}")
            
            # Success!
            return {
                "message": "Model updated successfully.",
                "feature_payload": payload,
                "api_response": api_response
            }
            
        except Exception as e:
            # 4. Feedback Loop
            # We feed the error back into the chat context so the model can fix it in the next turn.
            error_message = (
                f"The previous add-feature payload failed with this error:\n{str(e)}\n"
                "Regenerate valid JSON with keys feature and serializationVersion only."
            )
            current_prompt = error_message
            
    raise RuntimeError("Agent failed to modify the CAD model with add-feature workflow after maximum retries.")