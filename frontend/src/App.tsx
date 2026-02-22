import React, { useState } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import { uploadStep } from "./services/api";
import "./App.css";

export default function App(): JSX.Element {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
      const data = await uploadStep(file);
      setModelId(data.model_id);
      setModelUrl(`http://localhost:8000${data.glb_url}?t=${Date.now()}`);
    } catch (e) {
      console.error(e);
      alert("Upload failed. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCheckpoint = async () => {
    if (!modelId) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`http://localhost:8000/api/cad/${modelId}/save`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Save failed");
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (e: any) {
      console.error(e);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 2500);
    }
  };

  const saveLabel = () => {
    if (saveStatus === "saving") return "⏳ Saving...";
    if (saveStatus === "saved")  return "✅ Saved!";
    if (saveStatus === "error")  return "❌ Failed";
    return "💾 Save Checkpoint";
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">AgentFix</h1>
          <p className="sidebar-subtitle">Universal CAD Surgeon</p>

          {/* Upload */}
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

          {/* Save Checkpoint button */}
          {modelId && (
            <button
              onClick={handleSaveCheckpoint}
              disabled={saveStatus === "saving"}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                background:
                  saveStatus === "saved"  ? "rgba(74, 222, 128, 0.15)" :
                  saveStatus === "error"  ? "rgba(248, 113, 113, 0.15)" :
                  "rgba(255, 255, 255, 0.07)",
                border:
                  saveStatus === "saved"  ? "1px solid rgba(74, 222, 128, 0.4)" :
                  saveStatus === "error"  ? "1px solid rgba(248, 113, 113, 0.4)" :
                  "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: saveStatus === "saving" ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.2s",
              }}
              onMouseEnter={e => {
                if (saveStatus === "saving") return;
                e.currentTarget.style.background = "rgba(255,255,255,0.13)";
              }}
              onMouseLeave={e => {
                if (saveStatus !== null) return;
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              }}
            >
              {saveLabel()}
            </button>
          )}
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