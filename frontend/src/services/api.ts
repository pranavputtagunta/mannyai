import axios from "axios";

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

const BACKEND_URL = "http://localhost:8000/api";

export const fetchModelFromOnshape = async (onshapeUrl: string): Promise<string> => {
  const urlRegex = /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = onshapeUrl.match(urlRegex);
  if (!match) throw new Error("Invalid Onshape URL format.");

  const [_, did, wvm, wvmid, eid] = match;

  const apiUrl = `http://localhost:8000/api/cad/export/${did}/${wvm}/${wvmid}/${eid}`;
  console.log("EXPORT URL:", apiUrl);

  const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Backend export error: ${response.status}`);

  const gltfJson = await response.json();
  const blob = new Blob([JSON.stringify(gltfJson)], { type: "model/gltf+json" });
  return URL.createObjectURL(blob);
};

export const sendCopilotPrompt = async (
  prompt: string,
  coordinates: Coordinate | null = null,
): Promise<any> => {
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
