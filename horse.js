import * as THREE from "three";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = document.getElementById("stage");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, lambda, dt) => target + (current - target) * Math.exp(-lambda * dt);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (value) => value - Math.floor(value);
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const wrapCycle = (value) => value - Math.round(value);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* Seeded, so the little planet is laid out the same way on every visit. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(612);

function randomDirection(out) {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return out.set(ring * Math.cos(angle), z, ring * Math.sin(angle));
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (error) {
  document.querySelector(".loader p").textContent = "This browser could not start WebGL.";
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(37, stage.clientWidth / stage.clientHeight, 0.1, 900);

const PLANET_RADIUS = 7.4;
const CAMERA_AZIMUTH = 0.72;

/* ------------------------------------------------------------------ */
/* Sky, moon & light                                                   */
/* ------------------------------------------------------------------ */

/*
 * The sky hangs on a frame that travels with the horse: y is her local up and z a heading that is
 * carried along the surface as she walks. Wherever she goes on the planet, the low sun stays behind
 * the camera and the full moon rises over her shoulder.
 */
const skyFrame = new THREE.Group();
scene.add(skyFrame);

function skyDirection(azimuth, elevation) {
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  );
}

const SUN_DIRECTION = skyDirection(CAMERA_AZIMUTH - 0.8, 0.36);
/* Set per viewport by placeMoon(), so the moon always lands in the upper right of the frame. */
const MOON_DIRECTION = new THREE.Vector3();
const MOONLIGHT_DIRECTION = skyDirection(CAMERA_AZIMUTH + Math.PI - 0.6, 0.64);

const sky = new THREE.Mesh(
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
function makeStars(count) {
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

const stars = makeStars(1100);
stars.frustumCulled = false;
skyFrame.add(stars);

/* Moon */
function makeGlowTexture(stops, size = 128) {
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

function makeMoonTexture() {
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

const MOON_DISTANCE = 360;

const moonHalo = new THREE.Sprite(
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

const moon = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: makeMoonTexture(), depthWrite: false, toneMapped: false })
);
moon.scale.setScalar(34);
skyFrame.add(moon);

function placeMoon([azimuth, elevation]) {
  MOON_DIRECTION.copy(skyDirection(CAMERA_AZIMUTH + Math.PI - azimuth, elevation));
  moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
  moonHalo.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE + 4);
}

/* Two neighbouring worlds drifting in the distance */
const warmGlowTexture = makeGlowTexture([
  [0, "rgba(255, 220, 150, 0.95)"],
  [0.3, "rgba(255, 190, 110, 0.35)"],
  [1, "rgba(255, 170, 90, 0)"],
]);

function makeLamplighterWorld() {
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

function makeRingedWorld() {
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

const lamplighterWorld = makeLamplighterWorld();
lamplighterWorld.position.copy(skyDirection(CAMERA_AZIMUTH + Math.PI + 0.55, 0.05)).multiplyScalar(150);
lamplighterWorld.rotation.set(0.1, 0, -0.25);
skyFrame.add(lamplighterWorld);

const ringedWorld = makeRingedWorld();
ringedWorld.position.copy(skyDirection(CAMERA_AZIMUTH + Math.PI - 0.7, -0.14)).multiplyScalar(170);
skyFrame.add(ringedWorld);

/* Lights — aimed every frame from the sky frame */
const hemi = new THREE.HemisphereLight(0xa4b6ea, 0x40502f, 1.3);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffc28e, 2.5);
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

const moonLight = new THREE.DirectionalLight(0xaec4ff, 1.35);
scene.add(moonLight, moonLight.target);

/* ------------------------------------------------------------------ */
/* The planet                                                          */
/* ------------------------------------------------------------------ */

/* A little value noise for the meadow colours */
const noisePermutation = new Uint8Array(256);
const noiseValues = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  noisePermutation[i] = i;
  noiseValues[i] = random();
}
for (let i = 255; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [noisePermutation[i], noisePermutation[j]] = [noisePermutation[j], noisePermutation[i]];
}

function lattice(x, y, z) {
  return noiseValues[noisePermutation[(noisePermutation[(noisePermutation[x & 255] + y) & 255] + z) & 255]];
}

function valueNoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const x00 = lerp(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), ux);
  const x10 = lerp(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), ux);
  const x01 = lerp(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), ux);
  const x11 = lerp(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

function fbm(x, y, z) {
  return valueNoise(x, y, z) * 0.5
    + valueNoise(x * 2.03 + 5.1, y * 2.03, z * 2.03) * 0.3
    + valueNoise(x * 4.1, y * 4.1 + 3.3, z * 4.1) * 0.2;
}

/* Places on the planet, measured from where the horse starts: metres along the surface, then a bearing. */
function planetDirection(arc, bearing) {
  const theta = arc / PLANET_RADIUS;
  return new THREE.Vector3(
    Math.sin(theta) * Math.sin(bearing),
    Math.cos(theta),
    Math.sin(theta) * Math.cos(bearing)
  );
}

function placeOnPlanet(object, direction, spin = 0, lift = 0) {
  object.position.copy(direction).multiplyScalar(PLANET_RADIUS + lift);
  object.quaternion.setFromUnitVectors(Y_AXIS, direction);
  object.rotateY(spin);
  return object;
}

const layout = {
  rose: planetDirection(2.6, 4.95),
  volcanoes: [
    { direction: planetDirection(3.5, 3.05), scale: 1, active: true },
    { direction: planetDirection(4.5, 2.45), scale: 0.78, active: true },
    { direction: planetDirection(12.5, 0.5), scale: 0.9, active: false },
  ],
  trees: [
    { direction: planetDirection(6.2, 4.35), scale: 0.85, turn: 0.4 },
    { direction: planetDirection(13.5, 5.5), scale: 0.95, turn: 1.6 },
    { direction: planetDirection(17.5, 3.0), scale: 0.8, turn: 2.4 },
    { direction: planetDirection(9.4, 0.95), scale: 0.72, turn: 0.9 },
  ],
  baobab: planetDirection(9.5, 2.0),
};

/* Everything the horse walks around: a direction on the planet and a radius in metres. */
const obstacles = [];

const planetGeometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, 40);
{
  const position = planetGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const direction = new THREE.Vector3();
  const color = new THREE.Color();
  const meadowDark = new THREE.Color(0x3f7a35);
  const meadow = new THREE.Color(0x62a149);
  const meadowLight = new THREE.Color(0x8cc262);
  const meadowGlow = new THREE.Color(0xb6d77c);
  const ash = new THREE.Color(0x8b7864);

  for (let i = 0; i < position.count; i += 1) {
    direction.fromBufferAttribute(position, i).normalize();
    const broad = fbm(direction.x * 1.7 + 3, direction.y * 1.7, direction.z * 1.7);
    const fine = fbm(direction.x * 5.5, direction.y * 5.5 + 7, direction.z * 5.5);
    color.copy(meadowDark)
      .lerp(meadow, smoothstep(0.32, 0.52, broad))
      .lerp(meadowLight, smoothstep(0.5, 0.72, broad))
      .lerp(meadowGlow, smoothstep(0.6, 0.82, fine) * 0.4);
    for (const volcano of layout.volcanoes) {
      const distance = direction.angleTo(volcano.direction) * PLANET_RADIUS;
      color.lerp(ash, (1 - smoothstep(0.55 * volcano.scale, 1.25 * volcano.scale, distance)) * 0.8);
    }
    colors.set([color.r, color.g, color.b], i * 3);
  }
  planetGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

const planet = new THREE.Mesh(
  planetGeometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
);
planet.receiveShadow = true;
scene.add(planet);

/* A soft halo where the planet meets the sky */
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(PLANET_RADIUS * 1.1, 64, 48),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0x8fa2ef) } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = clamp(-dot(vNormal, vView), 0.0, 1.0);
        float glow = pow(smoothstep(0.0, 0.5, facing), 2.2);
        gl_FragColor = vec4(uColor * glow * 0.24, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
);
scene.add(atmosphere);

