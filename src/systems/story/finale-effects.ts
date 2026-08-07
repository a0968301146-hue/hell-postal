import * as THREE from 'three';

// "每日特殊劇情系統" round — Day8 finale polish pass (spec: "拆開包裝時播放
// 拆繩/拆紙動畫...簡單粒子：彩帶/紙花/小煙火...播放派對音效...背景音樂切換
// 為派對版本"). Deliberately its own small, self-contained module — matches
// this codebase's own established convention (after-work-story-bubble-ui.ts,
// letter-reading-ui.ts) of splitting decorative helpers out of the main
// state-machine file. Nothing here reads or writes AfterWorkStorySystem's
// own state; it only ever touches the THREE.Scene it's given and its own
// private particle bookkeeping.

// --- Audio (spec follow-up 一/六: unwrap/cheer SFX, party BGM) ---
//
// No bundled audio ASSETS exist anywhere in this repo yet (confirmed via
// research: no .mp3/.wav/.ogg files, no AudioContext usage anywhere) — the
// one existing precedent, builtin-bgm-data.ts, documents exactly this same
// situation for the TV prop's own BGM slots ("real files go in
// public/audio/bgm/<file>.mp3", every slot `filePath: null, enabled: false`
// until one is actually dropped in). These helpers follow that identical
// convention: they always ATTEMPT playback at a fixed path and silently
// no-op if the file is missing (HTMLAudioElement's own play() rejection is
// swallowed, never thrown) — dropping a real file at the path below
// activates it for real, with zero code changes needed anywhere else.
const SFX_UNWRAP_PATH = '/audio/sfx/day8-unwrap.mp3';
const SFX_CHEER_PATH = '/audio/sfx/day8-cheer.mp3';
const BGM_PARTY_PATH = '/audio/bgm/day8-party.mp3';

function tryPlayOneShot(path: string, volume: number): void {
  try {
    const audio = new Audio(path);
    audio.volume = volume;
    void audio.play().catch(() => {
      // Missing/unsupported file — silent no-op, see this file's own doc
      // comment above.
    });
  } catch {
    // Same — some environments throw synchronously instead of rejecting.
  }
}

export function playUnwrapSfx(): void {
  tryPlayOneShot(SFX_UNWRAP_PATH, 0.7);
}

export function playCheerSfx(): void {
  tryPlayOneShot(SFX_CHEER_PATH, 0.6);
}

let partyBgmEl: HTMLAudioElement | null = null;

/** Starts looping once, the moment the party begins — safe to call more
 * than once (a second call while already playing is a no-op). */
export function startPartyBgm(): void {
  if (partyBgmEl) return;
  try {
    const audio = new Audio(BGM_PARTY_PATH);
    audio.loop = true;
    audio.volume = 0.35;
    partyBgmEl = audio;
    void audio.play().catch(() => {});
  } catch {
    // Silent no-op — see this file's own doc comment above.
  }
}

/** Fades the party BGM out over `fadeSeconds` (spec: "慢慢淡出", section五
 * — the music fades alongside the screen, not cut instantly) rather than
 * stopping it abruptly the instant credits begin. Purely a volume ramp on
 * an already-detached-from-state audio element — safe to let this keep
 * running after AfterWorkStorySystem itself reaches its own terminal state. */
export function stopPartyBgm(fadeSeconds = 2.0): void {
  if (!partyBgmEl) return;
  const el = partyBgmEl;
  partyBgmEl = null;
  const startVolume = el.volume;
  const startTime = performance.now();
  const step = (): void => {
    const t = Math.min(1, (performance.now() - startTime) / (fadeSeconds * 1000));
    el.volume = startVolume * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else el.pause();
  };
  requestAnimationFrame(step);
}

// --- Particles (spec follow-up 一: 彩帶/紙花/小煙火) ---

