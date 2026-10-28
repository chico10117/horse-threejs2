import * as THREE from "three";
import { clamp, fract, lerp, smoothstep } from "../util.js";
import { scene } from "../core.js";
import { hairRibbonGeometry, makeDynamicTube, makeSweep, mergeGeometries, tubeGeometry } from "../geometry.js";

/* ------------------------------------------------------------------ */
/* Horse                                                               */
/* ------------------------------------------------------------------ */

/* Chestnut with a moon-white mane, a blaze and four white stockings. */
export const coatMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x8c3d1c,
  roughness: 0.55,
  metalness: 0,
  sheen: 0.6,
  sheenColor: new THREE.Color(0xffb27e),
  sheenRoughness: 0.45,
});
export const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ebdd, roughness: 0.72 });
export const blazeMaterial = new THREE.MeshStandardMaterial({
  color: 0xf4eee2,
  roughness: 0.72,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
export const maneMaterial = new THREE.MeshStandardMaterial({ color: 0xf5efe3, roughness: 0.78, side: THREE.DoubleSide });
export const maneMidMaterial = new THREE.MeshStandardMaterial({ color: 0xe4dac8, roughness: 0.82, side: THREE.DoubleSide });
export const maneShadeMaterial = new THREE.MeshStandardMaterial({ color: 0xcbbfa9, roughness: 0.86, side: THREE.DoubleSide });
export const hoofMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a31, roughness: 0.45 });
export const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x1a110b, roughness: 0.12, metalness: 0.1 });
export const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xfff8ec });
export const nostrilMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2a22, roughness: 0.9 });
export const innerEarMaterial = new THREE.MeshStandardMaterial({ color: 0x5e3322, roughness: 0.9 });
export const leatherMaterial = new THREE.MeshStandardMaterial({ color: 0x4f2d19, roughness: 0.62 });
export const darkLeatherMaterial = new THREE.MeshStandardMaterial({ color: 0x33200f, roughness: 0.66 });
export const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xd2a955, roughness: 0.32, metalness: 0.65 });
export const blanketMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5b8c, roughness: 0.86 });
export const blanketTrimMaterial = new THREE.MeshStandardMaterial({ color: 0xe6c26d, roughness: 0.6 });

export const sphereGeometry = new THREE.SphereGeometry(1, 40, 28);

export const horse = new THREE.Group();
scene.add(horse);

export const torso = new THREE.Group();
horse.add(torso);

