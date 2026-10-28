import * as THREE from "three";

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const damp = (current, target, lambda, dt) => target + (current - target) * Math.exp(-lambda * dt);
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (value) => value - Math.floor(value);
export const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
export const wrapCycle = (value) => value - Math.round(value);
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* Seeded, so the little planet is laid out the same way on every visit. */
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const random = mulberry32(612);

export function randomDirection(out) {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return out.set(ring * Math.cos(angle), z, ring * Math.sin(angle));
}

export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function makeGlowTexture(stops, size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
