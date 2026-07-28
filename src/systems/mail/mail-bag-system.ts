import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { HUD } from '../hud';
import { BACK_AREA } from '../world-layout';
import { BAG_RACK, MAIL_BAG_INTERIOR, MAIL_BAG_WALL_THICKNESS, ENVELOPE_SIZE } from '../../data/world/mail-layout-data';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { MailBagRecord, EnvelopeRecord } from './mail-types';
import { MAIL_DESTINATIONS, MAX_OPEN_BAGS, MAIL_BAG_CAPACITY, getMailDestination, buildBagMaterials, buildBoxGeometry, buildBoxSealVisual } from './mail-data';
import { MailSystem } from './mail-system';

const BAG_ID_PREFIX = 'mailbag-';

/** The empty-bag supply rack's own raycast-target id ("Resize mail bags and
 * fix supply rack interaction" round三/四: precise crosshair-hit
 * interaction, no proximity/second raycaster) — registered once in the
 * SAME shared `interactables` map every other pickupable prop uses, so
 * InteractionSystem's existing single raycast pipeline picks it up for
 * free (see interaction-system.ts's own special-case check against this
 * id, mirroring how it already special-cases the sorting pallet). Exported
 * so that file can reference it without a second lookup mechanism. */
export const MAIL_RACK_INTERACTABLE_ID = 'mail-rack';

function disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

/** How long a candidate envelope must sit continuously inside a box's
 * interiorBounds before it's judged at all ("Replace mail bags with open
 * mail boxes" round五: "正確信封進入interiorBounds並穩定約0.3～0.5秒後才設
 * 為boxed"). */
const INSERT_STABILITY_SECONDS = 0.4;

/** Overall bag footprint — interior cavity (mail-layout-data.ts) plus wall
 * thickness on X/Z (both sides) and Y (bottom only — the top stays open,
 * spec二: "袋口上方不得有Mesh或Collider封住"). Computed once, shared by every
 * bag instance's mesh/collider/interior-bounds math below. */
const TOTAL_WIDTH = MAIL_BAG_INTERIOR.width + 2 * MAIL_BAG_WALL_THICKNESS;
const TOTAL_DEPTH = MAIL_BAG_INTERIOR.depth + 2 * MAIL_BAG_WALL_THICKNESS;
const TOTAL_HEIGHT = MAIL_BAG_INTERIOR.height + MAIL_BAG_WALL_THICKNESS;

/** Local-space (bag-mesh-relative) interior cavity bounds — every bag shares
 * this same shape, so it's computed once rather than per-instance. Used by
 * attemptInsert's "did the envelope's center genuinely enter the interior"
 * judgment (spec三). Assumes the bag mesh stays close to axis-aligned (this
 * game's general fidelity level — matches every other static-bounds check
 * in this codebase, e.g. lost-found-cabinet-system.ts's own slotBounds). */
const LOCAL_INTERIOR_BOUNDS = {
  minX: -MAIL_BAG_INTERIOR.width / 2, maxX: MAIL_BAG_INTERIOR.width / 2,
  minY: -TOTAL_HEIGHT / 2 + MAIL_BAG_WALL_THICKNESS, maxY: TOTAL_HEIGHT / 2,
  minZ: -MAIL_BAG_INTERIOR.depth / 2, maxZ: MAIL_BAG_INTERIOR.depth / 2,
};

interface BagRuntime {
  label: THREE.Sprite;
  /** Sealed-state strap visual ("Replace mail bags with open mail boxes"
   * round七) — toggled visible only while sealed, same lifecycle the old
   * cinch ring used. */
  sealVisual: THREE.Group;
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
}

