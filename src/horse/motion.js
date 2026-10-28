import * as THREE from "three";
import { clamp, damp, fract, lerp, smoothstep, wrapCycle } from "../util.js";
import { PLANET_RADIUS, prefersReducedMotion } from "../core.js";
import { obstacles } from "../planet.js";
import { dust, emitPuff, particlesEnabled } from "../effects.js";
import { HEAD_PITCH, bitRings, ears, forelockLocks, headGroup, horse, maneLocks, neckGroup, neckSweep, reinAnchors, reins, tailBones, torso } from "./body.js";
import { PASTERN_SLOPE, applyLegPose, legs, solveLegPose } from "./legs.js";

/* ------------------------------------------------------------------ */
/* State & motion                                                      */
/* ------------------------------------------------------------------ */

export const state = {
  auto: !prefersReducedMotion,
  gallop: false,
  cruise: 1.4,
  speed: 0,
  yawRate: 0,
  height: 0,
  verticalVelocity: 0,
  jump: "ground",
  jumpTimer: 0,
  crouch: 0,
  landing: 0,
  air: 0,
};

export const GRAVITY = 15;
export const BODY_LIFT = 0.08;
export const JUMP_VELOCITY = 5.4;
export const HORSE_RADIUS = 0.85;

/* Where she stands on the planet: local up, and the way she faces. */
export const horseUp = new THREE.Vector3(0, 1, 0);
export const FRAME_HEADING = -0.27;
export const horseForward = new THREE.Vector3(Math.sin(FRAME_HEADING), 0, Math.cos(FRAME_HEADING));
export const horseSide = new THREE.Vector3();
export const previousUp = new THREE.Vector3(0, 1, 0);
export const basis = new THREE.Matrix4();
export const horseInverse = new THREE.Matrix4();
export const torsoInverse = new THREE.Matrix4();
export const moveRotation = new THREE.Quaternion();

export function placeHorse() {
  horseSide.crossVectors(horseUp, horseForward).normalize();
  horse.position.copy(horseUp).multiplyScalar(PLANET_RADIUS + state.height);
  basis.makeBasis(horseSide, horseUp, horseForward);
  horse.quaternion.setFromRotationMatrix(basis);
  horse.updateMatrixWorld(true);
}

placeHorse();
horseInverse.copy(horse.matrixWorld).invert();

/* Gaits, in leg order LH, LF, RH, RF. Offsets are fractions of a stride. */
export const GAITS = [
  { name: "walk", duty: 0.62, offsets: [0, 0.25, 0.5, 0.75], flex: 1, breakover: 0.75 },
  { name: "trot", duty: 0.44, offsets: [0, 0.5, 0.5, 0], flex: 1.3, breakover: 0.9 },
  { name: "gallop", duty: 0.34, offsets: [0, 0.38, 0.1, 0.5], flex: 1.5, breakover: 1.0 },
];

export const gait = {
  phase: 0,
  weights: [1, 0, 0],
  dominant: 0,
  duty: 0.62,
  stanceLength: 0.7,
  flex: 1,
  breakover: 0.75,
  activity: 0,
  direction: 1,
  frequency: 0,
};

export function gallopSpeed() {
  return Math.max(5.4, state.cruise * 1.7);
}

export function requestJump() {
  if (state.jump !== "ground") return;
  state.jump = "crouch";
  state.jumpTimer = 0.14;
}

export const pressed = new Set();


export const toObstacle = new THREE.Vector3();
export const pushAxis = new THREE.Vector3();
export const pushRotation = new THREE.Quaternion();

export function avoidObstacles() {
  let steer = 0;
  const lookahead = 4.5;
  for (const obstacle of obstacles) {
    toObstacle.copy(obstacle.direction).multiplyScalar(PLANET_RADIUS).sub(horse.position);
    const ahead = toObstacle.dot(horseForward);
    if (ahead < 0 || ahead > lookahead) continue;
    const lateral = toObstacle.dot(horseSide);
    const clearance = obstacle.radius + 1.4;
    if (Math.abs(lateral) > clearance) continue;
    const urgency = (1 - ahead / lookahead) * (1 - Math.abs(lateral) / clearance);
    steer += (lateral >= 0 ? -1 : 1) * 2.6 * urgency;
  }
  return steer;
}

