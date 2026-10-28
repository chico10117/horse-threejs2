import * as THREE from "three";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = document.getElementById("stage");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, lambda, dt) => target + (current - target) * Math.exp(-lambda * dt);
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

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
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd8e9cf, 32, 92);

const camera = new THREE.PerspectiveCamera(37, stage.clientWidth / stage.clientHeight, 0.1, 220);

/* ------------------------------------------------------------------ */
/* Sky & light                                                         */
/* ------------------------------------------------------------------ */

const sunDirection = new THREE.Vector3(8, 12, 5).normalize();

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(120, 40, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x8ec5e6) },
      uHorizon: { value: new THREE.Color(0xdcefd9) },
      uLow: { value: new THREE.Color(0xc2dcb4) },
      uSunColor: { value: new THREE.Color(0xffefc4) },
      uSunDir: { value: sunDirection.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = normalize(world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uLow;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      varying vec3 vDir;

      void main() {
        float h = vDir.y;
        float high = smoothstep(-0.02, 0.55, h);
        vec3 color = mix(uHorizon, uTop, high);
        color = mix(uLow, color, smoothstep(-0.22, 0.0, h));

        float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        color += uSunColor * (pow(sun, 12.0) * 0.16 + pow(sun, 120.0) * 0.28);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
);
sky.frustumCulled = false;
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xe9f6ff, 0x6e6d50, 1.18);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0d4, 2.3);
sun.position.copy(sunDirection).multiplyScalar(16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9;
sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(sun.target);

const rim = new THREE.DirectionalLight(0xc4dceb, 0.7);
rim.position.set(-7, 5, -9);
scene.add(rim);

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

function makeGroundTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#79b15a";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 160; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 30 + Math.random() * 150;
    const light = Math.random() > 0.5;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, light ? "rgba(178, 218, 132, 0.13)" : "rgba(59, 112, 47, 0.1)");
    gradient.addColorStop(1, "rgba(121, 177, 90, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 15000; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const light = Math.random();
    ctx.fillStyle = light > 0.55
      ? `rgba(190, 224, 137, ${0.05 + Math.random() * 0.12})`
      : `rgba(45, 94, 38, ${0.04 + Math.random() * 0.1})`;
    const w = Math.random() > 0.86 ? 2 : 1;
    ctx.fillRect(x, y, w, w);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(13, 13);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(72, 96),
  new THREE.MeshStandardMaterial({
    map: makeGroundTexture(),
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* Distant, soft hills */
const hillMaterialA = new THREE.MeshStandardMaterial({ color: 0x8ab274, roughness: 1, flatShading: true });
const hillMaterialB = new THREE.MeshStandardMaterial({ color: 0x9cc286, roughness: 1, flatShading: true });
const hillGeometry = new THREE.SphereGeometry(1, 28, 14);

const hills = [
  { p: [-24, -3.5, -34], s: [27, 7.5, 15], m: hillMaterialA },
  { p: [18, -4, -40], s: [34, 9, 18], m: hillMaterialB },
  { p: [46, -4.5, -18], s: [24, 6, 14], m: hillMaterialA },
  { p: [-47, -5, -12], s: [26, 7, 17], m: hillMaterialB },
  { p: [2, -6, -56], s: [44, 10, 20], m: hillMaterialB },
  { p: [-8, -5.5, 42], s: [30, 7, 16], m: hillMaterialA },
];

for (const hill of hills) {
  const mesh = new THREE.Mesh(hillGeometry, hill.m);
  mesh.position.set(...hill.p);
  mesh.scale.set(...hill.s);
  scene.add(mesh);
}

/* Grass tufts — soft, green, mostly out in the meadow */
const bladeGeometry = new THREE.ConeGeometry(0.03, 0.22, 3);
bladeGeometry.translate(0, 0.11, 0);
const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const bladeCount = 700;
const blades = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, bladeCount);
const dummy = new THREE.Object3D();
const bladeColor = new THREE.Color();

for (let i = 0; i < bladeCount; i += 1) {
  const outside = i % 3 !== 0;
  const angle = Math.random() * Math.PI * 2;
  const radius = outside ? 9.5 + Math.random() * 16 : 3.4 + Math.random() * 4.8;
  const scale = outside ? 0.55 + Math.random() * 1.1 : 0.3 + Math.random() * 0.45;
  dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  dummy.rotation.set((Math.random() - 0.5) * 0.22, Math.random() * Math.PI, (Math.random() - 0.5) * 0.22);
  dummy.scale.set(0.7 + Math.random() * 0.7, scale, 0.7 + Math.random() * 0.7);
  dummy.updateMatrix();
  blades.setMatrixAt(i, dummy.matrix);
  bladeColor.setHSL(0.26 + Math.random() * 0.035, 0.34 + Math.random() * 0.16, 0.24 + Math.random() * 0.12);
  blades.setColorAt(i, bladeColor);
}
blades.receiveShadow = true;
scene.add(blades);

/* ------------------------------------------------------------------ */
/* Low-poly trees around the meadow                                    */
/* ------------------------------------------------------------------ */

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4930, roughness: 0.96, flatShading: true });
const leafMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x4b8b3b, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x5da046, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 0.94, flatShading: true }),
];
const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
const treeShadowGeometry = new THREE.CircleGeometry(1, 24);
const treeShadowMaterial = new THREE.MeshBasicMaterial({
  color: 0x24401b,
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
});

