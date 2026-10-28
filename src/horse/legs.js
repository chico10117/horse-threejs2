import * as THREE from "three";
import { clamp } from "../util.js";
import { limbGeometry } from "../geometry.js";
import { addMesh, coatMaterial, ellipsoid, hoofMaterial, torso, whiteMaterial } from "./body.js";

/* Legs — jointed chains solved with a little inverse kinematics so the hooves stay planted */
export const FRONT_LEG = { upper: 0.42, middle: 0.49, cannon: 0.36 };
export const HIND_LEG = { upper: 0.48, middle: 0.6, cannon: 0.44 };
export const PASTERN_LENGTH = 0.13;
export const PASTERN_SLOPE = 0.52;
export const HOOF_HEIGHT = 0.1;
export const HOOF_TOE = 0.115;

export const hoofGeometry = new THREE.CylinderGeometry(0.062, 0.078, HOOF_HEIGHT, 20, 2);
{
  hoofGeometry.translate(0, -HOOF_HEIGHT / 2, 0);
  const position = hoofGeometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    position.setZ(i, (position.getZ(i) + (y + HOOF_HEIGHT) * -0.32 + 0.032) * 1.12);
  }
  hoofGeometry.computeVertexNormals();
}

export const FRONT_RADII = {
  forearm: [0.122, 0.122, 0.11, 0.09, 0.074, 0.068],
  cannon: [0.06, 0.054, 0.052, 0.053, 0.058, 0.064],
};
export const HIND_RADII = {
  gaskin: [0.132, 0.136, 0.12, 0.098, 0.078, 0.07],
  cannon: [0.062, 0.056, 0.054, 0.054, 0.059, 0.065],
};
export const PASTERN_RADII = [0.056, 0.05, 0.049, 0.053, 0.06];
export const SOCK_LINE = 0.34;

export function addLowerLeg(parent, cannonLength, cannonRadii) {
  addMesh(parent, limbGeometry(cannonLength, cannonRadii, 0, SOCK_LINE), coatMaterial);
  addMesh(parent, limbGeometry(cannonLength, cannonRadii, SOCK_LINE - 0.01, 1), whiteMaterial);

  const fetlock = new THREE.Group();
  fetlock.position.y = -cannonLength;
  parent.add(fetlock);
  ellipsoid(fetlock, whiteMaterial, [0, -0.004, -0.012], [0.062, 0.068, 0.075]);
  addMesh(fetlock, limbGeometry(PASTERN_LENGTH, PASTERN_RADII), whiteMaterial);

  const coffin = new THREE.Group();
  coffin.position.y = -PASTERN_LENGTH;
  fetlock.add(coffin);
  addMesh(coffin, hoofGeometry, hoofMaterial);
  return { fetlock, coffin };
}

export const legs = [];

export function makeLeg({ key, side, front, index }) {
  const pivot = front
    ? new THREE.Vector3(side * 0.19, 1.36, 0.74)
    : new THREE.Vector3(side * 0.2, 1.52, -0.6);
  const root = new THREE.Group();
  root.rotation.order = "ZXY";
  root.position.copy(pivot);
  torso.add(root);

  const lengths = front ? FRONT_LEG : HIND_LEG;
  const middle = new THREE.Group();
  middle.position.y = -lengths.upper;
  root.add(middle);
  const lower = new THREE.Group();
  lower.position.y = -lengths.middle;
  middle.add(lower);

  if (front) {
    ellipsoid(root, coatMaterial, [0, -0.1, 0.0], [0.1, 0.18, 0.13]);
    ellipsoid(middle, coatMaterial, [0, 0.01, -0.03], [0.088, 0.1, 0.1]);
    addMesh(middle, limbGeometry(lengths.middle, FRONT_RADII.forearm), coatMaterial);
    ellipsoid(lower, coatMaterial, [0, 0, 0.008], [0.07, 0.086, 0.078]);
  } else {
    ellipsoid(root, coatMaterial, [0, -0.2, -0.06], [0.15, 0.3, 0.22]);
    ellipsoid(middle, coatMaterial, [0, 0, 0.03], [0.1, 0.11, 0.1]);
    addMesh(middle, limbGeometry(lengths.middle, HIND_RADII.gaskin), coatMaterial);
    ellipsoid(lower, coatMaterial, [0, 0, -0.01], [0.074, 0.09, 0.088]);
    ellipsoid(lower, coatMaterial, [0, 0.035, -0.07], [0.04, 0.05, 0.035]);
  }
  const { fetlock, coffin } = addLowerLeg(lower, lengths.cannon, front ? FRONT_RADII.cannon : HIND_RADII.cannon);

  const leg = {
    key,
    index,
    side,
    front,
    pivot,
    lengths,
    root,
    joints: [middle, lower, fetlock, coffin],
    rest: new THREE.Vector3(pivot.x, 0, front ? 0.66 : -0.58),
    offset: [0, 0.25, 0.5, 0.75][index],
    stance: true,
    plant: new THREE.Vector3(),
    landing: new THREE.Vector3(),
    pose: new Float32Array(7),
    gaitPose: new Float32Array(7),
    liftPose: new Float32Array(7),
    neutralPose: new Float32Array(7),
    /* How each joint folds at the height of a swing, and the tucked shape for a jump. */
    fold: front ? [0, 0, -0.12, -0.55, 1.35, 0.55, 0.35] : [0, 0, -0.22, 0.35, -0.95, 0.65, 0.35],
    tuck: front ? [0, 0.05, -0.35, -0.9, 2.0, 0.7, 0.4] : [0, 0, -0.55, 0.65, -1.2, 0.8, 0.4],
  };
  legs.push(leg);
  return leg;
}