/* ------------------------------------------------------------------ */
/* Things that live on the planet                                      */
/* ------------------------------------------------------------------ */

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4930, roughness: 0.96, flatShading: true });
const leafMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x4b8b3b, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x5da046, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 0.94, flatShading: true }),
];
const leafGeometry = new THREE.IcosahedronGeometry(1, 1);

function castAndReceive(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

/* Scenery that fades aside whenever it comes between the camera and the horse */
const fadeables = [];

function makeFadeable(group, direction, radius, height) {
  const clones = new Map();
  group.traverse((child) => {
    if (!child.isMesh) return;
    if (!clones.has(child.material)) clones.set(child.material, child.material.clone());
    child.material = clones.get(child.material);
  });
  fadeables.push({
    materials: [...clones.values()],
    center: direction.clone().multiplyScalar(PLANET_RADIUS + height * 0.5),
    radius,
    opacity: 1,
  });
  return group;
}

function makeTree(spec, index) {
  const group = new THREE.Group();
  const trunkHeight = 2.2 * spec.scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11 * spec.scale, 0.19 * spec.scale, trunkHeight, 7),
    trunkMaterial
  );
  trunk.position.y = trunkHeight / 2;
  group.add(trunk);

  const canopy = new THREE.Group();
  canopy.position.y = trunkHeight + 0.3 * spec.scale;
  const blobs = [
    { p: [0, 0.35, 0], s: [1.28, 1.08, 1.22], m: 0 },
    { p: [-0.72, -0.02, 0.18], s: [0.82, 0.76, 0.84], m: 2 },
    { p: [0.7, 0.08, -0.12], s: [0.9, 0.8, 0.88], m: 1 },
    { p: [0.04, 1.12, 0.02], s: [0.76, 0.68, 0.74], m: 1 },
    { p: [-0.28, 0.8, -0.5], s: [0.62, 0.58, 0.6], m: 0 },
  ];
  blobs.forEach((blob, blobIndex) => {
    const leaves = new THREE.Mesh(leafGeometry, leafMaterials[(blob.m + index) % leafMaterials.length]);
    leaves.position.set(blob.p[0] * spec.scale, blob.p[1] * spec.scale, blob.p[2] * spec.scale);
    leaves.scale.set(blob.s[0] * spec.scale, blob.s[1] * spec.scale, blob.s[2] * spec.scale);
    leaves.rotation.set(blobIndex * 0.4, spec.turn + blobIndex * 1.3, blobIndex * 0.25);
    canopy.add(leaves);
  });
  group.add(canopy);

  scene.add(makeFadeable(castAndReceive(placeOnPlanet(group, spec.direction, spec.turn)), spec.direction, 1.7 * spec.scale, 4 * spec.scale));
  obstacles.push({ direction: spec.direction, radius: 0.5 * spec.scale });
}

layout.trees.forEach(makeTree);

/* A baobab, caught early enough */
{
  const group = new THREE.Group();
  const barkMaterial = new THREE.MeshStandardMaterial({ color: 0x8c7a66, roughness: 0.95, flatShading: true });
  const trunkProfile = [[0.46, 0], [0.52, 0.25], [0.5, 0.7], [0.4, 1.3], [0.28, 1.75], [0.24, 1.95], [0.001, 2.0]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  group.add(new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 9), barkMaterial));

  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const branch = new THREE.Group();
    branch.position.y = 1.85;
    branch.rotation.set(0, angle, 0.75);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 0.7, 6), barkMaterial);
    limb.position.y = 0.32;
    branch.add(limb);
    const crown = new THREE.Mesh(leafGeometry, leafMaterials[i % leafMaterials.length]);
    crown.position.y = 0.72;
    crown.rotation.z = -0.75;
    crown.scale.set(0.62, 0.26, 0.62);
    branch.add(crown);
    group.add(branch);
  }

  scene.add(makeFadeable(castAndReceive(placeOnPlanet(group, layout.baobab, 0.6)), layout.baobab, 1.4, 2.6));
  obstacles.push({ direction: layout.baobab, radius: 0.75 });
}