export function resolveCollisions() {
  for (const obstacle of obstacles) {
    const angle = horseUp.angleTo(obstacle.direction);
    const minimum = (obstacle.radius + HORSE_RADIUS) / PLANET_RADIUS;
    if (angle >= minimum) continue;
    pushAxis.crossVectors(obstacle.direction, horseUp);
    if (pushAxis.lengthSq() < 1e-8) continue;
    pushRotation.setFromAxisAngle(pushAxis.normalize(), minimum - angle);
    horseUp.applyQuaternion(pushRotation);
    horseForward.applyQuaternion(pushRotation);
  }
}

export function updateLocomotion(dt, elapsed) {
  let targetSpeed = 0;
  let targetYawRate = 0;
  const sprinting = state.gallop || pressed.has("ShiftLeft") || pressed.has("ShiftRight");

  if (state.auto) {
    targetYawRate = 0.3 * Math.sin(elapsed * 0.17) + 0.2 * Math.sin(elapsed * 0.41 + 1.3) + avoidObstacles();
    targetYawRate = clamp(targetYawRate, -1.4, 1.4);
    targetSpeed = sprinting ? gallopSpeed() : state.cruise;
  } else {
    const throttle = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0)
      - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const steer = (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0)
      - (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0);

    targetYawRate = steer * 1.55;
    targetSpeed = throttle > 0
      ? (sprinting ? gallopSpeed() : state.cruise) * throttle
      : throttle < 0 ? -state.cruise * 0.42 : 0;
  }

  state.yawRate = damp(state.yawRate, targetYawRate, 6, dt);
  state.speed = damp(state.speed, targetSpeed, state.jump === "air" ? 0.6 : 3.2, dt);
  if (Math.abs(state.speed) < 0.004) state.speed = 0;

  previousUp.copy(horseUp);
  horseForward.applyAxisAngle(horseUp, state.yawRate * dt);

  if (state.speed !== 0) {
    horseSide.crossVectors(horseUp, horseForward).normalize();
    moveRotation.setFromAxisAngle(horseSide, (state.speed * dt) / PLANET_RADIUS);
    horseUp.applyQuaternion(moveRotation);
    horseForward.applyQuaternion(moveRotation);
  }
  resolveCollisions();
  horseUp.normalize();
  horseForward.addScaledVector(horseUp, -horseForward.dot(horseUp)).normalize();

  /* Jump: a short crouch, a leap, a soft landing */
  if (state.jump === "crouch") {
    state.jumpTimer -= dt;
    if (state.jumpTimer <= 0) {
      state.jump = "air";
      state.verticalVelocity = JUMP_VELOCITY;
    }
  } else if (state.jump === "air") {
    state.verticalVelocity -= GRAVITY * dt;
    state.height += state.verticalVelocity * dt;
    if (state.height <= 0) {
      state.height = 0;
      state.verticalVelocity = 0;
      state.jump = "ground";
      state.landing = 1;
      land();
    }
  }
  state.crouch = damp(state.crouch, state.jump === "crouch" ? 1 : 0, 18, dt);
  state.air = damp(state.air, state.jump === "air" ? 1 : 0, state.jump === "air" ? 10 : 14, dt);
  state.landing = damp(state.landing, 0, 5, dt);

  placeHorse();
}

export const toeScratch = new THREE.Vector3();
export const toeTorso = new THREE.Vector3();
export const landingPose = new Float32Array(7);
export const plantWorld = new THREE.Vector3();
export const plantNormal = new THREE.Vector3();

