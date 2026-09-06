import * as THREE from 'three';

export interface SlabOpts {
  width: number;
  height: number;
  thickness: number;
  radius: number;
  curveSegments?: number;
  bevelSegments?: number;
}

export function createRoundedRectShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.min(radius, Math.min(hw, hh) - 1e-3);
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0);
  shape.lineTo(hw, hh - r);
  shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2);
  shape.lineTo(-hw + r, hh);
  shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-hw, -hh + r);
  shape.absarc(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI);
  shape.closePath();
  return shape;
}

export function createMilysecSlabGeometry(opts: SlabOpts) {
  const { width, height, thickness, radius, curveSegments = 64, bevelSegments = 8 } = opts;
  const shape = createRoundedRectShape(width, height, radius);
  const extrude = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: radius * 0.3,
    bevelThickness: radius * 0.3,
    bevelSegments,
    curveSegments,
    steps: 1
  });
  extrude.center();
  extrude.computeVertexNormals();
  return extrude;
}

export function applyMilysecVertexColors(geom: THREE.BufferGeometry, width: number, height: number, thickness: number) {
  const mint = new THREE.Color('#08D592');
  const purple = new THREE.Color('#9C32DF');
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const radiusDot = Math.min(width, height) * 0.14; // approx to SVG r=14 in 128 box
  const dot1Y = height * (46 / 128 - 0.5);
  const dot2Y = height * (82 / 128 - 0.5);
  const dotX = 0;
  const tmp = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    // Determine if the vertex belongs to either dot based on xy distance
    const inDot =
      (tmp.x - dotX) * (tmp.x - dotX) + (tmp.y - dot1Y) * (tmp.y - dot1Y) <= radiusDot * radiusDot ||
      (tmp.x - dotX) * (tmp.x - dotX) + (tmp.y - dot2Y) * (tmp.y - dot2Y) <= radiusDot * radiusDot;
    const c = inDot ? purple : mint;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

