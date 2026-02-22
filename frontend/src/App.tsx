import React, { useState } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import VersionTimeline from "./components/VersionTimeline";
import type { Version } from "./components/VersionTimeline";
import { uploadStep, getVersions, checkoutVersion } from "./services/api";
import "./App.css";

export default function App(): JSX.Element {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Version timeline state
  const [versions, setVersions] = useState<Version[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  // Tracks which version's files are currently being viewed (may differ from HEAD)
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  // Fetch versions from backend
  const refreshVersions = async (modelIdToFetch: string) => {
    try {
      const data = await getVersions(modelIdToFetch);
      setVersions(data.versions);
      setCurrentVersion(data.current_version);
      // After refresh, viewing version should be the latest
      setViewingVersion(data.current_version);
    } catch (e) {
      console.error("Failed to fetch versions:", e);
    }
  };

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
      const data = await uploadStep(file);
      setModelId(data.model_id);
      setModelUrl(`http://localhost:8000${data.glb_url}?t=${Date.now()}`);

      // Fetch version history from backend
      await refreshVersions(data.model_id);
    } catch (e) {
      console.error(e);
      alert("Upload failed. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle version selection - checkout files for viewing (non-destructive)
  const handleSelectVersion = async (version: number) => {
    if (!modelId || version === viewingVersion) return;

    setIsLoading(true);
    try {
      const data = await checkoutVersion(modelId, version);
      setModelUrl(data.glb_url);
      setViewingVersion(version);
      // Don't refresh versions - history is preserved
    } catch (e) {
      console.error("Failed to checkout version:", e);
      alert("Failed to view version. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!modelId) return;
    setExportStatus("exporting");
    try {
      // Download the STEP file
      const response = await fetch(
        `http://localhost:8000/api/cad/${modelId}/download/step`,
      );
      if (!response.ok) {
        throw new Error("Download failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `model_v${viewingVersion ?? "latest"}.step`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setExportStatus("exported");
      setTimeout(() => setExportStatus(null), 2500);
    } catch (e) {
      console.error(e);
      setExportStatus("error");
      setTimeout(() => setExportStatus(null), 2500);
    }
  };

  const exportLabel = () => {
    if (exportStatus === "exporting") return "⏳ Exporting...";
    if (exportStatus === "exported") return "✅ Downloaded!";
    if (exportStatus === "error") return "❌ Failed";
    return "📥 Export STEP";
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

          {/* Export button */}
          {modelId && (
            <button
              onClick={handleExport}
              disabled={exportStatus === "exporting"}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                background:
                  exportStatus === "exported"
                    ? "rgba(74, 222, 128, 0.15)"
                    : exportStatus === "error"
                      ? "rgba(248, 113, 113, 0.15)"
                      : "rgba(255, 255, 255, 0.07)",
                border:
                  exportStatus === "exported"
                    ? "1px solid rgba(74, 222, 128, 0.4)"
                    : exportStatus === "error"
                      ? "1px solid rgba(248, 113, 113, 0.4)"
                      : "1px solid rgba(255, 255, 255, 0.15)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor:
                  exportStatus === "exporting" ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (exportStatus === "exporting") return;
                e.currentTarget.style.background = "rgba(255,255,255,0.13)";
              }}
              onMouseLeave={(e) => {
                if (exportStatus !== null) return;
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              }}
            >
              {exportLabel()}
            </button>
          )}
        </div>

        {modelId && (
          <VersionTimeline
            versions={versions}
            currentVersion={viewingVersion}
            onSelectVersion={handleSelectVersion}
            disabled={isLoading}
          />
        )}

        <ChatInterface
          isLoading={isLoading}
          modelId={modelId}
          viewingVersion={viewingVersion}
          latestVersion={currentVersion}
          onModelUpdated={(newGlbUrl: string) => {
            setModelUrl(newGlbUrl);
            // Refresh versions from backend to get the new commit
            if (modelId) refreshVersions(modelId);
          }}
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