const treeSpecs = [
  { angle: 0.22, radius: 19.0, scale: 1.2, turn: 0.4 },
  { angle: 0.92, radius: 26.0, scale: 1.5, turn: 1.3 },
  { angle: 1.52, radius: 15.5, scale: 1.05, turn: 2.2 },
  { angle: 2.2, radius: 24.0, scale: 1.3, turn: 0.7 },
  { angle: 2.86, radius: 31.0, scale: 1.65, turn: 1.8 },
  { angle: 3.5, radius: 20.0, scale: 1.15, turn: 2.6 },
  { angle: 4.16, radius: 27.0, scale: 1.5, turn: 0.3 },
  { angle: 4.82, radius: 16.5, scale: 1.0, turn: 1.2 },
  { angle: 5.46, radius: 29.0, scale: 1.7, turn: 2.9 },
  { angle: 6.08, radius: 21.0, scale: 1.25, turn: 1.8 },
  { angle: 5.86, radius: 40.0, scale: 2.1, turn: 0.6 },
  { angle: 3.32, radius: 43.0, scale: 2.2, turn: 1.9 },
  { angle: 0.98, radius: 44.0, scale: 2.25, turn: 2.7 },
];

function makeTree(spec, index) {
  const group = new THREE.Group();
  group.position.set(Math.cos(spec.angle) * spec.radius, 0, Math.sin(spec.angle) * spec.radius);
  group.rotation.y = spec.turn;

  const trunkHeight = 2.7 * spec.scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * spec.scale, 0.2 * spec.scale, trunkHeight, 7),
    trunkMaterial
  );
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const canopy = new THREE.Group();
  canopy.position.y = trunkHeight + 0.35 * spec.scale;

  const blobs = [
    { p: [0, 0.35 * spec.scale, 0], s: [1.28, 1.08, 1.22], m: 0 },
    { p: [-0.72 * spec.scale, -0.02 * spec.scale, 0.18 * spec.scale], s: [0.82, 0.76, 0.84], m: 2 },
    { p: [0.7 * spec.scale, 0.08 * spec.scale, -0.12 * spec.scale], s: [0.9, 0.8, 0.88], m: 1 },
    { p: [0.04 * spec.scale, 1.12 * spec.scale, 0.02 * spec.scale], s: [0.76, 0.68, 0.74], m: 1 },
    { p: [-0.28 * spec.scale, 0.8 * spec.scale, -0.5 * spec.scale], s: [0.62, 0.58, 0.6], m: 0 },
  ];

  blobs.forEach((blob, blobIndex) => {
    const leaves = new THREE.Mesh(leafGeometry, leafMaterials[(blob.m + index) % leafMaterials.length]);
    leaves.position.set(...blob.p);
    leaves.scale.set(
      blob.s[0] * spec.scale * 1.25,
      blob.s[1] * spec.scale * 1.25,
      blob.s[2] * spec.scale * 1.25
    );
    leaves.rotation.set(blobIndex * 0.4, spec.turn + blobIndex * 1.3, blobIndex * 0.25);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    canopy.add(leaves);
  });

  group.add(canopy);

  const shadow = new THREE.Mesh(treeShadowGeometry, treeShadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.5 * spec.scale, 0.012, 0.3 * spec.scale);
  shadow.scale.set(1.35 * spec.scale, 0.95 * spec.scale, 1);
  group.add(shadow);

  scene.add(group);
}

treeSpecs.forEach(makeTree);

/* A few small bushes near the fence line */
for (const bush of [
  { angle: 1.95, radius: 10.4, scale: 0.56 },
  { angle: 4.45, radius: 10.9, scale: 0.7 },
  { angle: 5.25, radius: 10.2, scale: 0.48 },
]) {
  const bushGroup = new THREE.Group();
  bushGroup.position.set(Math.cos(bush.angle) * bush.radius, 0, Math.sin(bush.angle) * bush.radius);
  for (let i = 0; i < 3; i += 1) {
    const leaf = new THREE.Mesh(leafGeometry, leafMaterials[i % leafMaterials.length]);
    leaf.position.set((i - 1) * 0.45 * bush.scale, (0.3 + i * 0.12) * bush.scale, (i % 2) * 0.24 * bush.scale);
    leaf.scale.setScalar((0.58 + i * 0.12) * bush.scale);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    bushGroup.add(leaf);
  }
  scene.add(bushGroup);
}

/* ------------------------------------------------------------------ */
/* Horse                                                               */
/* ------------------------------------------------------------------ */