export function groundHeight(x, z) {
  return -(PLANET_RADIUS + state.height) + Math.sqrt(Math.max(0, PLANET_RADIUS ** 2 - x * x - z * z));
}

/* Solve for a toe given in the horse's frame; the hoof meets the curved ground flat. */
export function solveFromHorse(leg, toe, rhoOnGround, slope, flex, out) {
  const tilt = Math.atan2(toe.z, toe.y + PLANET_RADIUS + state.height);
  toeTorso.copy(toe).applyMatrix4(torsoInverse);
  return solveLegPose(leg, toeTorso, rhoOnGround + tilt - torso.rotation.x, slope, flex, out);
}

export function plantAt(leg, toe) {
  leg.plant.copy(toe).applyMatrix4(horse.matrixWorld).setLength(PLANET_RADIUS);
}

export function land() {
  for (const leg of legs) {
    toeScratch.set(leg.rest.x, 0, leg.rest.z);
    toeScratch.y = groundHeight(toeScratch.x, toeScratch.z);
    plantAt(leg, toeScratch);
    if (particlesEnabled) {
      plantWorld.copy(leg.plant);
      emitPuff(dust, plantWorld, plantNormal.copy(plantWorld).normalize(), { speed: 0.3, spread: 0.5, size: 0.2, growth: 0.9 });
    }
  }
}

export function updateGait(dt) {
  const speed = Math.abs(state.speed);
  const trot = smoothstep(1.9, 2.4, speed) * (1 - smoothstep(3.7, 4.3, speed));
  const gallop = smoothstep(3.7, 4.3, speed);
  const targets = [1 - trot - gallop, trot, gallop];
  gait.weights = gait.weights.map((weight, i) => damp(weight, targets[i], 4, dt));
  const total = gait.weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const [walkW, trotW, gallopW] = gait.weights.map((weight) => weight / total);

  gait.dominant = targets.indexOf(Math.max(...targets));
  gait.duty = walkW * GAITS[0].duty + trotW * GAITS[1].duty + gallopW * GAITS[2].duty;
  gait.flex = walkW * GAITS[0].flex + trotW * GAITS[1].flex + gallopW * GAITS[2].flex;
  gait.breakover = walkW * GAITS[0].breakover + trotW * GAITS[1].breakover + gallopW * GAITS[2].breakover;
  gait.activity = smoothstep(0.04, 0.5, speed);
  gait.stanceLength = lerp(0.3, walkW * lerp(0.42, 0.74, smoothstep(0.3, 1.8, speed)) + trotW * 0.8 + gallopW * 0.88, gait.activity);
  gait.direction = state.speed >= 0 ? 1 : -1;
  gait.frequency = (speed * gait.duty) / gait.stanceLength;
  gait.phase = fract(gait.phase + gait.direction * gait.frequency * dt);

  const maxShift = Math.max(0.3, gait.frequency * 0.6) * dt;
  const offsets = GAITS[gait.dominant].offsets;
  for (const leg of legs) {
    leg.offset += clamp(wrapCycle(offsets[leg.index] - leg.offset), -maxShift, maxShift);
  }
}

