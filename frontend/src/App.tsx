import { useState } from "react";
import ChatInterface from "./components/ChatInterface";
import Viewer3D from "./components/Viewer3D";
import LinkEntry from "./components/LinkEntry";
import UseCaseEntry from "./components/UseCaseEntry";
import { fetchModelFromOnshape } from "./services/api";
import "./App.css";

export default function App() {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /**
   * Called by ChatInterface when a user pastes an Onshape URL
   */
  const handleImport = async (url: string): Promise<void> => {
    setIsLoading(true);
    try {
      // Calls the proxy-enabled fetcher in api.ts
      const objectUrl = await fetchModelFromOnshape(url);
      setModelUrl(objectUrl);
      console.log("Model successfully loaded into blob URL:", objectUrl);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Failed to download model. Ensure your Vite proxy is running.");
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
          <LinkEntry isLoading={isLoading} onImport={handleImport} />
          <UseCaseEntry />
        </div>
        <ChatInterface isLoading={isLoading} />
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
