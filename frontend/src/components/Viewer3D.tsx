import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stage, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import type { Coordinate } from "../services/api";
import LassoTool, {
  type FaceHitRef,
  type RegionSelectionMode,
  type RegionSelectionResult,
  type SampledSurfacePoint,
  type Selection2DShape,
  type TriangleRef,
  type ViewContext,
} from "./LassoTool";
import "../assets/Viewer3D.css";

(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;

interface ModelProps {
  url: string;
  selectionMode: SelectionMode;
  onModelReady: (model: THREE.Object3D) => void;
}

export type SelectionMode = "click" | "lasso" | "circle";

export interface SelectionPayload {
  mode: SelectionMode;
  coordinates: Coordinate | null;
  pointCount: number;
  sampledPoints: Coordinate[];
  overlayTriangles: Coordinate[];
  boundedVertices: Coordinate[];
  selection2D: Selection2DShape | null;
  viewContext: ViewContext | null;
  sampledSurface: SampledSurfacePoint[];
  faceHits: FaceHitRef[];
  triangleRefs: TriangleRef[];
}

interface SelectionHighlightProps {
  selection: SelectionPayload | null;
}

function SelectionHighlight({ selection }: SelectionHighlightProps): ReactElement | null {
  const sampledPoints = selection?.sampledPoints ?? [];

  const pointPositions = useMemo(() => {
    if (sampledPoints.length === 0) {
      return null;
    }

    const values = new Float32Array(sampledPoints.length * 3);
    sampledPoints.forEach((point, index) => {
      const base = index * 3;
      values[base] = point.x;
      values[base + 1] = point.y;
      values[base + 2] = point.z;
    });
    return values;
  }, [sampledPoints]);

  if (!pointPositions) {
    return null;
  }

  return (
    <group>
      <points frustumCulled={false} renderOrder={22}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={sampledPoints.length}
            array={pointPositions}
            itemSize={3}
            args={[pointPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#3b82f6"
          transparent
          opacity={0.94}
          size={6.2}
          sizeAttenuation={false}
          depthWrite={false}
          depthTest
        />
      </points>
    </group>
  );
}

function Model({
  url,
  selectionMode,
  onModelReady,
}: ModelProps): ReactElement {
  const { scene } = useGLTF(url);

  useEffect(() => {
    onModelReady(scene);

    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        (node.geometry as any).computeBoundsTree?.();
      }
    });

    return () => {
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          (node.geometry as any).disposeBoundsTree?.();
        }
      });
    };
  }, [onModelReady, scene]);

  const handleSurfaceClick = (e: ThreeEvent<MouseEvent>) => {
    if (selectionMode !== "click") {
      return;
    }

    e.stopPropagation();
  };

  return (
    <primitive 
      object={scene} 
      onClick={handleSurfaceClick}
      onPointerOver={() => {
        document.body.style.cursor = "auto";
      }}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    />
  );
}

interface Viewer3DProps {
  modelUrl: string | null;
  selectionMode: SelectionMode;
  selection: SelectionPayload | null;
  onSelectionChange: (selection: SelectionPayload | null) => void;
}

export default function Viewer3D({
  modelUrl,
  selectionMode,
  selection,
  onSelectionChange,
}: Viewer3DProps): ReactElement {
  const [activeCamera, setActiveCamera] = useState<THREE.Camera | null>(null);
  const [modelRoot, setModelRoot] = useState<THREE.Object3D | null>(null);
  const [isDrawingSelection, setIsDrawingSelection] = useState<boolean>(false);

  useEffect(() => {
    document.body.style.cursor = "auto";
  }, [selectionMode]);

  const handleRegionSelection = (selection: RegionSelectionResult) => {
    onSelectionChange({
      mode: selection.mode,
      coordinates: selection.coordinates,
      pointCount: selection.pointCount,
      sampledPoints: selection.sampledPoints,
      overlayTriangles: selection.overlayTriangles,
      boundedVertices: selection.boundedVertices,
      selection2D: selection.selection2D,
      viewContext: selection.viewContext,
      sampledSurface: selection.sampledSurface,
      faceHits: selection.faceHits,
      triangleRefs: selection.triangleRefs,
    });
  };

  const lassoMode: RegionSelectionMode | null =
    selectionMode === "lasso" || selectionMode === "circle"
      ? selectionMode
      : null;

  return (
    <div className="viewer-wrapper">
      <Canvas
        shadows
        camera={{ position: [0, 2, 5], fov: 45 }}
        onCreated={({ camera }) => setActiveCamera(camera)}
      >
        <color attach="background" args={["#171717"]} />
        
        <Suspense fallback={null}>
          {modelUrl && (
            <Stage environment="city" intensity={0.6} shadows="contact">
              <Model
                url={modelUrl}
                selectionMode={selectionMode}
                onModelReady={setModelRoot}
              />
            </Stage>
          )}
        </Suspense>

        <SelectionHighlight selection={selection} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          enabled={!isDrawingSelection}
        />
      </Canvas>

      {modelUrl && (
        <LassoTool
          mode={lassoMode ?? "lasso"}
          active={Boolean(modelUrl && lassoMode)}
          selection2D={selection?.selection2D ?? null}
          camera={activeCamera}
          meshRoot={modelRoot}
          onDrawingStateChange={setIsDrawingSelection}
          onSelectionComplete={handleRegionSelection}
        />
      )}
    </div>
  );
}