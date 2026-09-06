import * as THREE from 'three';

type Node = {
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  force: THREE.Vector3;
  invMass: number;
};

type Edge = { i: number; j: number; rest: number; stiffness: number };

type Tetra = {
  a: number; b: number; c: number; d: number;
  restVolume: number;
  lambda: number;
  compliance: number; // XPBD compliance
};

export type LatticeDims = { nx: number; ny: number; nz: number };

export interface SoftBodyOpts {
  gravity?: THREE.Vector3;
  damping?: number;
  substeps?: number;
  iterations?: number;
  groundY?: number;
  groundFriction?: number;
}

export class SoftBody {
  public nodes: Node[] = [];
  public edges: Edge[] = [];
  public tets: Tetra[] = [];
  public boundsMin = new THREE.Vector3();
  public boundsMax = new THREE.Vector3();
  public restingNodes: THREE.Vector3[] = [];

  private tmp = new THREE.Vector3();
  private g: THREE.Vector3;
  private damping: number;
  private substeps: number;
  private iterations: number;
  private groundY: number;
  private groundFriction: number;

  constructor(opts: SoftBodyOpts = {}) {
    this.g = opts.gravity?.clone() ?? new THREE.Vector3(0, -9.81, 0);
    this.damping = opts.damping ?? 0.994;
    this.substeps = opts.substeps ?? 1;
    this.iterations = opts.iterations ?? 10;
    this.groundY = opts.groundY ?? 0;
    this.groundFriction = opts.groundFriction ?? 0.5;
  }

  static insideRoundRect(x: number, y: number, w: number, h: number, r: number) {
    // Round-rect centered at (0,0)
    const dx = Math.abs(x) - (w * 0.5 - r);
    const dy = Math.abs(y) - (h * 0.5 - r);
    const cx = Math.max(dx, 0);
    const cy = Math.max(dy, 0);
    return (cx * cx + cy * cy) <= r * r || (dx <= 0 && dy <= 0);
  }

