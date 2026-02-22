import React, { useState } from 'react';
import ChatInterface from './components/ChatInterface';
import Viewer3D from './components/Viewer3D';
import LassoOverlay, { type LassoPoint } from './components/Lasso/LassoOverlay';
import { fetchModelFromOnshape, resolveFacesFromPoints } from './services/api';
import './App.css';

type SelectedGeometryDetails = {
  objectUuids: string[];
  objectNames: string[];
  objects: Array<{
    uuid: string;
    name: string;
    type: string;
    matrixWorld: number[];
    bboxWorld: { min: [number, number, number]; max: [number, number, number] };
    centerWorld: [number, number, number];
    approxSurfaceArea?: number;
    vertexCount?: number;
    triangleCount?: number;
  }>;
  lasso: {
    pointsPx: Array<{ x: number; y: number }>;
    bboxPx: { minX: number; minY: number; maxX: number; maxY: number };
  };
  hits: Array<{ meshUuid: string; faceIndex: number | null; pointWorld: [number, number, number] }>;
};

// --- Shared Glassmorphism Style ---
const glassStyle: React.CSSProperties = {
  background: 'rgba(20, 20, 20, 0.65)', 
  backdropFilter: 'blur(16px)',         
  WebkitBackdropFilter: 'blur(16px)',   
  border: '1px solid rgba(255, 255, 255, 0.1)', 
  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)', 
  color: '#fff',
};

export default function App(): JSX.Element {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [docInfo, setDocInfo] = useState<{ did: string; wvm: string; wvmid: string; eid: string; } | null>(null);

  const [lassoEnabled, setLassoEnabled] = useState(false);
  const [lassoPointsPx, setLassoPointsPx] = useState<LassoPoint[] | null>(null);
  const [selection, setSelection] = useState<SelectedGeometryDetails | null>(null);

  const selectionCount = selection?.objectUuids?.length ?? 0;
  const canUseLasso = !!modelUrl && !isLoading;

  const handleImport = async (url: string): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetchModelFromOnshape(url);
      setModelUrl(res.blobUrl);
      setDocInfo({ did: res.did, wvm: res.wvm, wvmid: res.wvmid, eid: res.eid });

      setSelection(null);
      setLassoPointsPx(null);
      setLassoEnabled(false);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Error importing model. Check console for 404/CORS issues.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSelection = () => {
    setSelection(null);
    setLassoPointsPx(null);
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
              if (input.value.trim()) handleImport(input.value.trim());
            }}
            className="url-form"
            style={{ marginTop: 16, display: "flex", gap: 8 }}
          >
            <input
              name="url"
              type="text"
              placeholder="Paste Onshape URL..."
              disabled={isLoading}
              className="url-input"
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                background: "#171717",
                border: "1px solid #262626",
                color: "#fff",
                fontSize: 12
              }}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="url-submit-btn"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: "#2563eb",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Load
            </button>
          </form>
        </div>

        <ChatInterface onImport={handleImport} isLoading={isLoading} />
      </div>

      <div className="main-canvas" style={{ position: "relative" }}>
        
        {/* --- CENTERED GLASS LASSO TOOLBAR (Top) --- */}
        {canUseLasso && (
           <div style={{
             position: 'absolute',
             top: 24,
             left: '50%',
             transform: 'translateX(-50%)', // Perfectly centers the floating bar
             zIndex: 50, 
             display: 'flex',
             alignItems: 'center',
             gap: 12,
             padding: '8px 12px',
             borderRadius: 30, // Pill shape for the main bar
             ...glassStyle 
           }}>
             <button
               onClick={() => setLassoEnabled((v) => !v)}
               style={{
                 padding: "8px 16px",
                 borderRadius: 20, 
                 border: "none",
                 background: lassoEnabled ? "rgba(34,211,238,0.2)" : "transparent",
                 color: lassoEnabled ? "rgb(50, 220, 250)" : "rgba(255,255,255,0.8)",
                 fontWeight: 600,
                 fontSize: 13,
                 cursor: "pointer",
                 transition: "all 0.2s ease"
               }}
             >
               {lassoEnabled ? "Lasso Active" : "Lasso Tool"}
             </button>

             {selectionCount > 0 && (
                <>
                  <div style={{ height: 20, width: 1, background: 'rgba(255,255,255,0.2)' }}></div>
                  <span style={{ fontSize: 13, fontWeight: 500, paddingLeft: 4 }}>
                    {selectionCount} Selected
                  </span>
                  <button
                    onClick={handleClearSelection}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.05)",
                      color: "rgba(255,255,255,0.8)",
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.2s ease"
                    }}
                  >
                    Clear
                  </button>
                </>
             )}
           </div>
        )}

        {!modelUrl && !isLoading && (
          <div className="overlay">
            <p className="overlay-text">Paste an Onshape link to begin surgery.</p>
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
          lassoEnabled={lassoEnabled}
          lassoPointsPx={lassoPointsPx}
          onLassoSelection={async (details: SelectedGeometryDetails) => {
            setSelection(details);
            // I removed the setLassoEnabled(false) here. 
            // The lasso will stay active until you manually toggle it off or clear it, fixing the glitch.

            if (!details.hits?.length) return;
            try {
              const points = details.hits.filter((_, i) => i % 5 === 0).slice(0, 200).map(h => h.pointWorld);
              const result = await resolveFacesFromPoints(
                docInfo?.did || "", docInfo?.wvm || "", docInfo?.wvmid || "", docInfo?.eid || "", points
              );
              console.log("Onshape Feature IDs resolved:", result);
            } catch (err) {
              console.error("Failed to resolve Onshape faces:", err);
            }
          }}
        />

        <LassoOverlay
          enabled={lassoEnabled && !!modelUrl && !isLoading}
          onComplete={(pts) => setLassoPointsPx(pts)}
          onClear={() => setLassoPointsPx(null)}
        />

        {/* --- CENTERED BOTTOM HUD --- */}
        {selection && selectionCount > 0 && (
          <div style={{
            position: "absolute",
            bottom: 30,
            left: '50%',
            transform: 'translateX(-50%)', // Centered horizontally
            padding: "12px 24px",
            zIndex: 40,
            borderRadius: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            ...glassStyle 
          }}>
            <div style={{ fontWeight: 600, color: "#fff", fontSize: 13 }}>
              Selected Geometry
            </div>
            {selection.objects?.[0]?.centerWorld && (
              <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12, fontFamily: 'monospace' }}>
                Center XYZ: [{selection.objects[0].centerWorld.map(n => n.toFixed(2)).join(", ")}]
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}