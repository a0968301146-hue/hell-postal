import * as THREE from 'three';

/** Owns ONLY the requestAnimationFrame scheduling + delta-time clamp — what
 * actually happens each frame is the `onFrame` callback the owner (game-
 * app.ts) supplies, so this file stays orchestration-free and reusable. */
export class GameLoop {
  private clock = new THREE.Clock();
  private rafHandle: number | null = null;
  private readonly deltaTimeMax: number;
  private readonly onFrame: (deltaTime: number) => void;
  private readonly tick = (): void => {
    this.rafHandle = requestAnimationFrame(this.tick);
    let deltaTime = this.clock.getDelta();
    if (deltaTime > this.deltaTimeMax) deltaTime = this.deltaTimeMax;
    this.onFrame(deltaTime);
  };

  constructor(deltaTimeMax: number, onFrame: (deltaTime: number) => void) {
    this.deltaTimeMax = deltaTimeMax;
    this.onFrame = onFrame;
  }

  start(): void {
    this.clock.start();
    this.tick();
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }
}
