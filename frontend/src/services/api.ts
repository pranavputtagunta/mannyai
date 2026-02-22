// frontend/src/services/api.ts
/**
 * AI MODE:
 * Text -> backend /api/chat/prompt
 * Backend calls OpenAI -> generates CadQuery -> applies to STEP -> returns URLs
 */
// frontend/src/services/api.ts

export async function uploadStep(file: File) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("http://localhost:8000/api/cad/upload", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    model_id: string;
    glb_url: string;
    step_url: string;
  }>;
}


/**
 * AI MODE:
 * Text -> backend /api/chat/prompt
 * Backend calls OpenAI -> generates CadQuery -> applies to STEP -> returns URLs
 */
export async function applyCadQueryFromText(modelId: string, prompt: string) {
  const res = await fetch("http://localhost:8000/api/chat/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, prompt, params: {} }),
  });

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json() as {
    status: string;
    model_id?: string;
    glb_url: string;
    step_url: string;
    message?: string;
    code?: string;
  };

  const t = Date.now();
  const withBust = (u: string) =>
    u.startsWith("http") ? `${u}${u.includes("?") ? "&" : "?"}t=${t}` : `http://localhost:8000${u}${u.includes("?") ? "&" : "?"}t=${t}`;

  return {
    ...data,
    glb_url: withBust(data.glb_url),
    step_url: withBust(data.step_url),
  };
}

/**
 * Backwards-compat alias so you don't have to touch ChatInterface code
 * if it still imports applyOpFromText.
 *
 * NOTE: This is now AI-driven.
 */
export async function applyOpFromText(modelId: string, text: string) {
  return applyCadQueryFromText(modelId, text);
}