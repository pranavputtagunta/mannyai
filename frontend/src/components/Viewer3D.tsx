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
  tintColor: string | null;
  sphereTintColor: string | null;
  backgroundTintColor: string | null;
  sphereTintAnchor: [number, number, number] | null;
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
  tintColor,
  sphereTintColor,
  backgroundTintColor,
  sphereTintAnchor,
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

  useEffect(() => {
    const sceneBounds = new THREE.Box3().setFromObject(scene);
    const sceneSize = new THREE.Vector3();
    sceneBounds.getSize(sceneSize);
    const sceneDiag = Math.max(1e-9, sceneSize.length());

    const meshRoles = new Map<THREE.Mesh, "sphere" | "background" | "shape">();
    const meshCenters = new Map<THREE.Mesh, THREE.Vector3>();
    const meshDiagonals = new Map<THREE.Mesh, number>();
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) {
        return;
      }

      const meshBounds = new THREE.Box3().setFromObject(node);
      const meshSize = new THREE.Vector3();
      meshBounds.getSize(meshSize);
      const meshDiag = Math.max(1e-9, meshSize.length());
      meshDiagonals.set(node, meshDiag);
      const meshCenter = new THREE.Vector3();
      meshBounds.getCenter(meshCenter);
      meshCenters.set(node, meshCenter);

      const maxExtent = Math.max(meshSize.x, meshSize.y, meshSize.z, 1e-9);
      const minExtent = Math.min(meshSize.x, meshSize.y, meshSize.z, 1e-9);
      const extentRatio = minExtent / maxExtent;
      const isSmall = meshDiag <= sceneDiag * 0.22;
      const isRoundish = extentRatio >= 0.82;
      const nameHint = /sphere|ball|orb|circle/.test((node.name || "").toLowerCase());
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      const hasLightMaterial = materials.some((material) => {
        const materialWithColor = material as THREE.Material & { color?: THREE.Color };
        if (!materialWithColor.color) {
          return false;
        }
        const hsl = { h: 0, s: 0, l: 0 };
        materialWithColor.color.getHSL(hsl);
        return hsl.l > 0.72 && hsl.s < 0.35;
      });

      const initialRole = nameHint || (isSmall && isRoundish) || (isSmall && hasLightMaterial)
        ? "sphere"
        : "shape";
      meshRoles.set(node, initialRole);
    });

    let largestDiag = 0;
    for (const diag of meshDiagonals.values()) {
      largestDiag = Math.max(largestDiag, diag);
    }
    const backgroundThreshold = largestDiag * 0.55;
    for (const [mesh, role] of meshRoles.entries()) {
      if (role === "sphere") {
        continue;
      }
      const diag = meshDiagonals.get(mesh) ?? 0;
      if (diag >= backgroundThreshold) {
        meshRoles.set(mesh, "background");
      }
    });

    if (sphereTintAnchor) {
      const anchor = new THREE.Vector3(sphereTintAnchor[0], sphereTintAnchor[1], sphereTintAnchor[2]);
      let closestMesh: THREE.Mesh | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const [mesh, center] of meshCenters.entries()) {
        const distance = center.distanceTo(anchor);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestMesh = mesh;
        }
      }
      if (closestMesh) {
        for (const mesh of meshRoles.keys()) {
          const diag = meshDiagonals.get(mesh) ?? 0;
          const role = mesh === closestMesh
            ? "sphere"
            : diag >= backgroundThreshold
              ? "background"
              : "shape";
          meshRoles.set(mesh, role);
        }
      }
    }

    const sphereMeshCount = Array.from(meshRoles.values()).filter((role) => role === "sphere").length;

    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) {
        return;
      }
      const role = meshRoles.get(node) ?? "background";

      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];

      materials.forEach((material) => {
        const phongLike = material as THREE.Material & {
          color?: THREE.Color;
          userData?: Record<string, unknown>;
        };

        if (!phongLike.color) {
          return;
        }

        const userData = (phongLike.userData ??= {});
        if (!userData.originalColor && phongLike.color) {
          userData.originalColor = phongLike.color.clone();
        }

        const sphereTintEffective = sphereMeshCount > 0 ? sphereTintColor : null;
        const backgroundTintEffective = backgroundTintColor;
        const targetTint = role === "sphere"
          ? sphereTintEffective ?? tintColor
          : role === "background"
            ? backgroundTintEffective ?? tintColor
            : tintColor;

        if (!targetTint) {
          const original = userData.originalColor as THREE.Color | undefined;
          if (original) {
            phongLike.color.copy(original);
          }
        } else {
          phongLike.color.set(targetTint);
        }

        material.needsUpdate = true;
      });
    });
  }, [scene, tintColor, sphereTintColor, backgroundTintColor, sphereTintAnchor]);

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
  tintColor: string | null;
  sphereTintColor: string | null;
  backgroundTintColor: string | null;
  sphereTintAnchor: [number, number, number] | null;
  onSelectionChange: (selection: SelectionPayload | null) => void;
}

export default function Viewer3D({
  modelUrl,
  selectionMode,
  selection,
  tintColor,
  sphereTintColor,
  backgroundTintColor,
  sphereTintAnchor,
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
                tintColor={tintColor}
                sphereTintColor={sphereTintColor}
                backgroundTintColor={backgroundTintColor}
                sphereTintAnchor={sphereTintAnchor}
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