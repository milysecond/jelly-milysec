import * as THREE from 'three';

export type SkinWeights = {
  indices: number[];  // node indices
  weights: number[];  // sum to 1
  offsets: THREE.Vector3[]; // rest offset from node to vertex
}[];

export function buildSkinWeights(
  vertexPositions: Float32Array,
  nodes: THREE.Vector3[],
  kNearest = 4
): SkinWeights {
  const res: SkinWeights = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const indices = nodes.map((_, idx) => idx);

  for (let i = 0; i < vertexPositions.length; i += 3) {
    v.set(vertexPositions[i], vertexPositions[i + 1], vertexPositions[i + 2]);
    // find k nearest
    const dists: { idx: number; d2: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      n.copy(nodes[j]);
      const d2 = v.distanceToSquared(n);
      dists.push({ idx: j, d2 });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    const choose = dists.slice(0, Math.min(kNearest, dists.length));

    const ws: number[] = [];
    const is: number[] = [];
    const offs: THREE.Vector3[] = [];
    let wsum = 0;
    for (const { idx, d2 } of choose) {
      const w = 1 / Math.max(1e-6, Math.sqrt(d2));
      ws.push(w);
      is.push(idx);
      offs.push(new THREE.Vector3().subVectors(v, nodes[idx]));
      wsum += w;
    }
    for (let j = 0; j < ws.length; j++) ws[j] /= wsum || 1;
    res.push({ indices: is, weights: ws, offsets: offs });
  }

  return res;
}

export function applySkin(
  skin: SkinWeights,
  nodes: THREE.Vector3[],
  outPositions: Float32Array
) {
  const tmp = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < skin.length; i++) {
    const sw = skin[i];
    tmp.set(0, 0, 0);
    for (let j = 0; j < sw.indices.length; j++) {
      const ni = sw.indices[j];
      const w = sw.weights[j];
      const node = nodes[ni];
      p.copy(node).add(sw.offsets[j]);
      tmp.addScaledVector(p, w);
    }
    const k = i * 3;
    outPositions[k + 0] = tmp.x;
    outPositions[k + 1] = tmp.y;
    outPositions[k + 2] = tmp.z;
  }
}

