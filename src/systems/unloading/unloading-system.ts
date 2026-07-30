import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { CargoSystem, CargoShapePreset, CargoRegion } from '../cargo';
import { buildDailyCargoManifest } from '../cargo/cargo-manifest-planner';
import {
  DailyFlowSystem, UNLOAD_PORTS, UnloadPortConfig, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z,
  UNLOAD_BUTTON_POS, UNLOAD_BURST_CONFIG,
} from '../daily-flow';
import { BACK_AREA } from '../world-layout';
import { SCENE_CONFIG } from '../world-layout';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';

const IDLE_TEXT = '開始卸貨\n按 E 卸貨';
const RUNNING_TEXT = '卸貨裝置運作中';
const ALREADY_TEXT = '今日貨品已經送達\n請先完成今日整理';

type UnloadPhase = 'idle' | 'gateOpening' | 'chargingUp' | 'spawning' | 'waveGap' | 'settling' | 'gateClosing';

/** "Add playable envelope presets and fix unloading spawn jams" round spec
 * 一/四 — anti-jam tuning, kept together rather than scattered as magic
 * numbers through spawnOne/updateStuckRecovery. */
const CEILING_CLEARANCE_BUFFER = 0.15;
/** How little an item may move over STUCK_TIME_THRESHOLD before it's
 * considered genuinely wedged (spec四: "位移小於最低門檻"). */
const STUCK_DISPLACEMENT_THRESHOLD = 0.05;
const STUCK_TIME_THRESHOLD = 2.0;
/** Elongated/large cargo keeps only a SMALL amount of spawn-time rotation
 * variety (spec三: "保留少量隨機旋轉，但不可讓長型貨物一生成就橫卡在出
 * 口") — normal-sized items keep the full range for visual tumbling variety. */
const LARGE_ITEM_ROT_Y_RANGE = Math.PI / 6;
const LARGE_ITEM_ANGULAR_SCALE = 0.3;

/** Runtime bookkeeping for one spawned item's anti-stuck watch (spec四:
 * "每件新生成物品記錄：spawnTime／lastPosition／stuckDuration"). Only cargo
 * items UnloadingSystem itself spawns are tracked — this round's other
 * (shared-config) changes reduce jam risk for MailSystem's own envelope
 * spawns without needing to track them individually here, since this file
 * has no reference to MailSystem/its own envelope ids (out of scope for
 * this round — "只修改 UnloadingSystem 與卸貨口生成設定"). */
interface StuckWatchEntry {
  portIndex: number;
  lastPosition: THREE.Vector3;
  stuckDuration: number;
}

/** One spawn-plan entry: which preset+region (from the day's quota-based
 * manifest, cargo-manifest-planner.ts), and which UNLOAD_PORTS index it
 * launches from (spec "Add dual elevated unloading ports and day-one
 * special cargo" round 三: "兩個到貨口可交錯生成"). */
interface PlannedSpawn {
  preset: CargoShapePreset;
  region: CargoRegion;
  portIndex: number;
}

/** Per-port runtime state (mesh/materials/animation bounds) — built once per
 * UNLOAD_PORTS entry in the constructor, driven together by the single
 * shared UnloadPhase state machine below (both gates open/close in sync;
 * only WHICH port fires for a given spawned item varies, see buildSpawnPlan/
 * spawnOne). */
interface PortRuntime {
  config: UnloadPortConfig;
  gateMesh: THREE.Mesh;
  gateMat: THREE.MeshStandardMaterial;
  gateClosedY: number;
  gateOpenY: number;
  gateBaseX: number;
  /** Brief decaying jitter applied to this port's own gate/chute on each
   * burst event it fires (spec五: "噴射時牆面裝置輕微震動") — counts down to
   * 0 each frame. Per-port so only the port that actually just launched an
   * item visibly shakes. */
  deviceShakeTimer: number;
}

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
 * Owns the north unload docks' physical performance — spec "貨品外型與比例
 * 有更多變化" round section三/四/五: gate open, brief charge-up, then the
 * day's cargo bursts out in a few waves with real launch velocity (not the
 * old one-at-a-time gentle slide), plus the 開始卸貨 button that kicks it
 * off. "Add dual elevated unloading ports and day-one special cargo" round:
 * now drives TWO independent ports (UNLOAD_PORTS) off one shared phase
 * machine and one shared button, splitting each day's cargo evenly between
 * them. Reports state transitions to DailyFlowSystem (notifyUnloadingStarted/
 * registerDailyCargo/notifyUnloadingFinished) rather than owning the day's
 * state itself.
 */