/* Volcanoes — two warm, one long asleep */
const volcanoMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7466, roughness: 1, flatShading: true });
const craterGlowTexture = makeGlowTexture([
  [0, "rgba(255, 196, 120, 0.95)"],
  [0.35, "rgba(255, 120, 60, 0.4)"],
  [1, "rgba(255, 90, 40, 0)"],
]);
const smokeVents = [];

layout.volcanoes.forEach((spec) => {
  const group = new THREE.Group();
  const profile = [
    [0.72, 0], [0.66, 0.08], [0.52, 0.22], [0.38, 0.38], [0.27, 0.5],
    [0.22, 0.54], [0.17, 0.5], [0.1, 0.44], [0.001, 0.42],
  ].map(([r, y]) => new THREE.Vector2(r * spec.scale, y * spec.scale));
  const cone = new THREE.Mesh(new THREE.LatheGeometry(profile, 11), volcanoMaterial);
  group.add(cone);

  const craterY = 0.43 * spec.scale;
  if (spec.active) {
    const embers = new THREE.Mesh(
      new THREE.CircleGeometry(0.13 * spec.scale, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, toneMapped: false })
    );
    embers.rotation.x = -Math.PI / 2;
    embers.position.y = craterY + 0.01;
    group.add(embers);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: craterGlowTexture, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    glow.position.y = craterY + 0.12 * spec.scale;
    glow.scale.setScalar(0.9 * spec.scale);
    group.add(glow);
  } else {
    const moss = new THREE.Mesh(
      new THREE.CircleGeometry(0.16 * spec.scale, 12),
      new THREE.MeshStandardMaterial({ color: 0x55803f, roughness: 1 })
    );
    moss.rotation.x = -Math.PI / 2;
    moss.position.y = craterY + 0.01;
    group.add(moss);
  }

  scene.add(makeFadeable(castAndReceive(placeOnPlanet(group, spec.direction, spec.scale * 3)), spec.direction, 0.8 * spec.scale, 0.6 * spec.scale));
  obstacles.push({ direction: spec.direction, radius: 0.7 * spec.scale });

  if (spec.active) {
    smokeVents.push({
      origin: spec.direction.clone().multiplyScalar(PLANET_RADIUS + craterY + 0.05),
      normal: spec.direction.clone(),
      timer: random(),
    });
  }
});

/* The rose, under her glass */
{
  const group = new THREE.Group();
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.8 });
  const petalMaterial = new THREE.MeshStandardMaterial({ color: 0xc8243a, roughness: 0.55 });
  const budMaterial = new THREE.MeshStandardMaterial({ color: 0xa81a30, roughness: 0.55 });

  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.015, 0.09, 0),
        new THREE.Vector3(-0.01, 0.18, 0.01),
        new THREE.Vector3(0, 0.25, 0),
      ]),
      12, 0.007, 6
    ),
    stemMaterial
  );
  group.add(stem);

  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(sphereLowGeometry(), stemMaterial);
    leaf.position.set(side * 0.03, 0.1 + side * 0.02, 0);
    leaf.rotation.z = side * -0.9;
    leaf.scale.set(0.012, 0.035, 0.018);
    group.add(leaf);
  }

  const bloom = new THREE.Group();
  bloom.position.y = 0.26;
  const bud = new THREE.Mesh(sphereLowGeometry(), budMaterial);
  bud.scale.set(0.026, 0.034, 0.026);
  bloom.add(bud);
  for (let i = 0; i < 6; i += 1) {
    const petal = new THREE.Mesh(sphereLowGeometry(), petalMaterial);
    const angle = (i / 6) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 0.022, -0.004, Math.sin(angle) * 0.022);
    petal.rotation.set(Math.sin(angle) * 0.5, -angle, Math.cos(angle) * -0.5);
    petal.scale.set(0.03, 0.03, 0.013);
    bloom.add(petal);
  }
  group.add(bloom);

  const glassProfile = [[0.2, 0], [0.2, 0.26], [0.18, 0.34], [0.13, 0.41], [0.06, 0.445], [0.001, 0.45]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const glassMaterial = new THREE.MeshPhongMaterial({
    color: 0xdfeefc,
    specular: 0xffffff,
    shininess: 140,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.LatheGeometry(glassProfile, 40), glassMaterial);
  glass.renderOrder = 2;
  group.add(glass);
  const knob = new THREE.Mesh(sphereLowGeometry(), glassMaterial);
  knob.position.y = 0.47;
  knob.scale.setScalar(0.026);
  group.add(knob);

  stem.castShadow = true;
  bloom.traverse((child) => {
    child.castShadow = true;
  });
  scene.add(placeOnPlanet(group, layout.rose, 0.4));
  obstacles.push({ direction: layout.rose, radius: 0.32 });
}

function sphereLowGeometry() {
  sphereLowGeometry.shared ??= new THREE.SphereGeometry(1, 16, 12);
  return sphereLowGeometry.shared;
}

/* Bushes and stones */
const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x8b8aa0, roughness: 1, flatShading: true });

for (const [arc, bearing, scale] of [[5.1, 2.0, 0.6], [7.6, 5.2, 0.7], [15.5, 1.4, 0.55], [11, 3.9, 0.65]]) {
  const bush = new THREE.Group();
  for (let i = 0; i < 3; i += 1) {
    const leaf = new THREE.Mesh(leafGeometry, leafMaterials[i % leafMaterials.length]);
    leaf.position.set((i - 1) * 0.45 * scale, (0.3 + i * 0.12) * scale, (i % 2) * 0.24 * scale);
    leaf.scale.setScalar((0.58 + i * 0.12) * scale);
    bush.add(leaf);
  }
  const direction = planetDirection(arc, bearing);
  scene.add(makeFadeable(castAndReceive(placeOnPlanet(bush, direction, arc)), direction, 0.9 * scale, 0.8 * scale));
  obstacles.push({ direction, radius: 0.7 * scale });
}

