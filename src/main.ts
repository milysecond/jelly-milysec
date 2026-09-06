import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

import { createMilysecSlabGeometry, applyMilysecVertexColors } from './geometry/RoundedSlab';
import { SoftBody } from './sim/SoftBody';
import { buildSkinWeights, applySkin } from './skin/Skinner';
import { InputController, setupJoystick } from './interaction/Input';
import { ContactAudio } from './audio/ContactAudio';

const app = document.getElementById('app')!;

if (!WebGPU.isAvailable()) {
  app.innerHTML = `<div style="color:#cdf;font:16px/1.4 system-ui;padding:24px">Your browser does not support WebGPU yet. Please enable it (Chrome: chrome://flags/#enable-unsafe-webgpu) or try a recent Chrome/Edge build.</div>`;
  throw new Error('WebGPU not available');
}

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#070A08');

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0.6, 0.45, 0.9);
camera.lookAt(0, 0.15, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.8).texture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 0.2;
controls.maxDistance = 3.0;
controls.target.set(0, 0.12, 0);

// Table
{
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.2, 2.2),
    new THREE.MeshPhysicalMaterial({
      color: 0x121614,
      roughness: 0.8,
      metalness: 0.0,
      transmission: 0.0
    })
  );
  table.position.set(0, -0.1, 0);
  table.receiveShadow = false;
  scene.add(table);
}

// Build soft-body lattice and render mesh
const slabW = 0.28, slabH = 0.28, slabT = 0.10, cornerR = 0.08;
const geom = createMilysecSlabGeometry({ width: slabW, height: slabH, thickness: slabT, radius: cornerR });
applyMilysecVertexColors(geom, slabW, slabH, slabT);

const jellyMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.15,
  metalness: 0.0,
  transmission: 1.0,
  thickness: 0.18,
  ior: 1.38,
  attenuationColor: new THREE.Color('#08D592'),
  attenuationDistance: 1.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1,
  transparent: true
});

const jelly = new THREE.Mesh(geom, jellyMat);
scene.add(jelly);

// Physics model
const sim = new SoftBody({
  iterations: 8,
  substeps: 1,
  damping: 0.996,
  groundY: 0
});
sim.buildLatticeSlab({
  sizeX: slabW * 0.95,
  sizeY: slabH * 0.95,
  sizeZ: slabT * 0.9,
  radius: cornerR * 0.9,
  dims: { nx: 11, ny: 11, nz: 6 },
  edgeStiffness: 0.75,
  tetCompliance: 1e-5
});

// Skin weights
const restNodePositions = sim.restingNodes;
const restVerts = (geom.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
const skin = buildSkinWeights(restVerts, restNodePositions, 4);
const deformed = new Float32Array(restVerts.length);
const posAttr = new THREE.BufferAttribute(deformed, 3);
geom.setAttribute('position', posAttr);

// Interaction setup
const input = new InputController(renderer.domElement);
const joystick = setupJoystick();
const raycaster = new THREE.Raycaster();
let grabbedIndex = -1;
let grabDepth = 0.0;
let grabPoint = new THREE.Vector3();

function getGrabTarget(ndc: THREE.Vector2) {
  raycaster.setFromCamera(ndc, camera);
  const isect = raycaster.intersectObject(jelly, false)[0];
  if (!isect) return null;
  grabDepth = isect.distance;
  return isect.point;
}
input.onPointerDown = (ndc) => {
  const p = getGrabTarget(ndc);
  if (!p) return;
  // choose nearest node to intersection
  grabbedIndex = sim.closestNodeIndex(p, 0.10);
  grabPoint.copy(p);
};
input.onPointerMove = (ndc) => {
  if (grabbedIndex < 0) return;
  // project from screen using stored depth
  raycaster.setFromCamera(ndc, camera);
  const target = new THREE.Vector3();
  target.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, grabDepth);
  sim.dragNode(grabbedIndex, target, 0.85);
};
input.onPointerUp = () => { grabbedIndex = -1; };

const audio = new ContactAudio();
audio.unlockOnFirstUserGesture(renderer.domElement);
let lastGroundContactEnergy = 0;

// Controls: movement + hop + reset
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') sim.reset();
  if (e.code === 'Space') {
    sim.applyImpulse(new THREE.Vector3(0, 1, 0), 0.12);
  }
});

// Resize
window.addEventListener('resize', onResize);
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
onResize();

// Loop
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(1 / 30, clock.getDelta());
  controls.update();

  // movement impulses from keys + joystick
  const keyDir = input.computeMoveVector(camera);
  const joyDir = joystick.dir;
  const dir = keyDir.add(joyDir);
  if (dir.lengthSq() > 1e-4) {
    sim.applyImpulse(dir.normalize(), 0.05);
  }

  sim.step(dt);

  // simple contact audio: measure average downward velocity of nodes clamped at floor
  let contactEnergy = 0;
  for (const n of sim.nodes) {
    if (n.position.y <= 1e-4) {
      const vy = n.position.y - n.prevPosition.y;
      contactEnergy += Math.max(0, -vy);
    }
  }
  if (contactEnergy > lastGroundContactEnergy * 1.2 && contactEnergy > 0.01) {
    audio.thump(Math.min(1, contactEnergy * 20));
  }
  lastGroundContactEnergy = contactEnergy;

  // skinning
  const liveNodes = sim.nodes.map((n) => n.position);
  applySkin(skin, liveNodes, deformed);
  (jelly.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  jelly.geometry.computeVertexNormals();

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

