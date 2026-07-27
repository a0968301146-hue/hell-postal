import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { SCENE_CONFIG, BACK_AREA } from '../world-layout';
import { STAMP_TABLE, ENVELOPE_SIZE } from '../../data/world/mail-layout-data';
import { UNLOAD_PORTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_BURST_CONFIG } from '../daily-flow';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { MailDestination, EnvelopeRecord } from './mail-types';
import { MAIL_DESTINATIONS, DAILY_ENVELOPE_COUNT, getMailDestination, buildEnvelopeGeometry, buildEnvelopeMaterials } from './mail-data';

const ENVELOPE_ID_PREFIX = 'envelope-';
const STABLE_THRESHOLD = 0.3;
const VELOCITY_THRESHOLD = 0.4;

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
 * Owns the daily envelope flow ("Add modular envelope stamping and regional
 * mail bag system" round 二/三/四/五) — daily spawn (alongside regular cargo,
 * from the same two north unload ports, never touching dailyCargoIds), each
 * envelope's own registry entry (destination/stamp/state), and the stamp
 * table's physical sensor (auto-detects a single stable envelope resting on
 * it, snaps it flat/pauses its physics — spec四 — mirrors the OLD, now-dead
 * envelope-stamp-station.ts's sensor-box pattern, ported fresh rather than
 * reactivating that class). The actual drag-and-drop stamp UI lives in
 * stamp-table-ui.ts; this class only owns the DATA judgment (applyStamp)
 * and the physical table/sensor.
 */
