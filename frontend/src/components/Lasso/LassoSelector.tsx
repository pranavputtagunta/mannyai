import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { LassoPoint } from "./LassoOverlay";

export type HitSample = {
  pointWorld: [number, number, number];
  normalWorld?: [number, number, number];
};

export type SelectedGeometryDetails = {
  hits: HitSample[];
  lasso: {
    pointsPx: LassoPoint[];
    bboxPx: { minX: number; minY: number; maxX: number; maxY: number };
  };
};

type Props = {
  enabled: boolean;
  lassoPointsPx: LassoPoint[] | null;
  onSelection: (details: SelectedGeometryDetails) => void;
  sampleStepPx?: number;
  filterObject?: (obj: THREE.Object3D) => boolean;
};

function pointInPoly(x: number, y: number, poly: LassoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bbox(poly: LassoPoint[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export default function LassoSelector({
  enabled,
  lassoPointsPx,
  onSelection,
  sampleStepPx = 10,
  filterObject,
}: Props) {
  const { camera, scene, size } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const debugPointsRef = useRef<THREE.Points | null>(null);

  const clearDebug = () => {
    if (debugPointsRef.current) {
      debugPointsRef.current.parent?.remove(debugPointsRef.current);
      (debugPointsRef.current.geometry as THREE.BufferGeometry)?.dispose?.();
      (debugPointsRef.current.material as THREE.Material)?.dispose?.();
      debugPointsRef.current = null;
    }
  };

  useEffect(() => {
    if (!enabled) return;
    if (!lassoPointsPx || lassoPointsPx.length < 3) return;

    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (!(obj as any).isMesh) return;
      if (!obj.visible) return;
      if (filterObject && !filterObject(obj)) return;
      meshes.push(obj);
    });

    clearDebug();

    const bb = bbox(lassoPointsPx);
    const minX = Math.max(0, Math.floor(bb.minX));
    const minY = Math.max(0, Math.floor(bb.minY));
    const maxX = Math.min(size.width, Math.ceil(bb.maxX));
    const maxY = Math.min(size.height, Math.ceil(bb.maxY));

    const screenToNDC = (px: number, py: number) => ({
      x: (px / size.width) * 2 - 1,
      y: -(py / size.height) * 2 + 1,
    });

    const hitsWorld: HitSample[] = [];
    const debugPositions: number[] = [];

    for (let y = minY; y <= maxY; y += sampleStepPx) {
      for (let x = minX; x <= maxX; x += sampleStepPx) {
        if (!pointInPoly(x, y, lassoPointsPx)) continue;

        const { x: nx, y: ny } = screenToNDC(x, y);
        ndc.set(nx, ny);
        raycaster.setFromCamera(ndc, camera);

        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) continue;

        const h = hits[0];
        const p = h.point;
        hitsWorld.push({
          pointWorld: [p.x, p.y, p.z],
          normalWorld: h.face?.normal
            ? [h.face.normal.x, h.face.normal.y, h.face.normal.z]
            : undefined,
        });

        debugPositions.push(p.x, p.y, p.z);
      }
    }

    console.log("[LASSO] meshes:", meshes.length, "hits:", hitsWorld.length);

    if (debugPositions.length) {
      // Compute dynamic point size from actual hit spread
      const xs = debugPositions.filter((_, i) => i % 3 === 0);
      const ys = debugPositions.filter((_, i) => i % 3 === 1);
      const zs = debugPositions.filter((_, i) => i % 3 === 2);
      const rangeX = Math.max(...xs) - Math.min(...xs);
      const rangeY = Math.max(...ys) - Math.min(...ys);
      const rangeZ = Math.max(...zs) - Math.min(...zs);
      const modelExtent = Math.max(rangeX, rangeY, rangeZ, 0.1); // floor at 0.1
      const pointSize = modelExtent * 0.025; // 2.5% of model extent

      console.log("[LASSO] modelExtent:", modelExtent, "pointSize:", pointSize);

      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(debugPositions, 3));

      const m = new THREE.PointsMaterial({
        size: pointSize,
        color: new THREE.Color(0x22d3ee),
        transparent: false,
        opacity: 1.0,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
      });

      const pts = new THREE.Points(g, m);
      pts.renderOrder = 9999;
      scene.add(pts);
      debugPointsRef.current = pts;

      console.log("[LASSO] points added to scene:", pts.uuid);
    }

    onSelection({
      hits: hitsWorld,
      lasso: { pointsPx: lassoPointsPx, bboxPx: bb },
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lassoPointsPx]);

    useEffect(() => {
    if (lassoPointsPx === null) {
        clearDebug();
    }
    }, [lassoPointsPx]);
  return null;
}