for (let i = 0; i < 9; i += 1) {
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08 + random() * 0.12, 0), stoneMaterial);
  stone.scale.y = 0.6;
  const direction = randomDirection(new THREE.Vector3());
  if (direction.y > 0.9) direction.y = -direction.y;
  scene.add(castAndReceive(placeOnPlanet(stone, direction.normalize(), random() * 6, 0.02)));
}

function clearOfObstacles(direction, margin) {
  for (const obstacle of obstacles) {
    if (direction.angleTo(obstacle.direction) * PLANET_RADIUS < obstacle.radius + margin) return false;
  }
  return true;
}

/* Grass tufts and little flowers all the way around */
const dummy = new THREE.Object3D();
const scatterDirection = new THREE.Vector3();

function scatter(mesh, count, margin, place) {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 4) {
    attempts += 1;
    randomDirection(scatterDirection);
    if (!clearOfObstacles(scatterDirection, margin)) continue;
    placeOnPlanet(dummy, scatterDirection, random() * Math.PI * 2);
    place(dummy, placed);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  mesh.count = placed;
  scene.add(mesh);
}

const bladeGeometry = new THREE.ConeGeometry(0.018, 0.15, 3);
bladeGeometry.translate(0, 0.075, 0);
const blades = new THREE.InstancedMesh(
  bladeGeometry,
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  2600
);
const bladeColor = new THREE.Color();
scatter(blades, 2600, 0.15, (object, index) => {
  object.rotateX((random() - 0.5) * 0.3);
  const height = 0.6 + random() * 0.7;
  object.scale.set(0.7 + random() * 0.7, height, 0.7 + random() * 0.7);
  bladeColor.setHSL(0.26 + random() * 0.04, 0.38 + random() * 0.16, 0.24 + random() * 0.14);
  blades.setColorAt(index, bladeColor);
});
blades.receiveShadow = true;

const flowerHeads = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.045, 0),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
  150
);
const flowerPalette = [0xf6efdf, 0xf3d36b, 0xf0a8b8, 0xb9a6e8, 0xffffff].map((hex) => new THREE.Color(hex));
scatter(flowerHeads, 150, 0.25, (object, index) => {
  object.translateY(0.09 + random() * 0.05);
  object.scale.set(1, 0.6, 1);
  flowerHeads.setColorAt(index, flowerPalette[Math.floor(random() * flowerPalette.length)]);
});

/* ------------------------------------------------------------------ */
/* Dust & smoke                                                        */
/* ------------------------------------------------------------------ */

const softPuffTexture = makeGlowTexture([
  [0, "rgba(255, 247, 229, 0.9)"],
  [0.45, "rgba(226, 212, 185, 0.45)"],
  [1, "rgba(214, 199, 170, 0)"],
], 64);

function makePuffPool(count, color) {
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

const particlesEnabled = !prefersReducedMotion;
const dust = makePuffPool(particlesEnabled ? 30 : 0, 0xe6d7b9);
const smoke = makePuffPool(particlesEnabled ? 24 : 0, 0xb9b3c9);
const puffJitter = new THREE.Vector3();

function emitPuff(system, position, normal, { speed = 0.2, spread = 0.2, size = 0.18, growth = 0.6, life = 1, opacity = 0.15 } = {}) {
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

function updatePuffs(system, dt) {
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

/* ------------------------------------------------------------------ */
/* Geometry helpers for the horse                                      */
/* ------------------------------------------------------------------ */

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/* Smoothly samples evenly spaced keyframes at t in [0, 1]. */
function sampleKeys(keys, t) {
  const last = keys.length - 1;
  const f = clamp(t, 0, 1) * last;
  const i = Math.min(Math.floor(f), last - 1);
  return catmullRom(keys[Math.max(i - 1, 0)], keys[i], keys[i + 1], keys[Math.min(i + 2, last)], f - i);
}

/*
 * A body swept along a curve in the y–z plane with an egg-shaped cross section: `top` and `bottom`
 * are the radii above and below the curve, `rx` the half width. Used for the neck and head, and for
 * anything that has to sit on their surface (mane, blaze, bridle).
 */
function makeSweep(points, section) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const lifted = new THREE.Vector3();

  function radii(t) {
    return { rx: sampleKeys(section.rx, t), top: sampleKeys(section.top, t), bottom: sampleKeys(section.bottom, t) };
  }

  function point(t, angle, lift = 0, out = new THREE.Vector3()) {
    const tt = clamp(t, 0, 1);
    curve.getPointAt(tt, center);
    curve.getTangentAt(tt, tangent);
    normal.crossVectors(tangent, X_AXIS).normalize();
    const s = Math.sin(angle);
    const rx = sampleKeys(section.rx, tt) + lift;
    const ry = sampleKeys(s >= 0 ? section.top : section.bottom, tt) + lift;
    return out.copy(center).addScaledVector(X_AXIS, rx * Math.cos(angle)).addScaledVector(normal, ry * s);
  }

  function surfaceNormal(t, angle, out = new THREE.Vector3()) {
    point(t, angle, 0, out);
    point(t, angle, 0.01, lifted);
    return out.subVectors(lifted, out).normalize();
  }

  function geometry(tubular, radial) {
    const positions = [];
    const indices = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= tubular; i += 1) {
      for (let j = 0; j < radial; j += 1) {
        point(i / tubular, -Math.PI / 2 + (j / radial) * Math.PI * 2, 0, v);
        positions.push(v.x, v.y, v.z);
      }
    }
    for (let i = 0; i < tubular; i += 1) {
      for (let j = 0; j < radial; j += 1) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        indices.push(a, b, c, b, d, c);
      }
    }
    /* Round the two ends off with a fan */
    for (const end of [0, 1]) {
      curve.getPointAt(end, center);
      curve.getTangentAt(end, tangent);
      const r = radii(end);
      center.addScaledVector(tangent, (end ? 1 : -1) * Math.min(r.rx, r.top, r.bottom) * 0.7);
      const tip = positions.length / 3;
      positions.push(center.x, center.y, center.z);
      const ring = end ? tubular * radial : 0;
      for (let j = 0; j < radial; j += 1) {
        const a = ring + j;
        const b = ring + ((j + 1) % radial);
        if (end) indices.push(tip, a, b);
        else indices.push(tip, b, a);
      }
    }
    const result = new THREE.BufferGeometry();
    result.setIndex(indices);
    result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.computeVertexNormals();
    return result;
  }

  /* A thin band painted along the top line of the sweep, e.g. a blaze. */
  function stripGeometry(t0, t1, halfWidthAt, lift, rows = 48, cols = 6) {
    const positions = [];
    const indices = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= rows; i += 1) {
      const t = lerp(t0, t1, i / rows);
      const halfAngle = halfWidthAt(t) / radii(t).rx;
      for (let j = 0; j <= cols; j += 1) {
        point(t, Math.PI / 2 + (j / cols * 2 - 1) * halfAngle, lift, v);
        positions.push(v.x, v.y, v.z);
      }
    }
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        const a = i * (cols + 1) + j;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const result = new THREE.BufferGeometry();
    result.setIndex(indices);
    result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.computeVertexNormals();
    return result;
  }

  return { curve, radii, point, surfaceNormal, geometry, stripGeometry };
}