export class MailSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupPort;

  private envelopes: Map<string, EnvelopeRecord> = new Map();
  /** Today's spawned envelope ids — deliberately separate from
   * DailyFlowSystem.dailyCargoIds (spec二: 不加入dailyCargoIds). */
  dailyEnvelopeIds: string[] = [];
  private envelopeInstanceCounter = 0;
  private envelopeSpawnTimer: number | null = null;

  private sensorBox!: THREE.Box3;
  private stableTimer = 0;
  /** The one envelope currently snapped onto the table, ready for the stamp
   * UI (spec四: "一次只能處理一封") — null when the table is free. */
  private processingEnvelopeId: string | null = null;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, pickupSystem: PickupPort
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.pickupSystem = pickupSystem;
    this.buildStampTable();
  }

  private buildStampTable(): void {
    const floorY = BACK_AREA.floorY;
    const group = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x6b8e6a });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });

    const topGeo = new THREE.BoxGeometry(STAMP_TABLE.width, 0.05, STAMP_TABLE.depth);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = STAMP_TABLE.height - 0.025;
    group.add(top);

    const legH = STAMP_TABLE.height - 0.05;
    const legGeo = new THREE.BoxGeometry(STAMP_TABLE.legWidth, legH, STAMP_TABLE.legWidth);
    const hw = STAMP_TABLE.width / 2 - 0.1;
    const hd = STAMP_TABLE.depth / 2 - 0.1;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, legH / 2, lz);
      group.add(leg);
    }

    const label = createFloatingLabel('信封貼郵票工作桌', { width: 0.9, bg: 'rgba(20,30,25,0.75)' });
    label.position.set(0, STAMP_TABLE.height + 0.4, 0);
    group.add(label);

    group.position.set(STAMP_TABLE.posX, floorY, STAMP_TABLE.posZ);
    this.scene.add(group);
    group.updateMatrixWorld(true);

    const topThickness = 0.05;
    this.physics.createStaticCuboid(
      STAMP_TABLE.posX, floorY + STAMP_TABLE.height - topThickness / 2, STAMP_TABLE.posZ,
      STAMP_TABLE.width / 2, topThickness / 2, STAMP_TABLE.depth / 2
    );
    const legH2 = STAMP_TABLE.height - topThickness;
    const legHx = STAMP_TABLE.legWidth / 2;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      this.physics.createStaticCuboid(STAMP_TABLE.posX + lx, floorY + legH2 / 2, STAMP_TABLE.posZ + lz, legHx, legH2 / 2, legHx);
    }

    // Legal placement surface (spec四: "合法放置面") — the generic top-face
    // placement path already handles a thin (height<=0.05) envelope
    // correctly once registered here, no PickupSystem changes needed.
    this.pickupSystem.addPlacementSurface(top);

    this.sensorBox = new THREE.Box3(
      new THREE.Vector3(
        STAMP_TABLE.posX - STAMP_TABLE.width / 2 + 0.05, floorY + STAMP_TABLE.height,
        STAMP_TABLE.posZ - STAMP_TABLE.depth / 2 + 0.05
      ),
      new THREE.Vector3(
        STAMP_TABLE.posX + STAMP_TABLE.width / 2 - 0.05, floorY + STAMP_TABLE.height + 0.4,
        STAMP_TABLE.posZ + STAMP_TABLE.depth / 2 - 0.05
      )
    );
  }

  /** Wired into UnloadingSystem's existing onFirstUnload callback (game.ts),
   * alongside LostFoundSystem's own onDailyUnloadStarted — arms a short
   * burst-spawn delay so envelopes burst in from the SAME two north ports
   * alongside regular cargo (spec二), without UnloadingSystem itself ever
   * needing to know envelopes exist. */
  onDailyUnloadStarted(): void {
    this.envelopeSpawnTimer = UNLOAD_PORTS[0].gate.openDuration + UNLOAD_BURST_CONFIG.chargeUpDuration;
  }

  private spawnTodaysEnvelopes(): void {
    const perDestination = Math.floor(DAILY_ENVELOPE_COUNT / MAIL_DESTINATIONS.length);
    const remainder = DAILY_ENVELOPE_COUNT - perDestination * MAIL_DESTINATIONS.length;
    const destPool: MailDestination[] = [];
    MAIL_DESTINATIONS.forEach((d, i) => {
      for (let n = 0; n < perDestination + (i < remainder ? 1 : 0); n++) destPool.push(d.id);
    });
    const shuffled = shuffle(destPool);
    shuffled.forEach((dest) => {
      const id = this.spawnEnvelope(dest);
      this.dailyEnvelopeIds.push(id);
    });
  }

  private spawnEnvelope(dest: MailDestination): string {
    const destInfo = getMailDestination(dest);
    const port = UNLOAD_PORTS[Math.floor(Math.random() * UNLOAD_PORTS.length)];
    const point = port.spawnPoints[Math.floor(Math.random() * port.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const y = port.spawnY;
    const z = point.z + jitterZ;

    const id = `${ENVELOPE_ID_PREFIX}${this.envelopeInstanceCounter++}`;
    const geo = buildEnvelopeGeometry();
    const mats = buildEnvelopeMaterials(destInfo, null);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const { width: w, height: h, depth: d } = ENVELOPE_SIZE;
    const obj = createInteractableObject(id, `${destInfo.displayName}信`, mesh, w, h, d);
    const { body, collider } = this.physics.createBoxBody(x, y, z, w / 2, h / 2, d / 2, 12);
    obj.rigidBody = body;
    obj.collider = collider;

    const forward = randRange(UNLOAD_BURST_CONFIG.forwardSpeedMin, UNLOAD_BURST_CONFIG.forwardSpeedMax);
    const up = randRange(UNLOAD_BURST_CONFIG.upSpeedMin, UNLOAD_BURST_CONFIG.upSpeedMax);
    const lateral = randRange(UNLOAD_BURST_CONFIG.lateralSpeedMin, UNLOAD_BURST_CONFIG.lateralSpeedMax);
    body.setLinvel({ x: lateral, y: up, z: forward }, true);
    const amax = UNLOAD_BURST_CONFIG.angularSpeedMax;
    body.setAngvel({
      x: (Math.random() - 0.5) * 2 * amax, y: (Math.random() - 0.5) * 2 * amax, z: (Math.random() - 0.5) * 2 * amax,
    }, true);

    this.interactables.set(id, obj);
    this.envelopes.set(id, {
      envelopeId: id, destination: dest, region: destInfo.region,
      requiredStamp: dest, attachedStamp: null, state: 'unstamped', bagId: null,
    });
    return id;
  }

  getEnvelope(id: string): EnvelopeRecord | undefined {
    return this.envelopes.get(id);
  }

  get readyEnvelopeId(): string | null {
    return this.processingEnvelopeId;
  }

  isPlayerNearTable(pos: THREE.Vector3): boolean {
    const dx = pos.x - STAMP_TABLE.posX;
    const dz = pos.z - STAMP_TABLE.posZ;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }

  /** Applies `stamp` to the envelope currently on the table — correctness
   * judged purely by requiredStamp match (spec五). Wrong stamps are a pure
   * no-op here (caller/UI shows the failure feedback; nothing about the
   * envelope's own state changes, spec: "不完成、不扣分、可移除或重新選
   * 擇"). On success, redraws the envelope's own world-mesh top texture so
   * the 3D model genuinely shows the applied stamp (spec五: "3D信封表面顯示
   * 郵票"). */
  applyStamp(envelopeId: string, stamp: MailDestination): boolean {
    const rec = this.envelopes.get(envelopeId);
    if (!rec || rec.state !== 'unstamped') return false;
    if (stamp !== rec.requiredStamp) return false;

    rec.attachedStamp = stamp;
    rec.state = 'stamped';

    const obj = this.interactables.get(envelopeId);
    if (obj) {
      const oldMats = obj.mesh.material as THREE.Material[];
      obj.mesh.material = buildEnvelopeMaterials(getMailDestination(rec.destination), stamp);
      for (const m of oldMats) m.dispose();
    }
    return true;
  }

  /** Called once the stamp UI closes (success or cancel) — restores the
   * envelope to a normal pickupable/physical object and frees the table for
   * the next one (spec四: "信封恢復為可拾取物件"). */
  releaseFromTable(): void {
    const id = this.processingEnvelopeId;
    if (!id) return;
    const obj = this.interactables.get(id);
    if (obj?.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, true);
    this.processingEnvelopeId = null;
  }

  /** Marks an envelope bagged/unbagged — called by MailBagSystem, the only
   * other module allowed to mutate an envelope's own state (spec: envelope
   * state is otherwise owned entirely by this class). */
  setEnvelopeBagged(envelopeId: string, bagId: string): void {
    const rec = this.envelopes.get(envelopeId);
    if (!rec) return;
    rec.state = 'bagged';
    rec.bagId = bagId;
  }

  setEnvelopeUnbagged(envelopeId: string): void {
    const rec = this.envelopes.get(envelopeId);
    if (!rec) return;
    rec.state = 'stamped';
    rec.bagId = null;
  }

  markEnvelopeShipped(envelopeId: string): void {
    const rec = this.envelopes.get(envelopeId);
    if (rec) rec.state = 'shipped';
  }

  /** Departure-time settlement (spec十一) — counts every one of today's
   * envelopes as shipped only if it's 'shipped' (set by
   * VehicleControlSystem via markEnvelopeShipped, only for envelopes whose
   * bag both matched its vehicle's region AND actually departed) or still
   * 'bagged' inside one of the bag ids the caller confirms departed
   * correctly. Called once, at 載具出發 press time. */
  settleAtDeparture(correctlyShippedBagIds: Set<string>): { total: number; shipped: number; unshipped: number } {
    let shipped = 0;
    for (const id of this.dailyEnvelopeIds) {
      const rec = this.envelopes.get(id);
      if (!rec) continue;
      if (rec.state === 'shipped') { shipped++; continue; }
      if (rec.state === 'bagged' && rec.bagId && correctlyShippedBagIds.has(rec.bagId)) {
        rec.state = 'shipped';
        shipped++;
      }
    }
    const total = this.dailyEnvelopeIds.length;
    return { total, shipped, unshipped: total - shipped };
  }

  private disposeEnvelope(id: string): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    const mats = obj.mesh.material as THREE.Material[];
    if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
    else (obj.mesh.material as THREE.Material).dispose();
    if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
    this.interactables.delete(id);
  }

  /** Wired into DailyFlowSystem's resetTools callback (spec十二) — clears
   * every still-existing envelope (scattered, on the table, bagged — bags
   * themselves are cleared by MailBagSystem.resetDaily(), called
   * separately) and every daily flag. */
  resetDaily(): void {
    for (const id of this.dailyEnvelopeIds) {
      const obj = this.interactables.get(id);
      if (obj) {
        if (obj.isHeld) this.pickupSystem.forceDropHeld();
        this.disposeEnvelope(id);
      }
    }
    this.envelopes.clear();
    this.dailyEnvelopeIds = [];
    this.envelopeInstanceCounter = 0;
    this.envelopeSpawnTimer = null;
    this.processingEnvelopeId = null;
    this.stableTimer = 0;
  }

  update(deltaTime: number): void {
    if (this.envelopeSpawnTimer !== null) {
      this.envelopeSpawnTimer -= deltaTime;
      if (this.envelopeSpawnTimer <= 0) {
        this.envelopeSpawnTimer = null;
        this.spawnTodaysEnvelopes();
      }
    }
    this.updateTableSensor(deltaTime);
  }

  private updateTableSensor(deltaTime: number): void {
    if (this.processingEnvelopeId) {
      const obj = this.interactables.get(this.processingEnvelopeId);
      if (!obj || obj.isHeld || !obj.mesh.visible) this.processingEnvelopeId = null;
      return;
    }

    const found: string[] = [];
    for (const [id, rec] of this.envelopes) {
      if (rec.state !== 'unstamped') continue;
      const obj = this.interactables.get(id);
      if (!obj || obj.isHeld || !obj.mesh.visible) continue;
      if (this.sensorBox.containsPoint(obj.mesh.position)) found.push(id);
    }

    if (found.length !== 1) {
      this.stableTimer = 0;
      return;
    }

    const id = found[0];
    const obj = this.interactables.get(id)!;
    let stable = true;
    if (obj.rigidBody) {
      const lv = obj.rigidBody.linvel();
      const av = obj.rigidBody.angvel();
      const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
      const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
      stable = speed < VELOCITY_THRESHOLD && angSpeed < VELOCITY_THRESHOLD;
    }
    this.stableTimer = stable ? this.stableTimer + deltaTime : 0;

    if (this.stableTimer >= STABLE_THRESHOLD) {
      // Snap flat, centered, face-up (spec四: "信封吸附到桌面/自動平放/正面
      // 朝上/暫停該信封物理").
      const snapY = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005;
      obj.mesh.position.set(STAMP_TABLE.posX, snapY, STAMP_TABLE.posZ);
      obj.mesh.rotation.set(0, 0, 0);
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: STAMP_TABLE.posX, y: snapY, z: STAMP_TABLE.posZ }, true);
        obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, false);
      }
      this.processingEnvelopeId = id;
      this.stableTimer = 0;
    }
  }
}
