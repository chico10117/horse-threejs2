import * as THREE from "three";
/* Import order matters: sky.js and then planet.js draw from the seeded
   random() at load, so this order keeps the planet laid out the same. */
import { camera, renderer, scene } from "./core.js";
import { stars } from "./sky.js";
import "./planet.js";
import { dust, particlesEnabled, smoke, updatePuffs, updateSmoke } from "./effects.js";
import "./geometry.js";
import "./horse/body.js";
import "./horse/legs.js";
import { land, updateBody, updateGait, updateLegs, updateLocomotion, updateReins } from "./horse/motion.js";
import { resize, updateCamera, updateFades } from "./camera.js";
import { updateReadout } from "./ui.js";

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();


function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  updateLocomotion(dt, elapsed);
  updateGait(dt);
  updateBody(dt, elapsed);
  updateLegs();
  updateReins();
  if (particlesEnabled) updateSmoke(dt);
  updatePuffs(dust, dt);
  updatePuffs(smoke, dt);
  updateCamera(dt);
  updateFades(dt);
  updateReadout();
  stars.material.uniforms.uTime.value = elapsed;

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

window.addEventListener("resize", resize);

land();
updateGait(0);
updateLegs();
renderer.setAnimationLoop(animate);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    document.getElementById("loader").setAttribute("aria-hidden", "true");
  });
});
