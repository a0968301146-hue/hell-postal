import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { CargoSystem } from './cargo-system';
import { DailyFlowSystem } from './daily-flow-system';
import {
  UNLOAD_GATE, UNLOAD_CHUTE, UNLOAD_SPAWN_POINT, UNLOAD_SPAWN_INTERVAL,
  UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_SPAWN_IMPULSE_X,
  UNLOAD_BUTTON_POS, DAILY_BOX_COUNT, DAILY_ROLLER_COUNT,
  DAILY_BOX_SIZE_PRESETS, DAILY_ROLLER_SIZE_PRESETS,
} from './daily-flow-data';
import { BACK_AREA } from './logistics-layout-data';
import { SCENE_CONFIG } from './scene-manager';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';

const IDLE_TEXT = '開始卸貨\n按 E 卸貨';
const RUNNING_TEXT = '卸貨裝置運作中';
const ALREADY_TEXT = '今日貨品已經送達\n請先完成今日整理';

type UnloadPhase = 'idle' | 'gateOpening' | 'spawning' | 'settling' | 'gateClosing';

type SpawnPlan = { kind: 'box'; presetIndex: number } | { kind: 'roller'; presetIndex: number };

/**
 * Owns the west unload dock's physical performance: the gate panel's open/
 * close animation, the short chute, and the timed one-at-a-time spawn
 * sequence — plus the 開始卸貨 button that kicks it off. Reports state
 * transitions to DailyFlowSystem (notifyUnloadingStarted/registerDailyCargo/
 * notifyUnloadingFinished) rather than owning the day's state itself (spec
 * "每日貨品清空核心流程" section 二十三).
 */