const coatMaterial = new THREE.MeshStandardMaterial({ color: 0x8a4424, roughness: 0.66, metalness: 0.02 });
const creamMaterial = new THREE.MeshStandardMaterial({ color: 0xe8d6b5, roughness: 0.8 });
const muzzleMaterial = new THREE.MeshStandardMaterial({ color: 0xb58e63, roughness: 0.84 });
const maneMaterial = new THREE.MeshStandardMaterial({
  color: 0xe3bf80,
  roughness: 0.82,
  emissive: 0x301d07,
  emissiveIntensity: 0.26,
  side: THREE.DoubleSide,
});
const maneMidMaterial = new THREE.MeshStandardMaterial({
  color: 0xcda05b,
  roughness: 0.86,
  emissive: 0x281806,
  emissiveIntensity: 0.2,
  side: THREE.DoubleSide,
});
const tailMaterial = new THREE.MeshStandardMaterial({
  color: 0xdbb97f,
  roughness: 0.86,
  emissive: 0x281806,
  emissiveIntensity: 0.2,
});
const hoofMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3028, roughness: 0.55 });
const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x140e09, roughness: 0.18, metalness: 0.1 });
const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6e6 });
const nostrilMaterial = new THREE.MeshStandardMaterial({ color: 0x53382a, roughness: 0.9 });
const innerEarMaterial = new THREE.MeshStandardMaterial({ color: 0x6b3b28, roughness: 0.9 });

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

