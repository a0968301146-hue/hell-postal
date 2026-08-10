import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { HUD } from '../hud';
import { MAIL_BOX_DIMENSIONS, ENVELOPE_SIZE } from '../../data/world/mail-layout-data';
import { updateFloatingLabel } from '../../adapters/three/world-label-system';
import { MailBagRecord, EnvelopeRecord } from './mail-types';
import { MAIL_DESTINATIONS, getMailDestination, buildBagMaterials } from './mail-data';
import { MailSystem } from './mail-system';

function disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

/** How long a candidate envelope must sit continuously inside a box's
 * interiorBounds before it's judged at all ("Replace mail bags with open
 * mail boxes" round五: "正確信封進入interiorBounds並穩定約0.3～0.5秒後才設
 * 為boxed"). */
const INSERT_STABILITY_SECONDS = 0.4;

/** How long an already-boxed envelope must sit continuously OUTSIDE a box's
 * interiorBounds before it's confirmed as having escaped ("Remove sealing
 * and add physical mail box contents" round六: "持續約0.3秒不在箱內...避免
 * 抖動誤判"). */
const ESCAPE_CONFIRM_SECONDS = 0.3;

/** How high above the box's own rim the E-key drop point sits ("Align mail
 * box colliders with visible mesh" round四: "高於箱壁頂端約0.08～0.15m"). */
const E_INSERT_DROP_CLEARANCE = 0.1;

/** Local-space (box-mesh-relative) interior cavity bounds — every box shares
 * this same shape, so it's computed once rather than per-instance, and reads
 * exclusively from the single MAIL_BOX_DIMENSIONS config (spec二: "不可再各
 * 自寫死不同數值"). Used by updateInsertion's own acceptance judgment (spec
 * 五: 中心點進入interiorBounds／底面低於箱壁頂端／未穿過箱底). Assumes the
 * box mesh stays close to axis-aligned (this game's general fidelity level
 * — matches every other static-bounds check in this codebase, e.g.
 * lost-found-cabinet-system.ts's own slotBounds). */
const LOCAL_INTERIOR_BOUNDS = {
  minX: -MAIL_BOX_DIMENSIONS.innerWidth / 2, maxX: MAIL_BOX_DIMENSIONS.innerWidth / 2,
  minY: -MAIL_BOX_DIMENSIONS.outerHeight / 2 + MAIL_BOX_DIMENSIONS.bottomThickness, maxY: MAIL_BOX_DIMENSIONS.outerHeight / 2,
  minZ: -MAIL_BOX_DIMENSIONS.innerDepth / 2, maxZ: MAIL_BOX_DIMENSIONS.innerDepth / 2,
};

interface BagRuntime {
  label: THREE.Sprite;
  /** Which envelope id is currently being timed for the spec五 stability
   * check, and how long it's been continuously inside bounds so far — see
   * updateInsertion's own doc comment. */
  stableCandidateId: string | null;
  stableElapsed: number;
  /** Reset once the last JUDGED envelope leaves the interior bounds, so a
   * stationary already-judged envelope doesn't get re-evaluated (or spam a
   * failure toast) every frame while it just sits there (spec: 失敗時顯示
   * 原因一次即可). */
  lastAttemptedEnvelopeId: string | null;
  /** Per-already-boxed-envelope-id elapsed seconds spent continuously
   * OUTSIDE this bag's own interiorBounds — see updateEscapedEnvelopes's
   * own doc comment ("Remove sealing and add physical mail box contents"
   * round六). Absent/deleted entries mean "currently inside, or never left". */
  escapeTimers: Map<string, number>;
}

