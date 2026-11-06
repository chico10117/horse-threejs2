import * as THREE from "three";
import { CAMERA_AZIMUTH, PLANET_RADIUS, prefersReducedMotion, scene } from "./core.js";
import { Y_AXIS, clamp, damp } from "./util.js";
import { tubeGeometry } from "./geometry.js";
import { castAndReceive, layout, obstacles, planetDirection } from "./planet.js";

/* ------------------------------------------------------------------ */
/* The little prince                                                   */
/* ------------------------------------------------------------------ */

const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.82 });
const hairMaterial = new THREE.MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.62 });
const hairLightMaterial = new THREE.MeshStandardMaterial({ color: 0xf6cf6d, roughness: 0.58 });
const coatMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b4e, roughness: 0.78 });
const trouserMaterial = new THREE.MeshStandardMaterial({ color: 0x244a3c, roughness: 0.84 });
const collarMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.7 });
const scarfMaterial = new THREE.MeshStandardMaterial({ color: 0xc7363d, roughness: 0.72, side: THREE.DoubleSide });
const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.6 });
const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 0.18 });
const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a4a, roughness: 0.8 });
const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xd9b25c, roughness: 0.35, metalness: 0.6 });
const beltMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.7 });
const lapelMaterial = new THREE.MeshStandardMaterial({ color: 0x397b59, roughness: 0.76, side: THREE.DoubleSide });
const shirtMaterial = collarMaterial.clone();
shirtMaterial.side = THREE.DoubleSide;
const blushMaterial = new THREE.MeshStandardMaterial({
  color: 0xec9b83,
  roughness: 0.9,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});

const sphere = new THREE.SphereGeometry(1, 20, 16);
const princeGroup = new THREE.Group();
princeGroup.name = "littlePrince";
const headGroup = new THREE.Group();
const scarfGroup = new THREE.Group();
const eyes = [];
const princeLegs = [];
const foxLegs = [];

const poseBasis = new THREE.Matrix4();
const poseSide = new THREE.Vector3();
const moveSide = new THREE.Vector3();
const moveObstacle = new THREE.Vector3();
const moveHome = new THREE.Vector3();

function poseOnPlanet(group, up, forward, lift = 0) {
  poseSide.crossVectors(up, forward).normalize();
  poseBasis.makeBasis(poseSide, up, forward);
  group.quaternion.setFromRotationMatrix(poseBasis);
  group.position.copy(up).multiplyScalar(PLANET_RADIUS + lift);
}

function blob(parent, material, position, scale, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(sphere, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function segment(parent, material, from, to, radius, radiusEnd = radius) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusEnd, radius, direction.length(), 8), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  parent.add(mesh);
  return mesh;
}

function ribbon(curve, width, material, twistAmount = 0.8, segments = 30) {
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const widthDir = new THREE.Vector3();
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    widthDir.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
    if (widthDir.lengthSq() < 1e-6) widthDir.set(1, 0, 0);
    widthDir.normalize().applyAxisAngle(tangent, Math.sin(t * Math.PI) * twistAmount);
    const half = width * (1 - t * 0.78) * 0.5;
    positions.push(point.x - widthDir.x * half, point.y - widthDir.y * half, point.z - widthDir.z * half);
    positions.push(point.x + widthDir.x * half, point.y + widthDir.y * half, point.z + widthDir.z * half);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/* Legs and boots, grouped at the hip and knee so they can walk */
for (const side of [-1, 1]) {
  const shift = side < 0 ? 0.018 : -0.004;
  const hip = new THREE.Group();
  hip.position.set(side * 0.033, 0.36, 0);
  princeGroup.add(hip);

  const kneeOffset = new THREE.Vector3(0, -0.15, 0.008 + shift * 0.5);
  segment(hip, trouserMaterial, [0, 0, 0], [kneeOffset.x, kneeOffset.y, kneeOffset.z], 0.037, 0.032);
  const knee = new THREE.Group();
  knee.position.copy(kneeOffset);
  hip.add(knee);

  segment(knee, trouserMaterial, [0, 0, 0], [0, -0.132, 0.004 + shift * 0.5], 0.032, 0.026);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.026, 10), bootMaterial);
  cuff.position.set(0, -0.108, 0.004 + shift * 0.5);
  knee.add(cuff);
  const boot = blob(knee, bootMaterial, [0, -0.172, 0.014 + shift * 0.5], [0.034, 0.036, 0.058]);
  boot.rotation.x = -0.12;
  boot.rotation.y = side * 0.16;
  princeLegs.push({ hip, knee, offset: side < 0 ? Math.PI : 0 });
}