/* The barrel is one smooth surface so the chest, back and rump flow together. */
function makeTorsoGeometry() {
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const chest = Math.exp(-Math.pow((z - 0.58) / 0.4, 2));
    const shoulder = Math.exp(-Math.pow((z - 0.42) / 0.3, 2));
    const rump = Math.exp(-Math.pow((z + 0.62) / 0.45, 2));
    const middle = Math.exp(-Math.pow(z / 0.55, 2));

    const width = 0.43 * (1 + 0.08 * chest + 0.075 * rump + 0.035 * shoulder);
    const height = 0.48 * (1 + 0.02 * chest + 0.035 * rump) * (1 - 0.05 * middle);
    const baseY = 1.44 + 0.022 * rump + 0.01 * chest;
    const withers = 0.035 * Math.exp(-Math.pow((z - 0.38) / 0.16, 2)) * Math.max(0, y) ** 2;
    const croup = 0.022 * Math.exp(-Math.pow((z + 0.58) / 0.2, 2)) * Math.max(0, y) ** 2;

    position.setXYZ(
      i,
      x * width,
      y * height + baseY + withers + croup,
      z * 0.94
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

const torsoMesh = new THREE.Mesh(makeTorsoGeometry(), coatMaterial);
torsoMesh.castShadow = true;
torsoMesh.receiveShadow = true;
torso.add(torsoMesh);

/* Neck */
const neckGroup = new THREE.Group();
neckGroup.position.set(0, 1.7, 0.67);
neckGroup.rotation.x = 0.7;
torso.add(neckGroup);

const neckGeometry = new THREE.CylinderGeometry(0.23, 0.38, 0.78, 26);
neckGeometry.translate(0, 0.39, 0);
const neck = new THREE.Mesh(neckGeometry, coatMaterial);
neck.scale.x = 0.78;
neck.castShadow = true;
neck.receiveShadow = true;
neckGroup.add(neck);

ellipsoid(neckGroup, coatMaterial, [0, 0.17, 0.12], [0.185, 0.27, 0.18]);

/* Head — long face, deep jaw, short mealy muzzle */
const headGroup = new THREE.Group();
headGroup.position.set(0, 0.76, 0.015);
headGroup.rotation.x = -0.24;
neckGroup.add(headGroup);

ellipsoid(headGroup, coatMaterial, [0, 0.035, 0.08], [0.21, 0.26, 0.34]);
ellipsoid(headGroup, coatMaterial, [0, -0.03, 0.35], [0.15, 0.2, 0.3]);
ellipsoid(headGroup, coatMaterial, [0, -0.08, 0.18], [0.16, 0.19, 0.22]);
ellipsoid(headGroup, coatMaterial, [0, 0.07, 0.26], [0.155, 0.17, 0.19]);

const muzzleGeometry = new THREE.CylinderGeometry(0.095, 0.13, 0.22, 22);
muzzleGeometry.rotateX(Math.PI / 2);
const muzzle = new THREE.Mesh(muzzleGeometry, muzzleMaterial);
muzzle.position.set(0, -0.085, 0.66);
muzzle.scale.set(0.94, 0.78, 1);
muzzle.castShadow = true;
muzzle.receiveShadow = true;
headGroup.add(muzzle);

ellipsoid(headGroup, muzzleMaterial, [0, -0.095, 0.765], [0.098, 0.084, 0.05]);
ellipsoid(headGroup, nostrilMaterial, [-0.057, -0.075, 0.792], [0.023, 0.028, 0.011], false);
ellipsoid(headGroup, nostrilMaterial, [0.057, -0.075, 0.792], [0.023, 0.028, 0.011], false);
ellipsoid(headGroup, nostrilMaterial, [0, -0.145, 0.752], [0.072, 0.01, 0.015], false);

/* Eyes */
for (const side of [-1, 1]) {
  ellipsoid(headGroup, eyeMaterial, [side * 0.19, 0.11, 0.225], [0.046, 0.047, 0.046], false);
  ellipsoid(headGroup, glintMaterial, [side * 0.212, 0.124, 0.251], [0.01, 0.01, 0.01], false);
}

/* Ears */
const ears = [];
const earGeometry = new THREE.ConeGeometry(0.062, 0.19, 14);
earGeometry.translate(0, 0.095, 0);
const innerEarGeometry = new THREE.ConeGeometry(0.039, 0.14, 12);
innerEarGeometry.translate(0, 0.07, 0);

for (const side of [-1, 1]) {
  const ear = new THREE.Group();
  ear.position.set(side * 0.112, 0.29, -0.01);
  ear.rotation.set(-0.1, 0, side * -0.17);

  const outer = new THREE.Mesh(earGeometry, coatMaterial);
  outer.castShadow = true;
  ear.add(outer);

  const inner = new THREE.Mesh(innerEarGeometry, innerEarMaterial);
  inner.position.set(0, 0.012, 0.022);
  inner.scale.set(0.72, 0.94, 0.6);
  ear.add(inner);

  headGroup.add(ear);
  ears.push({ group: ear, baseZ: side * -0.14, phase: side * 1.7 });
}

/* Mane — a flaxen crest with locks falling over the near side */
const maneLocks = [];
const forelockLocks = [];
const manePalette = [maneMaterial, maneMidMaterial, maneMaterial, maneMaterial, maneMidMaterial];

const crestPoints = [];
for (let i = 0; i <= 10; i += 1) {
  const t = i / 10;
  const radius = 0.38 * (1 - t) + 0.21 * t;
  crestPoints.push(new THREE.Vector3(0, 0.05 + t * 0.72, -radius * 0.92));
}
const crest = new THREE.Mesh(
  taperedTubeGeometry(new THREE.CatmullRomCurve3(crestPoints), 0.06, 0.014, 26, 7),
  maneMaterial
);
crest.castShadow = true;
neckGroup.add(crest);

function neckRadiusAt(y) {
  const t = clamp(y / 0.78, 0, 1);
  return 0.38 * (1 - t) + 0.23 * t;
}

const maneThreadsMaterial = new THREE.MeshStandardMaterial({
  color: 0xcba35f,
  roughness: 0.9,
  emissive: 0x201204,
  emissiveIntensity: 0.16,
  side: THREE.DoubleSide,
});

function hairRibbonGeometry(curve, outward, widthStart, widthEnd, segments = 18) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const across = [-0.5, 0, 0.5];
  const outwardDir = outward.clone().normalize();

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const widthDir = new THREE.Vector3().crossVectors(tangent, outwardDir);
    if (widthDir.lengthSq() < 1e-5) widthDir.set(0, 0, 1);
    widthDir.normalize();
    const width = widthStart + (widthEnd - widthStart) * t;

    for (let k = 0; k < across.length; k += 1) {
      const acrossOffset = across[k];
      const cup = k === 1 ? 0.007 : 0;
      positions.push(
        point.x + widthDir.x * width * acrossOffset + outwardDir.x * cup,
        point.y + widthDir.y * width * acrossOffset + outwardDir.y * cup,
        point.z + widthDir.z * width * acrossOffset + outwardDir.z * cup
      );
      uvs.push(t, acrossOffset + 0.5);
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function addManeLock(side, t, index) {
  const rootY = 0.055 + t * 0.685;
  const rootRadius = neckRadiusAt(rootY);
  const group = new THREE.Group();
  group.position.set(
    side * (0.01 + Math.abs(Math.sin(index * 3.3)) * 0.012),
    rootY,
    -rootRadius * (0.88 + Math.sin(index * 2.4) * 0.025)
  );
  const baseZ = side * (0.07 + Math.sin(index * 1.9) * 0.06);
  group.rotation.z = baseZ;
  neckGroup.add(group);

  const length = (0.2 + t * 0.14 + Math.sin(index * 1.4) * 0.035) * (side > 0 ? 1 : 0.55);
  const thetaMax = 1.06 + Math.sin(index * 2.9) * 0.12;
  const points = [new THREE.Vector3(0, 0, 0)];

  for (const v of [0.3, 0.62, 1]) {
    const y = rootY - length * v;
    const radius = neckRadiusAt(y);
    const theta = -Math.PI / 2 + thetaMax * v;
    const px = side * (0.8 * radius * Math.cos(theta) + 0.02 + Math.sin(index * 2.1) * 0.008 * v);
    const pz = (radius + 0.014) * Math.sin(theta);
    points.push(new THREE.Vector3(px - side * 0.01, y - rootY, pz + rootRadius * 0.88));
  }

  const palette = side > 0
    ? [maneMaterial, maneMidMaterial, maneMaterial, maneThreadsMaterial]
    : [maneMidMaterial, maneThreadsMaterial];
  const width = side > 0
    ? [0.07, 0.048, 0.06, 0.04][index % 4]
    : 0.036;
  const lock = new THREE.Mesh(
    hairRibbonGeometry(
      new THREE.CatmullRomCurve3(points),
      new THREE.Vector3(side, 0, 0),
      width,
      0.004,
      18
    ),
    palette[index % palette.length]
  );
  lock.castShadow = true;
  lock.receiveShadow = true;
  group.add(lock);
  maneLocks.push({ group, baseZ, phase: index * 0.63 });
}

for (let i = 0; i < 28; i += 1) {
  addManeLock(1, i / 27, i);
}
for (let i = 0; i < 10; i += 1) {
  addManeLock(-1, (i / 9) * 0.94, i + 3);
}

/* A forelock swept to the near side of the brow */
for (let i = 0; i < 3; i += 1) {
  const group = new THREE.Group();
  const rootX = (i - 1) * 0.045 + 0.01;
  group.position.set(rootX, 0.28, 0.155 + Math.sin(i * 2.3) * 0.008);
  const baseZ = -0.04 - i * 0.025;
  group.rotation.z = baseZ;
  headGroup.add(group);

  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.002, 0.004, 0.06),
    new THREE.Vector3(-0.01, -0.005, 0.12),
    new THREE.Vector3(-0.032, -0.035, 0.18),
    new THREE.Vector3(-0.052, -0.07, 0.22),
    new THREE.Vector3(-0.07 + i * 0.012, -0.1 - Math.sin(i * 1.7) * 0.02, 0.25),
  ];

  const lock = new THREE.Mesh(
    hairRibbonGeometry(
      new THREE.CatmullRomCurve3(points),
      new THREE.Vector3(0, 0.25, 1),
      0.075 - i * 0.008,
      0.004,
      16
    ),
    manePalette[i % manePalette.length]
  );
  lock.castShadow = true;
  group.add(lock);
  forelockLocks.push({ group, baseZ, phase: i * 0.8 });
}

/* Tail with a tapered tube plus a few strands */
function taperedTubeGeometry(curve, radiusStart, radiusEnd, tubularSegments = 28, radialSegments = 8) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments;
    const point = curve.getPointAt(t);
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = Math.cos(v);
      const nx = cos * normal.x + sin * binormal.x;
      const ny = cos * normal.y + sin * binormal.y;
      const nz = cos * normal.z + sin * binormal.z;

      positions.push(point.x + radius * nx, point.y + radius * ny, point.z + radius * nz);
      normals.push(nx, ny, nz);
      uvs.push(t, j / radialSegments);
    }
  }

  for (let i = 0; i < tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

const tailGroup = new THREE.Group();
tailGroup.position.set(0, 1.69, -1.05);
tailGroup.rotation.x = 0.06;
torso.add(tailGroup);

const mainTailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.02, 0.04, 0.05),
  new THREE.Vector3(0.03, -0.16, -0.12),
  new THREE.Vector3(0.1, -0.58, -0.3),
  new THREE.Vector3(0.19, -1.1, -0.24),
]);

