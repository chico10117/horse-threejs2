import * as THREE from "three";
import { makeGlowTexture, smoothstep } from "./util.js";
import { prefersReducedMotion, scene } from "./core.js";
import { smokeVents } from "./planet.js";

/* ------------------------------------------------------------------ */
/* Dust & smoke                                                        */
/* ------------------------------------------------------------------ */

export const softPuffTexture = makeGlowTexture([
  [0, "rgba(255, 247, 229, 0.9)"],
  [0.45, "rgba(226, 212, 185, 0.45)"],
  [1, "rgba(214, 199, 170, 0)"],
], 64);

export function makePuffPool(count, color) {
  const pool = [];
  for (let i = 0; i < count; i += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softPuffTexture, color, transparent: true, opacity: 0, depthWrite: false })
    );
    sprite.visible = false;
    scene.add(sprite);
    pool.push({ sprite, life: 1, maxLife: 1, velocity: new THREE.Vector3(), size: 0.2, growth: 0.6, opacity: 0.15 });
  }
  return { pool, cursor: 0 };
}

export const particlesEnabled = !prefersReducedMotion;
export const dust = makePuffPool(particlesEnabled ? 30 : 0, 0xe6d7b9);
export const smoke = makePuffPool(particlesEnabled ? 24 : 0, 0xb9b3c9);
export const puffJitter = new THREE.Vector3();

export function emitPuff(system, position, normal, { speed = 0.2, spread = 0.2, size = 0.18, growth = 0.6, life = 1, opacity = 0.15 } = {}) {
  if (!system.pool.length) return;
  const puff = system.pool[system.cursor];
  system.cursor = (system.cursor + 1) % system.pool.length;
  puffJitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread);
  puffJitter.addScaledVector(normal, -puffJitter.dot(normal));
  puff.sprite.position.copy(position).addScaledVector(puffJitter, 0.5);
  puff.velocity.copy(normal).multiplyScalar(speed * (0.8 + Math.random() * 0.5)).add(puffJitter);
  puff.size = size * (0.85 + Math.random() * 0.3);
  puff.growth = growth;
  puff.opacity = opacity;
  puff.life = 0;
  puff.maxLife = life * (0.8 + Math.random() * 0.4);
  puff.sprite.scale.setScalar(puff.size);
  puff.sprite.material.opacity = opacity;
  puff.sprite.visible = true;
}

export function updatePuffs(system, dt) {
  for (const puff of system.pool) {
    if (!puff.sprite.visible) continue;
    puff.life += dt;
    const progress = puff.life / puff.maxLife;
    if (progress >= 1) {
      puff.sprite.visible = false;
      continue;
    }
    puff.sprite.position.addScaledVector(puff.velocity, dt);
    puff.velocity.multiplyScalar(1 - 0.8 * dt);
    puff.sprite.scale.setScalar(puff.size + progress * puff.growth);
    puff.sprite.material.opacity = puff.opacity * (1 - progress) * (1 - progress) * smoothstep(0, 0.12, progress);
  }
}


export function updateSmoke(dt) {
  for (const vent of smokeVents) {
    vent.timer -= dt;
    if (vent.timer <= 0) {
      vent.timer = 0.55 + Math.random() * 0.4;
      emitPuff(smoke, vent.origin, vent.normal, { speed: 0.35, spread: 0.12, size: 0.16, growth: 0.9, life: 3.2, opacity: 0.32 });
    }
  }
}
