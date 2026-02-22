import React, { useEffect, useRef, useState } from "react";

export type LassoPoint = { x: number; y: number };

type Props = {
  enabled: boolean;
  zIndex?: number;
  minPoints?: number;
  onComplete: (points: LassoPoint[]) => void;
  onClear?: () => void;
};

function draw(ctx: CanvasRenderingContext2D, pts: LassoPoint[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (pts.length < 2) return;

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.95)";
  ctx.fillStyle = "rgba(34, 211, 238, 0.10)";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export default function LassoOverlay({
  enabled,
  zIndex = 20,
  minPoints = 6,
  onComplete,
  onClear,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const ptsRef = useRef<LassoPoint[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // Resize to parent
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const resize = () => {
      const parent = c.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(rect.width));
      c.height = Math.max(1, Math.floor(rect.height));
      const ctx = c.getContext("2d");
      if (ctx) draw(ctx, ptsRef.current);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getLocal = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  };

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    draw(ctx, ptsRef.current);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    drawingRef.current = true;
    setIsDrawing(true);
    ptsRef.current = [getLocal(e)];
    redraw();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!enabled || !drawingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const p = getLocal(e);
    const pts = ptsRef.current;
    const last = pts[pts.length - 1];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < 4) return;
    pts.push(p);
    redraw();
  };

  const onUp = (e: React.PointerEvent) => {
    if (!enabled || !drawingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    drawingRef.current = false;
    setIsDrawing(false);

    const pts = ptsRef.current;
    if (pts.length < minPoints) {
      ptsRef.current = [];
      redraw();
      onClear?.();
      return;
    }

    // close
    if (pts.length > 2) pts.push({ ...pts[0] });
    redraw();
    onComplete(ptsRef.current);
  };

  useEffect(() => {
    if (!enabled) {
      drawingRef.current = false;
      setIsDrawing(false);
      ptsRef.current = [];
      redraw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!enabled) return;
      if (ev.key === "Escape") {
        ptsRef.current = [];
        redraw();
        onClear?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex,
        pointerEvents: enabled ? "auto" : "none",
        cursor: enabled ? (isDrawing ? "crosshair" : "crosshair") : "default",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}