  // Build a regular lattice inside a rounded-rectangle slab
  buildLatticeSlab(opts: {
    sizeX: number; sizeY: number; sizeZ: number;
    radius: number;
    dims: LatticeDims;
    massPerNode?: number;
    edgeStiffness?: number;
    tetCompliance?: number;
    density?: number;
  }) {
    const { sizeX, sizeY, sizeZ, radius, dims, massPerNode = 0.02, edgeStiffness = 0.8, tetCompliance = 1e-5 } = opts;
    const { nx, ny, nz } = dims;

    const nodes: Node[] = [];
    const positions: THREE.Vector3[] = [];
    const invMass = 1 / massPerNode;

    // grid spacing
    const dx = sizeX / (nx - 1);
    const dy = sizeY / (ny - 1);
    const dz = sizeZ / (nz - 1);
    const ox = -sizeX / 2;
    const oy = -sizeY / 2;
    const oz = -sizeZ / 2;

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = ox + i * dx;
          const y = oy + j * dy;
          const z = oz + k * dz;
          // inside rounded rectangle footprint?
          if (!SoftBody.insideRoundRect(x, y, sizeX, sizeY, radius)) continue;
          const p = new THREE.Vector3(x, y + 0.22, z); // raised above ground
          positions.push(p);
          nodes.push({
            position: p.clone(),
            prevPosition: p.clone(),
            force: new THREE.Vector3(),
            invMass
          });
        }
      }
    }

    // Build a 3D hash from i,j,k to node index; -1 when empty
    const indexGrid = new Map<string, number>();
    const idxKey = (i: number, j: number, k: number) => `${i},${j},${k}`;
    // Re-scan to store indices
    let cursor = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = ox + i * dx, y = oy + j * dy;
          if (!SoftBody.insideRoundRect(x, y, sizeX, sizeY, radius)) continue;
          indexGrid.set(idxKey(i, j, k), cursor++);
        }
      }
    }

    // Helper
    const get = (i: number, j: number, k: number) => indexGrid.get(idxKey(i, j, k)) ?? -1;

    // Edges (springs): structural + diagonals within cells
    const edges: Edge[] = [];
    const tryEdge = (aIdx: number, bIdx: number) => {
      if (aIdx < 0 || bIdx < 0) return;
      const pa = positions[aIdx], pb = positions[bIdx];
      edges.push({ i: aIdx, j: bIdx, rest: pa.distanceTo(pb), stiffness: edgeStiffness });
    };

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = get(i, j, k);
          if (a < 0) continue;
          tryEdge(a, get(i + 1, j, k));
          tryEdge(a, get(i, j + 1, k));
          tryEdge(a, get(i, j, k + 1));
          // diagonals within cell
          tryEdge(a, get(i + 1, j + 1, k));
          tryEdge(a, get(i + 1, j, k + 1));
          tryEdge(a, get(i, j + 1, k + 1));
          tryEdge(a, get(i + 1, j + 1, k + 1));
        }
      }
    }

    // Tetrahedra from each full voxel (split cube into 5 tets)
    const tets: Tetra[] = [];
    const addTet = (a: number, b: number, c: number, d: number) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      const pa = positions[a], pb = positions[b], pc = positions[c], pd = positions[d];
      const v = SoftBody.computeTetraVolume(pa, pb, pc, pd);
      if (v <= 1e-10) return;
      tets.push({ a, b, c, d, restVolume: v, lambda: 0, compliance: tetCompliance });
    };

    for (let k = 0; k < nz - 1; k++) {
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const n000 = get(i, j, k);
          const n100 = get(i + 1, j, k);
          const n010 = get(i, j + 1, k);
          const n110 = get(i + 1, j + 1, k);
          const n001 = get(i, j, k + 1);
          const n101 = get(i + 1, j, k + 1);
          const n011 = get(i, j + 1, k + 1);
          const n111 = get(i + 1, j + 1, k + 1);
          // only if all present
          if ([n000, n100, n010, n110, n001, n101, n011, n111].some(n => n < 0)) continue;
          // 5-tet split
          addTet(n000, n100, n010, n001);
          addTet(n100, n110, n010, n111);
          addTet(n100, n010, n001, n111);
          addTet(n010, n001, n011, n111);
          addTet(n100, n001, n101, n111);
        }
      }
    }

    // Store
    this.nodes = nodes;
    this.edges = edges;
    this.tets = tets;
    this.restingNodes = positions.map(p => p.clone());

    // Bounds
    this.boundsMin.copy(positions[0] ?? new THREE.Vector3());
    this.boundsMax.copy(positions[0] ?? new THREE.Vector3());
    for (const p of positions) {
      this.boundsMin.min(p);
      this.boundsMax.max(p);
    }
  }

  step(dt: number) {
    const nSub = this.substeps;
    const h = dt / nSub;
    for (let s = 0; s < nSub; s++) {
      // Semi-implicit euler for velocities
      for (const node of this.nodes) {
        if (node.invMass === 0) continue;
        node.force.addScaledVector(this.g, 1.0);
        const vel = this.tmp.copy(node.position).sub(node.prevPosition);
        vel.multiplyScalar(this.damping);
        vel.addScaledVector(node.force, h * node.invMass);
        node.prevPosition.copy(node.position);
        node.position.add(vel);
        node.force.set(0, 0, 0);
      }

      // XPBD iterations
      for (let iter = 0; iter < this.iterations; iter++) {
        this.solveEdges(h);
        this.solveVolumes(h);
        this.solveGround();
      }
    }
  }

  applyImpulse(dir: THREE.Vector3, magnitude: number) {
    for (const n of this.nodes) {
      const vel = this.tmp.copy(n.position).sub(n.prevPosition);
      vel.addScaledVector(dir, magnitude);
      n.prevPosition.copy(n.position).sub(vel);
    }
  }

  dragNode(nodeIndex: number, target: THREE.Vector3, stiffness = 0.8) {
    const n = this.nodes[nodeIndex];
    const to = this.tmp.copy(target).sub(n.position);
    n.position.addScaledVector(to, stiffness);
  }

  closestNodeIndex(p: THREE.Vector3, maxDist = 0.08) {
    let best = -1, bestD = maxDist * maxDist;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d2 = p.distanceToSquared(n.position);
      if (d2 < bestD) {
        best = i; bestD = d2;
      }
    }
    return best;
  }

  reset() {
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.restingNodes[i];
      const n = this.nodes[i];
      n.position.copy(p);
      n.prevPosition.copy(p);
      n.force.set(0, 0, 0);
    }
    for (const t of this.tets) t.lambda = 0;
  }

  private solveEdges(h: number) {
    const pA = new THREE.Vector3(), pB = new THREE.Vector3();
    for (const e of this.edges) {
      const a = this.nodes[e.i], b = this.nodes[e.j];
      pA.copy(a.position); pB.copy(b.position);
      const dir = pB.sub(pA);
      const len = dir.length() || 1e-9;
      const w1 = a.invMass, w2 = b.invMass;
      const wsum = w1 + w2;
      if (wsum === 0) continue;
      const diff = len - e.rest;
      const k = e.stiffness;
      const corrMag = -(diff) * k / (wsum);
      dir.multiplyScalar(corrMag / len);
      a.position.addScaledVector(dir, -w1);
      b.position.addScaledVector(dir, +w2);
    }
  }

  private solveVolumes(h: number) {
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
    for (const tet of this.tets) {
      const a = this.nodes[tet.a], b = this.nodes[tet.b], c = this.nodes[tet.c], d = this.nodes[tet.d];
      pa.copy(a.position); pb.copy(b.position); pc.copy(c.position); pd.copy(d.position);
      const volume = SoftBody.computeTetraVolume(pa, pb, pc, pd);
      const C = volume - tet.restVolume;

      // gradients
      const gradA = SoftBody.gradVolumeA(pa, pb, pc, pd);
      const gradB = SoftBody.gradVolumeB(pa, pb, pc, pd);
      const gradC = SoftBody.gradVolumeC(pa, pb, pc, pd);
      const gradD = SoftBody.gradVolumeD(pa, pb, pc, pd);

      const wA = a.invMass, wB = b.invMass, wC = c.invMass, wD = d.invMass;
      const denom =
        wA * gradA.lengthSq() +
        wB * gradB.lengthSq() +
        wC * gradC.lengthSq() +
        wD * gradD.lengthSq() +
        tet.compliance / (h * h);
      if (denom === 0) continue;

      const dl = (-C - tet.compliance * tet.lambda / (h * h)) / denom;
      tet.lambda += dl;

      a.position.addScaledVector(gradA, wA * dl);
      b.position.addScaledVector(gradB, wB * dl);
      c.position.addScaledVector(gradC, wC * dl);
      d.position.addScaledVector(gradD, wD * dl);
    }
  }

  private solveGround() {
    for (const n of this.nodes) {
      if (n.position.y < this.groundY) {
        const px = n.position.x, pz = n.position.z;
        const vy = n.position.y - n.prevPosition.y;
        // bounce-y
        n.position.y = this.groundY + 1e-4;
        n.prevPosition.y = n.position.y + Math.min(vy, 0) * -0.2; // dampen
        // friction-xz
        const vx = n.position.x - n.prevPosition.x;
        const vz = n.position.z - n.prevPosition.z;
        n.prevPosition.x = px - vx * (1 - this.groundFriction);
        n.prevPosition.z = pz - vz * (1 - this.groundFriction);
      }
    }
  }

  // Geometry helpers
  static computeTetraVolume(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    // V = (1/6) dot( (b-a) x (c-a), d-a )
    const ba = new THREE.Vector3().subVectors(b, a);
    const ca = new THREE.Vector3().subVectors(c, a);
    const da = new THREE.Vector3().subVectors(d, a);
    const cross = new THREE.Vector3().crossVectors(ba, ca);
    return cross.dot(da) / 6;
  }
  static gradVolumeA(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const cb = new THREE.Vector3().subVectors(c, b);
    const db = new THREE.Vector3().subVectors(d, b);
    return new THREE.Vector3().crossVectors(cb, db).multiplyScalar(-1 / 6);
  }
  static gradVolumeB(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const ca = new THREE.Vector3().subVectors(c, a);
    const da = new THREE.Vector3().subVectors(d, a);
    return new THREE.Vector3().crossVectors(ca, da).multiplyScalar(1 / 6);
  }
  static gradVolumeC(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const da = new THREE.Vector3().subVectors(d, a);
    const ba = new THREE.Vector3().subVectors(b, a);
    return new THREE.Vector3().crossVectors(da, ba).multiplyScalar(1 / 6);
  }
  static gradVolumeD(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const ba = new THREE.Vector3().subVectors(b, a);
    const ca = new THREE.Vector3().subVectors(c, a);
    return new THREE.Vector3().crossVectors(ba, ca).multiplyScalar(1 / 6);
  }
}

