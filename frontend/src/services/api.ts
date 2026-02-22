import axios from "axios";

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

const BACKEND_URL = "http://localhost:8000/api";

export interface EditCapabilityHealth {
  editing_enabled: boolean;
  mode: string;
  missing_env: string[];
  onshape: {
    ok: boolean;
    status_code: number | null;
    error?: string;
  };
}

export const fetchModelFromOnshape = async (
  onshapeUrl: string,
): Promise<{
  objectUrl: string;
  did: string;
  wvm: string;
  wvmid: string;
  eid: string;
}> => {
  const urlRegex =
    /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = urlRegex.exec(onshapeUrl);
  if (!match) throw new Error("Invalid Onshape URL format.");

  const [, did, wvm, wvmid, eid] = match;

  const apiUrl = `http://localhost:8000/api/cad/export/${did}/${wvm}/${wvmid}/${eid}`;
  console.log("EXPORT URL:", apiUrl);

  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Backend export error: ${response.status}`);

  const gltfJson = await response.json();
  const blob = new Blob([JSON.stringify(gltfJson)], {
    type: "model/gltf+json",
  });
  return { objectUrl: URL.createObjectURL(blob), did, wvm, wvmid, eid };
};

export const sendCopilotPrompt = async (
  prompt: string,
  coordinates: Coordinate | null = null,
): Promise<unknown> => {
  try {
    const response = await axios.post(`${BACKEND_URL}/chat/prompt`, {
      prompt,
      coordinates,
    });
    return response.data;
  } catch (error) {
    console.error("Copilot request failed:", error);
    throw error;
  }
};

export const saveUseCase = async (useCase: string): Promise<void> => {
  try {
    await axios.post(`${BACKEND_URL}/use-case`, { use_case: useCase });
  } catch (error) {
    console.error("Failed to save use case:", error);
    throw error;
  }
};

export const loadUseCase = async (): Promise<string> => {
  try {
    const response = await axios.get(`${BACKEND_URL}/use-case`);
    return response.data.use_case;
  } catch (error) {
    console.error("Failed to load use case:", error);
    throw error;
  }
};

export const fetchEditCapabilityHealth =
  async (): Promise<EditCapabilityHealth> => {
    const response = await fetch(`${BACKEND_URL}/cad/health/edit-capability`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Health endpoint failed: ${response.status}`);
    }

    const payload = await response.json();
    return payload as EditCapabilityHealth;
  };
