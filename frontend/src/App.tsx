// frontend/src/App.tsx
import React, { useState, useCallback } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import LassoOverlay from "./components/Lasso/LassoOverlay";
import VersionTimeline from "./components/VersionTimeline";
import type { LassoPoint } from "./components/Lasso/LassoOverlay";
import type { SelectedGeometryDetails } from "./components/Lasso/LassoSelector";
import type { Version } from "./components/VersionTimeline";
import { uploadStep, getVersions, checkoutVersion } from "./services/api";
import "./App.css";

export default function App(): JSX.Element {
  const [modelUrl, setModelUrl]     = useState<string | null>(null);
  const [modelId, setModelId]       = useState<string | null>(null);
  const [isLoading, setIsLoading]   = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Version timeline state
  const [versions, setVersions]             = useState<Version[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  // Lasso state
  const [lassoActive, setLassoActive]       = useState(false);
  const [lassoPointsPx, setLassoPointsPx]   = useState<LassoPoint[] | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<Array<[number, number, number]> | null>(null);

  const refreshVersions = async (modelIdToFetch: string) => {
    try {
      const data = await getVersions(modelIdToFetch);
      setVersions(data.versions);
      setCurrentVersion(data.current_version);
      setViewingVersion(data.current_version);
    } catch (e) {
      console.error("Failed to fetch versions:", e);
    }
  };

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    setSelectedPoints(null);
    setLassoPointsPx(null);
    setLassoActive(false);
    try {
      const data = await uploadStep(file);
      setModelId(data.model_id);
      setModelUrl(`http://localhost:8000${data.glb_url}?t=${Date.now()}`);
      await refreshVersions(data.model_id);
    } catch (e) {
      console.error(e);
      alert("Upload failed. Check console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectVersion = async (version: number) => {
    if (!modelId || version === viewingVersion) return;
    setIsLoading(true);
    try {
      const data = await checkoutVersion(modelId, version);
      setModelUrl(data.glb_url);
      setViewingVersion(version);
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
      const response = await fetch(`http://localhost:8000/api/cad/${modelId}/download/step`);
      if (!response.ok) throw new Error("Download failed");
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
    if (exportStatus === "exported")  return "✅ Downloaded!";
    if (exportStatus === "error")     return "❌ Failed";
    return "📥 Export STEP";
  };

  const handleSelection = useCallback((details: SelectedGeometryDetails) => {
    const pts = details.hits.map((h) => h.pointWorld) as Array<[number, number, number]>;
    setSelectedPoints(pts.length > 0 ? pts : null);
    setLassoActive(false);
  }, []);

  const clearSelection = () => {
    setSelectedPoints(null);
    setLassoPointsPx(null);
    setLassoActive(false);
  };

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
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

          {/* Export STEP button */}
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
                  exportStatus === "exported" ? "rgba(74, 222, 128, 0.15)" :
                  exportStatus === "error"    ? "rgba(248, 113, 113, 0.15)" :
                  "rgba(255,255,255,0.07)",
                border:
                  exportStatus === "exported" ? "1px solid rgba(74, 222, 128, 0.4)" :
                  exportStatus === "error"    ? "1px solid rgba(248, 113, 113, 0.4)" :
                  "1px solid rgba(255,255,255,0.15)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: exportStatus === "exporting" ? "not-allowed" : "pointer",
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

        {/* Version timeline */}
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
            if (modelId) refreshVersions(modelId);
          }}
          selectedPoints={selectedPoints}
        />
      </div>

      {/* ── Main Canvas ── */}
      <div className="main-canvas" style={{ position: "relative" }}>

        {/* Glass pill toolbar */}
        {modelUrl && (
          <div
            style={{
              position: "absolute",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 50,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 999,
              background: "rgba(20, 20, 20, 0.55)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
              pointerEvents: "auto",
            }}
          >
            <button
              onClick={() => {
                setLassoActive((v) => !v);
                if (lassoActive) {
                  setSelectedPoints(null);
                  setLassoPointsPx(null);
                }
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: lassoActive
                  ? "1px solid rgba(34,211,238,0.6)"
                  : "1px solid rgba(255,255,255,0.15)",
                background: lassoActive
                  ? "rgba(34, 211, 238, 0.18)"
                  : "rgba(255,255,255,0.07)",
                color: lassoActive ? "#22d3ee" : "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.2s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10" strokeDasharray="3 3"/>
                <path d="M22 2L12 12"/>
              </svg>
              {lassoActive ? "Drawing..." : "Lasso Select"}
            </button>

            {selectedPoints && selectedPoints.length > 0 && (
              <button
                onClick={clearSelection}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(248,113,113,0.4)",
                  background: "rgba(248,113,113,0.12)",
                  color: "#f87171",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                ✕ Clear ({selectedPoints.length} pts)
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {!modelUrl && !isLoading && (
          <div className="overlay">
            <p className="overlay-text">Upload a STEP file to begin surgery.</p>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="overlay">
            <div className="loader-group">
              <div className="spinner"></div>
              <p className="loading-text">Processing CAD...</p>
            </div>
          </div>
        )}

        {/* Three.js viewer */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: lassoActive ? "none" : "auto" }}>
          <Viewer3D
            modelUrl={modelUrl}
            lassoActive={lassoActive}
            lassoPointsPx={lassoPointsPx}
            onSelection={handleSelection}
          />
        </div>

        {/* Lasso canvas overlay */}
        <LassoOverlay
          enabled={lassoActive}
          zIndex={30}
          onComplete={(pts) => {
            setLassoPointsPx(pts);
          }}
          onClear={() => {
            setLassoPointsPx(null);
            setSelectedPoints(null);
          }}
        />
      </div>
    </div>
  );
}