import axios from "axios";

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

export interface ChatHistoryItem {
  operation_id: string;
  timestamp: number;
  status?: "executed" | "failed";
  action: string;
  prompt: string;
  document_id: string;
  workspace_type: string;
  workspace_id: string;
  element_id: string;
  region_topology_id: string | null;
  topology_status?: string;
  error?: string;
}

export interface ClearAllPayload {
  document_id: string;
  workspace_type: "w" | "v" | "m";
  workspace_id: string;
  element_id: string;
}

const BACKEND_URL = "http://localhost:8000/api";

export const fetchModelFromOnshape = async (
  onshapeUrl: string,
): Promise<string> => {
  const urlRegex =
    /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = onshapeUrl.match(urlRegex);
  if (!match) {
    throw new Error(
      "Invalid Onshape URL format. Use the full URL containing /documents/{did}/{wvm}/{wvmid}/e/{eid}.",
    );
  }

  const [_, did, wvm, wvmid, eid] = match;

  const apiUrl = `http://localhost:8000/api/cad/export/${did}/${wvm}/${wvmid}/${eid}`;
  console.log("EXPORT URL:", apiUrl);

  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let backendDetail = "";

    try {
      const errorBody = await response.json();
      backendDetail =
        typeof errorBody?.detail === "string"
          ? errorBody.detail
          : JSON.stringify(errorBody);
    } catch {
      backendDetail = await response.text();
    }

    const message = backendDetail
      ? `Model export failed (${response.status}): ${backendDetail}`
      : `Model export failed (${response.status}).`;

    throw new Error(message);
  }

  const gltfJson = await response.json();
  const blob = new Blob([JSON.stringify(gltfJson)], {
    type: "model/gltf+json",
  });
  return URL.createObjectURL(blob);
};

export const sendCopilotPrompt = async (
  prompt: string,
  coordinates: Coordinate | null = null,
): Promise<any> => {
  try {
    const regionSelectionRaw = localStorage.getItem("agentfix.regionSelectionForLlm");
    const regionSelection = regionSelectionRaw
      ? JSON.parse(regionSelectionRaw)
      : null;

    const response = await axios.post(`${BACKEND_URL}/chat/prompt`, {
      prompt,
      coordinates,
      region_selection: regionSelection,
    });
    return response.data;
  } catch (error) {
    console.error("Copilot request failed:", error);
    throw error;
  }
};

export const fetchChatHistory = async (): Promise<ChatHistoryItem[]> => {
  try {
    const response = await axios.get(`${BACKEND_URL}/chat/history`);
    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    return items as ChatHistoryItem[];
  } catch (error) {
    console.error("Failed to fetch chat history:", error);
    return [];
  }
};

export const clearAllGeneratedEdits = async (
  payload: ClearAllPayload,
): Promise<{ message: string; cleared_count: number; executed: boolean }> => {
  const response = await axios.post(`${BACKEND_URL}/chat/clear-all`, payload);
  return response.data;
};