function tubeGeometry(curve, radiusAt, tubularSegments = 28, radialSegments = 8) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const normals = [];
  const indices = [];
  const point = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments;
    curve.getPointAt(t, point);
    const radius = typeof radiusAt === "function" ? radiusAt(t) : radiusAt;
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const nx = Math.cos(v) * normal.x + Math.sin(v) * binormal.x;
      const ny = Math.cos(v) * normal.y + Math.sin(v) * binormal.y;
      const nz = Math.cos(v) * normal.z + Math.sin(v) * binormal.z;
      positions.push(point.x + radius * nx, point.y + radius * ny, point.z + radius * nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let i = 0; i < tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/* A flat, slightly cupped lock of hair. `outwardAt(t, out)` says which way the lock faces. */
function hairRibbonGeometry(curve, outwardAt, widthStart, widthEnd, segments = 18) {
  const positions = [];
  const indices = [];
  const across = [-0.5, 0, 0.5];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const widthDir = new THREE.Vector3();

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    outwardAt(t, outward);
    widthDir.crossVectors(tangent, outward);
    if (widthDir.lengthSq() < 1e-6) widthDir.set(0, 0, 1);
    widthDir.normalize();
    const width = lerp(widthStart, widthEnd, t);
    for (let k = 0; k < across.length; k += 1) {
      const cup = k === 1 ? 0.006 : 0;
      positions.push(
        point.x + widthDir.x * width * across[k] + outward.x * cup,
        point.y + widthDir.y * width * across[k] + outward.y * cup,
        point.z + widthDir.z * width * across[k] + outward.z * cup
      );
    }
  }

  for (let i = 0; i < segments; i += 1) {
    for (let k = 0; k < 2; k += 1) {
      const a = i * 3 + k;
      const b = a + 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/* A limb segment hanging from y = 0 down to y = -length, shaped by evenly spaced radii. */
function limbGeometry(length, radii, from = 0, to = 1, flatten = 0.86) {
  const points = [];
  const steps = 14;
  for (let i = steps; i >= 0; i -= 1) {
    const t = lerp(from, to, i / steps);
    points.push(new THREE.Vector2(Math.max(0.002, sampleKeys(radii, t)), -t * length));
  }
  const geometry = new THREE.LatheGeometry(points, 20);
  geometry.scale(flatten, 1, 1);
  return geometry;
}

function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    positions.set(geometry.attributes.position.array, vertexOffset * 3);
    normals.set(geometry.attributes.normal.array, vertexOffset * 3);
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 1) indices[indexOffset + i] = index[i] + vertexOffset;
    vertexOffset += geometry.attributes.position.count;
    indexOffset += index.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return merged;
}

/* A tube whose path is rewritten every frame (the reins). */
function makeDynamicTube(segments, radial, radius, material) {
  const count = (segments + 1) * radial;
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const normals = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  normals.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("normal", normals);
  const indices = [];
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      indices.push(a, a + radial, b, b, a + radial, b + radial);
    }
  }
  geometry.setIndex(indices);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;

  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const binormal = new THREE.Vector3();
  const offset = new THREE.Vector3();

  function update(points) {
    normal.set(0, 1, 0);
    for (let i = 0; i <= segments; i += 1) {
      const prev = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, segments)];
      tangent.subVectors(next, prev).normalize();
      normal.addScaledVector(tangent, -normal.dot(tangent));
      if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
      normal.normalize();
      binormal.crossVectors(tangent, normal);
      for (let j = 0; j < radial; j += 1) {
        const angle = (j / radial) * Math.PI * 2;
        offset.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
        const k = i * radial + j;
        normals.setXYZ(k, offset.x, offset.y, offset.z);
        positions.setXYZ(
          k,
          points[i].x + offset.x * radius,
          points[i].y + offset.y * radius,
          points[i].z + offset.z * radius
        );
      }
    }
    positions.needsUpdate = true;
    normals.needsUpdate = true;
  }

  return { mesh, update };
}

/* ------------------------------------------------------------------ */
/* Horse                                                               */
/* ------------------------------------------------------------------ */