/**
 * Owns the empty-box supply rack and every mail box's own lifecycle — spawn
 * (spec六), pattern selection (spec六), physical envelope insertion (spec
 * 七), and sealing (spec八). Player-visible as "信封箱" throughout (spec
 * "Replace mail bags with open mail boxes" round) — the class/field names
 * here (MailBagSystem, MailBagRecord, bagId, ...) are deliberately kept
 * as-is (spec: "內部程式類別若大幅更名會增加風險，可以暫時保留
 * MailBagSystem名稱"), a naming-only difference from what the player sees.
 * Boxes are genuine open-top containers — an open rectangular box shell
 * (mail-data.ts's buildBoxGeometry, purely visual: bottom + 4 walls, no
 * top) over a COMPOUND physics body of 5 separate box colliders (bottom +
 * left/right/front/back walls, attached to one dynamic RigidBody via
 * PhysicsSystem.addColliderToBody) — never a single solid box, and never
 * anything at the open mouth, so the interior is genuinely hollow both
 * visually and physically. Calls back into MailSystem to keep an envelope's
 * own state (bagged/unbagged) as the single source of truth there (spec:
 * envelope state lives in ONE place) — this class only owns box records and
 * the box's own InteractableObject.
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
  private bagInstanceCounter = 0;
  private rackLabel!: THREE.Sprite;

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
    this.buildRack();
  }

  private buildRack(): void {
    const floorY = BACK_AREA.floorY;
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(BAG_RACK.width, BAG_RACK.height, BAG_RACK.depth);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a7050 }));
    mesh.position.y = BAG_RACK.height / 2;
    group.add(mesh);

    this.rackLabel = createFloatingLabel(this.rackLabelText(), { width: 0.9, bg: 'rgba(30,25,15,0.75)' });
    this.rackLabel.position.set(0, BAG_RACK.height + 0.4, 0);
    group.add(this.rackLabel);

    group.position.set(BAG_RACK.posX, floorY, BAG_RACK.posZ);
    this.scene.add(group);

    // Player-blocking collider — unrelated to the interaction fix below,
    // unchanged from before (spec: only the INTERACTION gate changes).
    this.physics.createStaticCuboid(BAG_RACK.posX, floorY + BAG_RACK.height / 2, BAG_RACK.posZ, BAG_RACK.width / 2, BAG_RACK.height / 2, BAG_RACK.depth / 2);

    // Registered in the SAME shared `interactables` map every pickupable
    // prop uses, so InteractionSystem's existing single crosshair raycast
    // picks it up for free — no proximity check, no second raycaster
    // (spec三/四). `canPickUp: true` only so it PASSES that raycast's own
    // generic filter; it's never actually handed to PickupSystem.pickUp()
    // — interaction-system.ts intercepts E specially before that generic
    // path runs, exactly mirroring how it already special-cases the
    // sorting pallet. Bounds exactly match the rack's own body (width x
    // height x depth = 0.7 x 1.1 x 0.5), not an enlarged detection volume.
    const rackObj = createInteractableObject(MAIL_RACK_INTERACTABLE_ID, '空封箱供應架', mesh, BAG_RACK.width, BAG_RACK.height, BAG_RACK.depth);
    this.interactables.set(MAIL_RACK_INTERACTABLE_ID, rackObj);
  }

  private rackLabelText(): string {
    return `空封箱供應架 (${this.bags.size}/${MAX_OPEN_BAGS})`;
  }

  get canSpawnBag(): boolean {
    return this.bags.size < MAX_OPEN_BAGS;
  }

  /** Spawns one new open, pattern-unset mail box near the rack (spec六: "場
   * 上空袋上限8個，不可無限生成"). No-op past the cap. Builds the open-top
   * shell + compound (bottom/left/right/front/back, no top) collider —
   * see the class doc comment above. */
  trySpawnBag(): void {
    if (!this.canSpawnBag) {
      this.hud.showToast('空箱數量已達上限');
      return;
    }

    const id = `${BAG_ID_PREFIX}${this.bagInstanceCounter++}`;
    const x = BAG_RACK.posX + (Math.random() - 0.5) * 0.6;
    const z = BAG_RACK.posZ + BAG_RACK.depth / 2 + 0.5 + Math.random() * 0.4;
    const y = BACK_AREA.floorY + TOTAL_HEIGHT / 2 + 0.05;

    const geo = buildBoxGeometry(MAIL_BAG_INTERIOR.width, MAIL_BAG_INTERIOR.depth, MAIL_BAG_INTERIOR.height, MAIL_BAG_WALL_THICKNESS);
    const mats = buildBagMaterials(null);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const obj = createInteractableObject(id, '空信封箱', mesh, TOTAL_WIDTH, TOTAL_HEIGHT, TOTAL_DEPTH);

    const bodyDesc = this.physics.createDynamicBodyDesc(x, y, z, 8);
    const body = this.physics.createDynamicBody(bodyDesc);
    const wt = MAIL_BAG_WALL_THICKNESS;
    const wallLocalY = -TOTAL_HEIGHT / 2 + wt + MAIL_BAG_INTERIOR.height / 2;
    const bottomCollider = this.physics.addColliderToBody(body, 0, -TOTAL_HEIGHT / 2 + wt / 2, 0, TOTAL_WIDTH / 2, wt / 2, TOTAL_DEPTH / 2);
    this.physics.addColliderToBody(body, -(MAIL_BAG_INTERIOR.width / 2 + wt / 2), wallLocalY, 0, wt / 2, MAIL_BAG_INTERIOR.height / 2, TOTAL_DEPTH / 2); // left
    this.physics.addColliderToBody(body, (MAIL_BAG_INTERIOR.width / 2 + wt / 2), wallLocalY, 0, wt / 2, MAIL_BAG_INTERIOR.height / 2, TOTAL_DEPTH / 2); // right
    this.physics.addColliderToBody(body, 0, wallLocalY, -(MAIL_BAG_INTERIOR.depth / 2 + wt / 2), TOTAL_WIDTH / 2, MAIL_BAG_INTERIOR.height / 2, wt / 2); // back
    this.physics.addColliderToBody(body, 0, wallLocalY, (MAIL_BAG_INTERIOR.depth / 2 + wt / 2), TOTAL_WIDTH / 2, MAIL_BAG_INTERIOR.height / 2, wt / 2); // front
    obj.rigidBody = body;
    obj.collider = bottomCollider;
    this.interactables.set(id, obj);

    const label = createFloatingLabel('未設定\n0 封信', { width: 0.7, bg: 'rgba(20,20,20,0.75)' });
    label.position.set(0, TOTAL_HEIGHT / 2 + 0.35, 0);
    mesh.add(label);

    // Sealed-state strap visual — built once, toggled visible only while
    // sealed (spec七) rather than rebuilt on every seal/unseal.
    const sealVisual = buildBoxSealVisual(MAIL_BAG_INTERIOR.width, MAIL_BAG_INTERIOR.depth, TOTAL_HEIGHT / 2 - 0.02);
    mesh.add(sealVisual);

    this.bags.set(id, {
      bagId: id, destinationPattern: null, region: null, state: 'open', envelopeIds: [], capacity: MAIL_BAG_CAPACITY,
    });
    this.bagRuntime.set(id, { label, sealVisual, stableCandidateId: null, stableElapsed: 0, lastAttemptedEnvelopeId: null });
    updateFloatingLabel(this.rackLabel, this.rackLabelText());
  }

  isBag(id: string): boolean {
    return this.bags.has(id);
  }

  getBag(id: string): MailBagRecord | undefined {
    return this.bags.get(id);
  }

  /** Cycles this bag's destinationPattern through the four destinations
   * (spec六: 台北/台中/日本/美國) — a simple press-F-to-cycle rather than a
   * separate popup menu, reusing the existing E/F key surface with zero new
   * UI system. Region is auto-derived and re-locked alongside the pattern.
   * No-op on a sealed bag (spec: "封袋後圖樣與地區鎖定"). */
  cyclePattern(bagId: string): void {
    const bag = this.bags.get(bagId);
    if (!bag || bag.state !== 'open') return;
    const idx = bag.destinationPattern ? MAIL_DESTINATIONS.findIndex((d) => d.id === bag.destinationPattern) : -1;
    const next = MAIL_DESTINATIONS[(idx + 1) % MAIL_DESTINATIONS.length];
    bag.destinationPattern = next.id;
    bag.region = next.region;
    this.refreshBagVisual(bagId);
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
      runtime.sealVisual.visible = bag.state === 'sealed';
      const regionText = bag.region ? (bag.region === 'domestic' ? '國內' : '海外') : '';
      const patternText = pattern ? `${pattern.icon}${pattern.displayName}` : '未設定';
      const sealedText = bag.state === 'sealed' ? '（已封閉）' : '';
      updateFloatingLabel(runtime.label, `${patternText} ${regionText}${sealedText}\n${bag.envelopeIds.length} 封信`);
    }
  }

  /** Attempts to seal `bagId` (spec八) — requires an open bag with a pattern
   * set and at least one envelope. Locks pattern/region, blocks further
   * insertion/removal (spec五: "關閉袋內sensor/不可再投入或取出"), shows the
   * cinch-ring visual, and leaves the bag a normal pickupable/placeable
   * InteractableObject (it already was one — sealing only flips `state` and
   * the visual/label). */
  trySeal(bagId: string): void {
    const bag = this.bags.get(bagId);
    if (!bag || bag.state !== 'open') return;
    if (!bag.destinationPattern || bag.envelopeIds.length === 0) return;
    bag.state = 'sealed';
    this.refreshBagVisual(bagId);
  }

  canSeal(bagId: string): boolean {
    const bag = this.bags.get(bagId);
    return !!bag && bag.state === 'open' && !!bag.destinationPattern && bag.envelopeIds.length > 0;
  }

  /** Removes the most-recently-inserted envelope from an OPEN bag (spec七:
   * "封袋前可以取出信封") — un-parents it from the bag's own mesh (spec三's
   * "跟隨袋子移動" is implemented by literally parenting a bagged envelope's
   * mesh under the bag's own THREE.Mesh; taking it out reverses that) and
   * makes it visible/physical again just outside the bag. */
  tryTakeOutLast(bagId: string): void {
    const bag = this.bags.get(bagId);
    if (!bag || bag.state !== 'open' || bag.envelopeIds.length === 0) return;
    const envelopeId = bag.envelopeIds.pop()!;
    this.mailSystem.setEnvelopeUnbagged(envelopeId);
    const obj = this.interactables.get(envelopeId);
    const bagObj = this.interactables.get(bagId);
    if (obj && bagObj) {
      const worldPos = new THREE.Vector3();
      obj.mesh.getWorldPosition(worldPos);
      bagObj.mesh.remove(obj.mesh);
      this.scene.add(obj.mesh);
      obj.mesh.rotation.set(0, 0, 0);
      obj.mesh.visible = true;
      obj.canPickUp = true;
      const p = bagObj.mesh.position;
      obj.mesh.position.set(p.x + (Math.random() - 0.5) * 0.3, p.y + TOTAL_HEIGHT / 2 + 0.1, p.z + (Math.random() - 0.5) * 0.3);
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation(obj.mesh.position, true);
        obj.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        obj.rigidBody.setLinvel({ x: 0, y: 0.5, z: 0 }, true);
        this.physics.setBodyEnabled(obj.rigidBody, true);
      }
    }
    this.refreshBagVisual(bagId);
  }

  /** Read-only for VehicleControlSystem's own departure-time scan (spec九:
   * "所有信件袋裝載判定必須讀取同一份設定" — VehicleControlSystem is the ONE
   * place the actual region-vs-vehicle rule is evaluated; this class only
   * ever reports plain bag facts, never judges vehicle compatibility
   * itself). */
  getSealedBagIds(): string[] {
    return [...this.bags.values()].filter((b) => b.state === 'sealed').map((b) => b.bagId);
  }

  getBagRegion(bagId: string): 'domestic' | 'international' | null {
    return this.bags.get(bagId)?.region ?? null;
  }

  getBagEnvelopeIds(bagId: string): string[] {
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

  update(deltaTime: number): void {
    this.updateInsertion(deltaTime);
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
      if (bag.state !== 'open') continue;
      const bagObj = this.interactables.get(bag.bagId);
      const runtime = this.bagRuntime.get(bag.bagId);
      if (!bagObj || !runtime) continue;
      const bp = bagObj.mesh.position;

      let insideId: string | null = null;
      for (const id of this.trackedUnbaggedEnvelopeIds()) {
        const obj = this.interactables.get(id);
        if (!obj || obj.isHeld || !obj.mesh.visible) continue;
        const lx = obj.mesh.position.x - bp.x;
        const ly = obj.mesh.position.y - bp.y;
        const lz = obj.mesh.position.z - bp.z;
        if (
          lx >= LOCAL_INTERIOR_BOUNDS.minX && lx <= LOCAL_INTERIOR_BOUNDS.maxX &&
          ly >= LOCAL_INTERIOR_BOUNDS.minY && ly <= LOCAL_INTERIOR_BOUNDS.maxY &&
          lz >= LOCAL_INTERIOR_BOUNDS.minZ && lz <= LOCAL_INTERIOR_BOUNDS.maxZ
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

  /** On success, the envelope is re-parented under the bag's own mesh at a
   * fixed local slot (spec三: "可將信封保存為相對袋子的局部位置，跟隨袋子移
   * 動") — reparenting under the bag's THREE.Mesh means every subsequent
   * frame's bag movement (held/thrown/placed/pinned-for-departure) carries
   * it along for free via the normal scene-graph transform, no per-frame
   * position-copying code needed anywhere. On any failure the envelope is
   * untouched — stays exactly where it physically is, still fully normal
   * (spec: "未貼票、圖樣錯誤或袋子已滿時，信封保持正常物理，不得消失"). */
  private attemptInsert(envelopeId: string, bagId: string): void {
    const rec = this.mailSystem.getEnvelope(envelopeId);
    const bag = this.bags.get(bagId);
    if (!rec || !bag) return;

    const failReason = this.checkInsertEligibility(rec, bag);
    if (failReason) {
      this.hud.showToast(failReason);
      return;
    }

    const obj = this.interactables.get(envelopeId);
    const bagObj = this.interactables.get(bagId);
    if (obj && bagObj) {
      if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, false);
      bagObj.mesh.add(obj.mesh);
      const stackIndex = bag.envelopeIds.length;
      const localY = LOCAL_INTERIOR_BOUNDS.minY + ENVELOPE_SIZE.height / 2 + stackIndex * (ENVELOPE_SIZE.height + 0.005);
      const jitterRangeX = Math.max(0, MAIL_BAG_INTERIOR.width - ENVELOPE_SIZE.width) * 0.4;
      const jitterRangeZ = Math.max(0, MAIL_BAG_INTERIOR.depth - ENVELOPE_SIZE.depth) * 0.4;
      obj.mesh.position.set((Math.random() - 0.5) * jitterRangeX, localY, (Math.random() - 0.5) * jitterRangeZ);
      obj.mesh.rotation.set(0, 0, 0);
      obj.canPickUp = false;
    }

    bag.envelopeIds.push(envelopeId);
    this.mailSystem.setEnvelopeBagged(envelopeId, bagId);
    this.refreshBagVisual(bagId);
  }

  /** Shared "can this envelope go into this bag right now" precondition
   * chain ("Enlarge mail bags and add E key letter placement" round 二: the
   * new explicit E-key insertion path must enforce the EXACT same rules as
   * the passive sensor, never a second diverging copy) — used by both
   * attemptInsert's passive-sensor path and tryInsertHeldEnvelope's explicit
   * E-key path below. */
  private checkInsertEligibility(rec: EnvelopeRecord, bag: MailBagRecord): string | null {
    if (bag.state !== 'open') return '信封箱已封閉';
    if (!bag.destinationPattern) return '信封箱尚未設定圖樣';
    if (bag.envelopeIds.length >= bag.capacity) return '信封箱已滿';
    if (rec.state !== 'stamped') return '尚未貼郵票';
    if (rec.destination !== bag.destinationPattern) return '郵票或目的地不符';
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

    const failReason = this.checkInsertEligibility(rec, bag);
    if (failReason) {
      this.hud.showToast(failReason);
      return;
    }

    // Safe drop point: centered above the mouth, high enough to clear the
    // wall rims (spec四), expressed in the bag's own local space then
    // converted to world space via its CURRENT matrix — respects both
    // translation and rotation.
    bagObj.mesh.updateWorldMatrix(true, false);
    const dropWorld = bagObj.mesh.localToWorld(
      new THREE.Vector3(0, LOCAL_INTERIOR_BOUNDS.maxY + MAIL_BAG_WALL_THICKNESS * 2, 0)
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
   * every still-existing bag (open or sealed, world or rack-adjacent) and
   * every daily counter. */
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
    updateFloatingLabel(this.rackLabel, this.rackLabelText());
  }
}
