import axios from "axios";

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

const BACKEND_URL = "http://localhost:8000/api";

/**
 * Resolves 3D world points from the Lasso tool into Onshape internal face/query IDs.
 */
export async function resolveFacesFromPoints(
  did: string,
  wvm: string,
  wvmid: string,
  eid: string,
  pointsWorld: Array<[number, number, number]>
) {
  // Path updated to match your backend router structure
  const url = `${BACKEND_URL}/cad/resolve-faces/${did}/${wvm}/${wvmid}/${eid}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points_world: pointsWorld }),
  });

  if (!res.ok) throw new Error(`resolve-faces failed: ${res.status}`);
  return res.json();
}

/**
 * Fetches the GLTF model from the backend and returns the Blob URL 
 * along with the Onshape document metadata.
 */
export const fetchModelFromOnshape = async (onshapeUrl: string) => {
  const urlRegex = /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = onshapeUrl.match(urlRegex);
  
  if (!match) throw new Error("Invalid Onshape URL format.");

  const [_, did, wvm, wvmid, eid] = match;

  // Points to your FastAPI backend export endpoint
  const apiUrl = `${BACKEND_URL}/cad/export/${did}/${wvm}/${wvmid}/${eid}`;
  console.log("EXPORT URL:", apiUrl);

  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Backend export error: ${response.status}`);

  const gltfJson = await response.json();
  const blob = new Blob([JSON.stringify(gltfJson)], { type: "model/gltf+json" });
  
  // Return the object expected by your updated App.tsx
  return { 
    blobUrl: URL.createObjectURL(blob), 
    did, 
    wvm, 
    wvmid, 
    eid 
  };
};

/**
 * Sends the user prompt and optional coordinates to the AI backend.
 */
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