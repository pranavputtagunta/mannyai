import { useEffect, useMemo, useState, type ReactElement } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D, {
  type SelectionMode,
  type SelectionPayload,
} from "./components/Viewer3D";
import type { Coordinate } from "./services/api";
import { fetchModelFromOnshape } from "./services/api";
import "./App.css";

interface RegionSelectionJson {
  intent: {
    user_prompt: string;
  };
  cad_context: {
    document_id: string;
    workspace_id: string;
    element_id: string;
    length_units: "millimeter";
    angle_units: "degree";
  };
  selected_region: {
    topology_id: string;
    entity_type: "FACE";
    surface_geometry: "PLANE" | "CYLINDER" | "NURBS" | "UNKNOWN";
    spatial_math: {
      center_of_mass: [number, number, number];
      surface_normal: [number, number, number];
      bounding_box:
        | {
        min: [number, number, number];
        max: [number, number, number];
          }
        | null;
    };
    adjacent_entities: Array<{
      entity_type: "FACE" | "EDGE";
      topology_id: string;
    }>;
  };
}

type Bounds3D = RegionSelectionJson["selected_region"]["spatial_math"]["bounding_box"];

interface ModelContext {
  sourceUrl: string;
  did: string;
  wvm: string;
  wvmid: string;
  eid: string;
}

function parseOnshapeContext(url: string): ModelContext | null {
  const urlRegex =
    /\/documents\/([a-z0-9]+)\/([wvm])\/([a-z0-9]+)\/e\/([a-z0-9]+)/i;
  const match = url.match(urlRegex);
  if (!match) {
    return null;
  }

  const [, did, wvm, wvmid, eid] = match;
  return {
    sourceUrl: url,
    did,
    wvm,
    wvmid,
    eid,
  };
}