/* Coat and legs */
segment(princeGroup, coatMaterial, [0, 0.36, 0], [0, 0.65, 0], 0.1, 0.074);
blob(princeGroup, coatMaterial, [0, 0.35, -0.035], [0.085, 0.055, 0.07]);
blob(princeGroup, coatMaterial, [-0.032, 0.31, -0.085], [0.03, 0.105, 0.022], [0.55, 0, 0.15]);
blob(princeGroup, coatMaterial, [0.032, 0.31, -0.085], [0.03, 0.105, 0.022], [0.55, 0, -0.15]);
segment(princeGroup, beltMaterial, [0, 0.405, 0], [0, 0.422, 0], 0.092, 0.09);
const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.008), brassMaterial);
buckle.position.set(0, 0.414, 0.092);
princeGroup.add(buckle);

/* Shirt opening and lapels */
function triangle(parent, material, points, z) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap(([x, y]) => [x, y, z]), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  return mesh;
}
triangle(princeGroup, shirtMaterial, [[-0.024, 0.645], [0, 0.555], [0.024, 0.645]], 0.079);
triangle(princeGroup, lapelMaterial, [[-0.058, 0.648], [-0.006, 0.556], [-0.022, 0.648]], 0.081);
triangle(princeGroup, lapelMaterial, [[0.058, 0.648], [0.022, 0.648], [0.006, 0.556]], 0.081);
for (let i = 0; i < 3; i += 1) {
  blob(princeGroup, brassMaterial, [0, 0.455 + i * 0.055, 0.083 - i * 0.002], [0.009, 0.009, 0.006]);
}
const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.026, 14), collarMaterial);
collar.position.y = 0.655;
princeGroup.add(collar);
blob(princeGroup, collarMaterial, [0, 0.64, 0.062], [0.028, 0.022, 0.018]);

/* Arms, with the right hand lifted a little toward the rose */
for (const side of [-1, 1]) {
  const shoulder = [side * 0.083, 0.615, 0];
  const elbow = side < 0 ? [side * 0.122, 0.49, 0.022] : [side * 0.118, 0.5, 0.012];
  const hand = side < 0 ? [side * 0.042, 0.575, 0.088] : [side * 0.114, 0.39, 0.032];
  segment(princeGroup, coatMaterial, shoulder, elbow, 0.031, 0.026);
  segment(princeGroup, coatMaterial, elbow, hand, 0.026, 0.022);
  blob(princeGroup, skinMaterial, hand, [0.027, 0.031, 0.027]);
}

/* Neck and head */
segment(princeGroup, skinMaterial, [0, 0.65, 0], [0, 0.705, 0.004], 0.03, 0.032);
headGroup.position.set(0, 0.792, 0.006);
princeGroup.add(headGroup);
blob(headGroup, skinMaterial, [0, 0, 0], [0.096, 0.106, 0.091]);
blob(headGroup, skinMaterial, [-0.091, 0.002, 0], [0.019, 0.028, 0.016]);
blob(headGroup, skinMaterial, [0.091, 0.002, 0], [0.019, 0.028, 0.016]);
blob(headGroup, skinMaterial, [0, 0.002, 0.096], [0.013, 0.011, 0.014]);

for (const side of [-1, 1]) {
  const eye = blob(headGroup, eyeMaterial, [side * 0.035, 0.017, 0.083], [0.012, 0.0155, 0.0075]);
  eyes.push(eye);
  blob(headGroup, new THREE.MeshBasicMaterial({ color: 0xfff8ec }), [side * 0.038, 0.022, 0.09], [0.0038, 0.005, 0.0025]);
  blob(headGroup, hairMaterial, [side * 0.034, 0.035, 0.081], [0.017, 0.0035, 0.0035], [0, 0, side * -0.14]);
  blob(headGroup, blushMaterial, [side * 0.061, -0.013, 0.073], [0.019, 0.012, 0.005]);
}

const smile = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.018, -0.034, 0.085),
  new THREE.Vector3(0, -0.044, 0.09),
  new THREE.Vector3(0.018, -0.034, 0.085),
]);
headGroup.add(new THREE.Mesh(new THREE.TubeGeometry(smile, 10, 0.003, 5), mouthMaterial));