export class UnloadingSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private onFirstUnload?: () => void;

  private gateMesh!: THREE.Mesh;
  private gateClosedY!: number;
  private gateOpenY!: number;
  private buttonLabel!: THREE.Sprite;

  private phase: UnloadPhase = 'idle';
  private gateAnimT = 0; // 0 = closed, 1 = open
  private settleTimer = 0;
  private spawnTimer = 0;
  private spawnPlan: SpawnPlan[] = [];
  private spawnIndex = 0;
  private spawnedIds: string[] = [];

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
    const run = bottomX - topX;
    const length = Math.sqrt(rise * rise + run * run);
    const angle = -Math.atan2(rise, run); // tilt down toward +X (into the room)

    const cx = (topX + bottomX) / 2;
    const cy = (topY + bottomY) / 2;
    const cz = (topZ + bottomZ) / 2;

    const geo = new THREE.BoxGeometry(length, thickness, width);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x777a70 }));
    mesh.position.set(cx, cy, cz);
    mesh.rotation.z = angle;
    this.scene.add(mesh);

    // Tilted static collider — same rotated-cuboid pattern the cargo ramp
    // uses (createStaticCuboidRotatedX), but rotated about Z since this
    // chute runs along world X instead of Z.
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    this.physics.createStaticCuboidRotated(cx, cy, cz, length / 2, thickness / 2, width / 2, quat, 0.3);
  }

  private buildGate(): void {
    const { centerX, centerZ, width, height, thickness, openOffsetY } = UNLOAD_GATE;
    this.gateClosedY = BACK_AREA.floorY + height / 2;
    this.gateOpenY = this.gateClosedY + openOffsetY;

    const geo = new THREE.BoxGeometry(thickness, height, width);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4a35 }));
    mesh.position.set(centerX, this.gateClosedY, centerZ);
    this.scene.add(mesh);
    this.gateMesh = mesh;

    // Permanent invisible safety collider spanning the FULL wall opening
    // (floor to ceiling) — stays solid at all times regardless of the
    // visual panel's open/close animation, so nothing can ever physically
    // cross this wall plane in either direction (spec 五/九: "防止貨品飛出
    // 場景的隱藏安全碰撞"). Cargo always spawns already on the room side of
    // this plane (see UNLOAD_SPAWN_POINT), so it never needs to cross it.
    this.physics.createStaticCuboid(centerX, BACK_AREA.floorY + BACK_AREA.ceilingHeight / 2, centerZ, thickness / 2, BACK_AREA.ceilingHeight / 2, width / 2);

    const label = createFloatingLabel('西側卸貨口', { width: 0.9, bg: 'rgba(30,30,20,0.75)' });
    label.position.set(centerX + 0.4, this.gateClosedY + height / 2 + 0.5, centerZ);
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

  isPlayerNearButton(pos: THREE.Vector3): boolean {
    const dx = pos.x - UNLOAD_BUTTON_POS.x;
    const dz = pos.z - UNLOAD_BUTTON_POS.z;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
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
    this.spawnIndex = 0;
    this.spawnedIds = [];
    this.spawnTimer = 0;
    updateFloatingLabel(this.buttonLabel, RUNNING_TEXT);
  }

  private buildSpawnPlan(): SpawnPlan[] {
    const plan: SpawnPlan[] = [];
    for (let i = 0; i < DAILY_BOX_COUNT; i++) plan.push({ kind: 'box', presetIndex: i % DAILY_BOX_SIZE_PRESETS.length });
    for (let i = 0; i < DAILY_ROLLER_COUNT; i++) plan.push({ kind: 'roller', presetIndex: i % DAILY_ROLLER_SIZE_PRESETS.length });
    // Shuffle so box/roller drop order (and which box size lands when)
    // varies each day (spec 八: "掉落順序" may vary, total/ratio may not).
    for (let i = plan.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [plan[i], plan[j]] = [plan[j], plan[i]];
    }
    return plan;
  }

  private spawnOne(item: SpawnPlan): string {
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = UNLOAD_SPAWN_POINT.x + jitterX;
    const z = UNLOAD_SPAWN_POINT.z + jitterZ;
    const y = UNLOAD_CHUTE.topY + 0.5;

    let id: string;
    if (item.kind === 'box') {
      const size = DAILY_BOX_SIZE_PRESETS[item.presetIndex];
      const rotY = (Math.random() - 0.5) * 0.6;
      id = this.cargoSystem.spawnDailyBox(size, x, y, z, rotY);
    } else {
      const { radius, length } = DAILY_ROLLER_SIZE_PRESETS[item.presetIndex];
      const yawVariance = (Math.random() - 0.5) * 1.2;
      id = this.cargoSystem.spawnDailyRoller(radius, length, x, y, z, yawVariance);
    }

    const obj = this.cargoSystem.getInteractable(id);
    if (obj?.rigidBody) {
      const impulse = { x: UNLOAD_SPAWN_IMPULSE_X * (0.8 + Math.random() * 0.4), y: 0, z: -jitterZ * 0.6 };
      obj.rigidBody.applyImpulse(impulse, true);
    }
    return id;
  }

  update(deltaTime: number): void {
    switch (this.phase) {
      case 'gateOpening': {
        this.gateAnimT = Math.min(1, this.gateAnimT + deltaTime / UNLOAD_GATE.openDuration);
        this.gateMesh.position.y = THREE.MathUtils.lerp(this.gateClosedY, this.gateOpenY, this.gateAnimT);
        if (this.gateAnimT >= 1) {
          this.phase = 'spawning';
          this.spawnTimer = 0;
        }
        break;
      }
      case 'spawning': {
        this.spawnTimer += deltaTime;
        if (this.spawnTimer >= UNLOAD_SPAWN_INTERVAL) {
          this.spawnTimer = 0;
          const item = this.spawnPlan[this.spawnIndex];
          const id = this.spawnOne(item);
          this.spawnedIds.push(id);
          this.spawnIndex++;
          if (this.spawnIndex >= this.spawnPlan.length) {
            this.dailyFlowSystem.registerDailyCargo(this.spawnedIds);
            this.phase = 'settling';
            this.settleTimer = 0;
          }
        }
        break;
      }
      case 'settling': {
        this.settleTimer += deltaTime;
        if (this.settleTimer >= 0.6) {
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

  /** End-of-day reset (spec 二十: "卸貨閘門/卸貨按鈕狀態"). Only ever called
   * once DailyFlowSystem has confirmed the day's cargo is fully cleared, so
   * phase is always 'idle' here already — reset defensively anyway. */
  resetGate(): void {
    this.phase = 'idle';
    this.gateAnimT = 0;
    this.gateMesh.position.y = this.gateClosedY;
    updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
  }
}