export function updateLegs() {
  horseInverse.copy(horse.matrixWorld).invert();
  torso.updateMatrix();
  torsoInverse.copy(torso.matrix).invert();
  const activity = gait.activity;
  const forward = gait.direction > 0;
  const reach = gait.stanceLength * 0.5;

  for (const leg of legs) {
    const cycle = fract(gait.phase + leg.offset);
    const inStance = cycle < gait.duty;

    toeScratch.set(leg.rest.x, 0, leg.rest.z);
    toeScratch.y = groundHeight(toeScratch.x, toeScratch.z);
    solveFromHorse(leg, toeScratch, 0, PASTERN_SLOPE, 0, leg.neutralPose);

    if (inStance !== leg.stance) {
      if (inStance) {
        plantAt(leg, leg.landing);
        if (particlesEnabled && Math.abs(state.speed) > 1.1 && Math.random() < Math.abs(state.speed) / 5) {
          emitPuff(dust, leg.plant, plantNormal.copy(leg.plant).normalize(), { speed: 0.16, spread: 0.25 });
        }
      } else {
        leg.liftPose.set(leg.gaitPose);
      }
      leg.stance = inStance;
    }

    if (inStance) {
      const u = cycle / gait.duty;
      const progress = forward ? u : 1 - u;
      toeScratch.copy(leg.plant).applyMatrix4(horseInverse);
      const breakover = gait.breakover * smoothstep(0.7, 1, progress) * activity;
      const sink = 0.12 * Math.sin(Math.PI * u) * activity * (leg.front ? 1 : 0.7);
      solveFromHorse(leg, toeScratch, breakover, PASTERN_SLOPE + sink, 0, leg.gaitPose);
      if (activity < 0.04) plantAt(leg, leg.landing.set(leg.rest.x, groundHeight(leg.rest.x, leg.rest.z), leg.rest.z));
    } else {
      const u = (cycle - gait.duty) / (1 - gait.duty);
      const progress = forward ? u : 1 - u;
      const z = leg.rest.z + (forward ? reach : -reach);
      leg.landing.set(leg.rest.x, groundHeight(leg.rest.x, z), z);
      solveFromHorse(leg, leg.landing, -0.1 * activity, PASTERN_SLOPE, 0, landingPose);
      const ease = progress * progress * (3 - 2 * progress);
      const fold = Math.sin(Math.PI * Math.pow(progress, 0.75)) * gait.flex * activity;
      for (let k = 0; k < 7; k += 1) {
        leg.gaitPose[k] = lerp(leg.liftPose[k], landingPose[k], ease) + leg.fold[k] * fold;
      }
    }

    for (let k = 0; k < 7; k += 1) {
      const grounded = lerp(leg.neutralPose[k], leg.gaitPose[k], activity);
      leg.pose[k] = lerp(grounded, leg.tuck[k], state.air);
    }
    applyLegPose(leg, leg.pose);
  }
}

export const reinControl = new THREE.Vector3();
export const reinStart = new THREE.Vector3();
export const reinEnd = new THREE.Vector3();
export const crestPoint = new THREE.Vector3();

export function updateReins() {
  horse.updateMatrixWorld(true);
  reins.forEach((rein, i) => {
    const side = i === 0 ? -1 : 1;
    torso.worldToLocal(bitRings[i].getWorldPosition(reinStart));
    reinEnd.copy(reinAnchors[i]);
    neckSweep.point(0.4, side > 0 ? 0.3 : Math.PI - 0.3, 0.05, crestPoint);
    torso.worldToLocal(neckGroup.localToWorld(crestPoint));
    reinControl.copy(crestPoint);
    const last = rein.points.length - 1;
    rein.points.forEach((point, k) => {
      const t = k / last;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      point.set(
        a * reinStart.x + b * reinControl.x + c * reinEnd.x,
        a * reinStart.y + b * reinControl.y + c * reinEnd.y,
        a * reinStart.z + b * reinControl.z + c * reinEnd.z
      );
    });
    rein.update(rein.points);
  });
}

