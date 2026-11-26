/** Tiny 3D helpers for the evidence map: rotate points in space, then project them onto the screen. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective size multiplier: above 1 in front of the centre, below 1 behind it. */
  scale: number;
  /** 0 = farthest back, 1 = nearest the viewer. */
  depth: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** Half-size of the scene in world units; this is what fits inside the shorter screen side. */
  extent: number;
  /** Camera distance from the centre, in world units (smaller = stronger perspective). */
  distance: number;
  zoom?: number;
  /** Where the scene's centre sits vertically, as a fraction of the height (default 0.5). */
  centerY?: number;
}

export const PITCH_LIMIT = 1.25;

export function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}

/** Turn around the vertical axis (yaw), then tilt toward or away from the viewer (pitch). */
export function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

export function project(p: Vec3, view: Viewport): Projected {
  const unit = (Math.min(view.width, view.height) / (2 * view.extent)) * (view.zoom ?? 1);
  // The camera sits on the +z axis looking at the centre; nearer points (larger z) look bigger.
  const scale = view.distance / Math.max(0.2, view.distance - p.z);
  const depth = Math.max(0, Math.min(1, (p.z + view.extent) / (2 * view.extent)));
  return { x: view.width / 2 + p.x * unit * scale, y: view.height * (view.centerY ?? 0.5) - p.y * unit * scale, scale, depth };
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

export function scaleVec(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** Two unit vectors perpendicular to `d` (and each other), for spreading points around it. */
export function tangentBasis(d: Vec3): [Vec3, Vec3] {
  const helper = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize({ x: helper.y * d.z - helper.z * d.y, y: helper.z * d.x - helper.x * d.z, z: helper.x * d.y - helper.y * d.x });
  const v = { x: d.y * u.z - d.z * u.y, y: d.z * u.x - d.x * u.z, z: d.x * u.y - d.y * u.x };
  return [u, v];
}

/** The node nearest a tap, preferring the one in front when several overlap. */
export function hitTest<T extends { x: number; y: number; r: number; depth: number }>(points: T[], x: number, y: number, slop = 14): T | null {
  let best: T | null = null;
  for (const p of points) {
    if (Math.hypot(p.x - x, p.y - y) > Math.max(p.r, slop)) continue;
    if (!best || p.depth > best.depth) best = p;
  }
  return best;
}
