import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { CargoSystem } from './cargo-system';
import { DailyFlowSystem } from './daily-flow-system';
import {
  UNLOAD_GATE, UNLOAD_CHUTE, UNLOAD_SPAWN_POINTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z,
  UNLOAD_BUTTON_POS, DAILY_CARGO_CONFIG, UNLOAD_BURST_CONFIG,
} from './daily-flow-data';
import { CARGO_BOX_PRESETS, CARGO_ROLLER_PRESETS, CARGO_LARGE_PRESETS, CargoSubtypePreset } from './cargo-data';
import { BACK_AREA } from './logistics-layout-data';
import { SCENE_CONFIG } from './scene-manager';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';

const IDLE_TEXT = '開始卸貨\n按 E 卸貨';
const RUNNING_TEXT = '卸貨裝置運作中';
const ALREADY_TEXT = '今日貨品已經送達\n請先完成今日整理';

type UnloadPhase = 'idle' | 'gateOpening' | 'chargingUp' | 'spawning' | 'waveGap' | 'settling' | 'gateClosing';

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Owns the north unload dock's physical performance — spec "貨品外型與比例
 * 有更多變化" round section三/四/五: gate open, brief charge-up, then the
 * day's cargo bursts out in a few waves with real launch velocity (not the
 * old one-at-a-time gentle slide), plus the 開始卸貨 button that kicks it
 * off. Reports state transitions to DailyFlowSystem (notifyUnloadingStarted/
 * registerDailyCargo/notifyUnloadingFinished) rather than owning the day's
 * state itself.
 */