/* Chestnut with a moon-white mane, a blaze and four white stockings. */
const coatMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x8c3d1c,
  roughness: 0.55,
  metalness: 0,
  sheen: 0.6,
  sheenColor: new THREE.Color(0xffb27e),
  sheenRoughness: 0.45,
});
const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ebdd, roughness: 0.72 });
const blazeMaterial = new THREE.MeshStandardMaterial({
  color: 0xf4eee2,
  roughness: 0.72,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const maneMaterial = new THREE.MeshStandardMaterial({ color: 0xf5efe3, roughness: 0.78, side: THREE.DoubleSide });
const maneMidMaterial = new THREE.MeshStandardMaterial({ color: 0xe4dac8, roughness: 0.82, side: THREE.DoubleSide });
const maneShadeMaterial = new THREE.MeshStandardMaterial({ color: 0xcbbfa9, roughness: 0.86, side: THREE.DoubleSide });
const hoofMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a31, roughness: 0.45 });
const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x1a110b, roughness: 0.12, metalness: 0.1 });
const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xfff8ec });
const nostrilMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2a22, roughness: 0.9 });
const innerEarMaterial = new THREE.MeshStandardMaterial({ color: 0x5e3322, roughness: 0.9 });
const leatherMaterial = new THREE.MeshStandardMaterial({ color: 0x4f2d19, roughness: 0.62 });
const darkLeatherMaterial = new THREE.MeshStandardMaterial({ color: 0x33200f, roughness: 0.66 });
const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xd2a955, roughness: 0.32, metalness: 0.65 });
const blanketMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5b8c, roughness: 0.86 });
const blanketTrimMaterial = new THREE.MeshStandardMaterial({ color: 0xe6c26d, roughness: 0.6 });

const sphereGeometry = new THREE.SphereGeometry(1, 40, 28);

const horse = new THREE.Group();
scene.add(horse);

const torso = new THREE.Group();
horse.add(torso);