const tailMesh = new THREE.Mesh(taperedTubeGeometry(mainTailCurve, 0.102, 0.02, 32, 8), tailMaterial);
tailMesh.castShadow = true;
tailGroup.add(tailMesh);

const strandCurves = [
  { x: -0.06, z: 0.06, length: 1.0, radius: 0.032, bend: -0.03 },
  { x: 0.09, z: 0.02, length: 1.12, radius: 0.03, bend: 0.06 },
  { x: -0.03, z: 0.1, length: 0.9, radius: 0.025, bend: -0.02 },
  { x: 0.14, z: 0.08, length: 0.98, radius: 0.023, bend: 0.1 },
  { x: 0.05, z: 0.12, length: 0.86, radius: 0.021, bend: 0.03 },
  { x: -0.1, z: 0.02, length: 1.05, radius: 0.022, bend: -0.08 },
  { x: 0.02, z: -0.02, length: 1.16, radius: 0.018, bend: 0.01 },
  { x: -0.14, z: 0.09, length: 0.94, radius: 0.016, bend: -0.1 },
  { x: 0.11, z: 0.14, length: 0.8, radius: 0.015, bend: 0.08 },
];

strandCurves.forEach((strand, index) => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(strand.x * 0.5, 0.0, 0.04),
    new THREE.Vector3(strand.x, -0.2, -0.1 + strand.z),
    new THREE.Vector3(strand.x * 1.2 + strand.bend, -0.56, -0.24 + strand.z * 0.6),
    new THREE.Vector3(strand.x * 1.4 + strand.bend * 2, -strand.length, -0.2 + strand.z * 0.4),
  ]);
  const mesh = new THREE.Mesh(
    taperedTubeGeometry(curve, strand.radius, 0.005, 22, 6),
    index % 3 === 0 ? maneMidMaterial : tailMaterial
  );
  mesh.castShadow = true;
  tailGroup.add(mesh);
});

/* Legs */
const legs = [];