/**
 * Owns every mail box's own lifecycle — pattern selection (spec六), physical
 * envelope insertion (spec七), carry/placement/throw content hooks. Player-
 * visible as "信封箱" throughout (spec "Replace mail bags with open mail
 * boxes" round) — the class/field names here (MailBagSystem, MailBagRecord,
 * bagId, ...) are deliberately kept as-is (spec: "內部程式類別若大幅更名會增
 * 加風險，可以暫時保留MailBagSystem名稱"), a naming-only difference from what
 * the player sees.
 *
 * "移除空封箱供應架" round — the empty-box supply rack (its own physical
 * station + trySpawnBag()'s "player walks up, presses E, gets a fresh empty
 * box" flow) has been removed entirely; the region envelope dispatch machine
 * (envelope-dispatch-machine-system.ts / packed-mail-bag-system.ts) is now
 * the primary way envelopes get packed and shipped. Every OTHER box-lifecycle
 * method below (insertion sensor, escape tracking, carry/placement/throw
 * hooks, pattern cycling, resetDaily, ...) is deliberately left completely
 * untouched per spec ("不要刪除MailBagSystem整個系統") — nothing currently
 * calls into this class to create a new box, but the class itself, and
 * everything it does with a box once one exists, is unchanged.
 *
 * "Remove sealing and add physical mail box contents" round: sealing is
 * gone entirely (spec一) — a box is ALWAYS an open-top container that can be
 * picked up/placed/thrown/loaded at any time, with or without contents. A
 * "boxed" envelope (its id present in `bag.envelopeIds`) is NOT reparented
 * under the box's own Mesh while the box rests in the world — it stays a
 * fully independent scene object with its own active RigidBody, physically
 * resting inside the box purely because of real gravity/collision against
 * the box's own 5 Colliders (spec六: contents are continuously re-verified
 * against `interiorBounds` every frame, see updateEscapedEnvelopes, exactly
 * mirroring how updateInsertion already re-verifies not-yet-boxed
 * envelopes). Reparenting under the box's own Mesh only ever happens
 * TEMPORARILY while the box itself is being carried by the player (spec
 * 三) — see prepareContentsForCarry/restoreContentsAfterPlacement/
 * restoreContentsForThrow, wired into PickupSystem via setMailBoxHooks()
 * (spec三: "使用既有PickupSystem拿起信封箱", spec十: one set of hooks, never
 * two parallel "before/after" content systems). Boxes are genuine open-top
 * containers — an open rectangular box shell (mail-data.ts's
 * buildBoxGeometry, purely visual: bottom + 4 walls, no top) over a
 * COMPOUND physics body of 5 separate box colliders (bottom + left/right/
 * front/back walls, attached to one dynamic RigidBody via PhysicsSystem.
 * addColliderToBody) — never a single solid box, and never anything at the
 * open mouth, so the interior is genuinely hollow both visually and
 * physically. Calls back into MailSystem to keep an envelope's own state
 * (bagged/unbagged) as the single source of truth there (spec: envelope
 * state lives in ONE place) — this class only owns box records and the
 * box's own InteractableObject.
 */