function computeBounds(vertices: Coordinate[]): Bounds3D {
  if (vertices.length === 0) {
    return null;
  }

  let minX = vertices[0].x;
  let minY = vertices[0].y;
  let minZ = vertices[0].z;
  let maxX = vertices[0].x;
  let maxY = vertices[0].y;
  let maxZ = vertices[0].z;

  vertices.forEach((vertex) => {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    minZ = Math.min(minZ, vertex.z);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
    maxZ = Math.max(maxZ, vertex.z);
  });

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function normalizeVector(vector: Coordinate | null): Coordinate | null {
  if (!vector) {
    return null;
  }

  const length = Math.sqrt(
    vector.x * vector.x + vector.y * vector.y + vector.z * vector.z,
  );

  if (length < 1e-9) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function averageNormal(
  sampledSurface: SelectionPayload["sampledSurface"],
): Coordinate | null {
  if (sampledSurface.length === 0) {
    return null;
  }

  const normal = sampledSurface.reduce(
    (acc, item) => {
      acc.x += item.normal.x;
      acc.y += item.normal.y;
      acc.z += item.normal.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );

  return normalizeVector(normal);
}

function inferSurfaceGeometry(
  sampledSurface: SelectionPayload["sampledSurface"],
): "PLANE" | "CYLINDER" | "NURBS" | "UNKNOWN" {
  if (sampledSurface.length < 8) {
    return "UNKNOWN";
  }

  const mean = averageNormal(sampledSurface);
  if (!mean) {
    return "UNKNOWN";
  }

  let minDot = 1;
  sampledSurface.forEach((item) => {
    const itemNorm = normalizeVector(item.normal);
    if (!itemNorm) {
      return;
    }

    const dot =
      itemNorm.x * mean.x + itemNorm.y * mean.y + itemNorm.z * mean.z;
    minDot = Math.min(minDot, dot);
  });

  if (minDot > 0.96) {
    return "PLANE";
  }

  if (minDot > 0.7) {
    return "CYLINDER";
  }

  return "NURBS";
}

function dominantTopologyId(faceHits: SelectionPayload["faceHits"]): string | null {
  if (faceHits.length === 0) {
    return null;
  }

  const winner = [...faceHits].sort((a, b) => b.hits - a.hits)[0];
  return `${winner.meshId}:${winner.faceIndex}`;
}

function adjacentEntities(faceHits: SelectionPayload["faceHits"]) {
  const sorted = [...faceHits].sort((a, b) => b.hits - a.hits);
  return sorted.slice(1, 7).map((item) => ({
    entity_type: "EDGE" as const,
    topology_id: `EDGE_${item.meshId}:${item.faceIndex}`,
  }));
}

function buildRegionSelectionJson(
  selection: SelectionPayload | null,
  modelContext: ModelContext | null,
  prompt: string,
): RegionSelectionJson | null {
  if (!selection) {
    return null;
  }

  const derivedCenter: [number, number, number] = selection.coordinates
    ? [
        selection.coordinates.x,
        selection.coordinates.y,
        selection.coordinates.z,
      ]
    : [0, 0, 0];

  const derivedNormal = averageNormal(selection.sampledSurface);
  const derivedNormalTuple: [number, number, number] = derivedNormal
    ? [derivedNormal.x, derivedNormal.y, derivedNormal.z]
    : [0, 0, 1];

  return {
    intent: {
      user_prompt: prompt || "Describe the desired edit in chat.",
    },
    cad_context: {
      document_id: modelContext?.did ?? "",
      workspace_id: modelContext?.wvmid ?? "",
      element_id: modelContext?.eid ?? "",
      length_units: "millimeter",
      angle_units: "degree",
    },
    selected_region: {
      topology_id: dominantTopologyId(selection.faceHits) ?? "UNKNOWN",
      entity_type: "FACE",
      surface_geometry: inferSurfaceGeometry(selection.sampledSurface),
      spatial_math: {
        center_of_mass: derivedCenter,
        surface_normal: derivedNormalTuple,
        bounding_box: computeBounds(selection.boundedVertices),
      },
      adjacent_entities: adjacentEntities(selection.faceHits),
    },
  };
}

export default function App(): ReactElement {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("click");
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [modelContext, setModelContext] = useState<ModelContext | null>(null);
  const [intentPrompt, setIntentPrompt] = useState<string>("");

  const regionSelectionJson = useMemo<RegionSelectionJson | null>(() => {
    return buildRegionSelectionJson(selection, modelContext, intentPrompt);
  }, [intentPrompt, modelContext, selection]);

  const regionSelectionJsonString = useMemo(
    () => (regionSelectionJson ? JSON.stringify(regionSelectionJson, null, 2) : null),
    [regionSelectionJson],
  );

  useEffect(() => {
    if (!regionSelectionJsonString) {
      return;
    }

    localStorage.setItem("agentfix.regionSelection", regionSelectionJsonString);
  }, [regionSelectionJsonString]);

  const handlePromptCaptured = (prompt: string) => {
    setIntentPrompt(prompt);

    const snapshot = buildRegionSelectionJson(selection, modelContext, prompt);
    if (!snapshot) {
      return;
    }

    localStorage.setItem(
      "agentfix.regionSelectionForLlm",
      JSON.stringify(snapshot),
    );
  };

  /**
   * Called by ChatInterface when a user pastes an Onshape URL
   */
  const handleImport = async (url: string): Promise<void> => {
    setIsLoading(true);
    try {
      setModelContext(parseOnshapeContext(url));
      // Calls the proxy-enabled fetcher in api.ts
      const objectUrl = await fetchModelFromOnshape(url);
      setModelUrl(objectUrl);
      console.log("Model successfully loaded into blob URL:", objectUrl);
    } catch (err) {
      console.error("Import failed:", err);
      const message =
        err instanceof Error ? err.message : "Failed to download model.";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectionChange = (nextSelection: SelectionPayload | null) => {
    if (
      selectionMode === "click" &&
      nextSelection &&
      (!nextSelection.coordinates || nextSelection.pointCount <= 0)
    ) {
      return;
    }

    if (
      selectionMode === "click" &&
      selection &&
      nextSelection &&
      nextSelection.mode !== "click"
    ) {
      return;
    }

    setSelection(nextSelection);
  };

  const handleClearSelection = () => {
    setSelection(null);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">AgentFix</h1>
          <p className="sidebar-subtitle">Universal CAD Surgeon</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const input = form.elements.namedItem("url") as HTMLInputElement;
              if (input.value.trim()) {
                handleImport(input.value.trim());
              }
            }}
            className="url-form"
          >
            <input
              name="url"
              type="text"
              placeholder="Paste Onshape URL..."
              className="url-input"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="url-submit-btn"
            >
              Load
            </button>
          </form>
        </div>
        <ChatInterface
          isLoading={isLoading}
          selectedCoordinates={selection?.coordinates ?? null}
          selectedMode={selection?.mode ?? null}
          onPromptCaptured={handlePromptCaptured}
        />
      </div>

      <div className="main-canvas">
        <div className="selection-toolbar">
          <button
            type="button"
            className={`selection-btn ${selectionMode === "click" ? "active" : ""}`}
            onClick={() => setSelectionMode("click")}
          >
            Point
          </button>
          <button
            type="button"
            className={`selection-btn ${selectionMode === "lasso" ? "active" : ""}`}
            onClick={() => setSelectionMode("lasso")}
          >
            Lasso
          </button>
          <button
            type="button"
            className={`selection-btn ${selectionMode === "circle" ? "active" : ""}`}
            onClick={() => setSelectionMode("circle")}
          >
            Circle
          </button>
          <button
            type="button"
            className="selection-btn"
            onClick={handleClearSelection}
          >
            Clear
          </button>
          {selection?.coordinates && (
            <span className="selection-meta">
              {selection.mode} selected ({selection.pointCount} hits)
            </span>
          )}
        </div>

        {!modelUrl && !isLoading && (
          <div className="overlay">
            <p className="overlay-text">Paste an Onshape link to begin.</p>
          </div>
        )}

        {isLoading && (
          <div className="overlay">
            <div className="loader-group">
              <div className="spinner"></div>
              <p className="loading-text">Extracting Geometry...</p>
            </div>
          </div>
        )}

        <Viewer3D
          modelUrl={modelUrl}
          selectionMode={selectionMode}
          selection={selection}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  );
}
