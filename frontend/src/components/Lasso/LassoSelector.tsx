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

  // optional tiny “visual confirmation” overlay (single dot cloud)
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

    // selectable meshes
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

    // sample rays inside lasso
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
          normalWorld: h.face?.normal ? [h.face.normal.x, h.face.normal.y, h.face.normal.z] : undefined,
        });

        // debug overlay point
        debugPositions.push(p.x, p.y, p.z);
      }
    }

    // render tiny point cloud to show user “you selected here”
    if (debugPositions.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(debugPositions, 3));
        const m = new THREE.PointsMaterial({
        size: 0.003,
        color: new THREE.Color(0x22d3ee),
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 999;
      scene.add(pts);
      debugPointsRef.current = pts;
    }

    onSelection({
      hits: hitsWorld,
      lasso: { pointsPx: lassoPointsPx, bboxPx: bb },
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lassoPointsPx]);

  useEffect(() => {
    if (enabled) return;
    clearDebug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return null;
}