/* Golden hair: a cap, side locks, and a wind-blown swirl on top */
blob(headGroup, hairMaterial, [0, 0.049, -0.015], [0.105, 0.087, 0.1]);
blob(headGroup, hairMaterial, [-0.052, 0.068, 0.066], [0.028, 0.025, 0.022], [0.2, -0.3, 0.2]);
blob(headGroup, hairMaterial, [0.036, 0.07, 0.075], [0.024, 0.022, 0.02], [0.2, 0.3, -0.2]);
blob(headGroup, hairMaterial, [-0.078, 0.022, 0.014], [0.027, 0.05, 0.03], [0, 0, 0.22]);
blob(headGroup, hairMaterial, [0.078, 0.022, 0.014], [0.027, 0.05, 0.03], [0, 0, -0.22]);
blob(headGroup, hairMaterial, [0, 0.03, -0.088], [0.066, 0.06, 0.04]);
blob(headGroup, hairLightMaterial, [0.014, 0.108, 0.006], [0.05, 0.038, 0.046], [0.2, 0.3, -0.35]);
blob(headGroup, hairLightMaterial, [0.051, 0.098, 0.034], [0.031, 0.027, 0.029], [0.4, 0.8, -0.5]);
blob(headGroup, hairLightMaterial, [0.074, 0.076, 0.05], [0.021, 0.02, 0.02], [0.4, 1.1, -0.6]);
blob(headGroup, hairLightMaterial, [0.024, 0.101, 0.064], [0.03, 0.024, 0.026], [0.3, 0.5, -0.4]);

/* Scarf: a knot at the neck and a ribbon streaming behind him */
const knot = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 8, 18), scarfMaterial);
knot.position.y = 0.648;
knot.rotation.x = Math.PI / 2;
princeGroup.add(knot);

scarfGroup.position.set(0.012, 0.655, -0.035);
princeGroup.add(scarfGroup);
blob(scarfGroup, scarfMaterial, [0, 0, 0], [0.035, 0.032, 0.03]);
const scarfCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0.03, -0.012, -0.1),
  new THREE.Vector3(0.1, 0.045, -0.2),
  new THREE.Vector3(0.21, 0.02, -0.3),
  new THREE.Vector3(0.33, -0.055, -0.37),
  new THREE.Vector3(0.42, -0.145, -0.39),
]);
scarfGroup.add(ribbon(scarfCurve, 0.055, scarfMaterial, 1.05));
const scarfTailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-0.012, -0.06, -0.06),
  new THREE.Vector3(0.03, -0.13, -0.13),
  new THREE.Vector3(0.09, -0.19, -0.18),
]);
scarfGroup.add(ribbon(scarfTailCurve, 0.038, scarfMaterial, -0.75, 22));

castAndReceive(princeGroup);
scene.add(princeGroup);

/* Stand him about a stride from the horse, turned mostly toward the viewer but glancing at his rose. */
export const princeDirection = planetDirection(2.0, 4.75);
export const princeUp = princeDirection.clone();
export const princeForward = new THREE.Vector3();
const princeHome = princeDirection.clone();
let princeObstacle;
let headTurn = 0;
{
  const toRose = layout.rose.clone().multiplyScalar(PLANET_RADIUS).sub(princeDirection.clone().multiplyScalar(PLANET_RADIUS));
  toRose.addScaledVector(princeDirection, -toRose.dot(princeDirection)).normalize();
  const cameraDirection = new THREE.Vector3(
    Math.sin(CAMERA_AZIMUTH) * Math.sin(1.36),
    Math.cos(1.36),
    Math.cos(CAMERA_AZIMUTH) * Math.sin(1.36)
  );
  const face = cameraDirection.addScaledVector(princeDirection, -cameraDirection.dot(princeDirection)).normalize();
  const side = new THREE.Vector3().crossVectors(princeDirection, face);
  const towardRose = Math.atan2(toRose.dot(side), toRose.dot(face));
  face.applyAxisAngle(princeDirection, Math.sign(towardRose) * 0.45);
  headTurn = Math.sign(towardRose) * 0.32;
  headGroup.rotation.y = headTurn;
  princeForward.copy(face);
  princeGroup.scale.setScalar(1.12);
  poseOnPlanet(princeGroup, princeUp, princeForward);
  princeObstacle = { direction: princeUp, radius: 0.34 };
  obstacles.push(princeObstacle);
}


/* ------------------------------------------------------------------ */
/* The fox, sitting by the rose                                        */
/* ------------------------------------------------------------------ */

