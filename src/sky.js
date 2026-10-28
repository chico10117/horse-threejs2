import * as THREE from "three";
import { makeGlowTexture, random, randomDirection } from "./util.js";
import { CAMERA_AZIMUTH, prefersReducedMotion, renderer, scene } from "./core.js";

/* ------------------------------------------------------------------ */
/* Sky, moon & light                                                   */
/* ------------------------------------------------------------------ */

/*
 * The sky hangs on a frame that travels with the horse: y is her local up and z a heading that is
 * carried along the surface as she walks. Wherever she goes on the planet, the low sun stays behind
 * the camera and the full moon rises over her shoulder.
 */
export const skyFrame = new THREE.Group();
scene.add(skyFrame);

export function skyDirection(azimuth, elevation) {
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  );
}

export const SUN_DIRECTION = skyDirection(CAMERA_AZIMUTH - 0.8, 0.36);
/* Set per viewport by placeMoon(), so the moon always lands in the upper right of the frame. */
export const MOON_DIRECTION = new THREE.Vector3();
export const MOONLIGHT_DIRECTION = skyDirection(CAMERA_AZIMUTH + Math.PI - 0.6, 0.64);

export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 48, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x0a1331) },
      uHigh: { value: new THREE.Color(0x1b3066) },
      uLow: { value: new THREE.Color(0x3a4684) },
      uSunColor: { value: new THREE.Color(0xff9a64) },
      uSunDir: { value: SUN_DIRECTION },
      uMoonColor: { value: new THREE.Color(0xc9d8ff) },
      uMoonDir: { value: MOON_DIRECTION },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHigh;
      uniform vec3 uLow;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uMoonColor;
      uniform vec3 uMoonDir;
      varying vec3 vDir;

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 color = mix(uLow, uHigh, smoothstep(-0.55, 0.2, h));
        color = mix(color, uZenith, smoothstep(0.2, 0.95, h));

        float sun = max(dot(dir, uSunDir), 0.0);
        color += uSunColor * (pow(sun, 3.0) * 0.32 + pow(sun, 18.0) * 0.45 + pow(sun, 420.0) * 1.6);

        float moon = max(dot(dir, uMoonDir), 0.0);
        color += uMoonColor * (pow(moon, 10.0) * 0.1 + pow(moon, 80.0) * 0.18);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
);
sky.renderOrder = -10;
sky.frustumCulled = false;
skyFrame.add(sky);

