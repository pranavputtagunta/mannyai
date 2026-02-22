import React, { Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stage, useGLTF } from "@react-three/drei";
import "../assets/Viewer3D.css";

import LassoSelector from "./Lasso/LassoSelector";          // <-- add
import type { LassoPoint } from "./Lasso/LassoOverlay";     // <-- add

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

  // lasso plumbing
  lassoEnabled: boolean;
  lassoPointsPx: LassoPoint[] | null;
  onLassoSelection: (details: any) => void; // you can type this later
}

export default function Viewer3D({
  modelUrl,
  lassoEnabled,
  lassoPointsPx,
  onLassoSelection,
}: Viewer3DProps): JSX.Element {
  return (
    <div className="viewer-wrapper">
      <Canvas shadows camera={{ position: [0, 2, 5], fov: 45 }}>
        <color attach="background" args={["#171717"]} />

        <Suspense fallback={null}>
          {modelUrl && (
            <Stage environment="city" intensity={0.6} shadows="contact">
              <Model url={modelUrl} />
            </Stage>
          )}

        <LassoSelector
          enabled={lassoEnabled && !!modelUrl}
          lassoPointsPx={lassoPointsPx}
          onSelection={onLassoSelection}
          sampleStepPx={10}
          filterObject={(obj: any) => {
            if (!obj?.isMesh) return false;
            const name = (obj.name || "").toLowerCase();
            if (name.includes("helper") || name.includes("grid") || name.includes("axis")) return false;
            return true;
          }}
        />
        </Suspense>

        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}