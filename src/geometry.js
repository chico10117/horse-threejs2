import * as THREE from "three";
import { X_AXIS, clamp, lerp } from "./util.js";

/* ------------------------------------------------------------------ */
/* Geometry helpers for the horse                                      */
/* ------------------------------------------------------------------ */

export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/* Smoothly samples evenly spaced keyframes at t in [0, 1]. */
export function sampleKeys(keys, t) {
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
export function makeSweep(points, section) {
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

export function tubeGeometry(curve, radiusAt, tubularSegments = 28, radialSegments = 8) {
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
export function hairRibbonGeometry(curve, outwardAt, widthStart, widthEnd, segments = 18) {
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
export function limbGeometry(length, radii, from = 0, to = 1, flatten = 0.86) {
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

export function mergeGeometries(geometries) {
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
export function makeDynamicTube(segments, radial, radius, material) {
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
