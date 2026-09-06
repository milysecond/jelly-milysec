import * as THREE from 'three';

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function vec3(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}

export function lengthSqXYZ(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

export function mix(a: number, b: number, t: number) {
  return a * (1 - t) + b * t;
}