const foxFur = new THREE.MeshStandardMaterial({ color: 0xc85a26, roughness: 0.88 });
const foxCream = new THREE.MeshStandardMaterial({ color: 0xf2e3c9, roughness: 0.9 });
const foxDark = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.72 });

const fox = new THREE.Group();
fox.name = "littleFox";

/* A low, long body with a pointed snout, black stockings and a sweeping tail. */
blob(fox, foxFur, [0, 0.16, -0.015], [0.054, 0.058, 0.135]);
blob(fox, foxFur, [0, 0.146, 0.105], [0.043, 0.05, 0.07]);
blob(fox, foxFur, [0, 0.158, 0.148], [0.033, 0.04, 0.045]);
blob(fox, foxCream, [0, 0.132, 0.102], [0.03, 0.048, 0.024]);
blob(fox, foxCream, [0, 0.16, 0.137], [0.022, 0.03, 0.022]);
blob(fox, foxCream, [0, 0.114, -0.02], [0.027, 0.011, 0.09]);

for (const side of [-1, 1]) {
  blob(fox, foxFur, [side * 0.042, 0.137, -0.085], [0.028, 0.058, 0.07]);
  blob(fox, foxFur, [side * 0.04, 0.155, 0.08], [0.028, 0.05, 0.05]);
}

/* Four slim legs in alternating diagonal pairs. */
for (const side of [-1, 1]) {
  const leg = new THREE.Group();
  leg.position.set(side * 0.032, 0.155, 0.075);
  fox.add(leg);
  segment(leg, foxFur, [0, 0, 0], [0, -0.06, 0.004], 0.019, 0.014);
  segment(leg, foxDark, [0, -0.06, 0.004], [0, -0.142, 0.012], 0.014, 0.01);
  blob(leg, foxDark, [0, -0.146, 0.022], [0.015, 0.009, 0.025]);
  foxLegs.push({ leg, offset: side < 0 ? 0 : Math.PI });
}
for (const side of [-1, 1]) {
  const leg = new THREE.Group();
  leg.position.set(side * 0.043, 0.14, -0.075);
  fox.add(leg);
  segment(leg, foxFur, [0, 0, 0], [0, -0.045, -0.02], 0.026, 0.018);
  segment(leg, foxDark, [0, -0.045, -0.02], [0, -0.126, 0], 0.014, 0.01);
  blob(leg, foxDark, [0, -0.131, 0.008], [0.015, 0.009, 0.025]);
  foxLegs.push({ leg, offset: side < 0 ? Math.PI : 0 });
}

/* Pointed face with white cheeks and muzzle. */
const headY = 0.218;
const headZ = 0.195;
blob(fox, foxFur, [0, headY, headZ], [0.04, 0.04, 0.047]);
blob(fox, foxFur, [0, headY - 0.004, headZ + 0.04], [0.019, 0.018, 0.036]);
blob(fox, foxCream, [0, headY - 0.014, headZ + 0.055], [0.019, 0.016, 0.033]);
blob(fox, foxDark, [0, headY - 0.006, headZ + 0.09], [0.007, 0.006, 0.008]);
for (const side of [-1, 1]) {
  blob(fox, foxCream, [side * 0.029, headY - 0.01, headZ - 0.002], [0.015, 0.022, 0.036], [0, side * 0.5, 0.1]);
  blob(fox, foxDark, [side * 0.02, headY + 0.018, headZ + 0.034], [0.0055, 0.007, 0.0045]);
  blob(fox, new THREE.MeshBasicMaterial({ color: 0xfff8ec }), [side * 0.0215, headY + 0.0195, headZ + 0.0385], [0.0018, 0.0022, 0.0012]);
  blob(fox, foxDark, [side * 0.016, headY - 0.001, headZ + 0.052], [0.0035, 0.0035, 0.019], [0.1, 0, 0]);
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 4), foxFur);
  ear.position.set(side * 0.024, headY + 0.043, headZ - 0.005);
  ear.rotation.z = side * -0.18;
  ear.rotation.x = -0.08;
  fox.add(ear);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.016, 4), foxDark);
  tip.position.set(side * 0.028, headY + 0.06, headZ - 0.005);
  tip.rotation.z = side * -0.18;
  tip.rotation.x = -0.08;
  fox.add(tip);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.026, 4), foxCream);
  inner.position.set(side * 0.024, headY + 0.041, headZ - 0.002);
  inner.rotation.z = side * -0.18;
  inner.rotation.x = -0.08;
  fox.add(inner);
}

