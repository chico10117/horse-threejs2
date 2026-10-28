import * as THREE from "three";

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const stage = document.getElementById("stage");

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

function createRenderer() {
  try {
    return new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    document.querySelector(".loader p").textContent = "This browser could not start WebGL.";
    throw error;
  }
}

export const renderer = createRenderer();

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(37, stage.clientWidth / stage.clientHeight, 0.1, 900);

export const PLANET_RADIUS = 7.4;
export const CAMERA_AZIMUTH = 0.72;
