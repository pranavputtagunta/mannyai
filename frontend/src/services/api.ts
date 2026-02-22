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
 * @param fromVersion - If editing from a previous version, pass the version number to truncate history
 * @param selectedPoints - Optional lasso selection points to target specific region
 */
export async function applyCadQueryFromText(
  modelId: string,
  prompt: string,
  fromVersion?: number,
  selectedPoints?: Array<[number, number, number]>,
) {
  const res = await fetch("http://localhost:8000/api/chat/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: modelId,
      prompt,
      params: {
        selection: selectedPoints ?? null,
      },
      from_version: fromVersion ?? null,
    }),
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
    u.startsWith("http")
      ? `${u}${u.includes("?") ? "&" : "?"}t=${t}`
      : `http://localhost:8000${u}${u.includes("?") ? "&" : "?"}t=${t}`;

  return {
    ...data,
    glb_url: withBust(data.glb_url),
    step_url: withBust(data.step_url),
  };
}

/**
 * Backwards-compat alias
 */
export async function applyOpFromText(
  modelId: string,
  text: string,
  fromVersion?: number,
  selectedPoints?: Array<[number, number, number]>,
) {
  return applyCadQueryFromText(modelId, text, fromVersion, selectedPoints);
}

// ============== VERSION HISTORY API ==============

export interface VersionInfo {
  version: number;
  commit_hash: string;
  message: string;
  timestamp: string;
}

export interface VersionHistoryResponse {
  model_id: string;
  versions: VersionInfo[];
  current_version: number | null;
}

export async function getVersions(modelId: string): Promise<VersionHistoryResponse> {
  const res = await fetch(`http://localhost:8000/api/chat/versions/${modelId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkoutVersion(
  modelId: string,
  version: number,
): Promise<{
  status: string;
  message: string;
  version: number;
  commit_hash: string;
  glb_url: string;
  step_url: string;
}> {
  const res = await fetch(
    `http://localhost:8000/api/chat/versions/${modelId}/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  const t = Date.now();
  const withBust = (u: string) =>
    u.startsWith("http")
      ? `${u}${u.includes("?") ? "&" : "?"}t=${t}`
      : `http://localhost:8000${u}${u.includes("?") ? "&" : "?"}t=${t}`;

  return {
    ...data,
    glb_url: withBust(data.glb_url),
    step_url: withBust(data.step_url),
  };
}