/* A long, low, bushy tail with a white tip. */
const foxTail = new THREE.Group();
foxTail.position.set(0, 0.16, -0.145);
fox.add(foxTail);
const tailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0.004, -0.012, -0.075),
  new THREE.Vector3(0.01, 0.015, -0.15),
  new THREE.Vector3(0.012, 0.055, -0.225),
  new THREE.Vector3(0.006, 0.075, -0.3),
]);
const tail = new THREE.Mesh(
  tubeGeometry(tailCurve, (t) => 0.026 + Math.sin(t * Math.PI) * 0.018 - t * 0.008, 24, 9),
  foxFur
);
foxTail.add(tail);
blob(foxTail, foxFur, [0, 0, 0], [0.032, 0.035, 0.04]);
blob(foxTail, foxCream, [0.006, 0.075, -0.305], [0.02, 0.024, 0.042], [0.15, 0, 0]);
blob(foxTail, foxCream, [0.004, 0.077, -0.34], [0.014, 0.017, 0.024], [0.15, 0, 0]);
castAndReceive(fox);
scene.add(fox);

export const foxDirection = planetDirection(2.32, 5.06);
export const foxUp = foxDirection.clone();
export const foxForward = new THREE.Vector3();
const foxHome = foxDirection.clone();
let foxObstacle;
{
  const toPrince = princeDirection.clone().multiplyScalar(PLANET_RADIUS).sub(foxDirection.clone().multiplyScalar(PLANET_RADIUS));
  toPrince.addScaledVector(foxDirection, -toPrince.dot(foxDirection)).normalize();
  foxForward.copy(toPrince);
  poseOnPlanet(fox, foxUp, foxForward);
  foxObstacle = { direction: foxUp, radius: 0.24 };
  obstacles.push(foxObstacle);
}

/* ------------------------------------------------------------------ */
/* Wandering                                                           */
/* ------------------------------------------------------------------ */

const princeState = { speed: 0, targetSpeed: 0.3, yawRate: 0, targetYaw: 0, timer: 0.5, phase: 0 };
const foxState = { speed: 0, targetSpeed: 0.35, yawRate: 0, targetYaw: 0, timer: 1.2, phase: 0 };

function updateWanderer(up, forward, state, homeUp, homeRadius, baseSpeed, ownObstacle, horseUp, dt) {
  state.timer -= dt;
  if (state.timer <= 0) {
    state.targetYaw = (Math.random() - 0.5) * 1.25;
    state.targetSpeed = Math.random() < 0.25 ? 0 : baseSpeed * (0.65 + Math.random() * 0.5);
    state.timer = 1.4 + Math.random() * 3.2;
  }

  const side = moveSide.crossVectors(up, forward).normalize();
  let steer = 0;
  let closest = Infinity;
  for (const obstacle of obstacles) {
    if (obstacle === ownObstacle) continue;
    const gap = up.angleTo(obstacle.direction) * PLANET_RADIUS - obstacle.radius;
    if (gap > 1.5) continue;
    moveObstacle.copy(obstacle.direction).multiplyScalar(PLANET_RADIUS).addScaledVector(up, -PLANET_RADIUS);
    moveObstacle.addScaledVector(up, -moveObstacle.dot(up));
    if (moveObstacle.lengthSq() < 1e-6) continue;
    moveObstacle.normalize();
    const ahead = moveObstacle.dot(forward);
    if (ahead < 0.1) continue;
    const lateral = moveObstacle.dot(side);
    const closeness = 1 - clamp(gap / 1.5, 0, 1);
    const urgency = closeness * ahead;
    steer += (lateral >= 0 ? -1 : 1) * (1.5 + closeness * 2.5) * urgency;
    closest = Math.min(closest, gap);
  }

  if (horseUp) {
    const gap = up.angleTo(horseUp) * PLANET_RADIUS - 0.95;
    if (gap < 1.5) {
      moveObstacle.copy(horseUp).multiplyScalar(PLANET_RADIUS).addScaledVector(up, -PLANET_RADIUS);
      moveObstacle.addScaledVector(up, -moveObstacle.dot(up));
      if (moveObstacle.lengthSq() > 1e-6) {
        moveObstacle.normalize();
        const ahead = moveObstacle.dot(forward);
        const lateral = moveObstacle.dot(side);
        if (ahead > 0.1) {
          const closeness = 1 - clamp(gap / 1.5, 0, 1);
          steer += (lateral >= 0 ? -1 : 1) * (2.2 + closeness * 2.5) * closeness * ahead;
        }
        closest = Math.min(closest, gap);
      }
    }
  }

  const homeGap = up.angleTo(homeUp) * PLANET_RADIUS;
  if (homeGap > homeRadius) {
    moveHome.copy(homeUp).multiplyScalar(PLANET_RADIUS).addScaledVector(up, -PLANET_RADIUS);
    moveHome.addScaledVector(up, -moveHome.dot(up));
    if (moveHome.lengthSq() > 1e-6) {
      moveHome.normalize();
      const homeYaw = Math.atan2(moveHome.dot(side), moveHome.dot(forward));
      steer += clamp(homeYaw * 1.4, -2.4, 2.4);
      state.targetSpeed = Math.max(state.targetSpeed, baseSpeed * 0.75);
    }
  }

  if (closest < 0.6) state.targetSpeed = Math.max(state.targetSpeed, baseSpeed * 0.5);

  state.yawRate = damp(state.yawRate, clamp(state.targetYaw + steer, -2.6, 2.6), 4, dt);
  state.speed = damp(state.speed, state.targetSpeed, 2.6, dt);
  if (Math.abs(state.speed) < 0.008) state.speed = 0;

  forward.applyAxisAngle(up, state.yawRate * dt);
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  moveSide.crossVectors(up, forward).normalize();
  if (state.speed !== 0) {
    const step = (state.speed * dt) / PLANET_RADIUS;
    up.applyAxisAngle(moveSide, step);
    forward.applyAxisAngle(moveSide, step);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
  }
}

