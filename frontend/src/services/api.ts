import axios from 'axios';

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

// Replace with eys
const ONSHAPE_ACCESS_KEY = process.env.ONSHAPE_ACCESS_KEY || "";
const ONSHAPE_SECRET_KEY = process.env.ONSHAPE_SECRET_KEY || "";
const BACKEND_URL = 'http://localhost:8000/api';

export const fetchModelFromOnshape = async (onshapeUrl: string): Promise<string> => {
  // 1. Extract the IDs from the URL
  const urlRegex = /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = onshapeUrl.match(urlRegex);

  if (!match) {
    throw new Error("Invalid Onshape URL format.");
  }

  const [_, did, wvm, wvmid, eid] = match;

  // 2. Encode the API Keys for Basic Auth natively in the browser
  const authString = `${ONSHAPE_ACCESS_KEY}:${ONSHAPE_SECRET_KEY}`;
  const encodedAuth = btoa(authString); 

  // 3. Construct the Export Endpoint
    const apiUrl = `/onshape-proxy/api/partstudios/d/${did}/${wvm}/${wvmid}/e/${eid}/gltf`;

  // 4. Fetch the data directly in the browser
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${encodedAuth}`,
        'Accept': 'model/gltf-binary'
      }
    });

    if (!response.ok) {
      throw new Error(`Onshape API Error: ${response.status}`);
    }

    // 5. Convert the response into a Blob (Binary Large Object)
    const blob = await response.blob();

    // 6. Create a temporary, local browser URL for the Three.js canvas
    const localBlobUrl = URL.createObjectURL(blob);
    
    return localBlobUrl;

  } catch (error) {
    console.error("Frontend Download Error:", error);
    throw error;
  }
};

export const sendCopilotPrompt = async (prompt: string, coordinates: Coordinate | null = null): Promise<any> => {
  try {
    const response = await axios.post(`${BACKEND_URL}/chat/prompt`, { 
      prompt, 
      coordinates 
    });
    return response.data;
  } catch (error) {
    console.error("Copilot request failed:", error);
    throw error;
  }
};