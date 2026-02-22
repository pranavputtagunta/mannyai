import React, { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import type { Coordinate } from "../services/api";

export type RegionSelectionMode = "lasso" | "circle";

export interface Selection2DShape {
	kind: "polygon" | "circle";
	polygon?: Coordinate[];
	circle?: {
		center: Coordinate;
		radius: number;
	};
	viewport: {
		width: number;
		height: number;
	};
}

export interface ViewContext {
	cameraPosition: Coordinate;
	cameraQuaternion: {
		x: number;
		y: number;
		z: number;
		w: number;
	};
	fov: number | null;
	near: number;
	far: number;
}

export interface SampledSurfacePoint {
	point: Coordinate;
	normal: Coordinate;
	depth: number;
	meshId: string;
	faceIndex: number;
}

export interface FaceHitRef {
	meshId: string;
	faceIndex: number;
	hits: number;
}

export interface TriangleRef {
	meshId: string;
	faceIndex: number;
}

export interface RegionSelectionResult {
	mode: RegionSelectionMode;
	coordinates: Coordinate | null;
	pointCount: number;
	sampledPoints: Coordinate[];
	overlayTriangles: Coordinate[];
	boundedVertices: Coordinate[];
	selection2D: Selection2DShape;
	viewContext: ViewContext;
	sampledSurface: SampledSurfacePoint[];
	faceHits: FaceHitRef[];
	triangleRefs: TriangleRef[];
}

interface ScreenPoint {
	x: number;
	y: number;
}

interface SelectionBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

function hashToUnit(x: number, y: number, salt: number): number {
	const value = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

interface LassoToolProps {
	mode: RegionSelectionMode;
	active: boolean;
	selection2D: Selection2DShape | null;
	camera: THREE.Camera | null;
	meshRoot: THREE.Object3D | null;
	onDrawingStateChange: (drawing: boolean) => void;
	onSelectionComplete: (result: RegionSelectionResult) => void;
}

const MAX_SELECTED_POINTS = 300000;
const MAX_STORED_POINTS = 80000;
const MAX_OVERLAY_TRIANGLES = 6000;
const MAX_BOUNDED_VERTICES = 60000;
const MAX_SAMPLED_SURFACE_POINTS = 12000;

function coordinateKey(point: THREE.Vector3): string {
	return `${point.x.toFixed(6)}|${point.y.toFixed(6)}|${point.z.toFixed(6)}`;
}

function getStoredPointBudget(selectedCount: number): number {
	return Math.min(MAX_STORED_POINTS, selectedCount);
}

function toCoordinate(point: THREE.Vector3): Coordinate {
	return {
		x: point.x,
		y: point.y,
		z: point.z,
	};
}

function downsamplePoints(points: THREE.Vector3[], target: number): Coordinate[] {
	if (points.length <= target) {
		return points.map(toCoordinate);
	}

	const sampled: Coordinate[] = [];
	const step = Math.ceil(points.length / target);

	for (let index = 0; index < points.length; index += step) {
		sampled.push(toCoordinate(points[index]));
	}

	return sampled;
}

function downsampleByStep<T>(items: T[], target: number): T[] {
	if (items.length <= target) {
		return items;
	}

	const sampled: T[] = [];
	const step = Math.ceil(items.length / target);

	for (let index = 0; index < items.length; index += step) {
		sampled.push(items[index]);
	}

	return sampled;
}

function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
	let isInside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x;
		const yi = polygon[i].y;
		const xj = polygon[j].x;
		const yj = polygon[j].y;

		const intersects =
			yi > point.y !== yj > point.y &&
			point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;

		if (intersects) {
			isInside = !isInside;
		}
	}
	return isInside;
}

function centroid(points: THREE.Vector3[]): Coordinate | null {
	if (points.length === 0) {
		return null;
	}

	const sum = points.reduce(
		(acc, value) => {
			acc.x += value.x;
			acc.y += value.y;
			acc.z += value.z;
			return acc;
		},
		{ x: 0, y: 0, z: 0 },
	);

	return {
		x: sum.x / points.length,
		y: sum.y / points.length,
		z: sum.z / points.length,
	};
}