function animatePrinceWalk(dt) {
  const walking = clamp(princeState.speed / 0.2, 0, 1);
  princeState.phase += dt * (2.4 + princeState.speed * 6.5);
  for (const leg of princeLegs) {
    const swing = Math.sin(princeState.phase + leg.offset);
    const hipTarget = -swing * 0.42 * walking;
    const kneeTarget = Math.max(0, Math.cos(princeState.phase + leg.offset)) * 0.45 * walking;
    leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 12, dt);
    leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 12, dt);
  }
  const bob = Math.abs(Math.sin(princeState.phase)) * 0.008 * walking;
  poseOnPlanet(princeGroup, princeUp, princeForward, bob);
  princeGroup.rotateX(-0.04 * walking);
  princeGroup.rotateZ(Math.sin(princeState.phase) * 0.015 * walking);
}

function animateFoxWalk(dt) {
  const walking = clamp(foxState.speed / 0.2, 0, 1);
  foxState.phase += dt * (3.2 + foxState.speed * 7);
  for (const leg of foxLegs) {
    const target = -Math.sin(foxState.phase + leg.offset) * 0.55 * walking;
    leg.leg.rotation.x = damp(leg.leg.rotation.x, target, 12, dt);
  }
  const bob = Math.abs(Math.sin(foxState.phase * 2)) * 0.009 * walking;
  poseOnPlanet(fox, foxUp, foxForward, bob);
  fox.rotateX(-0.05 * walking);
}

export function updatePrince(elapsed, dt, horseUp) {
  if (prefersReducedMotion) return;

  updateWanderer(princeUp, princeForward, princeState, princeHome, 2.6, 0.42, princeObstacle, horseUp, dt);
  updateWanderer(foxUp, foxForward, foxState, foxHome, 3.4, 0.58, foxObstacle, horseUp, dt);
  animatePrinceWalk(dt);
  animateFoxWalk(dt);

  scarfGroup.rotation.y = Math.sin(elapsed * 1.15) * 0.09;
  scarfGroup.rotation.x = Math.sin(elapsed * 0.83 + 1.2) * 0.045;
  headGroup.rotation.z = Math.sin(elapsed * 0.62) * 0.025;
  headGroup.rotation.x = Math.sin(elapsed * 0.47 + 0.6) * 0.018;
  const cycle = elapsed % 4.6;
  const blink = cycle < 0.13 ? Math.sin((cycle / 0.13) * Math.PI) : 0;
  for (const eye of eyes) eye.scale.y = 0.014 * (1 - blink * 0.9);
  headGroup.rotation.y = headTurn + Math.sin(elapsed * 0.31 + 0.8) * 0.05;
  foxTail.rotation.y = Math.sin(elapsed * 1.2 + 0.5) * 0.15;
  foxTail.rotation.z = Math.sin(elapsed * 0.9 + 1.7) * 0.035;
}
