export class ContactAudio {
  private ctx?: AudioContext;
  private lastTime = 0;
  private coolDown = 0.05;

  private ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
  }
  unlockOnFirstUserGesture(el: HTMLElement) {
    const resume = () => {
      this.ensure();
      this.ctx!.resume();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      el.removeEventListener('touchstart', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    el.addEventListener('touchstart', resume);
  }
  thump(intensity: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTime < this.coolDown) return;
    this.lastTime = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const freq = 180 + 260 * Math.max(0, Math.min(1, intensity));
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(Math.min(0.15, 0.03 + intensity * 0.2), now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08 + 0.12 * intensity);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }
}

