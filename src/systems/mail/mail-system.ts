import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { SCENE_CONFIG, BACK_AREA } from '../world-layout';
import { STAMP_TABLE, ENVELOPE_SIZE } from '../../data/world/mail-layout-data';
import { UNLOAD_PORTS, UNLOAD_SPAWN_JITTER_X, UNLOAD_SPAWN_JITTER_Z, UNLOAD_BURST_CONFIG } from '../daily-flow';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { MailDestination, EnvelopeRecord } from './mail-types';
import {
  MAIL_DESTINATIONS, getMailDestination, buildEnvelopeGeometry, buildEnvelopeMaterials,
  MailEnvelopeVisualPreset, pickWeightedMailEnvelopeVisualPreset, getMailEnvelopeVisualPreset,
} from './mail-data';
import { getDailyMailTotal, isMailRegionUnlockedOnDay } from '../../data/daily-unlock-data';

const ENVELOPE_ID_PREFIX = 'envelope-';
const STABLE_THRESHOLD = 0.3;
const VELOCITY_THRESHOLD = 0.4;

/** "Add envelope stacks and expand pallet inventory" round五: the stamp
 * table's own combined pending+completed+active capacity (spec五: "最多容納
 * 20封未貼郵票信封"). */
const STAMP_TABLE_CAPACITY = 20;
/** How far left/right of the table's own single-slot center (STAMP_TABLE.
 * posX, unchanged — still where the ACTIVE/currently-processing envelope
 * snaps to, exactly as before this round) the two queue piles sit (spec五:
 * "待處理堆位於工作台左側/已完成堆位於工作台右側...兩堆不可重疊"). */
const QUEUE_PILE_X_OFFSET = 0.5;
/** Vertical gap between stacked envelopes in a pending/completed pile —
 * ENVELOPE_SIZE.height plus a hair of daylight so faces don't z-fight. */
