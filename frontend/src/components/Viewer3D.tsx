// frontend/src/components/Viewer3D.tsx
import React, { Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  Stage,
  useGLTF,
  GizmoHelper,
  GizmoViewport,
} from "@react-three/drei";

import LassoSelector from "./Lasso/LassoSelector";
import type { LassoPoint } from "./Lasso/LassoOverlay";
import type { SelectedGeometryDetails } from "./Lasso/LassoSelector";
import { ModelStatsReader } from "./ModelStats";
import type { ModelDimensions } from "./ModelStats";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return (
    <primitive
      object={scene}
      onPointerOver={() => (document.body.style.cursor = "crosshair")}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    />
  );
}

interface Viewer3DProps {
  modelUrl: string | null;
  lassoActive?: boolean;
  lassoPointsPx?: LassoPoint[] | null;
  onSelection?: (details: SelectedGeometryDetails) => void;
  onStats?: (stats: ModelDimensions | null) => void;
}

export default function Viewer3D({
  modelUrl,
  lassoActive = false,
  lassoPointsPx = null,
  onSelection,
  onStats,
}: Viewer3DProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
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
              return (
                !name.includes("helper") &&
                !name.includes("grid") &&
                !name.includes("axis")
              );
            }}
          />

          {onStats && <ModelStatsReader onStats={onStats} />}
        </Suspense>

        <OrbitControls
          makeDefault
          enabled={!lassoActive}
          enableDamping
          dampingFactor={0.05}
        />

        {/* Axis indicator in top-right corner */}
        <GizmoHelper alignment="top-right" margin={[60, 60]}>
          <GizmoViewport
            axisColors={["#ff4444", "#44ff44", "#4444ff"]}
            labelColor="white"
            hideNegativeAxes
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
