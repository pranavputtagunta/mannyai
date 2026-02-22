import React, { Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stage, useGLTF } from "@react-three/drei";
import "../assets/Viewer3D.css";

import LassoSelector from "./Lasso/LassoSelector";
import type { LassoPoint } from "./Lasso/LassoOverlay";
import type { SelectedGeometryDetails } from "./Lasso/LassoSelector";

interface ModelProps {
  url: string;
}

function Model({ url }: ModelProps): JSX.Element {
  const { scene } = useGLTF(url);

  const handleSurfaceClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const { x, y, z } = e.point;
    console.log("Surgical coordinate targeted:", { x, y, z });
  };

  return (
    <primitive
      object={scene}
      onClick={handleSurfaceClick}
      onPointerOver={() => (document.body.style.cursor = "crosshair")}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    />
  );
}

interface Viewer3DProps {
  modelUrl: string | null;
  lassoActive?: boolean;                          // ← matches App.tsx
  lassoPointsPx?: LassoPoint[] | null;            // ← drawn points from overlay
  onSelection?: (details: SelectedGeometryDetails) => void;
}

export default function Viewer3D({
  modelUrl,
  lassoActive = false,
  lassoPointsPx = null,
  onSelection,
}: Viewer3DProps): JSX.Element {
  return (
    <div
      className="viewer-wrapper"
      style={{
        // Show lasso cursor when active
        cursor: lassoActive ? "crosshair" : "auto",
      }}
    >
      <Canvas shadows camera={{ position: [0, 2, 5], fov: 45 }}>
        <color attach="background" args={["#171717"]} />

        <Suspense fallback={null}>
          {modelUrl && (
            <Stage environment="city" intensity={0.6} shadows="contact">
              <Model url={modelUrl} />
            </Stage>
          )}

          <LassoSelector
            enabled={lassoActive && !!modelUrl}
            lassoPointsPx={lassoPointsPx}
            onSelection={onSelection ?? (() => {})}
            sampleStepPx={10}
            filterObject={(obj: any) => {
              if (!obj?.isMesh) return false;
              const name = (obj.name || "").toLowerCase();
              if (
                name.includes("helper") ||
                name.includes("grid") ||
                name.includes("axis")
              )
                return false;
              return true;
            }}
          />
        </Suspense>

        {/* Disable orbit controls while lasso is active so drag = draw not rotate */}
        <OrbitControls
          makeDefault
          enabled={!lassoActive}        // ← key fix
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  );
}