function makeLeg({ x, z, front, phaseOffset }) {
  const upperLength = front ? 0.58 : 0.6;
  const lowerLength = 0.5;
  const pasternLength = 0.12;
  const hoofLength = 0.12;
  const totalLength = upperLength + lowerLength + pasternLength + hoofLength;

  const hip = new THREE.Group();
  hip.position.set(x, totalLength + 0.01, z);
  hip.rotation.z = x > 0 ? 0.018 : -0.018;
  horse.add(hip);

  const hipJoint = new THREE.Mesh(sphereGeometry, coatMaterial);
  hipJoint.scale.set(front ? 0.12 : 0.15, front ? 0.14 : 0.18, front ? 0.13 : 0.16);
  hipJoint.castShadow = true;
  hip.add(hipJoint);

  const upperGeometry = new THREE.CylinderGeometry(front ? 0.15 : 0.18, 0.092, upperLength, 18);
  upperGeometry.translate(0, -upperLength / 2, 0);
  const upper = new THREE.Mesh(upperGeometry, coatMaterial);
  upper.castShadow = true;
  upper.receiveShadow = true;
  hip.add(upper);

  const knee = new THREE.Group();
  knee.position.y = -upperLength;
  hip.add(knee);

  const kneeJoint = new THREE.Mesh(sphereGeometry, coatMaterial);
  kneeJoint.scale.setScalar(front ? 0.088 : 0.096);
  kneeJoint.castShadow = true;
  knee.add(kneeJoint);

  const lowerGeometry = new THREE.CylinderGeometry(0.07, 0.05, lowerLength, 16);
  lowerGeometry.translate(0, -lowerLength / 2, 0);
  const lower = new THREE.Mesh(lowerGeometry, coatMaterial);
  lower.castShadow = true;
  lower.receiveShadow = true;
  knee.add(lower);

  const sockGeometry = new THREE.CylinderGeometry(0.077, 0.056, 0.22, 16);
  sockGeometry.translate(0, -0.39, 0);
  const sock = new THREE.Mesh(sockGeometry, creamMaterial);
  sock.castShadow = true;
  knee.add(sock);

  const fetlock = new THREE.Group();
  fetlock.position.y = -lowerLength;
  knee.add(fetlock);

  const fetlockJoint = new THREE.Mesh(sphereGeometry, creamMaterial);
  fetlockJoint.scale.setScalar(0.058);
  fetlockJoint.castShadow = true;
  fetlock.add(fetlockJoint);

  const pasternGeometry = new THREE.CylinderGeometry(0.05, 0.043, pasternLength, 14);
  pasternGeometry.translate(0, -pasternLength / 2, 0);
  const pastern = new THREE.Mesh(pasternGeometry, creamMaterial);
  pastern.castShadow = true;
  fetlock.add(pastern);

  const hoofGeometry = new THREE.CylinderGeometry(0.07, 0.086, hoofLength, 16);
  const hoof = new THREE.Mesh(hoofGeometry, hoofMaterial);
  hoof.position.set(0, -pasternLength - hoofLength / 2, 0.018);
  hoof.scale.set(1.08, 1, 1.34);
  hoof.castShadow = true;
  hoof.receiveShadow = true;
  fetlock.add(hoof);

  const leg = { hip, knee, fetlock, hoof, front, phaseOffset };
  legs.push(leg);
  return leg;
}

const legSpecs = [
  { x: -0.32, z: -0.7, front: false, phaseOffset: 0.0 },   // left hind
  { x: -0.3, z: 0.6, front: true, phaseOffset: 0.25 },     // left front
  { x: 0.32, z: -0.7, front: false, phaseOffset: 0.5 },    // right hind
  { x: 0.3, z: 0.6, front: true, phaseOffset: 0.75 },      // right front
];

for (const spec of legSpecs) {
  makeLeg(spec);
}

/* ------------------------------------------------------------------ */
/* Dust                                                                */
/* ------------------------------------------------------------------ */

function makeDustTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, "rgba(255, 247, 229, 0.9)");
  gradient.addColorStop(0.45, "rgba(226, 212, 185, 0.45)");
  gradient.addColorStop(1, "rgba(214, 199, 170, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const dustTexture = makeDustTexture();
const puffs = [];
const dustEnabled = !prefersReducedMotion;

if (dustEnabled) {
  for (let i = 0; i < 26; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: dustTexture,
      color: 0xe6d7b9,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.scale.setScalar(0.2);
    scene.add(sprite);
    puffs.push({ sprite, life: 1, maxLife: 0.9, velocity: new THREE.Vector3() });
  }
}

let puffCursor = 0;
let puffTimer = 0;
const hoofWorld = new THREE.Vector3();

function emitPuff() {
  const puff = puffs[puffCursor];
  puffCursor = (puffCursor + 1) % puffs.length;

  const stanceLegs = legs.filter((leg) => {
    const phase = state.phase + leg.phaseOffset * Math.PI * 2;
    return Math.cos(phase) > 0.25;
  });
  const leg = (stanceLegs.length ? stanceLegs : legs)[Math.floor(Math.random() * (stanceLegs.length || legs.length))];
  leg.hoof.getWorldPosition(hoofWorld);

  puff.sprite.position.set(hoofWorld.x + (Math.random() - 0.5) * 0.12, 0.06, hoofWorld.z + (Math.random() - 0.5) * 0.12);
  puff.sprite.scale.setScalar(0.16 + Math.random() * 0.08);
  puff.sprite.material.opacity = 0.16;
  puff.sprite.visible = true;
  puff.life = 0;
  puff.maxLife = 0.7 + Math.random() * 0.5;
  puff.velocity.set((Math.random() - 0.5) * 0.22, 0.16 + Math.random() * 0.12, (Math.random() - 0.5) * 0.22);
}

function updateDust(dt) {
  for (const puff of puffs) {
    if (!puff.sprite.visible) continue;
    puff.life += dt;
    const progress = puff.life / puff.maxLife;
    if (progress >= 1) {
      puff.sprite.visible = false;
      continue;
    }
    puff.sprite.position.addScaledVector(puff.velocity, dt);
    puff.velocity.multiplyScalar(1 - 0.9 * dt);
    puff.velocity.y += 0.05 * dt;
    puff.sprite.scale.setScalar(0.18 + progress * 0.62);
    puff.sprite.material.opacity = 0.15 * (1 - progress) * (1 - progress);
  }
}

/* ------------------------------------------------------------------ */
/* State & motion                                                      */
/* ------------------------------------------------------------------ */

const state = {
  auto: !prefersReducedMotion,
  cruise: 1.6,
  speed: 0,
  yaw: -0.27,
  phase: Math.PI * 0.35,
  yawRate: 0,
};

horse.position.set(5.2, 0, 0);
horse.rotation.y = state.yaw;

const pressed = new Set();

const cruiseLabel = document.getElementById("paceValue");
const paceInput = document.getElementById("paceInput");
const paceOutput = document.getElementById("paceOutput");
const gaitValue = document.getElementById("gaitValue");
const wanderButton = document.getElementById("wanderButton");

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
    setAuto(!state.auto);
    return;
  }

  const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!movementKeys.includes(event.code)) return;

  event.preventDefault();
  setAuto(false);
  pressed.add(event.code);
});

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
  if (aspect < 0.7) return { fov: 46, distance: 11.4 };
  if (aspect < 1.05) return { fov: 42, distance: 9.4 };
  return { fov: 37, distance: 7.8 };
}

const initialFrame = frameForViewport();
camera.fov = initialFrame.fov;
camera.updateProjectionMatrix();

const orbit = {
  azimuth: 0.72,
  polar: 1.47,
  distance: initialFrame.distance,
  targetAzimuth: 0.72,
  targetPolar: 1.47,
  targetDistance: initialFrame.distance,
};

let userZoomed = false;

const cameraTarget = new THREE.Vector3(horse.position.x, 1.6, horse.position.z);
const desiredTarget = new THREE.Vector3();

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
  orbit.targetPolar = clamp(orbit.targetPolar + dy * 0.0042, 0.32, 1.52);
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
    orbit.targetDistance = clamp(orbit.targetDistance * (1 + event.deltaY * 0.0011), 3.4, 16);
  },
  { passive: false }
);

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let gaitText = "";
let paceText = "";