interface ConfettiParticle {
  kind: 'confetti';
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface SparkleParticle {
  kind: 'sparkle';
  points: THREE.Points;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

type FinaleParticle = ConfettiParticle | SparkleParticle;

function disposeParticleObject(obj: THREE.Mesh | THREE.Points): void {
  obj.geometry?.dispose();
  const mat = obj.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat?.dispose();
}

/** One burst controller, spawned fresh for the cake-open moment and ticked
 * from AfterWorkStorySystem's own update() loop alongside everything else
 * — kept entirely separate from the story state machine so a burst that's
 * still finishing never blocks or interacts with state transitions. */
export class FinaleParticleBurst {
  private scene: THREE.Scene;
  private particles: FinaleParticle[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Confetti + paper-flower streamers (spec: "彩帶、紙花") — small colored
   * planes flung outward and up, tumbling as they fall, fading over ~2s. */
  spawnConfetti(origin: THREE.Vector3, count = 26): void {
    const colors = [0xe8574f, 0xf2c744, 0x4fa8e8, 0x5fd18a, 0xe97fd1, 0xffffff];
    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      const geo = new THREE.PlaneGeometry(0.09, 0.15);
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.2;
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, 2.4 + Math.random() * 2.0, Math.sin(angle) * speed);
      const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7
      );
      this.scene.add(mesh);
      this.particles.push({ kind: 'confetti', mesh, velocity, angularVelocity, life: 0, maxLife: 1.7 + Math.random() * 0.6 });
    }
  }

  /** A handful of brief indoor "firework" sparkle bursts (spec: "小煙火，
   * 室內請控制數量") — small expanding point clouds that flash and fade in
   * under a second, deliberately few and modest (not real pyrotechnics). */
  spawnSparkleBursts(origin: THREE.Vector3, burstCount = 3): void {
    for (let b = 0; b < burstCount; b++) {
      const count = 14;
      const positions = new Float32Array(count * 3);
      const velocities: THREE.Vector3[] = [];
      const center = origin.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 2.4, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 2.4
      ));
      for (let i = 0; i < count; i++) {
        positions[i * 3] = center.x;
        positions[i * 3 + 1] = center.y;
        positions[i * 3 + 2] = center.z;
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize().multiplyScalar(1.1 + Math.random());
        velocities.push(dir);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0xfff2b0, size: 0.09, transparent: true, opacity: 1 });
      const points = new THREE.Points(geo, mat);
      this.scene.add(points);
      this.particles.push({ kind: 'sparkle', points, velocities, life: 0, maxLife: 0.6 + Math.random() * 0.2 });
    }
  }

  update(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += deltaTime;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        if (p.kind === 'confetti') { this.scene.remove(p.mesh); disposeParticleObject(p.mesh); }
        else { this.scene.remove(p.points); disposeParticleObject(p.points); }
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'confetti') {
        p.mesh.position.addScaledVector(p.velocity, deltaTime);
        p.velocity.y -= 2.6 * deltaTime;
        p.mesh.rotation.x += p.angularVelocity.x * deltaTime;
        p.mesh.rotation.y += p.angularVelocity.y * deltaTime;
        p.mesh.rotation.z += p.angularVelocity.z * deltaTime;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      } else {
        const posAttr = p.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < p.velocities.length; v++) {
          posAttr.setXYZ(
            v,
            posAttr.getX(v) + p.velocities[v].x * deltaTime,
            posAttr.getY(v) + p.velocities[v].y * deltaTime,
            posAttr.getZ(v) + p.velocities[v].z * deltaTime
          );
        }
        posAttr.needsUpdate = true;
        (p.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t);
      }
    }
  }

  /** True while any particle is still animating — lets the caller know when
   * it's safe to drop its own reference (not required to call update()
   * forever). */
  get isActive(): boolean {
    return this.particles.length > 0;
  }

  dispose(): void {
    for (const p of this.particles) {
      if (p.kind === 'confetti') { this.scene.remove(p.mesh); disposeParticleObject(p.mesh); }
      else { this.scene.remove(p.points); disposeParticleObject(p.points); }
    }
    this.particles = [];
  }
}