export function ellipsoid(parent, material, position, scale, castShadow = true) {
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function addMesh(parent, geometry, material, castShadow = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/* The barrel: one smooth surface so the chest, back and rump flow together. */
export function torsoShape(x, y, z, out) {
  const chest = Math.exp(-(((z - 0.58) / 0.4) ** 2));
  const shoulder = Math.exp(-(((z - 0.42) / 0.3) ** 2));
  const rump = Math.exp(-(((z + 0.62) / 0.45) ** 2));
  const middle = Math.exp(-((z / 0.55) ** 2));
  const flank = Math.exp(-(((z + 0.32) / 0.28) ** 2));
  const width = 0.42 * (1 + 0.09 * chest + 0.1 * rump + 0.05 * shoulder);
  const height = 0.46 * (1 + 0.04 * chest + 0.06 * rump) * (1 - 0.04 * middle);
  const tuck = y < 0 ? 1 - 0.17 * flank * -y : 1;
  const baseY = 1.45 + 0.03 * rump + 0.012 * chest;
  const top = Math.max(0, y) ** 2;
  const withers = 0.065 * Math.exp(-(((z - 0.4) / 0.15) ** 2)) * top;
  const croup = 0.04 * Math.exp(-(((z + 0.56) / 0.22) ** 2)) * top;
  return out.set(x * width, y * height * tuck + baseY + withers + croup, z * 0.92);
}

{
  const geometry = new THREE.SphereGeometry(1, 72, 54);
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    torsoShape(position.getX(i), position.getY(i), position.getZ(i), p);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  addMesh(torso, geometry, coatMaterial);
}

/* Points on (or just above) the barrel: zc runs tail→chest on the unit sphere, beta around from the spine. */
export const torsoScratch = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

export function torsoBase(zc, beta, out) {
  const ring = Math.sqrt(Math.max(0, 1 - zc * zc));
  return torsoShape(ring * Math.sin(beta), ring * Math.cos(beta), zc, out);
}

export function torsoSurface(zc, beta, lift, out = new THREE.Vector3()) {
  torsoBase(zc, beta, out);
  if (lift !== 0) {
    const [a, b, c, n] = torsoScratch;
    const e = 0.004;
    torsoBase(zc + e, beta, a).sub(torsoBase(zc - e, beta, b));
    torsoBase(zc, beta + e, c).sub(torsoBase(zc, beta - e, b));
    n.crossVectors(a, c).normalize();
    out.addScaledVector(n, lift);
  }
  return out;
}

/* A pad that hugs the barrel, with a little wall around its edge (saddle, blanket, girth). */
export function torsoPadGeometry({ z0, z1, b0, b1, lift, wall = null, segZ = 16, segB = 28 }) {
  const positions = [];
  const indices = [];
  const p = new THREE.Vector3();
  const cols = segB + 1;
  const liftAt = typeof lift === "function" ? lift : () => lift;

  for (let i = 0; i <= segZ; i += 1) {
    for (let j = 0; j <= segB; j += 1) {
      const u = i / segZ;
      const v = j / segB;
      torsoSurface(lerp(z0, z1, u), lerp(b0, b1, v), liftAt(u, v), p);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < segZ; i += 1) {
    for (let j = 0; j < segB; j += 1) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (wall !== null) {
    const rim = [];
    for (let j = 0; j <= segB; j += 1) rim.push([0, j]);
    for (let i = 1; i <= segZ; i += 1) rim.push([i, segB]);
    for (let j = segB - 1; j >= 0; j -= 1) rim.push([segZ, j]);
    for (let i = segZ - 1; i >= 0; i -= 1) rim.push([i, 0]);
    const start = positions.length / 3;
    for (const [i, j] of rim) {
      const u = i / segZ;
      const v = j / segB;
      torsoSurface(lerp(z0, z1, u), lerp(b0, b1, v), liftAt(u, v), p);
      positions.push(p.x, p.y, p.z);
      torsoSurface(lerp(z0, z1, u), lerp(b0, b1, v), wall, p);
      positions.push(p.x, p.y, p.z);
    }
    for (let k = 0; k < rim.length - 1; k += 1) {
      const top = start + k * 2;
      const nextTop = top + 2;
      indices.push(top, nextTop, top + 1, nextTop, nextTop + 1, top + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/* Saddle and blanket */
addMesh(torso, torsoPadGeometry({ z0: -0.27, z1: 0.41, b0: -1.04, b1: 1.04, lift: 0.011, wall: 0.003 }), blanketTrimMaterial, false);
addMesh(torso, torsoPadGeometry({ z0: -0.24, z1: 0.38, b0: -0.98, b1: 0.98, lift: 0.017, wall: 0.009 }), blanketMaterial, false);
addMesh(
  torso,
  torsoPadGeometry({
    z0: -0.16,
    z1: 0.3,
    b0: -0.6,
    b1: 0.6,
    segZ: 20,
    lift: (u, v) => {
      const across = 1 - 0.7 * (2 * v - 1) ** 2;
      return 0.03 + (0.085 * smoothstep(0.3, 0, u) + 0.06 * smoothstep(0.72, 1, u)) * across;
    },
    wall: 0.018,
  }),
  leatherMaterial
);
for (const side of [-1, 1]) {
  const [b0, b1] = side > 0 ? [0.55, 1.08] : [-1.08, -0.55];
  addMesh(torso, torsoPadGeometry({ z0: 0.0, z1: 0.22, b0, b1, lift: 0.035, wall: 0.02, segZ: 8, segB: 12 }), leatherMaterial);

  const anchor = torsoSurface(0.11, side * 1.02, 0.045);
  const strap = addMesh(torso, new THREE.BoxGeometry(0.03, 0.3, 0.008), darkLeatherMaterial);
  strap.position.set(anchor.x, anchor.y - 0.13, anchor.z);
  const iron = addMesh(torso, new THREE.TorusGeometry(0.052, 0.009, 8, 20), brassMaterial);
  iron.position.set(anchor.x, anchor.y - 0.32, anchor.z);
}
addMesh(torso, torsoPadGeometry({ z0: 0.08, z1: 0.15, b0: -Math.PI, b1: Math.PI, lift: 0.009, segZ: 3, segB: 64 }), darkLeatherMaterial, false);

export const reinAnchors = [-1, 1].map((side) => torsoSurface(0.3, side * 0.24, 0.07));

/* Neck */
export const neckGroup = new THREE.Group();
neckGroup.position.set(0, 1.64, 0.6);
torso.add(neckGroup);

export const neckSweep = makeSweep(
  [[0, -0.14, -0.12], [0, 0.14, 0.12], [0, 0.44, 0.33], [0, 0.69, 0.47], [0, 0.84, 0.54]],
  {
    rx: [0.3, 0.235, 0.185, 0.155, 0.135, 0.125],
    top: [0.31, 0.265, 0.215, 0.18, 0.15, 0.13],
    bottom: [0.36, 0.28, 0.205, 0.165, 0.15, 0.15],
  }
);
addMesh(neckGroup, neckSweep.geometry(40, 36), coatMaterial);

/* Head — long face, round jowl, soft muzzle */
export const HEAD_PITCH = 0.95;
export const headGroup = new THREE.Group();
headGroup.position.set(0, 0.86, 0.56);
headGroup.rotation.x = HEAD_PITCH;
neckGroup.add(headGroup);

export const headSweep = makeSweep(
  [[0, 0.05, -0.11], [0, 0.01, 0.1], [0, -0.03, 0.3], [0, -0.06, 0.47], [0, -0.07, 0.6]],
  {
    rx: [0.08, 0.135, 0.155, 0.15, 0.128, 0.11, 0.1, 0.094, 0.07],
    top: [0.07, 0.105, 0.12, 0.112, 0.098, 0.088, 0.08, 0.074, 0.055],
    bottom: [0.09, 0.165, 0.21, 0.19, 0.145, 0.118, 0.106, 0.096, 0.065],
  }
);
addMesh(headGroup, headSweep.geometry(44, 48), coatMaterial);

/* The blaze: a star on the brow running down to a wide snip over the nose */
export const BLAZE = [[0.1, 0.0], [0.15, 0.03], [0.21, 0.045], [0.27, 0.03], [0.36, 0.018], [0.55, 0.017], [0.7, 0.021], [0.82, 0.032], [0.92, 0.045], [0.99, 0.04]];
export function blazeHalfWidth(t) {
  for (let i = 1; i < BLAZE.length; i += 1) {
    if (t <= BLAZE[i][0]) {
      const [t0, w0] = BLAZE[i - 1];
      const [t1, w1] = BLAZE[i];
      return lerp(w0, w1, smoothstep(t0, t1, t));
    }
  }
  return BLAZE[BLAZE.length - 1][1];
}
addMesh(headGroup, headSweep.stripGeometry(0.1, 0.99, blazeHalfWidth, 0.002, 60, 8), blazeMaterial, false);

export const headScratch = new THREE.Vector3();
export const headNormal = new THREE.Vector3();

/* Eyes, with a soft brow above each */
for (const side of [-1, 1]) {
  const angle = side > 0 ? 0.55 : Math.PI - 0.55;
  headSweep.point(0.3, angle, 0, headScratch);
  headSweep.surfaceNormal(0.3, angle, headNormal);
  const eye = ellipsoid(headGroup, eyeMaterial, [0, 0, 0], [0.036, 0.044, 0.05], false);
  eye.position.copy(headScratch).addScaledVector(headNormal, -0.016);
  const glint = ellipsoid(headGroup, glintMaterial, [0, 0, 0], [0.009, 0.009, 0.009], false);
  glint.position.copy(headScratch).addScaledVector(headNormal, 0.017).add(new THREE.Vector3(0, 0.014, 0.012));
  const brow = ellipsoid(headGroup, coatMaterial, [0, 0, 0], [0.032, 0.02, 0.056]);
  brow.position.copy(headSweep.point(0.29, side > 0 ? 0.85 : Math.PI - 0.85, -0.012));
}

/* Nostrils and chin */
for (const side of [-1, 1]) {
  const angle = side > 0 ? 0.12 : Math.PI - 0.12;
  const nostril = ellipsoid(headGroup, nostrilMaterial, [0, 0, 0], [0.016, 0.026, 0.014], false);
  nostril.position.copy(headSweep.point(0.955, angle, -0.004));
  nostril.rotation.y = side * 0.5;
}
ellipsoid(headGroup, coatMaterial, [0, 0, 0], [0.07, 0.045, 0.075]).position.copy(headSweep.point(0.86, -Math.PI / 2, -0.03));

/* Ears */
export const ears = [];
export const earGeometry = new THREE.ConeGeometry(0.058, 0.18, 14);
earGeometry.translate(0, 0.09, 0);
export const innerEarGeometry = new THREE.ConeGeometry(0.036, 0.13, 12);
innerEarGeometry.translate(0, 0.065, 0);

for (const side of [-1, 1]) {
  const ear = new THREE.Group();
  ear.position.copy(headSweep.point(0.075, side > 0 ? 1.05 : Math.PI - 1.05, -0.02));
  const baseX = -HEAD_PITCH + 0.3;
  const baseZ = -side * 0.22;
  ear.rotation.set(baseX, 0, baseZ);
  headGroup.add(ear);

  const outer = addMesh(ear, earGeometry, coatMaterial);
  outer.scale.set(0.78, 1, 0.55);
  const inner = addMesh(ear, innerEarGeometry, innerEarMaterial, false);
  inner.position.set(0, 0.012, 0.016);
  inner.scale.set(0.72, 0.94, 0.5);
  ears.push({ group: ear, side, baseX, baseZ, phase: side * 1.7 });
}

/* Bridle */
export function strapAlong(sweep, samples, lift, radius, material, parent, closed = false) {
  const points = samples.map(([t, angle]) => sweep.point(t, angle, lift));
  const curve = new THREE.CatmullRomCurve3(points, closed);
  return addMesh(parent, new THREE.TubeGeometry(curve, samples.length * 6, radius, 6, closed), material);
}

{
  const ring = [];
  for (let i = 0; i < 24; i += 1) ring.push([0.74, (i / 24) * Math.PI * 2]);
  strapAlong(headSweep, ring, 0.012, 0.012, leatherMaterial, headGroup, true);

  const brow = [];
  for (let i = 0; i <= 10; i += 1) brow.push([0.13, lerp(0.3, Math.PI - 0.3, i / 10)]);
  strapAlong(headSweep, brow, 0.012, 0.011, leatherMaterial, headGroup);

  strapAlong(
    headSweep,
    [
      [0.8, -0.32], [0.62, -0.14], [0.42, 0.06], [0.24, 0.3], [0.1, 0.72], [0.05, 1.2], [0.04, Math.PI / 2],
      [0.05, Math.PI - 1.2], [0.1, Math.PI - 0.72], [0.24, Math.PI - 0.3], [0.42, Math.PI - 0.06], [0.62, Math.PI + 0.14], [0.8, Math.PI + 0.32],
    ],
    0.013,
    0.012,
    leatherMaterial,
    headGroup
  );

  strapAlong(
    headSweep,
    [[0.06, 0.8], [0.09, 0.0], [0.12, -0.8], [0.13, -Math.PI / 2], [0.12, -Math.PI + 0.8], [0.09, -Math.PI], [0.06, -Math.PI - 0.8]],
    0.012,
    0.01,
    leatherMaterial,
    headGroup
  );
}

export const bitRings = [-1, 1].map((side) => {
  const ring = addMesh(headGroup, new THREE.TorusGeometry(0.03, 0.007, 8, 18), brassMaterial);
  ring.position.copy(headSweep.point(0.82, side > 0 ? -0.3 : Math.PI + 0.3, 0.014));
  ring.rotation.y = Math.PI / 2;
  return ring;
});

/* Mane — a moon-white crest with long locks falling over the near (left) side */
export const maneLocks = [];
export const forelockLocks = [];
export const maneOutward = new THREE.Vector3();

addMesh(
  neckGroup,
  tubeGeometry(
    new THREE.CatmullRomCurve3(Array.from({ length: 11 }, (_, i) => neckSweep.point(lerp(0.04, 0.99, i / 10), Math.PI / 2, 0.012))),
    (t) => lerp(0.055, 0.03, t),
    32,
    8
  ),
  maneMaterial
);

export function addHairLock(sweep, parent, path, widths, material, list, phase) {
  const points = path.map(([t, angle, lift]) => sweep.point(t, angle, lift));
  const normals = path.map(([t, angle]) => sweep.surfaceNormal(t, angle));
  const root = points[0].clone();
  const group = new THREE.Group();
  group.position.copy(root);
  parent.add(group);
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone().sub(root)));
  const lock = addMesh(
    group,
    hairRibbonGeometry(
      curve,
      (t, out) => {
        const f = t * (normals.length - 1);
        const i = Math.min(Math.floor(f), normals.length - 2);
        return out.copy(normals[i]).lerp(normals[i + 1], f - i).normalize();
      },
      widths[0],
      widths[1],
      18
    ),
    material
  );
  lock.receiveShadow = true;
  list.push({ group, phase, side: Math.sign(Math.cos(path[path.length - 1][1])) || 1 });
}

export const manePalette = [maneMaterial, maneMidMaterial, maneMaterial, maneShadeMaterial, maneMaterial];

/* Two layers on the near side — a long under-layer and a fuller top layer — and short tufts on the off side. */
for (const layer of [0, 1]) {
  const count = layer ? 44 : 38;
  for (let i = 0; i < count; i += 1) {
    const s = i / (count - 1);
    const t = lerp(0.04, 0.97, s) + layer * 0.01;
    const ragged = fract(Math.sin(i * 12.9898 + layer * 78.233) * 43758.5453);
    const span = (layer ? 1.0 : 1.3) + ragged * 0.45 + s * 0.1;
    const drop = 0.06 + s * 0.04 + ragged * 0.02;
    const flare = layer * 0.01 + ragged * 0.006;
    const path = [0, 0.25, 0.55, 0.8, 1].map((v) => [
      t - v * drop,
      Math.PI / 2 + 0.14 - Math.pow(v, 0.85) * span,
      0.014 + v * 0.016 + flare,
    ]);
    const width = 0.045 + ragged * 0.03;
    const material = layer ? manePalette[i % manePalette.length] : (i % 2 ? maneMidMaterial : maneShadeMaterial);
    addHairLock(neckSweep, neckGroup, path, [width, width * 0.22], material, maneLocks, i * 0.63 + layer);
  }
}
for (let i = 0; i < 14; i += 1) {
  const s = i / 13;
  const t = lerp(0.08, 0.93, s);
  const path = [0, 0.4, 1].map((v) => [t - v * 0.035, Math.PI / 2 + 0.06 + v * (0.55 + Math.sin(i * 1.9) * 0.08), 0.014 + v * 0.022]);
  addHairLock(neckSweep, neckGroup, path, [0.06, 0.022], i % 2 ? maneMidMaterial : maneShadeMaterial, maneLocks, i * 0.9 + 2);
}

/* Forelock, swept a little to the near side of the brow */
for (let i = 0; i < 5; i += 1) {
  const offset = (i - 2) * 0.12;
  const path = [0, 0.35, 0.7, 1].map((v) => [0.03 + v * (0.2 + (i % 2) * 0.03), Math.PI / 2 + offset - v * 0.18, 0.018 + v * 0.016]);
  addHairLock(headSweep, headGroup, path, [0.06, 0.008], manePalette[i % manePalette.length], forelockLocks, i * 0.8);
}

/* Tail — a skinned fall of white hair that streams and swishes */
export const TAIL_BONES = 6;
export const tailGroup = new THREE.Group();
tailGroup.position.set(0, 1.7, -0.8);
torso.add(tailGroup);

export const tailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, -0.06, -0.16),
  new THREE.Vector3(0, -0.3, -0.29),
  new THREE.Vector3(0, -0.72, -0.3),
  new THREE.Vector3(0, -1.16, -0.24),
]);

export const tailBones = [];
for (let k = 0; k < TAIL_BONES; k += 1) {
  const bone = new THREE.Bone();
  const point = tailCurve.getPointAt(k / TAIL_BONES);
  if (k === 0) {
    bone.position.copy(point);
    tailGroup.add(bone);
  } else {
    bone.position.copy(point).sub(tailCurve.getPointAt((k - 1) / TAIL_BONES));
    tailBones[k - 1].add(bone);
  }
  tailBones.push(bone);
}
export const tailSkeleton = new THREE.Skeleton(tailBones);

export function skinToTail(geometry) {
  const samples = Array.from({ length: 65 }, (_, i) => tailCurve.getPointAt(i / 64));
  const position = geometry.attributes.position;
  const skinIndex = [];
  const skinWeight = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    let best = 0;
    let bestDistance = Infinity;
    samples.forEach((sample, k) => {
      const distance = sample.distanceToSquared(v);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    });
    const f = (best / 64) * TAIL_BONES;
    const i0 = Math.min(Math.floor(f), TAIL_BONES - 1);
    const i1 = Math.min(i0 + 1, TAIL_BONES - 1);
    const w = clamp(f - i0, 0, 1);
    skinIndex.push(i0, i1, 0, 0);
    skinWeight.push(1 - w, w, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  return geometry;
}

export function tailStrandCurve(ox, oz, length) {
  const points = [];
  for (let i = 0; i <= 5; i += 1) {
    const t = (i / 5) * length;
    const p = tailCurve.getPointAt(t);
    const fan = Math.pow(t, 0.7);
    points.push(new THREE.Vector3(p.x + ox * fan, p.y, p.z + oz * fan));
  }
  return new THREE.CatmullRomCurve3(points);
}

{
  const hair = { [maneMaterial.uuid]: [], [maneMidMaterial.uuid]: [], [maneShadeMaterial.uuid]: [] };
  const materials = { [maneMaterial.uuid]: maneMaterial, [maneMidMaterial.uuid]: maneMidMaterial, [maneShadeMaterial.uuid]: maneShadeMaterial };

  hair[maneShadeMaterial.uuid].push(
    tubeGeometry(tailCurve, (t) => lerp(0.04, 0.012, t) + 0.035 * Math.sin(Math.PI * clamp(t * 1.2, 0, 1)), 40, 10)
  );
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const reach = 0.05 + (i % 3) * 0.03;
    const curve = tailStrandCurve(Math.cos(angle) * reach, Math.sin(angle) * reach, 0.84 + (i % 4) * 0.05);
    const material = [maneMaterial, maneMidMaterial, maneShadeMaterial][i % 3];
    hair[material.uuid].push(tubeGeometry(curve, (t) => lerp(0.026, 0.004, t), 26, 6));
  }
  /* Flat locks fanned all round, longest at the back */
  for (let i = 0; i < 22; i += 1) {
    const angle = (i / 22) * Math.PI * 2 + 0.2;
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const back = 0.5 - 0.5 * out.z;
    const reach = 0.07 + 0.04 * Math.abs(Math.sin(i * 1.3));
    const curve = tailStrandCurve(out.x * reach, out.z * reach, 0.78 + 0.16 * back + (i % 3) * 0.03);
    const material = [maneMaterial, maneMidMaterial, maneMaterial, maneShadeMaterial][i % 4];
    hair[material.uuid].push(hairRibbonGeometry(curve, (t, target) => target.copy(out), 0.1, 0.02, 24));
  }

  const dock = tubeGeometry(
    new THREE.CatmullRomCurve3([0, 0.05, 0.1, 0.15].map((t) => tailCurve.getPointAt(t))),
    (t) => lerp(0.075, 0.055, t),
    10,
    10
  );

  const meshes = [new THREE.SkinnedMesh(skinToTail(dock), coatMaterial)];
  for (const [uuid, geometries] of Object.entries(hair)) {
    meshes.push(new THREE.SkinnedMesh(skinToTail(mergeGeometries(geometries)), materials[uuid]));
  }
  tailGroup.updateMatrixWorld(true);
  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    tailGroup.add(mesh);
    mesh.bind(tailSkeleton);
  }
}

/* Reins, rewritten each frame between the bit and the pommel */
export const reins = [-1, 1].map(() => {
  const tube = makeDynamicTube(24, 6, 0.008, darkLeatherMaterial);
  torso.add(tube.mesh);
  return { ...tube, points: Array.from({ length: 25 }, () => new THREE.Vector3()) };
});
