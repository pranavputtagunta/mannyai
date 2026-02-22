import React, { useState } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import { uploadStep } from "./services/api";
import "./App.css";

const glassStyle: React.CSSProperties = {
  background: "rgba(20, 20, 20, 0.65)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
  color: "#fff",
};

export default function App(): JSX.Element {
  const [modelUrl, setModelUrl] = useState<string | null>(null); // GLB URL
  const [modelId, setModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
      const data = await uploadStep(file);

      setModelId(data.model_id);

      // IMPORTANT: prefix backend host for viewer fetch
      setModelUrl(`http://localhost:8000${data.glb_url}?t=${Date.now()}`);
    } catch (e) {
      console.error(e);
      alert("Upload failed. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">AgentFix</h1>
          <p className="sidebar-subtitle">Universal CAD Surgeon</p>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <input
              type="file"
              accept=".step,.stp"
              disabled={isLoading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                background: "#171717",
                border: "1px solid #262626",
                color: "#fff",
                fontSize: 12,
              }}
            />
          </div>
        </div>

        <ChatInterface
          isLoading={isLoading}
          modelId={modelId}
          onModelUpdated={(newGlbUrl: string) => setModelUrl(newGlbUrl)}
        />
      </div>

      <div className="main-canvas" style={{ position: "relative" }}>
        {!modelUrl && !isLoading && (
          <div className="overlay">
            <p className="overlay-text">Upload a STEP file to begin surgery.</p>
          </div>
        )}

        {isLoading && (
          <div className="overlay">
            <div className="loader-group">
              <div className="spinner"></div>
              <p className="loading-text">Processing CAD...</p>
            </div>
          </div>
        )}

        <Viewer3D modelUrl={modelUrl} />
      </div>
    </div>
  );
}