export class UnloadingSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private cargoSystem: CargoSystem;
  private dailyFlowSystem: DailyFlowSystem;
  private onFirstUnload?: () => void;

  private ports: PortRuntime[] = [];
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
  private spawnPlan: PlannedSpawn[][] = [];
  private spawnedIds: string[] = [];
  /** Which port index gets the next odd leftover item when today's total
   * doesn't divide evenly across UNLOAD_PORTS.length — persists across days
   * (spec三: "奇數數量時，多出的1件輪流分配，避免固定偏向同一側") so the
   * leftover doesn't always land on the same port. */
  private oddLeftoverPortIndex = 0;

  /** Anti-stuck watch state (spec四) — see StuckWatchEntry's own doc comment. */
  private stuckWatch: Map<string, StuckWatchEntry> = new Map();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, cargoSystem: CargoSystem, dailyFlowSystem: DailyFlowSystem,
    onFirstUnload?: () => void
  ) {
    this.scene = scene;
    this.physics = physics;
    this.cargoSystem = cargoSystem;
    this.dailyFlowSystem = dailyFlowSystem;
    this.onFirstUnload = onFirstUnload;
    UNLOAD_PORTS.forEach((config, i) => {
      this.buildChute(config);
      this.ports.push(this.buildGate(config, i));
    });
    this.buildButton();
  }

  private buildChute(config: UnloadPortConfig): void {
    const { topX, topY, topZ, bottomX, bottomZ, width, thickness } = config.chute;
    const bottomY = BACK_AREA.floorY;
    const rise = topY - bottomY;
    const run = bottomZ - topZ;
    const length = Math.sqrt(rise * rise + run * run);
    // Same convention as scene-manager.ts's buildRamp(): positive angle
    // tilts the box's +Z-local end DOWN and further +Z, i.e. sloping down
    // from the gate (topZ) toward the room interior (bottomZ). Cargo no
    // longer slides down this (it launches on its own trajectory instead),
    // but the ramp housing stays as the physical "launch tube" the burst
    // mechanism protrudes from (spec四: "牆面裝置") — now steeper since
    // topY sits near the ceiling instead of the floor.
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

  private buildGate(config: UnloadPortConfig, index: number): PortRuntime {
    const { centerX, centerZ, width, height, thickness, openOffsetY } = config.gate;
    const gateClosedY = BACK_AREA.floorY + height / 2;
    const gateOpenY = gateClosedY + openOffsetY;
    const gateBaseX = centerX;

    const geo = new THREE.BoxGeometry(width, height, thickness);
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x5a4a35, emissive: 0x000000 });
    const mesh = new THREE.Mesh(geo, gateMat);
    mesh.position.set(centerX, gateClosedY, centerZ);
    this.scene.add(mesh);

    // Permanent invisible safety collider spanning the FULL wall opening
    // (floor to ceiling) — stays solid at all times regardless of the
    // visual panel's open/close animation, so nothing can ever physically
    // cross this wall plane in either direction (spec: "防止貨品飛出場景的
    // 隱藏安全碰撞"). Cargo always spawns already on the room side of this
    // plane, so it never needs to cross it.
    this.physics.createStaticCuboid(centerX, BACK_AREA.floorY + BACK_AREA.ceilingHeight / 2, centerZ, width / 2, BACK_AREA.ceilingHeight / 2, thickness / 2);

    const label = createFloatingLabel(`北側卸貨口 ${index + 1}`, { width: 0.9, bg: 'rgba(30,30,20,0.75)' });
    label.position.set(centerX + 0.6, gateClosedY + height / 2 + 0.5, centerZ);
    this.scene.add(label);

    return { config, gateMesh: mesh, gateMat, gateClosedY, gateOpenY, gateBaseX, deviceShakeTimer: 0 };
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
    this.stuckWatch.clear();
    this.chargeTimer = 0;
    updateFloatingLabel(this.buttonLabel, RUNNING_TEXT);
  }

  /** Builds today's full item list ("Fix cargo throwing and rebalance daily
   * manifest" round三/四: replaces the old pure-weighted-random per-category
   * fill with cargo-manifest-planner.ts's buildDailyCargoManifest() — a
   * fixed per-category AND per-region quota decided before any shape is
   * picked, a 35%-per-preset cap, and a generator-only vehicle capacity
   * estimate/dev-log, all built in that one call). The total item count and
   * the "every category has a nonzero presence on every day, including day
   * 1" property (spec十三) are unchanged from before — DAILY_CARGO_CATEGORY_
   * QUOTA (cargo-manifest-data.ts) still sums to 90 and every entry is still
   * fixed and nonzero. The resulting list is then split EVENLY across
   * UNLOAD_PORTS (spec三: "平均分配貨量"), same as before. Any remainder
   * (pool length not divisible by port count) is handed out one item at a
   * time via oddLeftoverPortIndex, which advances every call so it doesn't
   * always favor the same port. The per-port assignment is then shuffled
   * together with item order so which port fires next is effectively random
   * (spec: "交錯生成，降低同一位置的物理壓力"), while the exact per-port COUNT
   * stays fixed by construction. Finally dealt round-robin into
   * UNLOAD_BURST_CONFIG.waveCount waves, same as before. */
  private buildSpawnPlan(): PlannedSpawn[][] {
    const { manifest } = buildDailyCargoManifest();
    const shuffledItems = shuffle(manifest);

    const portCount = UNLOAD_PORTS.length;
    const base = Math.floor(shuffledItems.length / portCount);
    const remainder = shuffledItems.length % portCount;
    const portAssignment: number[] = [];
    for (let p = 0; p < portCount; p++) {
      for (let k = 0; k < base; k++) portAssignment.push(p);
    }
    for (let r = 0; r < remainder; r++) {
      portAssignment.push(this.oddLeftoverPortIndex);
      this.oddLeftoverPortIndex = (this.oddLeftoverPortIndex + 1) % portCount;
    }
    const shuffledPortAssignment = shuffle(portAssignment);

    const planned: PlannedSpawn[] = shuffledItems.map((item, i) => (
      { preset: item.preset, region: item.region, portIndex: shuffledPortAssignment[i] }
    ));

    const waveCount = Math.max(1, UNLOAD_BURST_CONFIG.waveCount);
    const waves: PlannedSpawn[][] = Array.from({ length: waveCount }, () => []);
    planned.forEach((item, i) => waves[i % waveCount].push(item));
    return waves;
  }

  /** Picks a safe spawn position for `preset` at `port` (spec一/二: dimension-
   * aware clearance + lanes). Filters this port's lanes down to ones whose
   * maxHalfWidth/maxHalfDepth can actually hold the item's own real
   * footprint, orders them so large cargo tries its preferred wide/central
   * lane first (spec二: "大型貨物優先使用較寬、較中央的lane") while
   * everything else tries its own non-large lanes first, then verifies each
   * candidate with a live castShape query (spec一: "生成位置不得位於任何
   * Collider內部"; spec五: "生成前檢查預定位置是否已有貨物Collider") —
   * catching the chute housing, gate side walls, ceiling, AND any
   * already-spawned cargo sitting in that lane in one call. The Y coordinate
   * is independently clamped against the item's OWN half-height so nothing
   * can ever spawn poking into the ceiling regardless of which lane it lands
   * in (spec一: "生成前以物品實際 Collider 尺寸計算 clearance"). Falls back
   * to the last-tried candidate (best-effort, never blocks the whole day's
   * unload) if every lane is genuinely occupied. */
  private pickSpawnPosition(port: PortRuntime, preset: CargoShapePreset): { x: number; y: number; z: number } {
    const halfW = preset.dimensions.width / 2;
    const halfD = preset.dimensions.depth / 2;
    const halfH = preset.dimensions.height / 2;
    const ceilingLimitY = BACK_AREA.floorY + BACK_AREA.ceilingHeight - halfH - CEILING_CLEARANCE_BUFFER;

    const fitting = port.config.lanes.filter((l) => halfW <= l.maxHalfWidth && halfD <= l.maxHalfDepth);
    const candidates = fitting.length > 0 ? fitting : port.config.lanes;
    const isLarge = preset.category === 'large';
    const ordered = shuffle(candidates).sort((a, b) => {
      const aFirst = a.preferLarge === isLarge ? 0 : 1;
      const bFirst = b.preferLarge === isLarge ? 0 : 1;
      return aFirst - bFirst;
    });

    let lastCandidate = { x: port.config.gate.centerX, y: Math.min(port.config.spawnY, ceilingLimitY), z: port.config.chute.topZ + 0.5 };
    for (const lane of ordered) {
      const jitterX = (Math.random() - 0.5) * Math.min(UNLOAD_SPAWN_JITTER_X, lane.maxHalfWidth * 0.3);
      const jitterZ = (Math.random() - 0.5) * Math.min(UNLOAD_SPAWN_JITTER_Z, lane.maxHalfDepth * 0.3);
      const x = lane.x + jitterX;
      const z = lane.z + jitterZ;
      const y = Math.min(port.config.spawnY + lane.yOffset, ceilingLimitY);
      lastCandidate = { x, y, z };
      const blocked = this.physics.castShape(new THREE.Vector3(x, y, z), new THREE.Vector3(halfW, halfH, halfD));
      if (!blocked) return lastCandidate;
    }
    return lastCandidate;
  }

  /** Launches one item with real burst velocity (spec三/四) from a safe,
   * dimension-aware spawn position (pickSpawnPosition) — forward/up/lateral
   * speed ranges from UNLOAD_BURST_CONFIG (up is now a mild DOWNWARD range,
   * see that constant's own doc comment), and a random angular velocity so
   * it visibly tumbles in the air — reduced for large/elongated cargo (spec
   * 三: "不可讓長型貨物一生成就橫卡在出口") so it can't immediately tumble
   * broadside across the exit. Sets linear/angular velocity directly (not an
   * impulse) so the launch speed is consistent regardless of the item's
   * mass. Registers the spawned item into the anti-stuck watch (spec四). */
  private spawnOne(item: PlannedSpawn): string {
    const port = this.ports[item.portIndex];
    const preset = item.preset;
    const { x, y, z } = this.pickSpawnPosition(port, preset);
    const isLarge = preset.category === 'large';

    let id: string;
    if (preset.colliderKind === 'cylinder') {
      const yawVariance = (Math.random() - 0.5) * 1.4;
      id = this.cargoSystem.spawnDailyRoller(preset, x, y, z, yawVariance, item.region);
    } else {
      const rotYRange = isLarge ? LARGE_ITEM_ROT_Y_RANGE : Math.PI;
      const rotY = (Math.random() - 0.5) * rotYRange;
      id = this.cargoSystem.spawnDailyBox(preset, x, y, z, rotY, item.region);
    }

    const obj = this.cargoSystem.getInteractable(id);
    if (obj?.rigidBody) {
      const forward = randRange(UNLOAD_BURST_CONFIG.forwardSpeedMin, UNLOAD_BURST_CONFIG.forwardSpeedMax);
      const up = randRange(UNLOAD_BURST_CONFIG.upSpeedMin, UNLOAD_BURST_CONFIG.upSpeedMax);
      const lateral = randRange(UNLOAD_BURST_CONFIG.lateralSpeedMin, UNLOAD_BURST_CONFIG.lateralSpeedMax);
      obj.rigidBody.setLinvel({ x: lateral, y: up, z: forward }, true);

      const amax = UNLOAD_BURST_CONFIG.angularSpeedMax * (isLarge ? LARGE_ITEM_ANGULAR_SCALE : 1);
      obj.rigidBody.setAngvel({
        x: (Math.random() - 0.5) * 2 * amax,
        y: (Math.random() - 0.5) * 2 * amax,
        z: (Math.random() - 0.5) * 2 * amax,
      }, true);
    }

    this.stuckWatch.set(id, { portIndex: item.portIndex, lastPosition: new THREE.Vector3(x, y, z), stuckDuration: 0 });

    port.deviceShakeTimer = 0.15;
    return id;
  }

  /** Whether `pos` is still within the danger zone around `port`'s own gate/
   * chute structure — elevated, and horizontally/depth-wise still close to
   * the wall opening (spec四: "仍位於卸貨口上方／斜板區域"). Once an item's
   * position falls outside this (landed on the open room floor, or picked up
   * and carried away), it's permanently removed from the watch (spec四:
   * "落到倉庫地面後不得再自動搬動玩家整理中的物品") — it can never be
   * re-added, since spawnOne is the only place new entries are created. */
  private isInUnloadDangerZone(port: UnloadPortConfig, pos: THREE.Vector3): boolean {
    const withinX = pos.x > port.gate.centerX - port.gate.width / 2 - 0.5 && pos.x < port.gate.centerX + port.gate.width / 2 + 0.5;
    const withinZ = pos.z > BACK_AREA.minZ - 0.5 && pos.z < port.chute.bottomZ + 0.8;
    const elevated = pos.y > BACK_AREA.floorY + 0.4;
    return withinX && withinZ && elevated;
  }

  /** Safe-recovery relocation (spec四) — moves the item to an open landing
   * spot well past the chute, keeps its Rigidbody/Collider intact (just
   * re-enables + repositions them), and gives it a light inward nudge rather
   * than dropping it dead-still. Never marks it shipped/organized/otherwise
   * "already processed" (spec: "不得直接刪除或計算為已處理") — from the
   * physics engine's perspective this is indistinguishable from the item
   * having simply landed there on its own. */
  private recoverStuckItem(id: string, port: UnloadPortConfig): void {
    const obj = this.cargoSystem.getInteractable(id);
    if (!obj) return;
    const safeX = port.gate.centerX;
    const safeZ = port.chute.bottomZ + 1.3;
    const safeY = BACK_AREA.floorY + obj.height / 2 + 0.05;
    obj.mesh.position.set(safeX, safeY, safeZ);
    obj.mesh.rotation.set(0, 0, 0);
    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: safeX, y: safeY, z: safeZ }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: -0.2, z: 0.8 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Per-frame anti-stuck scan (spec四) — only ever watches items THIS
   * system spawned (registered in spawnOne), and each id is watched at most
   * once for its whole lifetime: it's removed the instant it either leaves
   * the danger zone naturally (landed) or gets recovered (recovery only
   * fires once, then the entry is deleted immediately after) — it can never
   * re-enter this Map afterward. A held item is dropped from the watch
   * immediately too (the player is already handling it, not "stuck"). */
  private updateStuckRecovery(deltaTime: number): void {
    for (const [id, watch] of this.stuckWatch) {
      const obj = this.cargoSystem.getInteractable(id);
      if (!obj) { this.stuckWatch.delete(id); continue; }
      if (obj.isHeld) { this.stuckWatch.delete(id); continue; }

      const pos = obj.mesh.position;
      const port = this.ports[watch.portIndex].config;
      if (!this.isInUnloadDangerZone(port, pos)) {
        this.stuckWatch.delete(id);
        continue;
      }

      const displacement = pos.distanceTo(watch.lastPosition);
      if (displacement < STUCK_DISPLACEMENT_THRESHOLD) {
        watch.stuckDuration += deltaTime;
      } else {
        watch.stuckDuration = 0;
        watch.lastPosition.copy(pos);
      }

      if (watch.stuckDuration >= STUCK_TIME_THRESHOLD) {
        this.recoverStuckItem(id, port);
        this.stuckWatch.delete(id);
      }
    }
  }

  update(deltaTime: number): void {
    this.updateDeviceShake(deltaTime);
    this.updateStuckRecovery(deltaTime);

    switch (this.phase) {
      case 'gateOpening': {
        this.gateAnimT = Math.min(1, this.gateAnimT + deltaTime / this.ports[0].config.gate.openDuration);
        for (const port of this.ports) {
          port.gateMesh.position.y = THREE.MathUtils.lerp(port.gateClosedY, port.gateOpenY, this.gateAnimT);
        }
        if (this.gateAnimT >= 1) {
          this.phase = 'chargingUp';
          this.chargeTimer = 0;
        }
        break;
      }
      case 'chargingUp': {
        // Brief visual buildup before the first wave (spec三: "裝置短暫蓄
        // 力"；spec五: "到貨口內部短暫亮起") — a gently rising emissive glow
        // on both ports, no flash/no screen effects.
        this.chargeTimer += deltaTime;
        const t = Math.min(1, this.chargeTimer / UNLOAD_BURST_CONFIG.chargeUpDuration);
        for (const port of this.ports) {
          port.gateMat.emissive.setRGB(t * 0.35, t * 0.28, t * 0.05);
        }
        if (this.chargeTimer >= UNLOAD_BURST_CONFIG.chargeUpDuration) {
          for (const port of this.ports) port.gateMat.emissive.setRGB(0, 0, 0);
          this.phase = 'spawning';
          this.itemTimer = 0;
          this.nextItemInterval = randRange(UNLOAD_BURST_CONFIG.itemIntervalMin, UNLOAD_BURST_CONFIG.itemIntervalMax);
        }
        break;
      }
      case 'spawning': {
        this.itemTimer += deltaTime;
        if (this.itemTimer >= this.nextItemInterval) {
          this.itemTimer = 0;
          const wave = this.spawnPlan[this.waveIndex];
          const item = wave[this.itemIndexInWave];
          const id = this.spawnOne(item);
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
        this.gateAnimT = Math.max(0, this.gateAnimT - deltaTime / this.ports[0].config.gate.openDuration);
        for (const port of this.ports) {
          port.gateMesh.position.y = THREE.MathUtils.lerp(port.gateClosedY, port.gateOpenY, this.gateAnimT);
        }
        if (this.gateAnimT <= 0) {
          this.phase = 'idle';
          updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
          this.dailyFlowSystem.notifyUnloadingFinished();
        }
        break;
      }
    }
  }

  /** Small decaying side-to-side jitter on each port's own gate panel (spec
   * 五: "閘門震動...噴射時牆面裝置輕微震動") — purely cosmetic, no camera
   * shake, no screen effects. Only the port that most recently fired an
   * item shakes (see spawnOne setting its own deviceShakeTimer). */
  private updateDeviceShake(deltaTime: number): void {
    for (const port of this.ports) {
      if (port.deviceShakeTimer <= 0) continue;
      port.deviceShakeTimer = Math.max(0, port.deviceShakeTimer - deltaTime);
      const amount = port.deviceShakeTimer / 0.2;
      port.gateMesh.position.x = port.gateBaseX + Math.sin(port.deviceShakeTimer * 90) * 0.02 * amount;
      if (port.deviceShakeTimer <= 0) port.gateMesh.position.x = port.gateBaseX;
    }
  }

  /** End-of-day reset (spec: "卸貨閘門/卸貨按鈕狀態"). Only ever called
   * once DailyFlowSystem has confirmed the day's cargo is fully cleared, so
   * phase is always 'idle' here already — reset defensively anyway. */
  resetGate(): void {
    this.phase = 'idle';
    this.gateAnimT = 0;
    for (const port of this.ports) {
      port.gateMesh.position.y = port.gateClosedY;
      port.gateMesh.position.x = port.gateBaseX;
      port.gateMat.emissive.setRGB(0, 0, 0);
      port.deviceShakeTimer = 0;
    }
    updateFloatingLabel(this.buttonLabel, IDLE_TEXT);
  }
}