[
  { key: "LH", side: 1, front: false },
  { key: "LF", side: 1, front: true },
  { key: "RH", side: -1, front: false },
  { key: "RF", side: -1, front: true },
].forEach((spec, index) => makeLeg({ ...spec, index }));

/* Two-bone solve in a leg's plane. Angles are measured from straight down; positive swings back. */
export const twoBone = { upper: 0, lower: 0 };

export function solveTwoBone(sz, sy, tz, ty, upperLength, lowerLength, jointBack) {
  const dz = tz - sz;
  const dy = ty - sy;
  const distance = clamp(Math.hypot(dz, dy), Math.abs(upperLength - lowerLength) + 1e-4, upperLength + lowerLength - 1e-4);
  const toTarget = Math.atan2(-dz, -dy);
  const cosine = clamp((upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance), -1, 1);
  const bend = Math.acos(cosine);
  twoBone.upper = jointBack ? toTarget + bend : toTarget - bend;
  const jz = sz - upperLength * Math.sin(twoBone.upper);
  const jy = sy - upperLength * Math.cos(twoBone.upper);
  twoBone.lower = Math.atan2(-(tz - jz), -(ty - jy));
  return twoBone;
}

/*
 * Poses a leg so its toe lands on `toe` (torso space) with the hoof at angle `rho`. The front leg
 * bends at a hidden elbow and folds its knee by `flex`; the hind leg keeps its cannon near upright
 * (tilted by `flex`) and bends at the stifle. Writes [tilt, slide, root, middle, lower, fetlock, coffin].
 */
export function solveLegPose(leg, toe, rho, slope, flex, out) {
  const slide = leg.front ? clamp((toe.z - leg.rest.z) * 0.22, -0.12, 0.12) : 0;
  const pz = leg.pivot.z + slide;
  const py = leg.pivot.y;
  const lateral = toe.x - leg.pivot.x;
  const drop = py - toe.y;
  const tilt = Math.atan2(lateral, drop);
  const ty = py - Math.hypot(lateral, drop);
  const tz = toe.z;

  const sinR = Math.sin(rho);
  const cosR = Math.cos(rho);
  const cz = tz - (-HOOF_HEIGHT * sinR + HOOF_TOE * cosR);
  const cy = ty - (-HOOF_HEIGHT * cosR - HOOF_TOE * sinR);
  const pastern = rho - slope;
  const fz = cz + PASTERN_LENGTH * Math.sin(pastern);
  const fy = cy + PASTERN_LENGTH * Math.cos(pastern);
  const { upper, middle, cannon } = leg.lengths;

  out[0] = tilt;
  out[1] = slide;
  if (leg.front) {
    const ez = -cannon * Math.sin(flex);
    const ey = -middle - cannon * Math.cos(flex);
    const offset = Math.atan2(-ez, -ey);
    solveTwoBone(pz, py, fz, fy, upper, Math.hypot(ez, ey), true);
    const forearm = twoBone.lower - offset;
    const cannonAngle = forearm + flex;
    out[2] = twoBone.upper;
    out[3] = forearm - twoBone.upper;
    out[4] = flex;
    out[5] = pastern - cannonAngle;
  } else {
    const legAngle = Math.atan2(-(fz - pz), -(fy - py));
    const cannonAngle = legAngle * 0.45 + flex;
    const hz = fz + cannon * Math.sin(cannonAngle);
    const hy = fy + cannon * Math.cos(cannonAngle);
    solveTwoBone(pz, py, hz, hy, upper, middle, false);
    out[2] = twoBone.upper;
    out[3] = twoBone.lower - twoBone.upper;
    out[4] = cannonAngle - twoBone.lower;
    out[5] = pastern - cannonAngle;
  }
  out[6] = rho - pastern;
  return out;
}

export function applyLegPose(leg, pose) {
  leg.root.rotation.z = pose[0];
  leg.root.position.z = leg.pivot.z + pose[1];
  leg.root.rotation.x = pose[2];
  leg.joints[0].rotation.x = pose[3];
  leg.joints[1].rotation.x = pose[4];
  leg.joints[2].rotation.x = pose[5];
  leg.joints[3].rotation.x = pose[6];
}
