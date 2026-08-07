import * as THREE from 'three';

export interface ParticleBurstOptions {
  color: number;
  count: number;
  size: number;
  /** Initial random speed range (m/s) applied outward from origin. */
  speedMin: number;
  speedMax: number;
  /** How long the burst lives before fully fading out and disposing itself. */
  durationSeconds: number;
  /** Downward acceleration (m/s^2) — 0 for weightless effects (sparkles, hearts). */
  gravity?: number;
  opacity?: number;
}

/**
 * A short-lived THREE.Points burst (sparkle/heart/star/etc.) — spawn once,
 * call update() every frame, and it disposes itself the instant it's done
 * (spec, both for lost-found cleaning sparkle and living-cargo soothing
 * hearts/notes/stars: "播放一些粒子...約1秒左右", nothing persistent). Never
 * a global particle manager — each caller owns its own instance and is
 * responsible for dropping its reference once `done` is true.
 */
export class ParticleBurst {
  done = false;

  private scene: THREE.Scene;
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private velocities: Float32Array;
  private gravity: number;
  private duration: number;
  private baseOpacity: number;
  private elapsed = 0;

  constructor(scene: THREE.Scene, origin: THREE.Vector3, opts: ParticleBurstOptions) {
    this.scene = scene;
    this.gravity = opts.gravity ?? 0;
    this.duration = opts.durationSeconds;
    this.baseOpacity = opts.opacity ?? 0.9;

    const positions = new Float32Array(opts.count * 3);
    this.velocities = new Float32Array(opts.count * 3);
    for (let i = 0; i < opts.count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.4, Math.random() - 0.5).normalize();
      const speed = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
      this.velocities[i * 3] = dir.x * speed;
      this.velocities[i * 3 + 1] = dir.y * speed;
      this.velocities[i * 3 + 2] = dir.z * speed;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: opts.color, size: opts.size, transparent: true, opacity: this.baseOpacity,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  /** Follows a moving anchor (e.g. the held-item viewmodel) by re-basing
   * every particle's position each frame — used while the effect plays on
   * something the player is carrying, so the burst doesn't hang in empty
   * air as the player walks/looks around. */
  setOrigin(origin: THREE.Vector3): void {
    this.points.position.copy(origin);
  }

  update(deltaTime: number): void {
    if (this.done) return;
    this.elapsed += deltaTime;
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      this.velocities[i * 3 + 1] -= this.gravity * deltaTime;
      posAttr.setXYZ(
        i,
        posAttr.getX(i) + this.velocities[i * 3] * deltaTime,
        posAttr.getY(i) + this.velocities[i * 3 + 1] * deltaTime,
        posAttr.getZ(i) + this.velocities[i * 3 + 2] * deltaTime
      );
    }
    posAttr.needsUpdate = true;

    const t = this.elapsed / this.duration;
    this.material.opacity = this.baseOpacity * Math.max(0, 1 - t);

    if (this.elapsed >= this.duration) this.dispose();
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

export interface MistEmitterOptions {
  color: number;
  size: number;
  count: number;
  /** Particles drift downward within this half-height box, resetting to the
   * top the instant they fall past the bottom — a fixed working-set size, no
   * per-frame allocation. */
  halfExtents: THREE.Vector3;
  fallSpeed: number;
  driftSpeed: number;
  opacity?: number;
}

/**
 * A CONTINUOUS, low-density looping particle volume ("冷藏貨架粒子效果" round
 * spec二: "持續播放、低密度、循環即可") — unlike ParticleBurst above this
 * never finishes on its own; the owning system calls update() every frame
 * for as long as the effect should exist and dispose() once (e.g. on
 * shutdown, though in practice freezer cabinets live for the whole session).
 */
export class MistEmitter {
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private velocities: Float32Array;
  private origin: THREE.Vector3;
  private halfExtents: THREE.Vector3;

  constructor(scene: THREE.Scene, origin: THREE.Vector3, opts: MistEmitterOptions) {
    this.origin = origin.clone();
    this.halfExtents = opts.halfExtents;

    const positions = new Float32Array(opts.count * 3);
    this.velocities = new Float32Array(opts.count * 3);
    for (let i = 0; i < opts.count; i++) {
      this.resetParticle(positions, this.velocities, i, opts, true);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: opts.color, size: opts.size, transparent: true, opacity: opts.opacity ?? 0.35,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
    this.opts = opts;
  }

  private opts: MistEmitterOptions;

  private resetParticle(positions: Float32Array, velocities: Float32Array, i: number, opts: MistEmitterOptions, initialSpawn: boolean): void {
    const hx = opts.halfExtents.x, hy = opts.halfExtents.y, hz = opts.halfExtents.z;
    positions[i * 3] = this.origin.x + (Math.random() - 0.5) * 2 * hx;
    positions[i * 3 + 1] = this.origin.y + (initialSpawn ? (Math.random() - 0.5) * 2 * hy : hy);
    positions[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * 2 * hz;
    velocities[i * 3] = (Math.random() - 0.5) * opts.driftSpeed;
    velocities[i * 3 + 1] = -(opts.fallSpeed * (0.6 + Math.random() * 0.6));
    velocities[i * 3 + 2] = (Math.random() - 0.5) * opts.driftSpeed;
  }

  update(deltaTime: number): void {
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bottomY = this.origin.y - this.halfExtents.y;
    for (let i = 0; i < posAttr.count; i++) {
      let x = posAttr.getX(i) + this.velocities[i * 3] * deltaTime;
      let y = posAttr.getY(i) + this.velocities[i * 3 + 1] * deltaTime;
      let z = posAttr.getZ(i) + this.velocities[i * 3 + 2] * deltaTime;
      if (y < bottomY) {
        const tmpPos = new Float32Array(3);
        const tmpVel = new Float32Array(3);
        this.resetParticle(tmpPos, tmpVel, 0, this.opts, false);
        x = tmpPos[0]; y = tmpPos[1]; z = tmpPos[2];
        this.velocities[i * 3] = tmpVel[0];
        this.velocities[i * 3 + 1] = tmpVel[1];
        this.velocities[i * 3 + 2] = tmpVel[2];
      }
      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
