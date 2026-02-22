// frontend/src/components/ModelStats.tsx
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export type ModelDimensions = {
  width: number;
  depth: number;
  height: number;
  volume: number;
  surfaceArea: number;
  centerX: number;
  centerY: number;
  centerZ: number;
};

// Lives INSIDE the Canvas — reads scene data and reports up
export function ModelStatsReader({ onStats }: { onStats: (s: ModelDimensions | null) => void }) {
  const { scene } = useThree();

  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Points) return;
      if (!(obj as THREE.Mesh).isMesh) return;
      if (!obj.visible) return;
      const name = (obj.name || "").toLowerCase();
      if (name.includes("helper") || name.includes("grid")) return;
      meshes.push(obj as THREE.Mesh);
    });

    if (meshes.length === 0) { onStats(null); return; }

    const box = new THREE.Box3();
    meshes.forEach((m) => box.union(new THREE.Box3().setFromObject(m)));

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Approximate surface area from triangle geometry
    let totalArea = 0;
    meshes.forEach((mesh) => {
      const geo = mesh.geometry;
      if (!geo.index) return;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
      const cross = new THREE.Vector3();
      for (let i = 0; i < idx.count; i += 3) {
        vA.fromBufferAttribute(pos, idx.getX(i));
        vB.fromBufferAttribute(pos, idx.getX(i + 1));
        vC.fromBufferAttribute(pos, idx.getX(i + 2));
        cross.crossVectors(vB.clone().sub(vA), vC.clone().sub(vA));
        totalArea += cross.length() / 2;
      }
    });

    onStats({
      width:       Math.round(size.x * 100) / 100,
      depth:       Math.round(size.y * 100) / 100,
      height:      Math.round(size.z * 100) / 100,
      volume:      Math.round(size.x * size.y * size.z * 100) / 100,
      surfaceArea: Math.round(totalArea * 100) / 100,
      centerX:     Math.round(center.x * 100) / 100,
      centerY:     Math.round(center.y * 100) / 100,
      centerZ:     Math.round(center.z * 100) / 100,
    });
  }, [scene.children.length]); // eslint-disable-line

  return null;
}

// Lives OUTSIDE the Canvas — pure HTML overlay
export default function ModelStats({ stats, visible }: { stats: ModelDimensions | null; visible: boolean }) {
  const [expanded, setExpanded] = useState(true);

  if (!visible || !stats) return null;

  const fmt = (n: number) => n.toFixed(2);

  const dims = [
    { label: "W", value: fmt(stats.width),  unit: "mm", accent: true },
    { label: "D", value: fmt(stats.depth),  unit: "mm", accent: true },
    { label: "H", value: fmt(stats.height), unit: "mm", accent: true },
    { label: "Vol", value: fmt(stats.volume),      unit: "mm³" },
    { label: "SA",  value: fmt(stats.surfaceArea),  unit: "mm²" },
  ];

 return (
  <div style={{
    position: "absolute",
    bottom: 32,
    right: 32,
    zIndex: 40,
    minWidth: 220,
    borderRadius: 14,
    background: "rgba(8, 8, 8, 0.78)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
    overflow: "hidden",
    fontFamily: "'JetBrains Mono', 'Fira Mono', 'Cascadia Code', monospace",
    pointerEvents: "auto",
  }}>

    {/* Header */}
    <button
      onClick={() => setExpanded(v => !v)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        background: "transparent",
        border: "none",
        borderBottom: expanded ? "1px solid rgba(255,255,255,0.06)" : "none",
        cursor: "pointer",
        color: "rgba(255,255,255,0.45)",
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#22d3ee",
          boxShadow: "0 0 6px #22d3eeaa",
        }} />
        Dimensions
      </span>
      <span style={{ fontSize: 9, opacity: 0.5 }}>{expanded ? "▲" : "▼"}</span>
    </button>

    {expanded && (
      <div style={{ padding: "12px 0 14px" }}>
        {dims.map((row) => (
          <div key={row.label} style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "4px 18px",
          }}>
            <span style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              minWidth: 32,
            }}>
              {row.label}
            </span>

            <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{
                fontSize: 16,
                fontWeight: 700,
                color: row.accent ? "#e2e8f0" : "rgba(255,255,255,0.65)",
                letterSpacing: "-0.02em",
              }}>
                {row.value}
              </span>
              <span style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.28)",
                letterSpacing: "0.05em"
              }}>
                {row.unit}
              </span>
            </span>
          </div>
        ))}

        <div style={{
          margin: "10px 18px 8px",
          borderTop: "1px solid rgba(255,255,255,0.05)"
        }} />

        <div style={{ padding: "0 18px" }}>
          <div style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            Center
          </div>
          <div style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.45)",
            letterSpacing: "0.02em"
          }}>
            {fmt(stats.centerX)}, {fmt(stats.centerY)}, {fmt(stats.centerZ)}
          </div>
        </div>
      </div>
    )}
  </div>
);
}