export class UnloadingSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private onFirstUnload?: () => void;

  private gateMesh!: THREE.Mesh;
  private gateMat!: THREE.MeshStandardMaterial;
  private gateClosedY!: number;
  private gateOpenY!: number;
  private gateBaseX!: number;
  private buttonLabel!: THREE.Sprite;

  private phase: UnloadPhase = 'idle';
  private gateAnimT = 0; // 0 = closed, 1 = open
  private chargeTimer = 0;
  private settleTimer = 0;
  private itemTimer = 0;
  private nextItemInterval = 0;
  private waveGapTimer = 0;
  private nextWaveGap = 0;
  private waveIndex = 0;
  private itemIndexInWave = 0;
  private spawnPlan: CargoSubtypePreset[][] = [];
  private spawnedIds: string[] = [];
  /** Brief decaying jitter applied to the gate/chute on each burst event
   * (spec五: "噴射時牆面裝置輕微震動") — counts down to 0 each frame. */
  private deviceShakeTimer = 0;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, dailyFlowSystem: DailyFlowSystem,
    onFirstUnload?: () => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.onFirstUnload = onFirstUnload;
    this.buildChute();
    this.buildGate();
    this.buildButton();
  }

  private buildChute(): void {
    const { topX, topY, topZ, bottomX, bottomZ, width, thickness } = UNLOAD_CHUTE;
    const bottomY = BACK_AREA.floorY;
    const rise = topY - bottomY;
    const run = bottomZ - topZ;
    const length = Math.sqrt(rise * rise + run * run);
    // Same convention as scene-manager.ts's buildRamp(): positive angle
    // tilts the box's +Z-local end DOWN and further +Z, i.e. sloping down
    // from the gate (topZ) toward the room interior (bottomZ). Cargo no
    // longer slides down this (it launches on its own trajectory instead),
    // but the ramp housing stays as the physical "launch tube" the burst
    // mechanism protrudes from (spec四: "牆面裝置").
    const angle = Math.atan2(rise, run);

    const cx = (topX + bottomX) / 2;
    const cy = (topY + bottomY) / 2;
    const cz = (topZ + bottomZ) / 2;

    const geo = new THREE.BoxGeometry(width, thickness, length);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x777a70 }));
    mesh.position.set(cx, cy, cz);
    mesh.rotation.x = angle;
    this.scene.add(mesh);

    this.physics.createStaticCuboidRotatedX(cx, cy, cz, width / 2, thickness / 2, length / 2, angle, 0.3);

    // "卸貨區" floating label, centered over the drop zone — separate from
    // the gate's own label below (spec: "卸貨區漂浮文字改為：「卸貨區」").
    const zoneLabel = createFloatingLabel('卸貨區', { width: 0.8, bg: 'rgba(30,30,20,0.75)' });
    zoneLabel.position.set(topX, BACK_AREA.floorY + 1.6, (topZ + bottomZ) / 2 + 1.0);
    this.scene.add(zoneLabel);
  }

  private buildGate(): void {
    const { centerX, centerZ, width, height, thickness, openOffsetY } = UNLOAD_GATE;
    this.gateClosedY = BACK_AREA.floorY + height / 2;
    this.gateOpenY = this.gateClosedY + openOffsetY;
    this.gateBaseX = centerX;

    const geo = new THREE.BoxGeometry(width, height, thickness);
    this.gateMat = new THREE.MeshStandardMaterial({ color: 0x5a4a35, emissive: 0x000000 });
    const mesh = new THREE.Mesh(geo, this.gateMat);
    mesh.position.set(centerX, this.gateClosedY, centerZ);
    this.scene.add(mesh);
    this.gateMesh = mesh;

    // Permanent invisible safety collider spanning the FULL wall opening
    // (floor to ceiling) — stays solid at all times regardless of the
    // visual panel's open/close animation, so nothing can ever physically
    // cross this wall plane in either direction (spec: "防止貨品飛出場景的
    // 隱藏安全碰撞"). Cargo always spawns already on the room side of this
    // plane, so it never needs to cross it.
    this.physics.createStaticCuboid(centerX, BACK_AREA.floorY + BACK_AREA.ceilingHeight / 2, centerZ, width / 2, BACK_AREA.ceilingHeight / 2, thickness / 2);

    const label = createFloatingLabel('北側卸貨口', { width: 0.9, bg: 'rgba(30,30,20,0.75)' });
    label.position.set(centerX + 0.6, this.gateClosedY + height / 2 + 0.5, centerZ);
    this.scene.add(label);
  }

  private buildButton(): void {
    const floorY = BACK_AREA.floorY;
    const postHeight = 0.9;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, postHeight, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x444444 })
    );
    post.position.set(UNLOAD_BUTTON_POS.x, floorY + postHeight / 2, UNLOAD_BUTTON_POS.z);
    this.scene.add(post);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: 0x3aa8d8 })
    );
    cap.position.set(UNLOAD_BUTTON_POS.x, floorY + postHeight + 0.02, UNLOAD_BUTTON_POS.z);
    this.scene.add(cap);

    this.physics.createStaticCuboid(UNLOAD_BUTTON_POS.x, floorY + postHeight / 2, UNLOAD_BUTTON_POS.z, 0.11, postHeight / 2, 0.11);

    this.buttonLabel = createFloatingLabel(IDLE_TEXT, { width: 1.0, bg: 'rgba(20,35,45,0.75)' });
    this.buttonLabel.position.set(UNLOAD_BUTTON_POS.x, floorY + postHeight + 0.5, UNLOAD_BUTTON_POS.z);
    this.scene.add(this.buttonLabel);
  }

  /** Straight-line distance to this button — used by InteractionSystem to
   * resolve the nearest-wins tie-break against DailyFlowSystem's 結束今天
   * button, which sits close by in the same north unload-dock cluster (spec
   * section 十九: "四個按鈕不要互相重疊" — same pattern as
   * VehicleControlSystem's own call/depart nearest-button resolution). */
  buttonDistance(pos: THREE.Vector3): number {
    const dx = pos.x - UNLOAD_BUTTON_POS.x;
    const dz = pos.z - UNLOAD_BUTTON_POS.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  isPlayerNearButton(pos: THREE.Vector3): boolean {
    return this.buttonDistance(pos) < SCENE_CONFIG.interactionDistance + 1;
  }

  get canStartUnloading(): boolean {
    return this.dailyFlowSystem.state === 'ready' && this.phase === 'idle';
  }

  startBlockedMessage(): string {
    if (this.dailyFlowSystem.state === 'unloading') return RUNNING_TEXT;
    return ALREADY_TEXT;
  }

  pressButton(): void {
    if (!this.canStartUnloading) return;

    this.onFirstUnload?.();
    this.dailyFlowSystem.notifyUnloadingStarted();
    this.phase = 'gateOpening';
    this.gateAnimT = 0;
    this.spawnPlan = this.buildSpawnPlan();
    this.waveIndex = 0;
    this.itemIndexInWave = 0;
    this.spawnedIds = [];
    this.chargeTimer = 0;
    updateFloatingLabel(this.buttonLabel, RUNNING_TEXT);
  }

  /** 12 box + 4 roller + 2 large (DAILY_CARGO_CONFIG), cycling through each
   * category's preset list (repeating with variety, not just one silhouette
   * over and over) then shuffled and dealt round-robin into
   * UNLOAD_BURST_CONFIG.waveCount waves — spec四: "第一波6件/第二波6件/第三
   * 波6件" for the default 18/3 config, and generalizes cleanly if the
   * totals in daily-flow-data.ts ever change. */
  private buildSpawnPlan(): CargoSubtypePreset[][] {
    const boxPresets = Object.values(CARGO_BOX_PRESETS);
    const rollerPresets = Object.values(CARGO_ROLLER_PRESETS);
    const largePresets = Object.values(CARGO_LARGE_PRESETS);

    const items: CargoSubtypePreset[] = [];
    for (let i = 0; i < DAILY_CARGO_CONFIG.boxCount; i++) items.push(boxPresets[i % boxPresets.length]);
    for (let i = 0; i < DAILY_CARGO_CONFIG.rollerCount; i++) items.push(rollerPresets[i % rollerPresets.length]);
    for (let i = 0; i < DAILY_CARGO_CONFIG.largeCount; i++) items.push(largePresets[i % largePresets.length]);

    const shuffled = shuffle(items);
    const waveCount = Math.max(1, UNLOAD_BURST_CONFIG.waveCount);
    const waves: CargoSubtypePreset[][] = Array.from({ length: waveCount }, () => []);
    shuffled.forEach((item, i) => waves[i % waveCount].push(item));
    return waves;
  }

  /** Launches one item with real burst velocity (spec三/四) — a random
   * UNLOAD_SPAWN_POINTS entry (plus small jitter) so consecutive items don't
   * all fire from one exact point, forward/up/lateral speed ranges from
   * UNLOAD_BURST_CONFIG, and a random angular velocity so it visibly tumbles
   * in the air. Sets linear/angular velocity directly (not an impulse) so
   * the launch speed is consistent regardless of the item's mass. */
  private spawnOne(preset: CargoSubtypePreset): string {
    const point = UNLOAD_SPAWN_POINTS[Math.floor(Math.random() * UNLOAD_SPAWN_POINTS.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const z = point.z + jitterZ;
    const y = UNLOAD_CHUTE.topY + 0.35;

    let id: string;
    if (preset.shapeType === 'roller') {
      const yawVariance = (Math.random() - 0.5) * 1.4;
      id = this.cargoSystem.spawnDailyRoller(preset, x, y, z, yawVariance);
    } else {
      const rotY = (Math.random() - 0.5) * Math.PI;
      id = this.cargoSystem.spawnDailyBox(preset, x, y, z, rotY);
    }

    const obj = this.cargoSystem.getInteractable(id);
    if (obj?.rigidBody) {
      const forward = randRange(UNLOAD_BURST_CONFIG.forwardSpeedMin, UNLOAD_BURST_CONFIG.forwardSpeedMax);
      const up = randRange(UNLOAD_BURST_CONFIG.upSpeedMin, UNLOAD_BURST_CONFIG.upSpeedMax);
      const lateral = randRange(UNLOAD_BURST_CONFIG.lateralSpeedMin, UNLOAD_BURST_CONFIG.lateralSpeedMax);
      obj.rigidBody.setLinvel({ x: lateral, y: up, z: forward }, true);

      const amax = UNLOAD_BURST_CONFIG.angularSpeedMax;
      obj.rigidBody.setAngvel({
        x: (Math.random() - 0.5) * 2 * amax,
        y: (Math.random() - 0.5) * 2 * amax,
        z: (Math.random() - 0.5) * 2 * amax,
      }, true);
    }

    this.deviceShakeTimer = 0.15;
    return id;
  }

  update(deltaTime: number): void {
    this.updateDeviceShake(deltaTime);

    switch (this.phase) {
      case 'gateOpening': {
        this.gateAnimT = Math.min(1, this.gateAnimT + deltaTime / UNLOAD_GATE.openDuration);
        this.gateMesh.position.y = THREE.MathUtils.lerp(this.gateClosedY, this.gateOpenY, this.gateAnimT);
        if (this.gateAnimT >= 1) {
          this.phase = 'chargingUp';
          this.chargeTimer = 0;
        }
        break;
      }
      case 'chargingUp': {
        // Brief visual buildup before the first wave (spec三: "裝置短暫蓄
        // 力"；spec五: "到貨口內部短暫亮起") — a gently rising emissive glow,
        // no flash/no screen effects.
        this.chargeTimer += deltaTime;
        const t = Math.min(1, this.chargeTimer / UNLOAD_BURST_CONFIG.chargeUpDuration);
        this.gateMat.emissive.setRGB(t * 0.35, t * 0.28, t * 0.05);
        if (this.chargeTimer >= UNLOAD_BURST_CONFIG.chargeUpDuration) {
          this.gateMat.emissive.setRGB(0, 0, 0);
          this.phase = 'spawning';
          this.itemTimer = 0;
          this.nextItemInterval = randRange(UNLOAD_BURST_CONFIG.itemIntervalMin, UNLOAD_BURST_CONFIG.itemIntervalMax);
          this.deviceShakeTimer = 0.2; // small kick as the first wave fires
        }
        break;
      }
      case 'spawning': {
        this.itemTimer += deltaTime;
        if (this.itemTimer >= this.nextItemInterval) {
          this.itemTimer = 0;
          const wave = this.spawnPlan[this.waveIndex];
          const preset = wave[this.itemIndexInWave];
          const id = this.spawnOne(preset);
          this.spawnedIds.push(id);
          this.itemIndexInWave++;
          this.nextItemInterval = randRange(UNLOAD_BURST_CONFIG.itemIntervalMin, UNLOAD_BURST_CONFIG.itemIntervalMax);

          if (this.itemIndexInWave >= wave.length) {
            this.waveIndex++;
            this.itemIndexInWave = 0;
            if (this.waveIndex >= this.spawnPlan.length) {
              this.dailyFlowSystem.registerDailyCargo(this.spawnedIds);
              this.phase = 'settling';
              this.settleTimer = 0;
            } else {
              this.phase = 'waveGap';
              this.waveGapTimer = 0;
              this.nextWaveGap = randRange(UNLOAD_BURST_CONFIG.waveGapMin, UNLOAD_BURST_CONFIG.waveGapMax);
            }
          }
        }
        break;
      }
      case 'waveGap': {
        this.waveGapTimer += deltaTime;
        if (this.waveGapTimer >= this.nextWaveGap) {
          this.phase = 'spawning';
          this.itemTimer = 0;
          this.nextItemInterval = randRange(UNLOAD_BURST_CONFIG.itemIntervalMin, UNLOAD_BURST_CONFIG.itemIntervalMax);
          this.deviceShakeTimer = 0.2; // small kick as the next wave fires
        }
        break;
      }
      case 'settling': {
        this.settleTimer += deltaTime;
        if (this.settleTimer >= UNLOAD_BURST_CONFIG.settleAfterLastItem) {
          this.phase = 'gateClosing';
        }
        break;
      }
      case 'gateClosing': {
        this.gateAnimT = Math.max(0, this.gateAnimT - deltaTime / UNLOAD_GATE.openDuration);
        this.gateMesh.position.y = THREE.MathUtils.lerp(this.gateClosedY, this.gateOpenY, this.gateAnimT);
        if (this.gateAnimT <= 0) {
          this.phase = 'idle';
          updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
          this.dailyFlowSystem.notifyUnloadingFinished();
        }
        break;
      }
    }
  }

  /** Small decaying side-to-side jitter on the gate panel (spec五: "閘門震
   * 動...噴射時牆面裝置輕微震動") — purely cosmetic, no camera shake, no
   * screen effects, just the gate mesh itself wobbling briefly. */
  private updateDeviceShake(deltaTime: number): void {
    if (this.deviceShakeTimer <= 0) return;
    this.deviceShakeTimer = Math.max(0, this.deviceShakeTimer - deltaTime);
    const amount = this.deviceShakeTimer / 0.2;
    this.gateMesh.position.x = this.gateBaseX + Math.sin(this.deviceShakeTimer * 90) * 0.02 * amount;
    if (this.deviceShakeTimer <= 0) this.gateMesh.position.x = this.gateBaseX;
  }

  /** End-of-day reset (spec: "卸貨閘門/卸貨按鈕狀態"). Only ever called
   * once DailyFlowSystem has confirmed the day's cargo is fully cleared, so
   * phase is always 'idle' here already — reset defensively anyway. */
  resetGate(): void {
    this.phase = 'idle';
    this.gateAnimT = 0;
    this.gateMesh.position.y = this.gateClosedY;
    this.gateMesh.position.x = this.gateBaseX;
    this.gateMat.emissive.setRGB(0, 0, 0);
    this.deviceShakeTimer = 0;
    updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
  }
}
