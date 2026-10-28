import * as THREE from "three";
import { clamp, damp, wrapAngle } from "./util.js";
import { CAMERA_AZIMUTH, PLANET_RADIUS, camera, renderer, stage } from "./core.js";
import { MOONLIGHT_DIRECTION, SUN_DIRECTION, hemi, moonLight, placeMoon, skyFrame, stars, sun } from "./sky.js";
import { fadeables } from "./planet.js";
import { horse, torso } from "./horse/body.js";
import { BODY_LIFT, FRAME_HEADING, horseForward, horseUp, previousUp } from "./horse/motion.js";

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export function frameForViewport() {
  const aspect = stage.clientWidth / Math.max(stage.clientHeight, 1);
  if (aspect < 0.7) return { fov: 46, distance: 13.8, moon: [0.08, -0.02] };
  if (aspect < 1.05) return { fov: 42, distance: 12.5, moon: [0.2, 0.0] };
  return { fov: 36, distance: 10.6, moon: [0.22, -0.01] };
}

export const initialFrame = frameForViewport();
placeMoon(initialFrame.moon);
camera.fov = initialFrame.fov;
camera.updateProjectionMatrix();

export const orbit = {
  azimuth: CAMERA_AZIMUTH,
  polar: 1.36,
  distance: initialFrame.distance,
  targetAzimuth: CAMERA_AZIMUTH,
  targetPolar: 1.36,
  targetDistance: initialFrame.distance,
};

export let userZoomed = false;

/* The camera's frame: the horse's (smoothed) up, and a heading carried along the planet with her. */
export const cameraUp = new THREE.Vector3(0, 1, 0);
export const cameraHeading = new THREE.Vector3(0, 0, 1);
export const cameraSide = new THREE.Vector3(1, 0, 0);
export const frameMatrix = new THREE.Matrix4();
export const frameQuaternion = new THREE.Quaternion();
export const transport = new THREE.Quaternion();

export const cameraTarget = new THREE.Vector3().copy(horse.position).addScaledVector(horseUp, 1.3);
export const desiredTarget = new THREE.Vector3();
export const cameraOffset = new THREE.Vector3();
export const lightDirection = new THREE.Vector3();

export let dragging = false;
export let lastPointerX = 0;
export let lastPointerY = 0;
export let activePointer = null;

export const canvas = renderer.domElement;

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  dragging = true;
  activePointer = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  stage.classList.add("is-dragging");
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging || event.pointerId !== activePointer) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;

  orbit.targetAzimuth -= dx * 0.0052;
  orbit.targetPolar = clamp(orbit.targetPolar + dy * 0.0042, 0.3, 1.62);
});

export function endDrag(event) {
  if (event.pointerId !== activePointer) return;
  dragging = false;
  activePointer = null;
  stage.classList.remove("is-dragging");
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    userZoomed = true;
    orbit.targetDistance = clamp(orbit.targetDistance * (1 + event.deltaY * 0.0011), 4.2, 30);
  },
  { passive: false }
);

export function updateCamera(dt) {
  /* Carry the camera's heading along with the horse, then settle its up onto hers */
  transport.setFromUnitVectors(previousUp, horseUp);
  cameraHeading.applyQuaternion(transport);
  cameraUp.lerp(horseUp, 1 - Math.exp(-5 * dt)).normalize();
  cameraHeading.addScaledVector(cameraUp, -cameraHeading.dot(cameraUp)).normalize();
  cameraSide.crossVectors(cameraUp, cameraHeading);
  frameMatrix.makeBasis(cameraSide, cameraUp, cameraHeading);
  frameQuaternion.setFromRotationMatrix(frameMatrix);

  /*
   * Swing the whole frame — camera, sky and moon together — slowly after her heading, so she keeps
   * the angle you left her at and the moon stays over her shoulder while the planet turns beneath.
   */
  const heading = Math.atan2(horseForward.dot(cameraSide), horseForward.dot(cameraHeading));
  cameraHeading.applyAxisAngle(cameraUp, wrapAngle(heading - FRAME_HEADING) * (1 - Math.exp(-0.7 * dt)));
  cameraSide.crossVectors(cameraUp, cameraHeading);
  frameMatrix.makeBasis(cameraSide, cameraUp, cameraHeading);
  frameQuaternion.setFromRotationMatrix(frameMatrix);

  orbit.azimuth = damp(orbit.azimuth, orbit.targetAzimuth, 7, dt);
  orbit.polar = damp(orbit.polar, orbit.targetPolar, 7, dt);
  orbit.distance = damp(orbit.distance, orbit.targetDistance, 6, dt);

  desiredTarget.copy(horse.position).addScaledVector(horseUp, 1.35 + (torso.position.y - BODY_LIFT) * 0.5);
  cameraTarget.lerp(desiredTarget, 1 - Math.exp(-6 * dt));

  const sinPolar = Math.sin(orbit.polar);
  cameraOffset.set(
    Math.sin(orbit.azimuth) * sinPolar,
    Math.cos(orbit.polar),
    Math.cos(orbit.azimuth) * sinPolar
  ).multiplyScalar(orbit.distance).applyQuaternion(frameQuaternion);
  camera.position.copy(cameraTarget).add(cameraOffset);
  if (camera.position.length() < PLANET_RADIUS + 0.8) camera.position.setLength(PLANET_RADIUS + 0.8);
  camera.up.copy(cameraUp);
  camera.lookAt(cameraTarget);

  skyFrame.position.copy(camera.position);
  skyFrame.quaternion.copy(frameQuaternion);

  lightDirection.copy(SUN_DIRECTION).applyQuaternion(frameQuaternion);
  sun.position.copy(horse.position).addScaledVector(lightDirection, 20);
  sun.target.position.copy(horse.position);
  sun.target.updateMatrixWorld();
  lightDirection.copy(MOONLIGHT_DIRECTION).applyQuaternion(frameQuaternion);
  moonLight.position.copy(horse.position).addScaledVector(lightDirection, 20);
  moonLight.target.position.copy(horse.position);
  moonLight.target.updateMatrixWorld();
  hemi.position.copy(cameraUp);
}

export const sightLine = new THREE.Vector3();
export const toScenery = new THREE.Vector3();

/* Does `point` sit within `radius` of the line from the camera to `target`, in front of the target? */
export function blocksView(point, target, radius) {
  sightLine.subVectors(target, camera.position);
  toScenery.subVectors(point, camera.position);
  const along = toScenery.dot(sightLine) / sightLine.lengthSq();
  return along > 0 && along < 0.95 && toScenery.addScaledVector(sightLine, -along).length() < radius;
}

export function updateFades(dt) {
  for (const item of fadeables) {
    const blocking = blocksView(item.center, cameraTarget, item.radius + 0.5)
      || blocksView(item.center, horse.position, item.radius + 0.5);
    item.opacity = damp(item.opacity, blocking ? 0.14 : 1, 7, dt);
    const fading = item.opacity < 0.985;
    for (const material of item.materials) {
      material.opacity = item.opacity;
      if (material.transparent !== fading) {
        material.transparent = fading;
        material.depthWrite = !fading;
        material.needsUpdate = true;
      }
    }
  }
}

export function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const frame = frameForViewport();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = frame.fov;
  camera.updateProjectionMatrix();
  placeMoon(frame.moon);
  stars.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();

  if (!userZoomed) {
    orbit.distance = frame.distance;
    orbit.targetDistance = frame.distance;
  } else {
    orbit.targetDistance = Math.max(orbit.targetDistance, frame.distance * 0.45);
  }
}