export class MailBagSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupPort;
  private hud: HUD;
  private mailSystem: MailSystem;

  private bags: Map<string, MailBagRecord> = new Map();
  private bagRuntime: Map<string, BagRuntime> = new Map();

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    pickupSystem: PickupPort, hud: HUD, mailSystem: MailSystem
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.pickupSystem = pickupSystem;
    this.hud = hud;
    this.mailSystem = mailSystem;
  }

  /** PickupSystem's own `isMailBox` hook (spec三/十) — a plain userData tag
   * check, no MailBagRecord lookup needed for this narrow question. */
  isMailBox(obj: InteractableObject): boolean {
    return !!obj.mesh.userData.mailBoxId;
  }

  isBag(id: string): boolean {
    return this.bags.has(id);
  }

  getBag(id: string): MailBagRecord | undefined {
    return this.bags.get(id);
  }

  /** Cycles this bag's destinationPattern through the four destinations
   * (spec六: 阿爾戈斯/赫菲斯提亞/東方群島/精靈之島) — a simple press-F-to-cycle rather than a
   * separate popup menu, reusing the existing E/F key surface with zero new
   * UI system. Region is auto-derived and re-locked alongside the pattern.
   * "Allow mail box pattern changes with contents" round: F now works
   * regardless of how many envelopes the box already holds (sealing no
   * longer exists, and the box's contents are never blocked/locked by its
   * own pattern — see validEnvelopeIds' own doc comment for how already-
   * boxed envelopes that stop matching are handled). */
  cyclePattern(bagId: string): void {
    const bag = this.bags.get(bagId);
    if (!bag) return;
    const idx = bag.destinationPattern ? MAIL_DESTINATIONS.findIndex((d) => d.id === bag.destinationPattern) : -1;
    const next = MAIL_DESTINATIONS[(idx + 1) % MAIL_DESTINATIONS.length];
    bag.destinationPattern = next.id;
    bag.region = next.region;
    this.refreshBagVisual(bagId);
  }

  /** Envelope ids among `bag.envelopeIds` whose OWN destination still
   * matches the bag's CURRENT destinationPattern ("Allow mail box pattern
   * changes with contents" round — cycling the pattern via F no longer
   * touches any envelope record at all, so validity is always computed
   * fresh here rather than cached/stored anywhere; the moment the pattern
   * cycles back to match a previously-mismatched envelope, it's valid again
   * automatically, no re-insertion needed). Used by both the world label's
   * own valid/total count below and MailSystem's departure-time scoring
   * gate (via the lookup hook wired in create-game-systems.ts). */
  private validEnvelopeIds(bag: MailBagRecord): string[] {
    if (!bag.destinationPattern) return [];
    return bag.envelopeIds.filter((id) => this.mailSystem.getEnvelope(id)?.destination === bag.destinationPattern);
  }

  private refreshBagVisual(bagId: string): void {
    const bag = this.bags.get(bagId);
    const obj = this.interactables.get(bagId);
    const runtime = this.bagRuntime.get(bagId);
    if (!bag || !obj) return;
    const pattern = bag.destinationPattern ? getMailDestination(bag.destinationPattern) : null;
    const oldMats = obj.mesh.material;
    // Exterior pattern updates immediately on every F cycle (spec二: "每次
    // 按F切換時，外側圖樣立即同步更新") — a fresh material PAIR each time
    // (exterior texture regenerated, interior lining rebuilt alongside it
    // purely for symmetric lifecycle/disposal, see buildBagMaterials).
    obj.mesh.material = buildBagMaterials(pattern);
    disposeMaterial(oldMats);
    if (runtime) {
      const regionText = bag.region ? (bag.region === 'domestic' ? '國內' : '海外') : '';
      const patternText = pattern ? `${pattern.icon}${pattern.displayName}` : '未設定';
      const validCount = this.validEnvelopeIds(bag).length;
      updateFloatingLabel(runtime.label, `${patternText} ${regionText}｜${validCount}/${bag.envelopeIds.length} 封有效`);
    }
  }

  /** Removes the most-recently-placed envelope from `bagId` (spec二: LIFO —
   * "取出最後放入的信件") and returns its own InteractableObject so the
   * caller (InteractionSystem's right-click handler) can hand it straight
   * into PickupSystem.pickUp() (spec二: "信封直接加入玩家heldItems") — this
   * method only does the box-side bookkeeping (envelopeIds / MailSystem
   * state / floating label / escape timer), never touches
   * playerData/heldItems itself (that stays PickupSystem's own job, spec
   * 三). A "boxed" envelope is never reparented under the box's own Mesh
   * while the box merely rests in the world (see class doc comment) — it's
   * already a fully independent, physically-resting scene object, so
   * there's nothing to unparent or reposition here beyond restoring normal
   * pickupability. */
  removeLastEnvelope(bagId: string): InteractableObject | null {
    const bag = this.bags.get(bagId);
    if (!bag || bag.envelopeIds.length === 0) return null;
    const envelopeId = bag.envelopeIds.pop()!;
    this.bagRuntime.get(bagId)?.escapeTimers.delete(envelopeId);
    this.mailSystem.setEnvelopeUnbagged(envelopeId);
    const obj = this.interactables.get(envelopeId);
    if (obj) obj.canPickUp = true;
    this.refreshBagVisual(bagId);
    return obj ?? null;
  }

  /** All currently-existing box ids ("Remove sealing and add physical mail
   * box contents" round九: sealing is gone, every box is loadable/scoreable
   * regardless of any prior state) — read-only for VehicleControlSystem's
   * own departure-time cargo-bay scan (spec: "所有信封箱裝載判定必須讀取同
   * 一份設定" — VehicleControlSystem is the ONE place the actual
   * region-vs-vehicle rule is evaluated; this class only ever reports plain
   * bag facts, never judges vehicle compatibility itself). */
  getAllBagIds(): string[] {
    return [...this.bags.keys()];
  }

  getBagRegion(bagId: string): 'domestic' | 'international' | null {
    return this.bags.get(bagId)?.region ?? null;
  }

  /** spec十: getContainedEnvelopeIds() — always the CURRENT live contents
   * (kept accurate by updateEscapedEnvelopes/removeLastEnvelope/
   * attemptInsert), so departure-time scoring naturally only counts
   * envelopes still genuinely inside at that exact moment (spec九: "依當下
   * 仍在interiorBounds且已登記的信件計分"). */
  getContainedEnvelopeIds(bagId: string): string[] {
    return this.bags.get(bagId)?.envelopeIds ?? [];
  }

  /** Called by VehicleControlSystem once per bag it's decided departed —
   * lets tomorrow's resetDaily() skip anything already gone, and stops this
   * class's own bookkeeping map from growing across days indefinitely.
   * Bagged-envelope children ride along with the bag's own mesh removal —
   * MailSystem's own resetDaily() (called separately, right after this one)
   * disposes every remaining envelope interactable regardless of its
   * current parent, so nothing here needs to explicitly detach them first. */
  removeShippedBag(bagId: string): void {
    const obj = this.interactables.get(bagId);
    if (obj) {
      this.scene.remove(obj.mesh);
      obj.mesh.geometry.dispose();
      disposeMaterial(obj.mesh.material);
      if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
      this.interactables.delete(bagId);
    }
    this.bags.delete(bagId);
    this.bagRuntime.delete(bagId);
  }

  /** Called from PickupSystem's own isMailBox hook, right before the box
   * itself is hidden/added as a viewmodel clone (spec三) — reparents every
   * currently-contained envelope under the box's own THREE.Mesh at its
   * CURRENT local-relative transform, pauses its physics, and leaves it
   * fully VISIBLE (spec三: "信件模型保持可見，不可刪除或合併成單一貼圖").
   * Reparenting (rather than the generic captureContainerContents/
   * restoreContainerContents side-array PickupSystem already has for
   * sortingBoxId/crateId containers) is deliberate: it's the only way
   * addHeldViewMesh's own `obj.mesh.clone(true)` deep clone naturally
   * includes correctly-positioned, correctly-rotating envelope children in
   * the held viewmodel with zero extra viewmodel code (spec三: "旋轉箱子時
   * 信件需正確跟隨旋轉"). Physics is disabled (not merely paused) so the
   * per-frame render-sync loop in game-app.ts skips these envelopes
   * entirely — leaving a now-locally-parented mesh where that loop expects
   * a world-space rigidbody translation would otherwise silently corrupt
   * its transform. */
  prepareContentsForCarry(obj: InteractableObject): void {
    const bag = this.bags.get(obj.id);
    if (!bag || bag.envelopeIds.length === 0) return;
    obj.mesh.updateWorldMatrix(true, false);
    const parentWorldQuatInv = new THREE.Quaternion();
    obj.mesh.getWorldQuaternion(parentWorldQuatInv).invert();
    for (const envelopeId of bag.envelopeIds) {
      const envObj = this.interactables.get(envelopeId);
      if (!envObj) continue;
      const worldPos = new THREE.Vector3();
      envObj.mesh.getWorldPosition(worldPos);
      const worldQuat = new THREE.Quaternion();
      envObj.mesh.getWorldQuaternion(worldQuat);
      const localPos = obj.mesh.worldToLocal(worldPos);
      const localQuat = parentWorldQuatInv.clone().multiply(worldQuat);
      if (envObj.rigidBody) {
        envObj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        envObj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.physics.setBodyEnabled(envObj.rigidBody, false);
      }
      obj.mesh.add(envObj.mesh);
      envObj.mesh.position.copy(localPos);
      envObj.mesh.quaternion.copy(localQuat);
      envObj.mesh.visible = true;
    }
  }

  /** Shared unparent-and-restore step for both restoreContentsAfterPlacement
   * and restoreContentsForThrow below — reads each reparented envelope's
   * CURRENT world transform (derived from its still-correct local offset
   * combined with the box's own now-final matrixWorld), unparents it back
   * to a plain independent `this.scene` child, and re-enables its physics
   * at that transform with the given velocity. `angularRatio` lets the
   * throw path damp the box's own angular velocity down to "a reasonable
   * proportion" (spec五) while the placement path passes 0 angular velocity
   * outright (a placed box isn't spinning). */
  private restoreContents(obj: InteractableObject, linvel: THREE.Vector3, angvel: THREE.Vector3, angularRatio: number): void {
    const bag = this.bags.get(obj.id);
    if (!bag || bag.envelopeIds.length === 0) return;
    obj.mesh.updateWorldMatrix(true, true);
    for (const envelopeId of bag.envelopeIds) {
      const envObj = this.interactables.get(envelopeId);
      if (!envObj || envObj.mesh.parent !== obj.mesh) continue;
      const worldPos = new THREE.Vector3();
      envObj.mesh.getWorldPosition(worldPos);
      obj.mesh.remove(envObj.mesh);
      this.scene.add(envObj.mesh);
      envObj.mesh.position.copy(worldPos);
      // Flat/level rotation rather than re-applying whatever tilt the
      // envelope's carried local quaternion happened to capture (mirrors
      // confirmPlacement/executeThrow's own universal `rotation.set(0,0,0)`
      // reset for every other placed/thrown item elsewhere in this
      // codebase) — an instantly-teleported envelope re-inserted with even
      // a tiny residual tilt turned out to settle into a slow, undamped
      // lateral slide against the box's own floor collider (confirmed via
      // headless physics tracing: naturally-settled envelopes stay
      // bit-for-bit stationary indefinitely, but a captured-tilt restore
      // drifted enough to trip updateEscapedEnvelopes within ~1s even with
      // zero initial velocity) — spec四/五 only require position/velocity
      // to carry over, never rotation.
      envObj.mesh.rotation.set(0, 0, 0);
      envObj.mesh.visible = true;
      if (envObj.rigidBody) {
        this.physics.setBodyEnabled(envObj.rigidBody, true);
        envObj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        envObj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        envObj.rigidBody.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
        envObj.rigidBody.setAngvel({ x: angvel.x * angularRatio, y: angvel.y * angularRatio, z: angvel.z * angularRatio }, true);
      }
    }
  }

  /** Called from PickupSystem right after the box itself is placed at its
   * final world transform (spec四) — restores physics with a near-zero
   * inherited velocity (`boxVelocity`, typically ~0 for a normal placement)
   * so envelopes settle naturally inside rather than launching or clipping
   * through the bottom (spec四: "速度應接近0，讓信件自然落定"). Not locked
   * or reparented again right after (spec四: "不得在放下後立刻鎖定") — from
   * this point on they're ordinary independent physics objects, exactly
   * like any envelope that settled in on its own. */
  restoreContentsAfterPlacement(obj: InteractableObject, boxVelocity: THREE.Vector3): void {
    this.restoreContents(obj, boxVelocity, new THREE.Vector3(0, 0, 0), 1);
  }

  /** Called from PickupSystem at the START of the box's own charge-throw
   * (spec五: "投出時信件立刻恢復動態物理...在丟出的瞬間就要恢復物理，而非
   * 等箱子落地後才處理") — same unparent-and-restore as placement, but each
   * envelope additionally inherits the box's own linear velocity plus a
   * damped share of its angular velocity (spec五: "信件應繼承箱子的線速
   * 度、一定比例的角速度"), so a tipping/spinning thrown box can naturally
   * eject its contents out the open top on impact — no fake ejection
   * animation, no invisible lid Collider (spec五). */
  restoreContentsForThrow(obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void {
    this.restoreContents(obj, linearVelocity, angularVelocity, 0.5);
  }

  /** Continuously re-verifies every ALREADY-boxed envelope against its own
   * box's LIVE interiorBounds (spec六) — mirrors updateInsertion's own
   * stability-timer pattern, just inverted (confirm-continuously-OUTSIDE-
   * for-ESCAPE_CONFIRM_SECONDS instead of confirm-continuously-INSIDE-for-
   * INSERT_STABILITY_SECONDS). A momentary bounce/collision that carries an
   * envelope outside bounds and back doesn't immediately clear it — only a
   * SUSTAINED exit does (spec六: "避免抖動誤判"). Skips any box currently
   * held by the player — its contents are transiently reparented/physics-
   * disabled by prepareContentsForCarry, not subject to this world-space
   * check at all (mirrors updateInsertion's own identical guard). */
  private updateEscapedEnvelopes(deltaTime: number): void {
    const halfEnvelopeHeight = ENVELOPE_SIZE.height / 2;
    for (const bag of this.bags.values()) {
      if (bag.envelopeIds.length === 0) continue;
      const bagObj = this.interactables.get(bag.bagId);
      const runtime = this.bagRuntime.get(bag.bagId);
      if (!bagObj || !runtime || bagObj.isHeld) continue;
      const bp = bagObj.mesh.position;

      const escapedIds: string[] = [];
      for (const envelopeId of bag.envelopeIds) {
        const envObj = this.interactables.get(envelopeId);
        if (!envObj) continue;
        const lx = envObj.mesh.position.x - bp.x;
        const lz = envObj.mesh.position.z - bp.z;
        const bottomFaceY = (envObj.mesh.position.y - bp.y) - halfEnvelopeHeight;
        const inside =
          lx >= LOCAL_INTERIOR_BOUNDS.minX && lx <= LOCAL_INTERIOR_BOUNDS.maxX &&
          lz >= LOCAL_INTERIOR_BOUNDS.minZ && lz <= LOCAL_INTERIOR_BOUNDS.maxZ &&
          bottomFaceY <= LOCAL_INTERIOR_BOUNDS.maxY &&
          bottomFaceY >= LOCAL_INTERIOR_BOUNDS.minY - 0.01;

        if (inside) {
          runtime.escapeTimers.delete(envelopeId);
          continue;
        }
        const elapsed = (runtime.escapeTimers.get(envelopeId) ?? 0) + deltaTime;
        if (elapsed >= ESCAPE_CONFIRM_SECONDS) {
          escapedIds.push(envelopeId);
          runtime.escapeTimers.delete(envelopeId);
        } else {
          runtime.escapeTimers.set(envelopeId, elapsed);
        }
      }

      if (escapedIds.length === 0) continue;
      for (const envelopeId of escapedIds) {
        const idx = bag.envelopeIds.indexOf(envelopeId);
        if (idx !== -1) bag.envelopeIds.splice(idx, 1);
        this.mailSystem.setEnvelopeUnbagged(envelopeId);
        const envObj = this.interactables.get(envelopeId);
        if (envObj) envObj.canPickUp = true;
      }
      this.refreshBagVisual(bag.bagId);
    }
  }

  update(deltaTime: number): void {
    this.updateInsertion(deltaTime);
    this.updateEscapedEnvelopes(deltaTime);
  }

  /** Passive per-bag insertion sensor (spec三: "玩家必須真的將信封從袋口放
   * 入袋內...使用袋內sensor／interiorBounds判定：信封中心從袋口進入內部，信
   * 封位於袋子內部範圍") — checks each unbagged envelope's WORLD position
   * against the bag's CURRENT world-space interior cavity (LOCAL_INTERIOR_
   * BOUNDS offset by the bag's own live position), not mere proximity to the
   * bag's outside. Since the only way into that interior volume is down
   * through the genuinely open top (every other side is a real wall
   * collider), an envelope merely resting against an outer wall face never
   * satisfies this check — it has to have actually gone in through the
   * mouth.
   *
   * "Replace mail bags with open mail boxes" round五: a candidate must stay
   * the SAME envelope, continuously inside bounds, for INSERT_STABILITY_
   * SECONDS (~0.3-0.5s) before it's judged at all — a bouncing/still-falling
   * envelope (thrown via Q, or the E-drop's own natural fall) is never
   * evaluated mid-flight. The timer resets the instant the candidate
   * changes or leaves the bounds. Once judged (success -> `attemptInsert`
   * flips its state to 'bagged', removing it from trackedUnbaggedEnvelopeIds
   * on the very next scan; failure -> lastAttemptedEnvelopeId) it's not
   * re-judged again until it actually leaves and re-enters the bounds, so a
   * stationary failed envelope doesn't spam the failure toast every frame. */
  private updateInsertion(deltaTime: number): void {
    for (const bag of this.bags.values()) {
      const bagObj = this.interactables.get(bag.bagId);
      const runtime = this.bagRuntime.get(bag.bagId);
      if (!bagObj || !runtime) continue;
      // A box currently held by the player has its own physics/render-sync
      // suspended and its contents transiently reparented under its own
      // Mesh (prepareContentsForCarry) — running the world-space insertion
      // sensor against it would misread those local-space child positions
      // as world coordinates (spec三/十).
      if (bagObj.isHeld) continue;
      const bp = bagObj.mesh.position;

      // "Align mail box colliders with visible mesh" round五: horizontal
      // (X/Z) acceptance is still the envelope's CENTER point against the
      // interior footprint, but the vertical judgment is explicitly the
      // envelope's own BOTTOM face — below the rim (spec: "信封底面低於箱
      // 壁頂端") and not sunk through the bottom board (spec: "未穿過箱
      // 底") — rather than the bare center-point range check this used
      // before. Every envelope preset shares the exact same height (see
      // mail-data.ts's own doc comment on ENVELOPE_SIZE.height), so this
      // one constant is valid for all of them.
      const halfEnvelopeHeight = ENVELOPE_SIZE.height / 2;
      let insideId: string | null = null;
      for (const id of this.trackedUnbaggedEnvelopeIds()) {
        const obj = this.interactables.get(id);
        if (!obj || obj.isHeld || !obj.mesh.visible) continue;
        const lx = obj.mesh.position.x - bp.x;
        const lz = obj.mesh.position.z - bp.z;
        const bottomFaceY = (obj.mesh.position.y - bp.y) - halfEnvelopeHeight;
        if (
          lx >= LOCAL_INTERIOR_BOUNDS.minX && lx <= LOCAL_INTERIOR_BOUNDS.maxX &&
          lz >= LOCAL_INTERIOR_BOUNDS.minZ && lz <= LOCAL_INTERIOR_BOUNDS.maxZ &&
          bottomFaceY <= LOCAL_INTERIOR_BOUNDS.maxY &&
          bottomFaceY >= LOCAL_INTERIOR_BOUNDS.minY - 0.01 // small settle tolerance, still catches genuine tunneling
        ) { insideId = id; break; }
      }

      if (!insideId) {
        runtime.lastAttemptedEnvelopeId = null;
        runtime.stableCandidateId = null;
        runtime.stableElapsed = 0;
        continue;
      }
      if (insideId === runtime.lastAttemptedEnvelopeId) continue; // already judged this approach

      if (runtime.stableCandidateId !== insideId) {
        runtime.stableCandidateId = insideId;
        runtime.stableElapsed = 0;
      }
      runtime.stableElapsed += deltaTime;
      if (runtime.stableElapsed < INSERT_STABILITY_SECONDS) continue; // spec五: not stable yet

      runtime.lastAttemptedEnvelopeId = insideId;
      runtime.stableCandidateId = null;
      runtime.stableElapsed = 0;
      this.attemptInsert(insideId, bag.bagId);
    }
  }

  /** All of today's envelope ids that still physically exist and aren't
   * already claimed by some bag — read via MailSystem's own registry
   * (spec: envelope state lives in ONE place). */
  private trackedUnbaggedEnvelopeIds(): string[] {
    const ids: string[] = [];
    for (const id of this.interactables.keys()) {
      if (!id.startsWith('envelope-')) continue;
      const rec = this.mailSystem.getEnvelope(id);
      if (rec && (rec.state === 'unstamped' || rec.state === 'stamped')) ids.push(id);
    }
    return ids;
  }

  /** On success, the envelope is simply registered as this bag's newest
   * content — it stays exactly where it physically already settled, as a
   * fully independent scene object with its own active RigidBody (spec十:
   * no more "pre-seal/post-seal" parallel content systems — a boxed
   * envelope is genuinely still just resting inside the box under normal
   * physics, held in only by the box's own real wall/bottom Colliders).
   * Only `canPickUp` flips false, so it can no longer be directly E-picked
   * out of the box (extraction is now exclusively the right-click flow, see
   * removeLastEnvelope). On any failure the envelope is untouched — stays
   * exactly where it physically is, still fully normal (spec: "未貼票、圖樣
   * 錯誤或袋子已滿時，信封保持正常物理，不得消失"). */
  private attemptInsert(envelopeId: string, bagId: string): void {
    const rec = this.mailSystem.getEnvelope(envelopeId);
    const bag = this.bags.get(bagId);
    if (!rec || !bag) return;

    const failReason = this.canAcceptEnvelope(rec, bag);
    if (failReason) {
      this.hud.showToast(failReason);
      return;
    }

    // "Allow unset mail boxes to accept first envelope" round二: the FIRST
    // correctly-stamped envelope to genuinely settle into an unset box
    // fixes that box's own destination to the envelope's own (full 4-way)
    // destination — never merely its domestic/international region. Set
    // BEFORE refreshBagVisual() below so the exterior texture/floating
    // label both update to the new pattern in this same call, no separate
    // follow-up render needed.
    if (!bag.destinationPattern) {
      bag.destinationPattern = rec.destination;
      bag.region = rec.region;
    }

    const obj = this.interactables.get(envelopeId);
    if (obj) obj.canPickUp = false;

    bag.envelopeIds.push(envelopeId);
    this.mailSystem.setEnvelopeBagged(envelopeId, bagId);
    this.refreshBagVisual(bagId);
  }

  /** Shared "can this envelope go into this bag right now" precondition
   * chain ("Enlarge mail bags and add E key letter placement" round 二: the
   * new explicit E-key insertion path must enforce the EXACT same rules as
   * the passive sensor, never a second diverging copy) — used by BOTH
   * attemptInsert's passive Q/physics-settle sensor path AND
   * tryInsertHeldEnvelope's explicit E-key path below, so the two can never
   * diverge into separate rule sets (spec三: "E與Q必須共用同一套
   * canAcceptEnvelope()判定").
   *
   * "Allow unset mail boxes to accept first envelope" round一/三: an UNSET
   * box (`destinationPattern === null`) no longer blocks insertion outright
   * — it accepts any correctly-stamped envelope as its potential FIRST one
   * (attemptInsert then fixes the box's own destination to that envelope's,
   * see its own doc comment). Once a box already has ITS OWN destination
   * (either previously unset-then-filled, or set directly via F), the
   * original destination-match rule applies exactly as before — this is
   * naturally already true here since `rec.destination !== bag.
   * destinationPattern` only ever runs once destinationPattern is
   * non-null. */
  private canAcceptEnvelope(rec: EnvelopeRecord, bag: MailBagRecord): string | null {
    if (bag.envelopeIds.length >= bag.capacity) return '信封箱已滿';
    if (rec.state !== 'stamped') return '尚未貼郵票';
    if (bag.destinationPattern && rec.destination !== bag.destinationPattern) return '郵票或目的地不符';
    return null;
  }

  /** Explicit E-key insertion (spec二/三/四) — called by InteractionSystem
   * when the player is holding a stamped envelope and presses E while aiming
   * at an open bag. Does NOT delete the envelope or set it `bagged` here
   * (spec: "不得在按下E的當下就刪除信封或只改資料") — it only releases the
   * held envelope and repositions it just above the bag's own CURRENT mouth
   * (world-space, computed from the bag mesh's live position+rotation via
   * localToWorld so a moved/rotated bag still gets a correct drop point,
   * spec四), then lets it fall under normal gravity/physics. The EXISTING
   * passive updateInsertion()/attemptInsert() sensor (unchanged) picks it up
   * once it genuinely settles inside interiorBounds, exactly like any other
   * insertion — this method only ever handles the "release + safe drop
   * point" half. On any failed precondition the envelope is left completely
   * untouched (still held) and the specific reason is shown, mirroring
   * attemptInsert's own failure behavior. */
  tryInsertHeldEnvelope(envelopeId: string, bagId: string): void {
    const rec = this.mailSystem.getEnvelope(envelopeId);
    const bag = this.bags.get(bagId);
    const obj = this.interactables.get(envelopeId);
    const bagObj = this.interactables.get(bagId);
    if (!rec || !bag || !obj || !bagObj) return;

    const failReason = this.canAcceptEnvelope(rec, bag);
    if (failReason) {
      this.hud.showToast(failReason);
      return;
    }

    // Safe drop point: centered above the mouth, ~E_INSERT_DROP_CLEARANCE
    // (0.08-0.15m) above the rim (spec四), expressed in the box's own local
    // space then converted to world space via its CURRENT matrix — respects
    // both translation and rotation. Deliberately NOT run through
    // PickupSystem's generic placement validation (spec三) — that check
    // treats the box's own walls as obstacles (they're real Colliders under
    // GROUP_BOX, same as every other cargo item), which would reject a
    // perfectly legitimate drop point sitting directly above the box's own
    // open mouth; this drop point is fixed, always in open air above the
    // rim, and physics re-enables normally right below (spec六).
    bagObj.mesh.updateWorldMatrix(true, false);
    const dropWorld = bagObj.mesh.localToWorld(
      new THREE.Vector3(0, LOCAL_INTERIOR_BOUNDS.maxY + E_INSERT_DROP_CLEARANCE, 0)
    );

    this.pickupSystem.forceDropHeld();

    obj.mesh.visible = true;
    obj.mesh.position.copy(dropWorld);
    obj.mesh.rotation.set(0, 0, 0);
    obj.isHeld = false;
    obj.canPickUp = true;

    if (obj.rigidBody) {
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.setTranslation({ x: dropWorld.x, y: dropWorld.y, z: dropWorld.z }, true);
      obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Wired into DailyFlowSystem's resetTools callback (spec十二) — clears
   * every still-existing bag (world or rack-adjacent, empty or holding
   * envelopes) and every daily counter. */
  resetDaily(): void {
    for (const bag of this.bags.values()) {
      const obj = this.interactables.get(bag.bagId);
      if (obj) {
        if (obj.isHeld) this.pickupSystem.forceDropHeld();
        this.scene.remove(obj.mesh);
        obj.mesh.geometry.dispose();
        disposeMaterial(obj.mesh.material);
        if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
        this.interactables.delete(bag.bagId);
      }
    }
    this.bags.clear();
    this.bagRuntime.clear();
  }
}