const QUEUE_PILE_STEP = ENVELOPE_SIZE.height + 0.003;

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

  /** "Allow mail box pattern changes with contents" round: an optional
   * lookup into a bag's own CURRENT destinationPattern, wired from
   * create-game-systems.ts once MailBagSystem exists (mirrors
   * PickupSystem.setMailBoxHooks' own after-construction wiring pattern, to
   * avoid a constructor-time circular dependency). Used only by
   * settleAtDeparture below, to additionally require a bagged envelope's
   * OWN destination to still match its bag's live pattern before counting
   * it as shipped — an envelope left behind after the bag's pattern was
   * cycled away from it stays physically boxed but simply never counts
   * (spec: "不相符的信件...不計入出貨分數"). Null-safe: if never wired
   * (e.g. in isolated tests), settleAtDeparture falls back to its own prior
   * bag-only region check, unchanged. */
  private bagPatternLookup: ((bagId: string) => MailDestination | null) | null = null;

  /** "Day 1～7 每日內容與解鎖規格" round — optional day-number source, wired
   * from create-game-systems.ts once DailyFlowSystem exists (this class is
   * constructed BEFORE it, same "avoid a constructor-time circular
   * dependency" reasoning as bagPatternLookup above). Defaults to "always
   * day 1" if never wired (e.g. isolated tests) — the safest fallback,
   * matching this round's own Day 1 baseline (10 domestic-only envelopes)
   * rather than silently assuming every region/total is already open. */
  private getCurrentDay: () => number = () => 1;

  private sensorBox!: THREE.Box3;
  private stableTimer = 0;
  /** The one envelope currently snapped onto the table's own single ACTIVE
   * slot (STAMP_TABLE.posX/posZ, unchanged from before this round), ready
   * for the stamp UI (spec四: "一次只能處理一封") — null when nothing is
   * actively being stamped right now. Distinct from pendingEnvelopeIds/
   * completedEnvelopeIds below — this is specifically "on stage right now",
   * those two are "waiting in the wings". */
  private processingEnvelopeId: string | null = null;
  /** "Add envelope stacks and expand pallet inventory" round五/六: the
   * table's own two queue piles — pending (left, still unstamped, front =
   * index 0 = next up) and completed (right, already stamped). Both are
   * physically REAL envelope objects positioned in a manual stack (physics
   * disabled, same treatment as processingEnvelopeId's own envelope) rather
   * than a data-only list, so the player can see the two piles and pick
   * either back up directly. Deliberately disabled physics (not merely
   * repositioned) doubles as how these stay excluded from the envelope
   * vacuum for free — envelope-vacuum-system.ts's own isEligibleEnvelope
   * already skips any envelope whose rigidBody is disabled, so nothing in
   * that file needs to change (spec八: "工作台上的信封不可被吸塵器吸走"). */
  private pendingEnvelopeIds: string[] = [];
  private completedEnvelopeIds: string[] = [];

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

  /** See getCurrentDay's own doc comment — called once from
   * create-game-systems.ts right after DailyFlowSystem is constructed. */
  setDayUnlockProvider(fn: () => number): void {
    this.getCurrentDay = fn;
  }

  private spawnTodaysEnvelopes(): void {
    const day = this.getCurrentDay();
    const dailyTotal = getDailyMailTotal(day);
    // "Day 1～7 每日內容與解鎖規格" round: only destinations whose region is
    // open today take part in the split — the split itself is UNCHANGED
    // (still the same even perDestination/remainder distribution as before
    // this round), just applied to a day-filtered pool/total instead of the
    // old fixed MAIL_DESTINATIONS/DAILY_ENVELOPE_COUNT (spec: mail region
    // gating is mechanically safe to wire since no per-destination RATIO is
    // being invented here, only reusing the existing even-split algorithm).
    const openDestinations = MAIL_DESTINATIONS.filter((d) => isMailRegionUnlockedOnDay(d.region, day));
    if (openDestinations.length === 0) return;
    const perDestination = Math.floor(dailyTotal / openDestinations.length);
    const remainder = dailyTotal - perDestination * openDestinations.length;
    const destPool: MailDestination[] = [];
    openDestinations.forEach((d, i) => {
      for (let n = 0; n < perDestination + (i < remainder ? 1 : 0); n++) destPool.push(d.id);
    });
    const shuffled = shuffle(destPool);
    shuffled.forEach((dest) => {
      // Picked separately from `dest` (spec: "四種外型近似平均或加權隨機...
      // 彼此獨立") — never correlated with destination/region/stamp.
      const preset = pickWeightedMailEnvelopeVisualPreset();
      const id = this.spawnEnvelope(dest, preset);
      this.dailyEnvelopeIds.push(id);
    });
  }

  /** "Add playable envelope visual presets" round: `preset` is picked by the
   * caller via pickWeightedMailEnvelopeVisualPreset() — entirely independent
   * of `dest` (spec: "目的地、國內／海外、requiredStamp 與外型彼此獨立"), so
   * this method never lets one influence the other; it only ever consumes
   * whichever preset it's handed. */
  private spawnEnvelope(dest: MailDestination, preset: MailEnvelopeVisualPreset): string {
    const destInfo = getMailDestination(dest);
    const port = UNLOAD_PORTS[Math.floor(Math.random() * UNLOAD_PORTS.length)];
    const point = port.spawnPoints[Math.floor(Math.random() * port.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_X;
    const jitterZ = (Math.random() - 0.5) * 2 * UNLOAD_SPAWN_JITTER_Z;
    const x = point.x + jitterX;
    const y = port.spawnY;
    const z = point.z + jitterZ;

    const id = `${ENVELOPE_ID_PREFIX}${this.envelopeInstanceCounter++}`;
    const geo = buildEnvelopeGeometry(preset.dimensions);
    const mats = buildEnvelopeMaterials(destInfo, null, preset);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const { width: w, height: h, depth: d } = preset.dimensions;
    const obj = createInteractableObject(id, `${destInfo.displayName}信（${preset.displayName}）`, mesh, w, h, d);
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
      visualPresetId: preset.id,
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

  // --- Stamp table queue (spec五/六/七) ---

  get pendingCount(): number { return this.pendingEnvelopeIds.length; }
  get completedCount(): number { return this.completedEnvelopeIds.length; }

  getPendingEnvelopeIds(): string[] { return [...this.pendingEnvelopeIds]; }
  getCompletedEnvelopeIds(): string[] { return [...this.completedEnvelopeIds]; }

  /** True while `id` is anywhere on the table right now (active slot, or
   * either queue pile) — read by EnvelopeStackSystem so its own ground-pile
   * gather logic never scoops up a table-owned envelope alongside loose
   * ones (spec八 in spirit: table contents are a separate collection from
   * the floor), and so a picked-back-up envelope can be correctly removed
   * from whichever collection currently owns it. */
  isOnStampTable(id: string): boolean {
    return id === this.processingEnvelopeId || this.pendingEnvelopeIds.includes(id) || this.completedEnvelopeIds.includes(id);
  }

  /** How many MORE envelopes the table can currently accept across both
   * piles plus the active slot combined (spec五: "capacity = 20"). */
  get tableRemainingCapacity(): number {
    const occupied = this.pendingEnvelopeIds.length + this.completedEnvelopeIds.length + (this.processingEnvelopeId ? 1 : 0);
    return Math.max(0, STAMP_TABLE_CAPACITY - occupied);
  }

  /** "Fix mail workbench envelope intake" round — read-only existence check
   * (never admits/mutates) for whether at least one eligible-but-not-yet-
   * registered envelope is physically resting on the desk right now. Reuses
   * the SAME sensorBox volume the passive per-frame sensor already tests
   * against (updateTableSensor below), and the same eligibility rules as
   * scanDeskForUnregisteredEnvelopes (unstamped, not already on the table in
   * any pile/active slot, not held, visible) — kept as its own cheap query
   * (no mutation) so canStartMailTable can be called every frame for the
   * crosshair prompt without side effects. */
  private hasUnregisteredDeskEnvelope(): boolean {
    for (const [id, rec] of this.envelopes) {
      if (rec.state !== 'unstamped') continue;
      if (this.isOnStampTable(id)) continue;
      const obj = this.interactables.get(id);
      if (!obj || obj.isHeld || !obj.mesh.visible) continue;
      if (this.sensorBox.containsPoint(obj.mesh.position)) return true;
    }
    return false;
  }

  /** ONE canonical judgment for whether pressing E at the table right now
   * should start/resume stamping — shared by BOTH the crosshair prompt
   * (InteractionSystem.updateStationPrompts) and the actual E-press action
   * (InteractionSystem.onKeyDown), so the two can never disagree ("Fix mail
   * workbench envelope intake" round spec三 — root cause of "已有信封在桌上
   * 但按E無效": the two used to gate on `readyEnvelopeId` alone, which only
   * ever became true via advanceQueue(), and nothing ever called
   * advanceQueue() from a purely-pending state — a dead end). True whenever
   * something is already active, the pending pile already has at least one
   * envelope, OR at least one eligible envelope is sitting on the desk
   * physically but not yet registered (scanDeskForUnregisteredEnvelopes
   * below is what actually registers it, called by the caller right before
   * starting the UI). */
  canStartMailTable(cameraPosition: THREE.Vector3): boolean {
    if (!this.isPlayerNearTable(cameraPosition)) return false;
    return this.processingEnvelopeId !== null || this.pendingEnvelopeIds.length > 0 || this.hasUnregisteredDeskEnvelope();
  }

  /** Scans the table's own desk volume for unstamped envelopes that are
   * physically resting there but not yet registered into pendingEnvelopeIds
   * (spec: "掃描工作台桌面範圍內實際放置的未貼票Envelope"), and admits as
   * many as the table's remaining capacity allows — called by
   * InteractionSystem's empty-handed E-press handler right before starting/
   * resuming the stamp flow, so "the mesh is visibly on the desk but was
   * never actually queued" (spec: "不可只顯示信封Mesh在桌面，卻沒有登記進工
   * 作台佇列") can never happen, regardless of how the envelope got there
   * (a stack-mode Q-throw that happened to land on the desk, several
   * envelopes arriving at once — the passive per-frame sensor in
   * updateTableSensor below only ever auto-admits when EXACTLY one stable
   * envelope occupies the box — or any other path that never went through
   * EnvelopeStackSystem.tryHandToTable). Exclusions are enforced entirely by
   * the existing state machine, not special-cased here: already-stamped
   * envelopes fail the unstamped check, PackedMailBag/bagged/shipped
   * envelopes are never 'unstamped', dispatch-machine-consumed envelopes are
   * already removed from `interactables` entirely, and isOnStampTable
   * excludes anything already pending/completed/active — so a repeat scan
   * (e.g. the next E press) never double-registers the same id (spec: "以
   * Envelope ID去重，不可複製或重複登記"). */
  scanDeskForUnregisteredEnvelopes(): string[] {
    const candidates: string[] = [];
    for (const [id, rec] of this.envelopes) {
      if (rec.state !== 'unstamped') continue;
      if (this.isOnStampTable(id)) continue;
      const obj = this.interactables.get(id);
      if (!obj || obj.isHeld || !obj.mesh.visible) continue;
      if (!this.sensorBox.containsPoint(obj.mesh.position)) continue;
      candidates.push(id);
    }
    return this.admitEnvelopesToPending(candidates);
  }

  /** Snaps a single envelope into its own pending-pile slot (index = its own
   * position within pendingEnvelopeIds) — physics disabled, same "artificial
   * stack" treatment the active slot already used before this round (see
   * this class's own doc comment on why disabled-physics is also what keeps
   * it vacuum-proof for free). */
  private snapToPendingSlot(id: string, index: number): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    const x = STAMP_TABLE.posX - QUEUE_PILE_X_OFFSET;
    const y = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005 + index * QUEUE_PILE_STEP;
    const z = STAMP_TABLE.posZ;
    obj.mesh.position.set(x, y, z);
    obj.mesh.rotation.set(0, 0, 0);
    if (obj.rigidBody) {
      obj.rigidBody.setTranslation({ x, y, z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }
  }

  private snapToCompletedSlot(id: string, index: number): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    const x = STAMP_TABLE.posX + QUEUE_PILE_X_OFFSET;
    const y = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005 + index * QUEUE_PILE_STEP;
    const z = STAMP_TABLE.posZ;
    obj.mesh.position.set(x, y, z);
    obj.mesh.rotation.set(0, 0, 0);
    if (obj.rigidBody) {
      obj.rigidBody.setTranslation({ x, y, z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.physics.setBodyEnabled(obj.rigidBody, false);
    }
  }

  /** Re-snaps every envelope currently in a pile to its own index-based
   * slot — called after any push/splice so the visual stack never has gaps
   * (spec五: "每封依厚度向上排列"). */
  private refreshPendingVisual(): void { this.pendingEnvelopeIds.forEach((id, i) => this.snapToPendingSlot(id, i)); }
  private refreshCompletedVisual(): void { this.completedEnvelopeIds.forEach((id, i) => this.snapToCompletedSlot(id, i)); }

  /** Admits as many of the given (already-unstamped, already-loose)
   * envelope ids into the pending pile as the table's own remaining
   * capacity allows, in the given order — called by EnvelopeStackSystem
   * when the player hands over a batch at the table (spec五: "若工作台剩餘
   * 容量不足，只放入可容納數量，其他信封留在玩家手上"). Returns the ids that
   * were actually admitted, in order — the caller is responsible for
   * removing exactly those from whatever held it was carrying them. Silently
   * skips (does not admit, does not error) any id that isn't a genuinely
   * unstamped envelope — the caller is expected to have already filtered for
   * that, this is just a defensive re-check. */
  admitEnvelopesToPending(envelopeIds: string[]): string[] {
    const admitted: string[] = [];
    for (const id of envelopeIds) {
      if (this.tableRemainingCapacity <= 0) break;
      const rec = this.envelopes.get(id);
      if (!rec || rec.state !== 'unstamped') continue;
      this.pendingEnvelopeIds.push(id);
      admitted.push(id);
    }
    this.refreshPendingVisual();
    return admitted;
  }

  /** Removes `id` from whichever pile currently holds it (does NOT touch the
   * active processingEnvelopeId slot — that's releaseFromTable's own job) —
   * called by EnvelopeStackSystem when the player picks a specific envelope
   * back up off the table (spec七: "玩家可分別拿取兩疊"). Re-enables its
   * physics (mirrors releaseFromTable's own restoration) — the caller (
   * EnvelopeStackSystem) immediately disables it again anyway once it's
   * added to the player's own held stack, same as picking up any loose
   * envelope. */
  removeFromQueue(id: string): boolean {
    const pendingIdx = this.pendingEnvelopeIds.indexOf(id);
    if (pendingIdx !== -1) {
      this.pendingEnvelopeIds.splice(pendingIdx, 1);
      this.refreshPendingVisual();
      this.reenablePhysics(id);
      return true;
    }
    const completedIdx = this.completedEnvelopeIds.indexOf(id);
    if (completedIdx !== -1) {
      this.completedEnvelopeIds.splice(completedIdx, 1);
      this.refreshCompletedVisual();
      this.reenablePhysics(id);
      return true;
    }
    return false;
  }

  private reenablePhysics(id: string): void {
    const obj = this.interactables.get(id);
    if (obj?.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, true);
  }

  /** If nothing is currently active AND at least one envelope is pending,
   * pops the front of the pending pile onto the table's own single active
   * slot (exactly the same snap transform updateTableSensor's own physical-
   * sensor path already used) and returns its id; otherwise returns null.
   * Called both by the physical sensor (updateTableSensor, once it admits a
   * hand-placed envelope into pending) and directly by game-app.ts's own
   * startMailStampUi()/endMailStampUi() to drive the queue forward (spec六:
   * "若pending仍有信：自動載入下一封"). */
  advanceQueue(): string | null {
    if (this.processingEnvelopeId) return null;
    const id = this.pendingEnvelopeIds.shift();
    if (!id) return null;
    this.refreshPendingVisual();
    const obj = this.interactables.get(id);
    if (obj) {
      const snapY = BACK_AREA.floorY + STAMP_TABLE.height + ENVELOPE_SIZE.height / 2 + 0.005;
      obj.mesh.position.set(STAMP_TABLE.posX, snapY, STAMP_TABLE.posZ);
      obj.mesh.rotation.set(0, 0, 0);
      // Already physics-disabled from sitting in the pending pile — no
      // separate re-snap of the rigidBody transform needed beyond position,
      // but set it anyway for consistency/defensiveness.
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: STAMP_TABLE.posX, y: snapY, z: STAMP_TABLE.posZ }, true);
        obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      }
    }
    this.processingEnvelopeId = id;
    return id;
  }

  /** Called on a SUCCESSFUL stamp completion (spec六 step 3) — moves the
   * just-finished active envelope into the completed pile. Does NOT clear
   * processingEnvelopeId itself (releaseFromTable, called right after by
   * game-app.ts exactly as before, still owns that) — this only handles the
   * queue-bookkeeping side of "completed". */
  moveActiveToCompleted(): void {
    const id = this.processingEnvelopeId;
    if (!id) return;
    this.completedEnvelopeIds.push(id);
    this.refreshCompletedVisual();
  }

  /** Called when the player leaves the table mid-processing (Escape/cancel,
   * spec七: "正在處理但尚未完成的信封回到待處理堆最前方...不可把未完成信封誤
   * 標記完成"). Puts the currently-active (still-unstamped) envelope back at
   * the FRONT of the pending pile rather than the back, so re-entering the
   * table resumes with the same envelope next. Does NOT clear
   * processingEnvelopeId itself — releaseFromTable (called right after by
   * game-app.ts, unchanged) still owns that. */
  returnActiveToPendingFront(): void {
    const id = this.processingEnvelopeId;
    if (!id) return;
    this.pendingEnvelopeIds.unshift(id);
    this.refreshPendingVisual();
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
      // Rebuilt on the SAME preset the envelope was originally spawned with
      // (spec: "貼郵票後，在原信封外型上顯示郵票") — never a different one.
      const preset = getMailEnvelopeVisualPreset(rec.visualPresetId)!;
      obj.mesh.material = buildEnvelopeMaterials(getMailDestination(rec.destination), stamp, preset);
      for (const m of oldMats) m.dispose();
    }
    return true;
  }

  /** Called once the stamp UI closes for the active envelope (success or
   * cancel) — clears the "who's on stage right now" pointer. "Add envelope
   * stacks and expand pallet inventory" round五/七: the envelope itself is
   * NOT restored to a free physical object here anymore — the caller
   * (game-app.ts's endMailStampUi) is responsible for calling EITHER
   * moveActiveToCompleted() (success) OR returnActiveToPendingFront()
   * (cancel/leave) FIRST, both of which already re-snap it into the
   * appropriate pile with physics still deliberately disabled (spec七: "不
   * 可把未完成信封誤標記完成", "不可遺失目前處理中的信封") — this method
   * would otherwise re-enable physics out from under whichever pile just
   * claimed it. */
  releaseFromTable(): void {
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

  /** See the field's own doc comment above. */
  setBagPatternLookup(fn: (bagId: string) => MailDestination | null): void {
    this.bagPatternLookup = fn;
  }

  /** Departure-time settlement (spec十一) — counts every one of today's
   * envelopes as shipped only if it's 'shipped' (set by
   * VehicleControlSystem via markEnvelopeShipped, only for envelopes whose
   * bag both matched its vehicle's region AND actually departed) or still
   * 'bagged' inside one of the bag ids the caller confirms departed
   * correctly. "Allow mail box pattern changes with contents" round: ALSO
   * requires the envelope's own destination to still match its bag's
   * current pattern (via bagPatternLookup) — a bagged envelope left behind
   * by a since-cycled-away pattern is correctly excluded here without
   * touching correctlyShippedBagIds itself (still purely a region-vs-
   * vehicle set, untouched — see vehicle-control-system.ts). Called once,
   * at 載具出發 press time. */
  settleAtDeparture(correctlyShippedBagIds: Set<string>): { total: number; shipped: number; unshipped: number } {
    let shipped = 0;
    for (const id of this.dailyEnvelopeIds) {
      const rec = this.envelopes.get(id);
      if (!rec) continue;
      if (rec.state === 'shipped') { shipped++; continue; }
      if (
        rec.state === 'bagged' && rec.bagId && correctlyShippedBagIds.has(rec.bagId) &&
        (!this.bagPatternLookup || this.bagPatternLookup(rec.bagId) === rec.destination)
      ) {
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
    this.pendingEnvelopeIds = [];
    this.completedEnvelopeIds = [];
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
      // "Add envelope stacks and expand pallet inventory" round五: a
      // hand-placed envelope now joins the PENDING queue (admitEnvelopesTo
      // Pending itself re-snaps it into that pile's own slot, physics
      // disabled) rather than becoming the active/processing envelope
      // directly — starting the actual minigame is now always an explicit
      // player E-press at the table (game-app.ts's startMailStampUi calling
      // advanceQueue()), whether that pending entry arrived via this
      // physical sensor or via EnvelopeStackSystem's own bulk hand-in.
      this.admitEnvelopesToPending([id]);
      this.stableTimer = 0;
    }
  }
}