function updateHorse(dt, elapsed) {
  let targetSpeed = 0;
  let targetYawRate = 0;

  if (state.auto) {
    const radius = Math.hypot(horse.position.x, horse.position.z);
    const angle = Math.atan2(horse.position.z, horse.position.x) + (radius < 1 ? 0.6 : 0.52);
    const targetX = Math.cos(angle) * 6.4;
    const targetZ = Math.sin(angle) * 6.4;
    const desiredYaw = Math.atan2(targetX - horse.position.x, targetZ - horse.position.z);
    const difference = wrapAngle(desiredYaw - state.yaw);
    targetYawRate = clamp(difference * 2.1, -1.35, 1.35);
    targetSpeed = state.cruise;
  } else {
    const throttle = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0)
      - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const steer = (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0)
      - (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0);

    targetYawRate = steer * 1.55;
    targetSpeed = throttle > 0 ? state.cruise * throttle : throttle < 0 ? -state.cruise * 0.42 : 0;
  }

  state.yawRate = damp(state.yawRate, targetYawRate, 6, dt);
  state.yaw += state.yawRate * dt;
  horse.rotation.y = state.yaw;

  state.speed = damp(state.speed, targetSpeed, 4.2, dt);
  if (Math.abs(state.speed) < 0.004) state.speed = 0;

  if (state.speed !== 0) {
    horse.position.x += Math.sin(state.yaw) * state.speed * dt;
    horse.position.z += Math.cos(state.yaw) * state.speed * dt;

    const distanceFromCenter = Math.hypot(horse.position.x, horse.position.z);
    if (distanceFromCenter > 24) {
      const correction = 24 / distanceFromCenter;
      horse.position.x *= correction;
      horse.position.z *= correction;
    }
  }

  const activity = clamp(Math.abs(state.speed) / 0.8, 0, 1);
  const strideLength = 1.5 + Math.abs(state.speed) * 0.08;
  state.phase += (state.speed / strideLength) * Math.PI * 2 * dt;

  for (const leg of legs) {
    const phase = state.phase + leg.phaseOffset * Math.PI * 2;
    const swing = Math.sin(phase);
    const lift = Math.max(0, -Math.cos(phase));
    const liftSmooth = Math.pow(lift, 1.25);
    const amplitude = (leg.front ? 0.4 : 0.355) * activity;
    const kneeBend = (0.82 + Math.abs(state.speed) * 0.06) * activity;

    leg.hip.rotation.x = swing * amplitude;
    leg.knee.rotation.x = liftSmooth * kneeBend;
    leg.fetlock.rotation.x = -liftSmooth * kneeBend * 0.58;
  }

  /* Body carriage */
  torso.position.y = 0.02 * Math.sin(state.phase * 2 + 0.4) * activity;
  torso.rotation.x = 0.008 * Math.sin(state.phase * 2 + 1.0) * activity;
  torso.rotation.z = -state.yawRate * 0.045 + 0.012 * Math.sin(state.phase) * activity;

  /* Head, neck and ears */
  const idle = 1 - activity;
  neckGroup.rotation.x = 0.7
    + 0.035 * Math.sin(state.phase * 2 + 0.7) * activity
    + 0.012 * Math.sin(elapsed * 1.1) * idle;
  neckGroup.rotation.y = clamp(state.yawRate * 0.16, -0.14, 0.14) + 0.025 * Math.sin(elapsed * 0.47) * idle;
  headGroup.rotation.x = -0.24
    + 0.028 * Math.sin(state.phase * 2 + 1.4) * activity
    + 0.018 * Math.sin(elapsed * 1.4 + 1.1) * idle;
  headGroup.rotation.y = -0.035 * Math.sin(elapsed * 0.6) * idle;

  ears.forEach((ear) => {
    const twitch = Math.max(0, Math.sin(elapsed * 2.3 + ear.phase) - 0.94) * 1.4;
    ear.group.rotation.z = ear.baseZ + twitch * 0.5 + 0.02 * Math.sin(elapsed * 0.9 + ear.phase);
  });

  /* Mane and tail */
  maneLocks.forEach((lock) => {
    lock.group.rotation.z = lock.baseZ
      + 0.032 * Math.sin(elapsed * 1.8 + lock.phase)
      + 0.026 * Math.sin(state.phase * 2 + lock.phase) * activity;
    lock.group.rotation.x = 0.02 * Math.sin(elapsed * 1.3 + lock.phase * 0.7);
  });

  forelockLocks.forEach((lock) => {
    lock.group.rotation.z = lock.baseZ + 0.018 * Math.sin(elapsed * 1.6 + lock.phase);
    lock.group.rotation.x = 0.02 * Math.sin(elapsed * 1.9 + lock.phase);
  });

  tailGroup.rotation.y = 0.14 * Math.sin(elapsed * 1.15) + 0.21 * Math.sin(state.phase * 0.85 + 1.2) * activity;
  tailGroup.rotation.x = 0.06 + 0.035 * Math.sin(elapsed * 1.8 + 0.5) + 0.02 * Math.sin(state.phase * 2) * activity;

  /* Dust */
  if (dustEnabled && activity > 0.45) {
    puffTimer -= dt;
    if (puffTimer <= 0) {
      emitPuff();
      puffTimer = 0.1 + Math.random() * 0.1;
    }
  }

  /* Readout */
  const nextGait = Math.abs(state.speed) < 0.12 ? "standing" : state.speed < 0 ? "backing" : "walk";
  if (nextGait !== gaitText) {
    gaitText = nextGait;
    gaitValue.textContent = nextGait;
  }
  const nextPace = (Math.abs(state.speed) || 0).toFixed(1);
  if (nextPace !== paceText) {
    paceText = nextPace;
    cruiseLabel.textContent = nextPace;
  }
}

function updateCamera(dt) {
  orbit.azimuth = damp(orbit.azimuth, orbit.targetAzimuth, 7, dt);
  orbit.polar = damp(orbit.polar, orbit.targetPolar, 7, dt);
  orbit.distance = damp(orbit.distance, orbit.targetDistance, 6, dt);

  desiredTarget.set(horse.position.x, 1.6 + torso.position.y * 0.5, horse.position.z);
  cameraTarget.lerp(desiredTarget, 1 - Math.exp(-5.2 * dt));

  const sinPolar = Math.sin(orbit.polar);
  const offsetX = Math.sin(orbit.azimuth) * sinPolar * orbit.distance;
  const offsetY = Math.cos(orbit.polar) * orbit.distance;
  const offsetZ = Math.cos(orbit.azimuth) * sinPolar * orbit.distance;

  camera.position.set(
    cameraTarget.x + offsetX,
    cameraTarget.y + offsetY,
    cameraTarget.z + offsetZ
  );
  camera.lookAt(cameraTarget);

  sun.position.copy(horse.position).add(sunDirection.clone().multiplyScalar(16));
  sun.target.position.copy(horse.position);
  sun.target.updateMatrixWorld();
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  updateHorse(dt, elapsed);
  updateDust(dt);
  updateCamera(dt);

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

  if (!userZoomed) {
    orbit.distance = frame.distance;
    orbit.targetDistance = frame.distance;
  } else {
    orbit.targetDistance = Math.max(orbit.targetDistance, frame.distance * 0.55);
  }
}

window.addEventListener("resize", resize);

renderer.setAnimationLoop(animate);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    document.getElementById("loader").setAttribute("aria-hidden", "true");
  });
});


