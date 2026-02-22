import { useEffect, useState } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import LinkEntry from "./components/LinkEntry";
import UseCaseEntry from "./components/UseCaseEntry";
import {
  fetchEditCapabilityHealth,
  fetchModelFromOnshape,
} from "./services/api";
import "./App.css";

export default function App() {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [cadContext, setCadContext] = useState<{
    did: string;
    wvm: string;
    wvmid: string;
    eid: string;
  } | null>(null);
  const [editHealth, setEditHealth] = useState<{
    loading: boolean;
    editingEnabled: boolean;
    label: string;
  }>({
    loading: true,
    editingEnabled: false,
    label: "Checking edit capability...",
  });

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const health = await fetchEditCapabilityHealth();
        if (health.editing_enabled) {
          setEditHealth({
            loading: false,
            editingEnabled: true,
            label: "Editing enabled",
          });
          return;
        }

        const missing = health.missing_env?.length
          ? `Missing: ${health.missing_env.join(", ")}`
          : "Onshape unreachable";
        setEditHealth({
          loading: false,
          editingEnabled: false,
          label: missing,
        });
      } catch {
        setEditHealth({
          loading: false,
          editingEnabled: false,
          label: "Health check unavailable",
        });
      }
    };

    loadHealth();
  }, []);

  /**
   * Called by ChatInterface when a user pastes an Onshape URL
   */
  const handleImport = async (url: string): Promise<void> => {
    setIsLoading(true);
    try {
      // Calls the proxy-enabled fetcher in api.ts
      const { objectUrl, did, wvm, wvmid, eid } =
        await fetchModelFromOnshape(url);
      setModelUrl(objectUrl);
      setCadContext({ did, wvm, wvmid, eid });
      console.log("Model successfully loaded into blob URL:", objectUrl);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Failed to download model. Ensure your Vite proxy is running.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelUpdated = async () => {
    if (!cadContext) return;
    setIsLoading(true);
    try {
      const apiUrl = `http://localhost:8000/api/cad/export/${cadContext.did}/${cadContext.wvm}/${cadContext.wvmid}/${cadContext.eid}`;
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`Backend export error: ${response.status}`);

      const gltfJson = await response.json();
      const blob = new Blob([JSON.stringify(gltfJson)], {
        type: "model/gltf+json",
      });
      setModelUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Failed to refetch model:", err);
    } finally {
      setIsLoading(false);
    }
  };

  let healthDotClass = "bad";
  if (editHealth.loading) {
    healthDotClass = "pending";
  } else if (editHealth.editingEnabled) {
    healthDotClass = "ok";
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">AgentFix</h1>
          <p className="sidebar-subtitle">Universal CAD Surgeon</p>
          <div className="health-chip" aria-live="polite">
            <span className={`health-dot ${healthDotClass}`}></span>
            <span className="health-text">{editHealth.label}</span>
          </div>
          <LinkEntry isLoading={isLoading} onImport={handleImport} />
          <UseCaseEntry />
        </div>
        <ChatInterface
          isLoading={isLoading}
          cadContext={cadContext}
          onModelUpdated={handleModelUpdated}
        />
      </div>

      <div className="main-canvas">
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

        <Viewer3D modelUrl={modelUrl} />
      </div>
    </div>
  );
}