function ellipsoid(parent, material, position, scale, castShadow = true) {
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addMesh(parent, geometry, material, castShadow = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/* The barrel: one smooth surface so the chest, back and rump flow together. */
function torsoShape(x, y, z, out) {
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
const torsoScratch = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

function torsoBase(zc, beta, out) {
  const ring = Math.sqrt(Math.max(0, 1 - zc * zc));
  return torsoShape(ring * Math.sin(beta), ring * Math.cos(beta), zc, out);
}

function torsoSurface(zc, beta, lift, out = new THREE.Vector3()) {
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
function torsoPadGeometry({ z0, z1, b0, b1, lift, wall = null, segZ = 16, segB = 28 }) {
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

const reinAnchors = [-1, 1].map((side) => torsoSurface(0.3, side * 0.24, 0.07));

/* Neck */
const neckGroup = new THREE.Group();
neckGroup.position.set(0, 1.64, 0.6);
torso.add(neckGroup);

const neckSweep = makeSweep(
  [[0, -0.14, -0.12], [0, 0.14, 0.12], [0, 0.44, 0.33], [0, 0.69, 0.47], [0, 0.84, 0.54]],
  {
    rx: [0.3, 0.235, 0.185, 0.155, 0.135, 0.125],
    top: [0.31, 0.265, 0.215, 0.18, 0.15, 0.13],
    bottom: [0.36, 0.28, 0.205, 0.165, 0.15, 0.15],
  }
);
addMesh(neckGroup, neckSweep.geometry(40, 36), coatMaterial);

/* Head — long face, round jowl, soft muzzle */
const HEAD_PITCH = 0.95;
const headGroup = new THREE.Group();
headGroup.position.set(0, 0.86, 0.56);
headGroup.rotation.x = HEAD_PITCH;
neckGroup.add(headGroup);

const headSweep = makeSweep(
  [[0, 0.05, -0.11], [0, 0.01, 0.1], [0, -0.03, 0.3], [0, -0.06, 0.47], [0, -0.07, 0.6]],
  {
    rx: [0.08, 0.135, 0.155, 0.15, 0.128, 0.11, 0.1, 0.094, 0.07],
    top: [0.07, 0.105, 0.12, 0.112, 0.098, 0.088, 0.08, 0.074, 0.055],
    bottom: [0.09, 0.165, 0.21, 0.19, 0.145, 0.118, 0.106, 0.096, 0.065],
  }
);
addMesh(headGroup, headSweep.geometry(44, 48), coatMaterial);

/* The blaze: a star on the brow running down to a wide snip over the nose */
const BLAZE = [[0.1, 0.0], [0.15, 0.03], [0.21, 0.045], [0.27, 0.03], [0.36, 0.018], [0.55, 0.017], [0.7, 0.021], [0.82, 0.032], [0.92, 0.045], [0.99, 0.04]];
function blazeHalfWidth(t) {
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

const headScratch = new THREE.Vector3();
const headNormal = new THREE.Vector3();

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
const ears = [];
const earGeometry = new THREE.ConeGeometry(0.058, 0.18, 14);
earGeometry.translate(0, 0.09, 0);
const innerEarGeometry = new THREE.ConeGeometry(0.036, 0.13, 12);
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
function strapAlong(sweep, samples, lift, radius, material, parent, closed = false) {
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

const bitRings = [-1, 1].map((side) => {
  const ring = addMesh(headGroup, new THREE.TorusGeometry(0.03, 0.007, 8, 18), brassMaterial);
  ring.position.copy(headSweep.point(0.82, side > 0 ? -0.3 : Math.PI + 0.3, 0.014));
  ring.rotation.y = Math.PI / 2;
  return ring;
});

/* Mane — a moon-white crest with long locks falling over the near (left) side */
const maneLocks = [];
const forelockLocks = [];
const maneOutward = new THREE.Vector3();

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

function addHairLock(sweep, parent, path, widths, material, list, phase) {
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

const manePalette = [maneMaterial, maneMidMaterial, maneMaterial, maneShadeMaterial, maneMaterial];

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
const TAIL_BONES = 6;
const tailGroup = new THREE.Group();
tailGroup.position.set(0, 1.7, -0.8);
torso.add(tailGroup);

const tailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, -0.06, -0.16),
  new THREE.Vector3(0, -0.3, -0.29),
  new THREE.Vector3(0, -0.72, -0.3),
  new THREE.Vector3(0, -1.16, -0.24),
]);

const tailBones = [];
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
const tailSkeleton = new THREE.Skeleton(tailBones);

function skinToTail(geometry) {
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

function tailStrandCurve(ox, oz, length) {
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
const reins = [-1, 1].map(() => {
  const tube = makeDynamicTube(24, 6, 0.008, darkLeatherMaterial);
  torso.add(tube.mesh);
  return { ...tube, points: Array.from({ length: 25 }, () => new THREE.Vector3()) };
});

/* Legs — jointed chains solved with a little inverse kinematics so the hooves stay planted */
const FRONT_LEG = { upper: 0.42, middle: 0.49, cannon: 0.36 };
const HIND_LEG = { upper: 0.48, middle: 0.6, cannon: 0.44 };
const PASTERN_LENGTH = 0.13;
const PASTERN_SLOPE = 0.52;
const HOOF_HEIGHT = 0.1;
const HOOF_TOE = 0.115;

const hoofGeometry = new THREE.CylinderGeometry(0.062, 0.078, HOOF_HEIGHT, 20, 2);
{
  hoofGeometry.translate(0, -HOOF_HEIGHT / 2, 0);
  const position = hoofGeometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    position.setZ(i, (position.getZ(i) + (y + HOOF_HEIGHT) * -0.32 + 0.032) * 1.12);
  }
  hoofGeometry.computeVertexNormals();
}

const FRONT_RADII = {
  forearm: [0.122, 0.122, 0.11, 0.09, 0.074, 0.068],
  cannon: [0.06, 0.054, 0.052, 0.053, 0.058, 0.064],
};
const HIND_RADII = {
  gaskin: [0.132, 0.136, 0.12, 0.098, 0.078, 0.07],
  cannon: [0.062, 0.056, 0.054, 0.054, 0.059, 0.065],
};
const PASTERN_RADII = [0.056, 0.05, 0.049, 0.053, 0.06];
const SOCK_LINE = 0.34;

function addLowerLeg(parent, cannonLength, cannonRadii) {
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

const legs = [];

function makeLeg({ key, side, front, index }) {
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
const twoBone = { upper: 0, lower: 0 };

function solveTwoBone(sz, sy, tz, ty, upperLength, lowerLength, jointBack) {
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
function solveLegPose(leg, toe, rho, slope, flex, out) {
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

function applyLegPose(leg, pose) {
  leg.root.rotation.z = pose[0];
  leg.root.position.z = leg.pivot.z + pose[1];
  leg.root.rotation.x = pose[2];
  leg.joints[0].rotation.x = pose[3];
  leg.joints[1].rotation.x = pose[4];
  leg.joints[2].rotation.x = pose[5];
  leg.joints[3].rotation.x = pose[6];
}

/* ------------------------------------------------------------------ */
/* State & motion                                                      */
/* ------------------------------------------------------------------ */

const state = {
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

const GRAVITY = 15;
const BODY_LIFT = 0.08;
const JUMP_VELOCITY = 5.4;
const HORSE_RADIUS = 0.85;

/* Where she stands on the planet: local up, and the way she faces. */
const horseUp = new THREE.Vector3(0, 1, 0);
const FRAME_HEADING = -0.27;
const horseForward = new THREE.Vector3(Math.sin(FRAME_HEADING), 0, Math.cos(FRAME_HEADING));
const horseSide = new THREE.Vector3();
const previousUp = new THREE.Vector3(0, 1, 0);
const basis = new THREE.Matrix4();
const horseInverse = new THREE.Matrix4();
const torsoInverse = new THREE.Matrix4();
const moveRotation = new THREE.Quaternion();

function placeHorse() {
  horseSide.crossVectors(horseUp, horseForward).normalize();
  horse.position.copy(horseUp).multiplyScalar(PLANET_RADIUS + state.height);
  basis.makeBasis(horseSide, horseUp, horseForward);
  horse.quaternion.setFromRotationMatrix(basis);
  horse.updateMatrixWorld(true);
}

placeHorse();
horseInverse.copy(horse.matrixWorld).invert();

/* Gaits, in leg order LH, LF, RH, RF. Offsets are fractions of a stride. */
const GAITS = [
  { name: "walk", duty: 0.62, offsets: [0, 0.25, 0.5, 0.75], flex: 1, breakover: 0.75 },
  { name: "trot", duty: 0.44, offsets: [0, 0.5, 0.5, 0], flex: 1.3, breakover: 0.9 },
  { name: "gallop", duty: 0.34, offsets: [0, 0.38, 0.1, 0.5], flex: 1.5, breakover: 1.0 },
];

const gait = {
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

function gallopSpeed() {
  return Math.max(5.4, state.cruise * 1.7);
}

function requestJump() {
  if (state.jump !== "ground") return;
  state.jump = "crouch";
  state.jumpTimer = 0.14;
}

const pressed = new Set();

const cruiseLabel = document.getElementById("paceValue");
const paceInput = document.getElementById("paceInput");
const paceOutput = document.getElementById("paceOutput");
const gaitValue = document.getElementById("gaitValue");
const wanderButton = document.getElementById("wanderButton");
const soundButton = document.getElementById("soundButton");
const gallopButton = document.getElementById("gallopButton");
const themeAudio = document.getElementById("themeAudio");
themeAudio.volume = 0.42;

function syncMusicState() {
  const playing = !themeAudio.paused;
  soundButton.setAttribute("aria-pressed", String(playing));
  soundButton.setAttribute("aria-label", playing ? "Pause music" : "Play music");
}

soundButton.addEventListener("click", async () => {
  if (!themeAudio.paused) {
    themeAudio.pause();
    return;
  }

  try {
    await themeAudio.play();
  } catch {
    syncMusicState();
  }
});

themeAudio.addEventListener("play", syncMusicState);
themeAudio.addEventListener("pause", syncMusicState);
syncMusicState();

function updatePaceFill() {
  const min = Number(paceInput.min);
  const max = Number(paceInput.max);
  const fill = ((Number(paceInput.value) - min) / (max - min)) * 100;
  paceInput.style.setProperty("--fill", `${fill}%`);
}

function setAuto(enabled) {
  state.auto = enabled;
  wanderButton.setAttribute("aria-pressed", String(enabled));
}

wanderButton.setAttribute("aria-pressed", String(state.auto));

wanderButton.addEventListener("click", () => {
  setAuto(!state.auto);
});

/* Gallop without holding Shift */
function setGallop(enabled) {
  state.gallop = enabled;
  gallopButton.setAttribute("aria-pressed", String(enabled));
}

gallopButton.addEventListener("click", () => {
  setGallop(!state.gallop);
});

paceInput.value = String(state.cruise);
paceOutput.textContent = state.cruise.toFixed(1);
paceInput.addEventListener("input", () => {
  state.cruise = Number(paceInput.value);
  paceOutput.textContent = state.cruise.toFixed(1);
  updatePaceFill();
});
updatePaceFill();

function isTextEntry(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

window.addEventListener("keydown", (event) => {
  if (isTextEntry(event.target)) return;

  if (event.code === "Space") {
    if (event.target instanceof Element && event.target.closest("button, a[href]")) return;
    event.preventDefault();
    if (!event.repeat) requestJump();
    return;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    pressed.add(event.code);
    return;
  }

  const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!movementKeys.includes(event.code)) return;

  event.preventDefault();
  setAuto(false);
  pressed.add(event.code);
});

for (const control of [wanderButton, gallopButton, soundButton, paceInput]) {
  control.addEventListener("pointerup", (event) => {
    if (event.detail > 0) control.blur();
  });
}

window.addEventListener("keyup", (event) => {
  pressed.delete(event.code);
});

window.addEventListener("blur", () => pressed.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pressed.clear();
});

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function frameForViewport() {
  const aspect = stage.clientWidth / Math.max(stage.clientHeight, 1);
  if (aspect < 0.7) return { fov: 46, distance: 13.8, moon: [0.08, -0.02] };
  if (aspect < 1.05) return { fov: 42, distance: 12.5, moon: [0.2, 0.0] };
  return { fov: 36, distance: 10.6, moon: [0.22, -0.01] };
}

const initialFrame = frameForViewport();
placeMoon(initialFrame.moon);
camera.fov = initialFrame.fov;
camera.updateProjectionMatrix();

const orbit = {
  azimuth: CAMERA_AZIMUTH,
  polar: 1.36,
  distance: initialFrame.distance,
  targetAzimuth: CAMERA_AZIMUTH,
  targetPolar: 1.36,
  targetDistance: initialFrame.distance,
};

let userZoomed = false;

/* The camera's frame: the horse's (smoothed) up, and a heading carried along the planet with her. */
const cameraUp = new THREE.Vector3(0, 1, 0);
const cameraHeading = new THREE.Vector3(0, 0, 1);
const cameraSide = new THREE.Vector3(1, 0, 0);
const frameMatrix = new THREE.Matrix4();
const frameQuaternion = new THREE.Quaternion();
const transport = new THREE.Quaternion();

const cameraTarget = new THREE.Vector3().copy(horse.position).addScaledVector(horseUp, 1.3);
const desiredTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const lightDirection = new THREE.Vector3();

let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let activePointer = null;

const canvas = renderer.domElement;

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

function endDrag(event) {
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

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let gaitText = "";
let paceText = "";

const toObstacle = new THREE.Vector3();
const pushAxis = new THREE.Vector3();
const pushRotation = new THREE.Quaternion();

function avoidObstacles() {
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

function resolveCollisions() {
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

function updateLocomotion(dt, elapsed) {
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

const toeScratch = new THREE.Vector3();
const toeTorso = new THREE.Vector3();
const landingPose = new Float32Array(7);
const plantWorld = new THREE.Vector3();
const plantNormal = new THREE.Vector3();

function groundHeight(x, z) {
  return -(PLANET_RADIUS + state.height) + Math.sqrt(Math.max(0, PLANET_RADIUS ** 2 - x * x - z * z));
}

/* Solve for a toe given in the horse's frame; the hoof meets the curved ground flat. */
function solveFromHorse(leg, toe, rhoOnGround, slope, flex, out) {
  const tilt = Math.atan2(toe.z, toe.y + PLANET_RADIUS + state.height);
  toeTorso.copy(toe).applyMatrix4(torsoInverse);
  return solveLegPose(leg, toeTorso, rhoOnGround + tilt - torso.rotation.x, slope, flex, out);
}

function plantAt(leg, toe) {
  leg.plant.copy(toe).applyMatrix4(horse.matrixWorld).setLength(PLANET_RADIUS);
}

function land() {
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

function updateGait(dt) {
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

function updateLegs() {
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

const reinControl = new THREE.Vector3();
const reinStart = new THREE.Vector3();
const reinEnd = new THREE.Vector3();
const crestPoint = new THREE.Vector3();

function updateReins() {
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

function updateBody(dt, elapsed) {
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

function updateCamera(dt) {
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

function updateSmoke(dt) {
  for (const vent of smokeVents) {
    vent.timer -= dt;
    if (vent.timer <= 0) {
      vent.timer = 0.55 + Math.random() * 0.4;
      emitPuff(smoke, vent.origin, vent.normal, { speed: 0.35, spread: 0.12, size: 0.16, growth: 0.9, life: 3.2, opacity: 0.32 });
    }
  }
}

const sightLine = new THREE.Vector3();
const toScenery = new THREE.Vector3();

/* Does `point` sit within `radius` of the line from the camera to `target`, in front of the target? */
function blocksView(point, target, radius) {
  sightLine.subVectors(target, camera.position);
  toScenery.subVectors(point, camera.position);
  const along = toScenery.dot(sightLine) / sightLine.lengthSq();
  return along > 0 && along < 0.95 && toScenery.addScaledVector(sightLine, -along).length() < radius;
}

function updateFades(dt) {
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

function updateReadout() {
  const speed = Math.abs(state.speed);
  const nextGait = state.jump === "air"
    ? "jump"
    : speed < 0.12
      ? "standing"
      : state.speed < 0
        ? "backing"
        : GAITS[gait.dominant].name;
  if (nextGait !== gaitText) {
    gaitText = nextGait;
    gaitValue.textContent = nextGait;
  }
  const nextPace = speed.toFixed(1);
  if (nextPace !== paceText) {
    paceText = nextPace;
    cruiseLabel.textContent = nextPace;
  }
}

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

function resize() {
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
