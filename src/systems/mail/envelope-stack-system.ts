import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { ENVELOPE_SIZE } from '../../data/world/mail-layout-data';
import { MailSystem } from './mail-system';
import { EnvelopeState } from './mail-types';

/** Sentinel `playerData.heldObjectId` while carrying an envelope stack —
 * mirrors LadderSystem/PalletSystem's own convention of writing a known id
 * directly into playerData while bypassing PickupSystem's generic heldStack
 * entirely (see this class's own doc comment for why), except there's no
 * single real envelope id that could represent "the whole stack", so this
 * is a fixed constant instead of a specific object's own id. Every other
 * system's own `heldObjectId` checks (mailBagSystem.isBag, palletSystem.
 * isPalletId, mailSystem.getEnvelope, ...) naturally return false/undefined
 * for this string, so none of them misidentify a carried stack as anything
 * they own. */
export const ENVELOPE_STACK_HELD_ID = 'envelope-stack';

export type EnvelopeActionMode = 'stack' | 'single';

const DEFAULT_MAX_CAPACITY = 5; // Lv.0, spec十一

/** Camera-local carry anchor (mirrors PickupSystem's own HELD_ANCHOR_*
 * constants, computed manually here since this is a world-space carry, not
 * a viewModelScene clone — see class doc comment) — held low-right so even
 * a full 20-envelope stack never rises into the crosshair (spec二: "最多20
 * 封時仍不可遮住畫面中央準心"). */
const ANCHOR_X = 0.22;
const ANCHOR_Y = -0.32;
const ANCHOR_Z = -0.55;
/** Vertical step between stacked envelopes — real thickness + a hair of
 * daylight (spec二: "每封垂直間距依信封實際厚度＋約0.002m"). */
const STACK_STEP_Y = ENVELOPE_SIZE.height + 0.002;
/** Small alternating horizontal jitter so the player can visually count
 * roughly how many are held without a literal on-screen number (spec二:
 * "可加入很小的水平錯位，讓玩家看得出封數") — capped so even 20 envelopes
 * don't fan out far enough to reach the crosshair either. */
const JITTER_X = 0.012;
const JITTER_MAX_STEPS = 6;

const GROUND_PLACE_FORWARD_DIST = 1.0;

/**
 * Owns carrying multiple loose single Envelope objects at once ("Add
 * envelope stacks and expand pallet inventory" round一-四) — a genuinely
 * NEW carry mode, not an extension of PickupSystem's existing generic
 * multi-carry (heldStack/HELD_SLOT_OFFSETS): envelopes have never set
 * `mesh.userData.cargoSizeClass`, so they're exclusive-hold items under
 * PickupSystem's own isExclusiveItem check today, and that system's visual
 * slot layout only supports 3 simultaneous items anyway — nowhere near this
 * round's 5-20 range. Mirrors LadderSystem/PalletSystem's own established
 * "dedicated world-space carry, bypass PickupSystem's viewmodel-clone path
 * entirely" pattern instead: envelopes stay their own real scene objects
 * (never hidden, never cloned into a viewmodel), repositioned directly in
 * front of the camera every frame while held, with physics disabled the
 * same way any other held item's physics is suspended.
 *
 * Owns its own per-carry state: an ordered stack of envelope ids (last =
 * top, LIFO — spec: "信封順序採後進先出"), the single processingState
 * ('unstamped' | 'stamped') every envelope in the CURRENT stack must share
 * (spec: "不可將已貼與未貼信封混在同一疊"), an actionMode ('stack' | 'single',
 * spec三/四), and maxCapacity (5-20, pushed by UpgradeSystem's own
 * envelopeCarryLevel effect via setMaxCapacity — see upgrade-system.ts).
 *
 * Deliberately EXCLUDES: PackedMailBag, open MailBagSystem boxes, anything
 * currently buffered inside the envelope dispatch machine (already fully
 * removed from `interactables` the instant it's consumed — see
 * EnvelopeDispatchMachineSystem's own consumeEnvelope), and whatever is
 * currently on the stamp table (active slot or either queue pile — see
 * MailSystem.isOnStampTable). Only ever considers a loose EnvelopeRecord in
 * state 'unstamped' or 'stamped'.
 */