/* Stars */
export function makeStars(count) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const direction = new THREE.Vector3();
  const tint = new THREE.Color();
  const palette = [0xffffff, 0xfff1d6, 0xdfe8ff, 0xffe2c4];

  for (let i = 0; i < count; i += 1) {
    randomDirection(direction).multiplyScalar(380);
    positions.set([direction.x, direction.y, direction.z], i * 3);
    sizes[i] = 1.1 + Math.pow(random(), 3) * 2.6;
    phases[i] = random();
    tint.setHex(palette[Math.floor(random() * palette.length)]);
    tints.set([tint.r, tint.g, tint.b], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute("starColor", new THREE.Float32BufferAttribute(tints, 3));

  return new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uSunDir: { value: SUN_DIRECTION },
        uTwinkle: { value: prefersReducedMotion ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float phase;
        attribute vec3 starColor;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uTwinkle;
        uniform vec3 uSunDir;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vec3 dir = normalize(position);
          float twinkle = 1.0 - uTwinkle * 0.35 * (0.5 + 0.5 * sin(uTime * (0.7 + phase * 1.6) + phase * 6.2831));
          float sunFade = 1.0 - smoothstep(0.25, 0.85, dot(dir, uSunDir));
          vAlpha = twinkle * sunFade;
          vColor = starColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          float alpha = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(vColor, alpha * alpha * vAlpha);
          #include <colorspace_fragment>
        }
      `,
    })
  );
}

export const stars = makeStars(1100);
stars.frustumCulled = false;
skyFrame.add(stars);

/* Moon */


export function makeMoonTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  const r = size * 0.48;

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();

  const base = ctx.createRadialGradient(c - r * 0.2, c - r * 0.25, r * 0.1, c, c, r);
  base.addColorStop(0, "#fffaf0");
  base.addColorStop(0.75, "#f1eadb");
  base.addColorStop(1, "#ddd5c4");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  /* Soft grey seas */
  const seas = [
    [-0.3, -0.2, 0.3], [0.02, -0.34, 0.2], [0.22, -0.06, 0.26],
    [-0.08, 0.14, 0.2], [0.32, 0.3, 0.15], [-0.36, 0.28, 0.14],
  ];
  for (const [sx, sy, sr] of seas) {
    for (let k = 0; k < 8; k += 1) {
      const x = c + (sx + (random() - 0.5) * sr * 0.8) * r;
      const y = c + (sy + (random() - 0.5) * sr * 0.8) * r;
      const radius = sr * r * (0.45 + random() * 0.5);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(150, 147, 142, 0.2)");
      gradient.addColorStop(1, "rgba(150, 147, 142, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
  }

  /* Craters */
  for (let i = 0; i < 60; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * r * 0.9;
    const x = c + Math.cos(angle) * distance;
    const y = c + Math.sin(angle) * distance;
    const radius = 3 + Math.pow(random(), 2.5) * 20;
    ctx.fillStyle = "rgba(140, 134, 124, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 252, 242, 0.32)";
    ctx.lineWidth = Math.max(1, radius * 0.18);
    ctx.beginPath();
    ctx.arc(x - radius * 0.12, y - radius * 0.12, radius, Math.PI * 0.9, Math.PI * 1.9);
    ctx.stroke();
  }

  const limb = ctx.createRadialGradient(c, c, r * 0.55, c, c, r);
  limb.addColorStop(0, "rgba(110, 104, 96, 0)");
  limb.addColorStop(1, "rgba(110, 104, 96, 0.32)");
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const MOON_DISTANCE = 360;

export const moonHalo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture([
      [0, "rgba(214, 226, 255, 0.85)"],
      [0.22, "rgba(190, 206, 255, 0.28)"],
      [1, "rgba(160, 180, 255, 0)"],
    ]),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.6,
  })
);
moonHalo.scale.setScalar(130);
skyFrame.add(moonHalo);

export const moon = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: makeMoonTexture(), depthWrite: false, toneMapped: false })
);
moon.scale.setScalar(34);
skyFrame.add(moon);

export function placeMoon([azimuth, elevation]) {
  MOON_DIRECTION.copy(skyDirection(CAMERA_AZIMUTH + Math.PI - azimuth, elevation));
  moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
  moonHalo.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE + 4);
}

/* Two neighbouring worlds drifting in the distance */
export const warmGlowTexture = makeGlowTexture([
  [0, "rgba(255, 220, 150, 0.95)"],
  [0.3, "rgba(255, 190, 110, 0.35)"],
  [1, "rgba(255, 170, 90, 0)"],
]);

export function makeLamplighterWorld() {
  const group = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: 0x9a8fb8, roughness: 0.95, flatShading: true });
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(3, 2), rock));

  const ironMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2a33, roughness: 0.6 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.5, 6), ironMaterial);
  post.position.y = 4.1;
  group.add(post);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false })
  );
  lamp.position.y = 5.45;
  group.add(lamp);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: warmGlowTexture, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  glow.position.y = 5.45;
  glow.scale.setScalar(4.2);
  group.add(glow);
  return group;
}

export function makeRingedWorld() {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.4, 3),
      new THREE.MeshStandardMaterial({ color: 0xd9a1b4, roughness: 0.9, flatShading: true })
    )
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.3, 4.7, 56),
    new THREE.MeshStandardMaterial({ color: 0xf1ddbd, roughness: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.set(-Math.PI / 2 + 0.38, 0, 0.3);
  group.add(ring);
  return group;
}

export const lamplighterWorld = makeLamplighterWorld();
lamplighterWorld.position.copy(skyDirection(CAMERA_AZIMUTH + Math.PI + 0.55, 0.05)).multiplyScalar(150);
lamplighterWorld.rotation.set(0.1, 0, -0.25);
skyFrame.add(lamplighterWorld);

export const ringedWorld = makeRingedWorld();
ringedWorld.position.copy(skyDirection(CAMERA_AZIMUTH + Math.PI - 0.7, -0.14)).multiplyScalar(170);
skyFrame.add(ringedWorld);

/* Lights — aimed every frame from the sky frame */
export const hemi = new THREE.HemisphereLight(0xa4b6ea, 0x40502f, 1.3);
scene.add(hemi);

export const sun = new THREE.DirectionalLight(0xffc28e, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

export const moonLight = new THREE.DirectionalLight(0xaec4ff, 1.35);
scene.add(moonLight, moonLight.target);