export function updateBody(dt, elapsed) {
  const activity = gait.activity;
  const [walkW, trotW, gallopW] = gait.weights;
  const cycle = gait.phase * Math.PI * 2;
  const speed = Math.abs(state.speed);

  /* Body carriage: a gentle walk, a springy trot, a rocking gallop */
  const bob = activity * (
    walkW * 0.012 * Math.cos(2 * cycle)
    - trotW * 0.03 * Math.cos(2 * cycle - 2.76)
    + gallopW * 0.05 * Math.sin(cycle - 1.0)
  ) - 0.11 * state.crouch - 0.08 * state.landing;
  const airPitch = clamp(-state.verticalVelocity * 0.03, -0.18, 0.18) * state.air;
  const pitch = activity * (
    walkW * 0.01 * Math.sin(2 * cycle + 0.6)
    + trotW * 0.006 * Math.sin(2 * cycle)
    + gallopW * 0.065 * Math.sin(cycle + 0.4)
  ) + 0.05 * state.crouch + airPitch;
  const roll = activity * (walkW * 0.016 * Math.sin(cycle) + trotW * 0.008 * Math.sin(cycle))
    - clamp(state.yawRate * speed * 0.018, -0.08, 0.08);

  /* Pitch about the barrel rather than the ground beneath it */
  torso.rotation.set(pitch, 0, roll);
  torso.position.set(0, BODY_LIFT + bob + 1.5 * (1 - Math.cos(pitch)), -1.5 * Math.sin(pitch));

  /* Head, neck and ears */
  const idle = 1 - activity;
  const nod = activity * (
    walkW * 0.05 * Math.sin(2 * cycle + 1.2)
    + trotW * 0.012 * Math.sin(2 * cycle)
    + gallopW * 0.1 * Math.sin(cycle + 1.8)
  );
  neckGroup.rotation.x = nod
    + 0.02 * Math.sin(elapsed * 1.1) * idle
    + 0.09 * state.crouch - 0.14 * state.air;
  neckGroup.rotation.y = clamp(state.yawRate * 0.2, -0.24, 0.24) + 0.16 * Math.sin(elapsed * 0.27) * idle;
  headGroup.rotation.x = HEAD_PITCH
    - 0.12 * gallopW * activity
    + 0.025 * Math.sin(elapsed * 1.4 + 1.1) * idle;
  headGroup.rotation.y = -0.05 * Math.sin(elapsed * 0.6) * idle;

  ears.forEach((ear) => {
    const twitch = Math.max(0, Math.sin(elapsed * 2.3 + ear.phase) - 0.94) * 1.4;
    const listen = clamp(state.yawRate * 0.25 * ear.side, -0.25, 0.25);
    ear.group.rotation.x = ear.baseX - 0.2 * gallopW * activity + twitch * 0.4;
    ear.group.rotation.z = ear.baseZ + 0.03 * Math.sin(elapsed * 0.9 + ear.phase) + listen;
  });

  /* Mane and forelock */
  const bounce = activity * (walkW * 0.025 * Math.sin(2 * cycle) + trotW * 0.05 * Math.sin(2 * cycle - 2.76) + gallopW * 0.07 * Math.sin(cycle));
  maneLocks.forEach((lock) => {
    lock.group.rotation.z = lock.side * (
      0.04 * Math.sin(elapsed * 1.8 + lock.phase)
      + bounce * (1 + 0.3 * Math.sin(lock.phase))
      + 0.06 * gallopW * activity
    );
    lock.group.rotation.x = 0.03 * Math.sin(elapsed * 1.3 + lock.phase * 0.7) - 0.05 * speed / 5;
  });
  forelockLocks.forEach((lock) => {
    lock.group.rotation.z = 0.02 * Math.sin(elapsed * 1.6 + lock.phase);
    lock.group.rotation.x = 0.03 * Math.sin(elapsed * 1.9 + lock.phase) - 0.05 * state.air;
  });

  /* Tail: a slow swish when easy, lifted and streaming at speed */
  const stream = clamp((speed - 1) / 4.5, 0, 1);
  const swish = 0.1 * (1 - stream * 0.6);
  tailBones.forEach((bone, k) => {
    const lag = k * 0.55;
    bone.rotation.z = swish * Math.sin(elapsed * 1.5 - lag) * (k === 0 ? 0.5 : 1)
      - clamp(state.yawRate * 0.08, -0.12, 0.12);
    bone.rotation.x = (k === 0 ? 0.08 + 0.5 * stream + 0.3 * state.air : 0.06 * stream + 0.04 * state.air)
      + activity * 0.035 * Math.sin(2 * cycle - lag);
  });
}
