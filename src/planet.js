import * as THREE from "three";
import { Y_AXIS, lerp, makeGlowTexture, random, randomDirection, smoothstep } from "./util.js";
import { PLANET_RADIUS, scene } from "./core.js";

/* ------------------------------------------------------------------ */
/* The planet                                                          */
/* ------------------------------------------------------------------ */

/* A little value noise for the meadow colours */
export const noisePermutation = new Uint8Array(256);
export const noiseValues = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  noisePermutation[i] = i;
  noiseValues[i] = random();
}
for (let i = 255; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [noisePermutation[i], noisePermutation[j]] = [noisePermutation[j], noisePermutation[i]];
}

export function lattice(x, y, z) {
  return noiseValues[noisePermutation[(noisePermutation[(noisePermutation[x & 255] + y) & 255] + z) & 255]];
}

export function valueNoise(x, y, z) {
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

export function fbm(x, y, z) {
  return valueNoise(x, y, z) * 0.5
    + valueNoise(x * 2.03 + 5.1, y * 2.03, z * 2.03) * 0.3
    + valueNoise(x * 4.1, y * 4.1 + 3.3, z * 4.1) * 0.2;
}

/* Places on the planet, measured from where the horse starts: metres along the surface, then a bearing. */
export function planetDirection(arc, bearing) {
  const theta = arc / PLANET_RADIUS;
  return new THREE.Vector3(
    Math.sin(theta) * Math.sin(bearing),
    Math.cos(theta),
    Math.sin(theta) * Math.cos(bearing)
  );
}

export function placeOnPlanet(object, direction, spin = 0, lift = 0) {
  object.position.copy(direction).multiplyScalar(PLANET_RADIUS + lift);
  object.quaternion.setFromUnitVectors(Y_AXIS, direction);
  object.rotateY(spin);
  return object;
}

export const layout = {
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
export const obstacles = [];

export const planetGeometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, 40);
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

export const planet = new THREE.Mesh(
  planetGeometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
);
planet.receiveShadow = true;
scene.add(planet);

/* A soft halo where the planet meets the sky */
export const atmosphere = new THREE.Mesh(
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

export const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4930, roughness: 0.96, flatShading: true });
export const leafMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x4b8b3b, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x5da046, roughness: 0.94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x3f7a32, roughness: 0.94, flatShading: true }),
];
export const leafGeometry = new THREE.IcosahedronGeometry(1, 1);

export function castAndReceive(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

/* Scenery that fades aside whenever it comes between the camera and the horse */
export const fadeables = [];

export function makeFadeable(group, direction, radius, height) {
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

export function makeTree(spec, index) {
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
export const volcanoMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7466, roughness: 1, flatShading: true });
export const craterGlowTexture = makeGlowTexture([
  [0, "rgba(255, 196, 120, 0.95)"],
  [0.35, "rgba(255, 120, 60, 0.4)"],
  [1, "rgba(255, 90, 40, 0)"],
]);
export const smokeVents = [];

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

export function sphereLowGeometry() {
  sphereLowGeometry.shared ??= new THREE.SphereGeometry(1, 16, 12);
  return sphereLowGeometry.shared;
}

/* Bushes and stones */
export const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x8b8aa0, roughness: 1, flatShading: true });

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

export function clearOfObstacles(direction, margin) {
  for (const obstacle of obstacles) {
    if (direction.angleTo(obstacle.direction) * PLANET_RADIUS < obstacle.radius + margin) return false;
  }
  return true;
}

/* Grass tufts and little flowers all the way around */
export const dummy = new THREE.Object3D();
export const scatterDirection = new THREE.Vector3();

export function scatter(mesh, count, margin, place) {
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

export const bladeGeometry = new THREE.ConeGeometry(0.018, 0.15, 3);
bladeGeometry.translate(0, 0.075, 0);
export const blades = new THREE.InstancedMesh(
  bladeGeometry,
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  2600
);
export const bladeColor = new THREE.Color();
scatter(blades, 2600, 0.15, (object, index) => {
  object.rotateX((random() - 0.5) * 0.3);
  const height = 0.6 + random() * 0.7;
  object.scale.set(0.7 + random() * 0.7, height, 0.7 + random() * 0.7);
  bladeColor.setHSL(0.26 + random() * 0.04, 0.38 + random() * 0.16, 0.24 + random() * 0.14);
  blades.setColorAt(index, bladeColor);
});
blades.receiveShadow = true;

export const flowerHeads = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.045, 0),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
  150
);
export const flowerPalette = [0xf6efdf, 0xf3d36b, 0xf0a8b8, 0xb9a6e8, 0xffffff].map((hex) => new THREE.Color(hex));
scatter(flowerHeads, 150, 0.25, (object, index) => {
  object.translateY(0.09 + random() * 0.05);
  object.scale.set(1, 0.6, 1);
  flowerHeads.setColorAt(index, flowerPalette[Math.floor(random() * flowerPalette.length)]);
});