function collectSelectionData(
	root: THREE.Object3D,
	camera: THREE.Camera,
	width: number,
	height: number,
	matcher: (x: number, y: number) => boolean,
 	bounds: SelectionBounds,
): {
	selected: THREE.Vector3[];
	overlayTriangles: THREE.Vector3[];
	boundedVertices: THREE.Vector3[];
	sampledSurface: SampledSurfacePoint[];
	faceHits: FaceHitRef[];
	triangleRefs: TriangleRef[];
} {
	const selected: THREE.Vector3[] = [];
	const overlayTriangles: THREE.Vector3[] = [];
	const boundedVertices: THREE.Vector3[] = [];
	const sampledSurface: SampledSurfacePoint[] = [];
	const boundedVertexKeys = new Set<string>();
	const raycaster = new THREE.Raycaster();
	const ndcPoint = new THREE.Vector2();
	const selectedFacesByMesh = new Map<THREE.Mesh, Set<number>>();
	const faceHitCounts = new Map<string, FaceHitRef>();

	root.updateWorldMatrix(true, true);

	const boundedMinX = Math.max(0, Math.floor(bounds.minX));
	const boundedMaxX = Math.min(width, Math.ceil(bounds.maxX));
	const boundedMinY = Math.max(0, Math.floor(bounds.minY));
	const boundedMaxY = Math.min(height, Math.ceil(bounds.maxY));

	const selectionArea = Math.max(
		1,
		(boundedMaxX - boundedMinX) * (boundedMaxY - boundedMinY),
	);
	const targetSamples = Math.min(45000, Math.max(6000, Math.floor(selectionArea * 0.22)));
	const sampleStep = Math.max(1, Math.floor(Math.sqrt(selectionArea / targetSamples)));
	const samplesPerCell =
		selectionArea > 70000 ? 4 : selectionArea > 30000 ? 3 : selectionArea > 12000 ? 2 : 1;

	for (let y = boundedMinY; y <= boundedMaxY; y += sampleStep) {
		for (let x = boundedMinX; x <= boundedMaxX; x += sampleStep) {
			for (let sample = 0; sample < samplesPerCell; sample++) {
				const jitterX = hashToUnit(x, y, sample * 2 + 1);
				const jitterY = hashToUnit(x, y, sample * 2 + 2);
				const sampleX = Math.min(width - 1, x + jitterX * sampleStep);
				const sampleY = Math.min(height - 1, y + jitterY * sampleStep);

				if (!matcher(sampleX, sampleY)) {
					continue;
				}

				ndcPoint.set((sampleX / width) * 2 - 1, -(sampleY / height) * 2 + 1);
				raycaster.setFromCamera(ndcPoint, camera);
				const intersections = raycaster.intersectObject(root, true);

				if (intersections.length === 0) {
					continue;
				}

				const hit = intersections[0];
				if (!(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) {
					continue;
				}

				const meshId = hit.object.name || hit.object.uuid;
				const faceKey = `${meshId}|${hit.faceIndex}`;
				const existingFaceHit = faceHitCounts.get(faceKey);
				if (existingFaceHit) {
					existingFaceHit.hits += 1;
				} else {
					faceHitCounts.set(faceKey, {
						meshId,
						faceIndex: hit.faceIndex,
						hits: 1,
					});
				}

				if (hit.face) {
					const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
					const worldNormal = hit.face.normal
						.clone()
						.applyMatrix3(normalMatrix)
						.normalize();

					sampledSurface.push({
						point: toCoordinate(hit.point),
						normal: toCoordinate(worldNormal),
						depth: hit.distance,
						meshId,
						faceIndex: hit.faceIndex,
					});
				}

				selected.push(hit.point.clone());
				const meshFaceSet = selectedFacesByMesh.get(hit.object) ?? new Set<number>();
				meshFaceSet.add(hit.faceIndex);
				selectedFacesByMesh.set(hit.object, meshFaceSet);

				if (selected.length >= MAX_SELECTED_POINTS) {
					break;
				}
			}

			if (selected.length >= MAX_SELECTED_POINTS) {
				break;
			}
		}

		if (selected.length >= MAX_SELECTED_POINTS) {
			break;
		}
	}

	const worldA = new THREE.Vector3();
	const worldB = new THREE.Vector3();
	const worldC = new THREE.Vector3();
	const projectedPoint = new THREE.Vector3();
	const triangleCenter = new THREE.Vector3();
	const triangleRefs: TriangleRef[] = [];
	const faceHits = Array.from(faceHitCounts.values());
	const maxFaceHits = faceHits.reduce((maxValue, item) => Math.max(maxValue, item.hits), 0);
	const dynamicThreshold = Math.max(2, Math.floor(maxFaceHits * 0.06));
	const effectiveThreshold = maxFaceHits >= 2 ? dynamicThreshold : 1;
	const allowedFaceKeys = new Set(
		faceHits
			.filter((item) => item.hits >= effectiveThreshold)
			.map((item) => `${item.meshId}|${item.faceIndex}`),
	);

	if (allowedFaceKeys.size === 0) {
		faceHits.forEach((item) => {
			allowedFaceKeys.add(`${item.meshId}|${item.faceIndex}`);
		});
	}

	const filteredSelected = selected;
	const filteredSampledSurface = sampledSurface;
	const pushBoundedVertex = (point: THREE.Vector3) => {
		if (boundedVertices.length >= MAX_BOUNDED_VERTICES) {
			return;
		}

		const key = coordinateKey(point);
		if (boundedVertexKeys.has(key)) {
			return;
		}

		boundedVertexKeys.add(key);
		boundedVertices.push(point.clone());
	};

	const isWorldPointInsideSelection = (point: THREE.Vector3): boolean => {
		projectedPoint.copy(point).project(camera);

		if (projectedPoint.z < -1 || projectedPoint.z > 1) {
			return false;
		}

		const screenX = ((projectedPoint.x + 1) * 0.5) * width;
		const screenY = ((1 - projectedPoint.y) * 0.5) * height;
		return matcher(screenX, screenY);
	};

	for (const [mesh, faceSet] of selectedFacesByMesh.entries()) {
		const positionAttribute = mesh.geometry?.getAttribute("position");
		if (!positionAttribute || positionAttribute.count === 0) {
			continue;
		}

		const indexAttribute = mesh.geometry?.getIndex();
		const meshId = mesh.name || mesh.uuid;
		for (const faceIndex of faceSet) {
			if (!allowedFaceKeys.has(`${meshId}|${faceIndex}`)) {
				continue;
			}

			const base = faceIndex * 3;
			const indexA = indexAttribute ? indexAttribute.getX(base) : base;
			const indexB = indexAttribute ? indexAttribute.getX(base + 1) : base + 1;
			const indexC = indexAttribute ? indexAttribute.getX(base + 2) : base + 2;

			worldA.fromBufferAttribute(positionAttribute, indexA).applyMatrix4(mesh.matrixWorld);
			worldB.fromBufferAttribute(positionAttribute, indexB).applyMatrix4(mesh.matrixWorld);
			worldC.fromBufferAttribute(positionAttribute, indexC).applyMatrix4(mesh.matrixWorld);

			const insideVertices =
				Number(isWorldPointInsideSelection(worldA)) +
				Number(isWorldPointInsideSelection(worldB)) +
				Number(isWorldPointInsideSelection(worldC));

			triangleCenter
				.copy(worldA)
				.add(worldB)
				.add(worldC)
				.multiplyScalar(1 / 3);
			const centerInside = isWorldPointInsideSelection(triangleCenter);

			if (insideVertices < 3) {
				continue;
			}

			overlayTriangles.push(worldA.clone(), worldB.clone(), worldC.clone());
			triangleRefs.push({ meshId, faceIndex });
			pushBoundedVertex(worldA);
			pushBoundedVertex(worldB);
			pushBoundedVertex(worldC);

			if (overlayTriangles.length / 3 >= MAX_OVERLAY_TRIANGLES) {
				return {
					selected: filteredSelected,
					overlayTriangles,
					boundedVertices,
					sampledSurface: downsampleByStep(filteredSampledSurface, MAX_SAMPLED_SURFACE_POINTS),
					faceHits,
					triangleRefs,
				};
			}
		}
	}

	return {
		selected: filteredSelected,
		overlayTriangles,
		boundedVertices,
		sampledSurface: downsampleByStep(filteredSampledSurface, MAX_SAMPLED_SURFACE_POINTS),
		faceHits,
		triangleRefs,
	};
}

export default function LassoTool({
	mode,
	active,
	selection2D,
	camera,
	meshRoot,
	onDrawingStateChange,
	onSelectionComplete,
}: LassoToolProps): ReactElement {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);

	const [isDrawing, setIsDrawing] = useState<boolean>(false);
	const [freehandPoints, setFreehandPoints] = useState<ScreenPoint[]>([]);
	const [circleCenter, setCircleCenter] = useState<ScreenPoint | null>(null);
	const [circleRadius, setCircleRadius] = useState<number>(0);

	const isLassoMode = mode === "lasso";

	const drawSelectionShape = (
		context: CanvasRenderingContext2D,
		shape: Selection2DShape,
		canvasWidth: number,
		canvasHeight: number,
	) => {
		const baseWidth = Math.max(1, shape.viewport.width);
		const baseHeight = Math.max(1, shape.viewport.height);
		const scaleX = canvasWidth / baseWidth;
		const scaleY = canvasHeight / baseHeight;

		if (shape.kind === "polygon" && shape.polygon && shape.polygon.length > 2) {
			context.beginPath();
			context.moveTo(shape.polygon[0].x * scaleX, shape.polygon[0].y * scaleY);
			shape.polygon.slice(1).forEach((point) => {
				context.lineTo(point.x * scaleX, point.y * scaleY);
			});
			context.closePath();
			context.fill();
			context.stroke();
		}

		if (shape.kind === "circle" && shape.circle) {
			context.beginPath();
			context.arc(
				shape.circle.center.x * scaleX,
				shape.circle.center.y * scaleY,
				shape.circle.radius * Math.min(scaleX, scaleY),
				0,
				Math.PI * 2,
			);
			context.fill();
			context.stroke();
		}
	};

	const currentCanvasSize = useMemo(() => {
		const host = overlayRef.current;
		if (!host) {
			return { width: 0, height: 0 };
		}
		return { width: host.clientWidth, height: host.clientHeight };
	}, [active, isDrawing, freehandPoints.length, circleRadius]);

	useEffect(() => {
		const host = overlayRef.current;
		const canvas = canvasRef.current;
		if (!host || !canvas) {
			return;
		}

		const resizeCanvas = () => {
			canvas.width = host.clientWidth;
			canvas.height = host.clientHeight;
		};

		resizeCanvas();
		const observer = new ResizeObserver(resizeCanvas);
		observer.observe(host);

		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		onDrawingStateChange(isDrawing);
	}, [isDrawing, onDrawingStateChange]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}

		context.clearRect(0, 0, canvas.width, canvas.height);

		if (!active) {
			return;
		}

		context.strokeStyle = "#2563eb";
		context.lineWidth = 2;
		context.lineJoin = "round";
		context.lineCap = "round";
		context.fillStyle = "rgba(59, 130, 246, 0.22)";

		if (isLassoMode && freehandPoints.length > 1) {
			context.beginPath();
			context.moveTo(freehandPoints[0].x, freehandPoints[0].y);
			freehandPoints.slice(1).forEach((point) => {
				context.lineTo(point.x, point.y);
			});
			context.stroke();
		}

		if (!isLassoMode && circleCenter && circleRadius > 0) {
			context.beginPath();
			context.arc(circleCenter.x, circleCenter.y, circleRadius, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}
	}, [active, circleCenter, circleRadius, freehandPoints, isDrawing, isLassoMode, selection2D]);

	useEffect(() => {
		if (active) {
			return;
		}
		setIsDrawing(false);
		setFreehandPoints([]);
		setCircleCenter(null);
		setCircleRadius(0);
	}, [active]);

	useEffect(() => {
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			setIsDrawing(false);
			setFreehandPoints([]);
			setCircleCenter(null);
			setCircleRadius(0);
		};

		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, []);

	const getPointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
		const host = overlayRef.current;
		if (!host) {
			return { x: 0, y: 0 };
		}

		const rect = host.getBoundingClientRect();
		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
	};

	const finalizeSelection = (
		polygon: ScreenPoint[] | null,
		center: ScreenPoint | null,
		radius: number,
	) => {
		const perspectiveCamera =
			camera instanceof THREE.PerspectiveCamera ? camera : null;
		const nearValue =
			camera && "near" in camera ? (camera as THREE.Camera & { near: number }).near : 0.1;
		const farValue =
			camera && "far" in camera ? (camera as THREE.Camera & { far: number }).far : 1000;

		const selection2D: Selection2DShape = polygon
			? {
					kind: "polygon",
					polygon: polygon.map((point) => ({ x: point.x, y: point.y, z: 0 })),
					viewport: {
						width: currentCanvasSize.width,
						height: currentCanvasSize.height,
					},
				}
			: {
					kind: "circle",
					circle: {
						center: { x: center?.x ?? 0, y: center?.y ?? 0, z: 0 },
						radius,
					},
					viewport: {
						width: currentCanvasSize.width,
						height: currentCanvasSize.height,
					},
				};

		const viewContext: ViewContext = {
			cameraPosition: camera
				? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
				: { x: 0, y: 0, z: 0 },
			cameraQuaternion: camera
				? {
						x: camera.quaternion.x,
						y: camera.quaternion.y,
						z: camera.quaternion.z,
						w: camera.quaternion.w,
					}
				: { x: 0, y: 0, z: 0, w: 1 },
			fov: perspectiveCamera ? perspectiveCamera.fov : null,
			near: nearValue,
			far: farValue,
		};

		if (!camera || !meshRoot || currentCanvasSize.width === 0 || currentCanvasSize.height === 0) {
			onSelectionComplete({
				mode,
				coordinates: null,
				pointCount: 0,
				sampledPoints: [],
				overlayTriangles: [],
				boundedVertices: [],
				selection2D,
				viewContext,
				sampledSurface: [],
				faceHits: [],
				triangleRefs: [],
			});
			return;
		}

		const matcher = (x: number, y: number) => {
			if (polygon) {
				return pointInPolygon({ x, y }, polygon);
			}

			if (center && radius > 0) {
				const circlePaddingPx = 2;
				const dx = x - center.x;
				const dy = y - center.y;
				const inclusiveRadius = radius + circlePaddingPx;
				return dx * dx + dy * dy <= inclusiveRadius * inclusiveRadius;
			}

			return false;
		};

		const bounds: SelectionBounds = polygon
			? {
					minX: Math.min(...polygon.map((point) => point.x)),
					maxX: Math.max(...polygon.map((point) => point.x)),
					minY: Math.min(...polygon.map((point) => point.y)),
					maxY: Math.max(...polygon.map((point) => point.y)),
				}
			: {
					minX: (center?.x ?? 0) - radius - 2,
					maxX: (center?.x ?? 0) + radius + 2,
					minY: (center?.y ?? 0) - radius - 2,
					maxY: (center?.y ?? 0) + radius + 2,
				};

		const {
			selected,
			overlayTriangles,
			boundedVertices,
			sampledSurface,
			faceHits,
			triangleRefs,
		} = collectSelectionData(
			meshRoot,
			camera,
			currentCanvasSize.width,
			currentCanvasSize.height,
			matcher,
			bounds,
		);

		onSelectionComplete({
			mode,
			coordinates: centroid(selected),
			pointCount: selected.length,
			sampledPoints: downsamplePoints(
				selected,
				getStoredPointBudget(selected.length),
			),
			overlayTriangles: overlayTriangles.map(toCoordinate),
			boundedVertices: boundedVertices.map(toCoordinate),
			selection2D,
			viewContext,
			sampledSurface,
			faceHits,
			triangleRefs,
		});
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!active) {
			return;
		}

		event.preventDefault();
		const point = getPointFromEvent(event);

		setIsDrawing(true);

		if (isLassoMode) {
			setFreehandPoints([point]);
		} else {
			setCircleCenter(point);
			setCircleRadius(0);
		}

		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!active || !isDrawing) {
			return;
		}

		const point = getPointFromEvent(event);

		if (isLassoMode) {
			setFreehandPoints((previous) => [...previous, point]);
			return;
		}

		if (!circleCenter) {
			return;
		}

		const dx = point.x - circleCenter.x;
		const dy = point.y - circleCenter.y;
		setCircleRadius(Math.sqrt(dx * dx + dy * dy));
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!active || !isDrawing) {
			return;
		}

		event.currentTarget.releasePointerCapture(event.pointerId);
		setIsDrawing(false);

		if (isLassoMode) {
			if (freehandPoints.length >= 3) {
				finalizeSelection(freehandPoints, null, 0);
			} else {
				onSelectionComplete({
					mode,
					coordinates: null,
					pointCount: 0,
					sampledPoints: [],
					overlayTriangles: [],
					boundedVertices: [],
					selection2D: {
						kind: "polygon",
						polygon: [],
						viewport: {
							width: currentCanvasSize.width,
							height: currentCanvasSize.height,
						},
					},
					viewContext: {
						cameraPosition: { x: 0, y: 0, z: 0 },
						cameraQuaternion: { x: 0, y: 0, z: 0, w: 1 },
						fov: null,
						near: 0.1,
						far: 1000,
					},
					sampledSurface: [],
					faceHits: [],
					triangleRefs: [],
				});
			}
			setFreehandPoints([]);
			return;
		}

		if (circleCenter && circleRadius > 3) {
			finalizeSelection(null, circleCenter, circleRadius);
		} else {
			onSelectionComplete({
				mode,
				coordinates: null,
				pointCount: 0,
				sampledPoints: [],
				overlayTriangles: [],
				boundedVertices: [],
				selection2D: {
					kind: "circle",
					circle: {
						center: { x: circleCenter?.x ?? 0, y: circleCenter?.y ?? 0, z: 0 },
						radius: circleRadius,
					},
					viewport: {
						width: currentCanvasSize.width,
						height: currentCanvasSize.height,
					},
				},
				viewContext: {
					cameraPosition: { x: 0, y: 0, z: 0 },
					cameraQuaternion: { x: 0, y: 0, z: 0, w: 1 },
					fov: null,
					near: 0.1,
					far: 1000,
				},
				sampledSurface: [],
				faceHits: [],
				triangleRefs: [],
			});
		}

		setCircleCenter(null);
		setCircleRadius(0);
	};

	return (
		<div
			ref={overlayRef}
			className={`selection-overlay ${active ? "active" : "inactive"}`}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			<canvas ref={canvasRef} className="selection-canvas" />
			{active && (
				<div className="selection-hint">
					{isLassoMode
						? "Draw freehand around the area, then release"
						: "Drag to draw a circle around the repair zone"}
				</div>
			)}
		</div>
	);
}