export class EnvelopeStackSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private camera: THREE.PerspectiveCamera;
  private hud: HUD;
  private mailSystem: MailSystem;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;

  private stackIds: string[] = [];
  private processingState: EnvelopeState | null = null;
  private actionMode: EnvelopeActionMode = 'stack';
  private maxCapacity = DEFAULT_MAX_CAPACITY;
  private downRaycaster = new THREE.Raycaster();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, camera: THREE.PerspectiveCamera, hud: HUD, mailSystem: MailSystem,
    pauseManager: PauseManager, isLockedFn: () => boolean
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.playerData = playerData;
    this.camera = camera;
    this.hud = hud;
    this.mailSystem = mailSystem;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;

    // Independent F-listener (spec三) — mirrors pallet-system.ts's own F-key
    // rope-strap toggle, a SEPARATE document-level 'keydown' listener rather
    // than threading through InteractionSystem's own existing F handler
    // (which only ever fires for mail-bag pattern cycling / the legacy
    // crate, both structurally unable to match an envelope-stack scenario —
    // see this method's own guard). This is how the codebase already keeps
    // multiple independent F-key consumers from colliding (spec三: "不可同時
    // 觸發其他F互動...不可破壞力量手套對地面托盤使用固定繩索的F功能").
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  // --- Upgrade hook ---

  /** UpgradeSystem's ONLY hook into envelope-carry capacity (mirrors
   * PickupSystem.setMaxCarryCapacity's own doc comment: never called by
   * anything except UpgradeSystem.applyEffect). Spec十一: "若玩家升級時手上
   * 數量高於新容量，不強制丟棄；容量只限制之後新增信封" — lowering the cap
   * below the current count is intentionally a no-op on whatever's already
   * held, it only affects future additions. */
  setMaxCapacity(n: number): void {
    this.maxCapacity = Math.max(1, n);
    this.refreshHud();
  }

  // --- Queries ---

  get isCarrying(): boolean {
    return this.stackIds.length > 0;
  }

  get count(): number {
    return this.stackIds.length;
  }

  get mode(): EnvelopeActionMode {
    return this.actionMode;
  }

  static isHeldSentinel(id: string | null): boolean {
    return id === ENVELOPE_STACK_HELD_ID;
  }

  /** True while the player is CURRENTLY carrying a stack via this system —
   * read by InteractionSystem the same way it already reads
   * ladderSystem.isCarrying/palletSystem's own held-pallet check. */
  get isCarryingViaHeldId(): boolean {
    return this.playerData.heldObjectId === ENVELOPE_STACK_HELD_ID;
  }

  /** A loose envelope's own processing state, or null if it's not a
   * genuinely eligible loose envelope at all (spec一: only single Envelope
   * objects, excludes anything bagged/shipped/on the table/held). */
  private eligibleGroundState(id: string, obj: InteractableObject): EnvelopeState | null {
    const rec = this.mailSystem.getEnvelope(id);
    if (!rec) return null;
    if (rec.state !== 'unstamped' && rec.state !== 'stamped') return null;
    if (obj.isHeld || !obj.mesh.visible) return null;
    if (this.mailSystem.readyEnvelopeId === id) return null;
    if (obj.rigidBody && !obj.rigidBody.isEnabled()) return null;
    return rec.state;
  }

  /** True if `id` is a valid E-target right now — either a loose ground
   * envelope, or an envelope currently sitting in one of the stamp table's
   * own queue piles (spec七: "拿取規則沿用整疊／單張模式") — both routed
   * through the same pickUpFromGround() below, since "gather same-pile
   * matches" applies equally to either collection. */
  canPickUpTarget(id: string): boolean {
    const obj = this.interactables.get(id);
    if (!obj) return false;
    if (this.isCarrying && this.stackIds.length >= this.maxCapacity) return false;
    if (this.mailSystem.isOnStampTable(id)) {
      const state = this.mailSystem.getEnvelope(id)?.state ?? null;
      return (state === 'unstamped' || state === 'stamped') && this.stateCompatible(state);
    }
    const state = this.eligibleGroundState(id, obj);
    return state !== null && this.stateCompatible(state);
  }

  private stateCompatible(state: EnvelopeState): boolean {
    return this.processingState === null || this.processingState === state;
  }

  // --- Pickup (E, empty-handed or already carrying, aimed at an envelope) ---

  /** spec一/四: stack mode gathers `targetId` plus other SAME-collection
   * (loose-ground OR the SAME table pile — never mixed) same-state
   * envelopes up to remaining capacity; single mode takes only `targetId`
   * itself. */
  pickUpTarget(targetId: string): void {
    if (!this.canPickUpTarget(targetId)) return;
    const onTable = this.mailSystem.isOnStampTable(targetId);
    const state = (this.mailSystem.getEnvelope(targetId)?.state ?? null) as EnvelopeState | null;
    if (!state) return;

    const ids = this.actionMode === 'single' ? [targetId] : this.gatherMatchingIds(targetId, state, onTable);
    let added = 0;
    for (const id of ids) {
      if (this.stackIds.length >= this.maxCapacity) break;
      if (onTable) this.mailSystem.removeFromQueue(id);
      this.addToStack(id, state);
      added++;
    }
    if (added === 0) return;
    if (this.stackIds.length >= this.maxCapacity) this.hud.showToast('信封攜帶量已達上限');
  }

  /** Stack-mode gather — `targetId` first, then other eligible ids from the
   * SAME collection (loose ground, or specifically whichever table pile
   * `targetId` itself belongs to), in stable insertion order, capped by
   * remaining capacity by the caller. */
  private gatherMatchingIds(targetId: string, state: EnvelopeState, onTable: boolean): string[] {
    const result = [targetId];
    const remaining = this.maxCapacity - this.stackIds.length;
    if (remaining <= 1) return result;

    if (onTable) {
      const pile = state === 'unstamped' ? this.mailSystem.getPendingEnvelopeIds() : this.mailSystem.getCompletedEnvelopeIds();
      for (const id of pile) {
        if (id === targetId) continue;
        if (result.length >= remaining) break;
        result.push(id);
      }
      return result;
    }

    for (const [id, obj] of this.interactables) {
      if (id === targetId) continue;
      if (result.length >= remaining) break;
      if (this.eligibleGroundState(id, obj) === state) result.push(id);
    }
    return result;
  }

  private addToStack(id: string, state: EnvelopeState): void {
    const obj = this.interactables.get(id);
    if (!obj) return;
    if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, false);
    obj.isHeld = true;
    this.stackIds.push(id);
    this.processingState = state;
    if (this.stackIds.length === 1) {
      this.playerData.state = 'holding-item';
      this.playerData.heldObjectId = ENVELOPE_STACK_HELD_ID;
    }
    this.refreshHud();
  }

  // --- Place / hand-to-table / throw ---

  /** stack mode: whole stack; single mode: only the top (LIFO) one. */
  private takeForRelease(): string[] {
    if (this.stackIds.length === 0) return [];
    if (this.actionMode === 'single') return [this.stackIds[this.stackIds.length - 1]];
    return [...this.stackIds];
  }

  private removeFromStack(ids: string[]): void {
    for (const id of ids) {
      const idx = this.stackIds.indexOf(id);
      if (idx !== -1) this.stackIds.splice(idx, 1);
    }
    if (this.stackIds.length === 0) {
      this.processingState = null;
      if (this.playerData.heldObjectId === ENVELOPE_STACK_HELD_ID) {
        this.playerData.state = 'empty-handed';
        this.playerData.heldObjectId = null;
      }
    }
    this.refreshHud();
  }

  /** True while the crosshair-independent proximity to the stamp table
   * (same convention MailSystem.isPlayerNearTable already establishes for
   * every other table interaction) is close enough to hand off. */
  canHandToTable(cameraPosition: THREE.Vector3): boolean {
    return this.isCarrying && this.processingState === 'unstamped' && this.mailSystem.isPlayerNearTable(cameraPosition);
  }

  /** spec五: "整疊模式：對信件工作台按E：將整疊中可容納的未貼票信封全部放入
   * 工作台" / "單張模式只放入最上方1封". Only ever offers UNSTAMPED envelopes
   * to the table (stamped ones have nothing to do there) — if the current
   * stack is stamped, this is simply never reachable (canHandToTable already
   * gates on processingState==='unstamped'). */
  tryHandToTable(cameraPosition: THREE.Vector3): void {
    if (!this.canHandToTable(cameraPosition)) return;
    const candidates = this.takeForRelease();
    const admitted = this.mailSystem.admitEnvelopesToPending(candidates);
    if (admitted.length === 0) {
      this.hud.showToast('工作台已滿，無法放入信封');
      return;
    }
    for (const id of admitted) {
      const obj = this.interactables.get(id);
      if (obj) obj.isHeld = false;
    }
    this.removeFromStack(admitted);
    if (admitted.length < candidates.length) {
      this.hud.showToast(`工作台空間不足，僅放入 ${admitted.length} 封`);
    }
  }

  /** spec四: place the current release-batch on the floor/surface in front
   * of the player, found via a straight-down raycast from a point ahead of
   * the camera (mirrors LadderSystem's own downRaycaster placement-preview
   * technique) — a direct one-press placement, no separate preview/confirm
   * step (unlike PickupSystem's own generic flow), matching this round's
   * own simpler "對可放置表面按E：放下整疊/1封" spec wording. Each envelope
   * gets its own small floor-plane offset so a whole stack never spawns
   * stacked at one exact point (spec四: "不可全部生成在相同座標造成爆炸"). */
  tryPlaceOnGround(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.isCarrying) return;
    const flat = new THREE.Vector3(cameraForward.x, 0, cameraForward.z);
    if (flat.lengthSq() < 1e-6) return;
    flat.normalize();
    const groundPoint = new THREE.Vector3(
      cameraPosition.x + flat.x * GROUND_PLACE_FORWARD_DIST,
      cameraPosition.y,
      cameraPosition.z + flat.z * GROUND_PLACE_FORWARD_DIST
    );
    this.downRaycaster.set(new THREE.Vector3(groundPoint.x, groundPoint.y + 2, groundPoint.z), new THREE.Vector3(0, -1, 0));
    const hits = this.downRaycaster.intersectObjects(this.scene.children, true).filter((h) => this.isRealSurfaceHit(h.object));
    const surfaceY = hits.length > 0 ? hits[0].point.y : groundPoint.y - 1.5;

    const ids = this.takeForRelease();
    let i = 0;
    for (const id of ids) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      const ring = Math.floor(i / 6);
      const angle = (i % 6) * ((Math.PI * 2) / 6);
      const radius = 0.06 + ring * 0.1;
      const x = groundPoint.x + Math.cos(angle) * radius;
      const z = groundPoint.z + Math.sin(angle) * radius;
      const y = surfaceY + ENVELOPE_SIZE.height / 2 + 0.01 + ring * (ENVELOPE_SIZE.height + 0.01);
      obj.mesh.position.set(x, y, z);
      obj.mesh.rotation.set(0, 0, 0);
      obj.isHeld = false;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x, y, z }, true);
        obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      i++;
    }
    this.removeFromStack(ids);
  }

  private isRealSurfaceHit(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur === this.camera) return false;
      if (cur.userData.isFloatingLabel || cur.userData.isHitProxy) return false;
      cur = cur.parent;
    }
    return true;
  }

  /** Q: throw the current release-batch (mirrors PickupSystem's own
   * charge-throw impulse scale loosely — kept simple/fixed here since a
   * thrown envelope is trivially light, spec四: "放出後每封恢復個別物理，可
   * 自然散開"). */
  throwRelease(cameraPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (!this.isCarrying) return;
    const ids = this.takeForRelease();
    const dir = cameraForward.clone().normalize();
    let i = 0;
    for (const id of ids) {
      const obj = this.interactables.get(id);
      if (!obj) continue;
      const spawnPos = cameraPosition.clone().add(dir.clone().multiplyScalar(0.6 + i * 0.05));
      obj.mesh.position.copy(spawnPos);
      obj.isHeld = false;
      if (obj.rigidBody) {
        this.physics.setBodyEnabled(obj.rigidBody, true);
        obj.rigidBody.setTranslation({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, true);
        obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        const jitter = () => (Math.random() - 0.5) * 1.2;
        obj.rigidBody.setLinvel({ x: dir.x * 4.5 + jitter(), y: 2.0 + jitter() * 0.3, z: dir.z * 4.5 + jitter() }, true);
        obj.rigidBody.setAngvel({ x: jitter(), y: jitter(), z: jitter() }, true);
      }
      i++;
    }
    this.removeFromStack(ids);
  }

  // --- F: stack/single mode toggle ---

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'KeyF') return;
    if (!this.isLocked() || this.pauseManager.isPaused) return;
    // spec三: only while carrying a stack, OR empty-handed and aiming at an
    // eligible envelope (crosshair target resolved by InteractionSystem via
    // playerData.targetedObjectId, the SAME shared field every other prompt
    // already reads). Never fires otherwise, so this can never collide with
    // pallet-system.ts's own independent F-listener (mutually exclusive held
    // items) or InteractionSystem's own F handler (mail-bag pattern cycle /
    // legacy crate — neither ever matches an envelope target).
    const targetId = this.playerData.targetedObjectId;
    const aimingAtEligible = !!targetId && this.playerData.state === 'empty-handed' && this.canPickUpTarget(targetId);
    if (!this.isCarrying && !aimingAtEligible) return;

    event.preventDefault();
    this.actionMode = this.actionMode === 'stack' ? 'single' : 'stack';
    this.hud.showToast(this.actionMode === 'stack' ? '已切換：整疊模式' : '已切換：單張模式');
    this.refreshHud();
  }

  // --- Per-frame carry visual ---

  update(): void {
    if (this.stackIds.length === 0) return;
    const camPos = this.camera.position;
    const camQuat = this.camera.quaternion;
    for (let i = 0; i < this.stackIds.length; i++) {
      const obj = this.interactables.get(this.stackIds[i]);
      if (!obj) continue;
      const jitterSteps = Math.min(i, JITTER_MAX_STEPS);
      const jitterSign = i % 2 === 0 ? -1 : 1;
      const local = new THREE.Vector3(
        ANCHOR_X + jitterSign * JITTER_X * jitterSteps,
        ANCHOR_Y + i * STACK_STEP_Y,
        ANCHOR_Z
      );
      const worldPos = local.applyQuaternion(camQuat).add(camPos);
      obj.mesh.position.copy(worldPos);
      obj.mesh.quaternion.copy(camQuat);
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w }, true);
      }
    }
  }

  private refreshHud(): void {
    this.hud.updateEnvelopeStackStatus(this.stackIds.length, this.maxCapacity, this.actionMode);
  }

  /** Wired into DailyFlowSystem's resetTools callback, alongside
   * mailSystem.resetDaily() — MailSystem's OWN resetDaily already disposes
   * every still-existing daily envelope (mesh/geometry/material/body/
   * interactables entry) regardless of who's currently "holding" it (spec:
   * "isHeld=true的信封需 forceDropHeld 後才 dispose" — that convention lives
   * on PickupPort.forceDropHeld, which this class isn't part of; MailSystem.
   * resetDaily's own loop just disposes directly). This method only needs to
   * clear THIS class's own bookkeeping (stack membership/mode/processing
   * state) so nothing stale references an id MailSystem is about to delete
   * — called BEFORE mailSystem.resetDaily() in create-game-systems.ts's
   * reset callback, mirroring mailBagSystem's own ordering. */
  resetDaily(): void {
    this.stackIds = [];
    this.processingState = null;
    this.actionMode = 'stack';
    if (this.playerData.heldObjectId === ENVELOPE_STACK_HELD_ID) {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
    }
    this.refreshHud();
  }
}
