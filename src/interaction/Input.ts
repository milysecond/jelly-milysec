import * as THREE from 'three';

export class InputController {
  keys = new Set<string>();
  isPointerDown = false;
  pointer = new THREE.Vector2();
  onPointerDown?: (ndc: THREE.Vector2, evt: PointerEvent) => void;
  onPointerMove?: (ndc: THREE.Vector2, evt: PointerEvent) => void;
  onPointerUp?: (evt: PointerEvent) => void;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener('pointerdown', (e) => {
      this.isPointerDown = true;
      this.updatePointer(e);
      this.onPointerDown?.(this.pointer, e);
    });
    el.addEventListener('pointermove', (e) => {
      this.updatePointer(e);
      if (this.isPointerDown) this.onPointerMove?.(this.pointer, e);
    });
    window.addEventListener('pointerup', (e) => {
      this.isPointerDown = false;
      this.onPointerUp?.(e as PointerEvent);
    });
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    this.pointer.set(x * 2 - 1, -(y * 2 - 1));
  }

  computeMoveVector(camera: THREE.Camera) {
    // WASD/arrow relative to camera yaw
    let x = 0, z = 0;
    const keys = this.keys;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('w') || keys.has('arrowup')) z -= 1;
    if (keys.has('s') || keys.has('arrowdown')) z += 1;
    if (x === 0 && z === 0) return new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const out = new THREE.Vector3().addScaledVector(dir, z).addScaledVector(right, x);
    out.normalize();
    return out;
  }
}

export function setupJoystick() {
  const joy = document.getElementById('joystick') as HTMLDivElement;
  const stick = document.getElementById('stick') as HTMLDivElement;
  if (!('ontouchstart' in window)) {
    joy.classList.add('hidden');
    return {
      dir: new THREE.Vector3(),
      destroy() {}
    };
  }
  joy.classList.remove('hidden');
  let active = false;
  let cx = 64, cy = 64;
  let dx = 0, dy = 0;
  const onMove = (e: TouchEvent) => {
    if (!active) return;
    const t = e.touches[0];
    const rect = joy.getBoundingClientRect();
    dx = t.clientX - rect.left - cx;
    dy = t.clientY - rect.top - cy;
    const r = Math.hypot(dx, dy);
    const max = 46;
    if (r > max) { dx *= max / r; dy *= max / r; }
    stick.style.transform = `translate(${cx - 27 + dx}px, ${cy - 27 + dy}px)`;
  };
  joy.addEventListener('touchstart', (e) => { active = true; onMove(e); }, { passive: true });
  joy.addEventListener('touchmove', onMove, { passive: true });
  joy.addEventListener('touchend', () => {
    active = false; dx = dy = 0;
    stick.style.transform = `translate(${cx - 27}px, ${cy - 27}px)`;
  });
  return {
    get dir() {
      const v = new THREE.Vector3(dx / 46, 0, -dy / 46);
      return v.lengthSq() > 1e-3 ? v.normalize() : v.set(0, 0, 0);
    },
    destroy() {}
  };
}

