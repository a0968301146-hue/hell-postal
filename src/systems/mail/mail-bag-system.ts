import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { HUD } from '../hud';
import { SCENE_CONFIG, BACK_AREA } from '../world-layout';
import { BAG_RACK, MAIL_BAG_SIZE } from '../../data/world/mail-layout-data';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { MailBagRecord } from './mail-types';
import { MAIL_DESTINATIONS, MAX_OPEN_BAGS, MAIL_BAG_CAPACITY, getMailDestination, buildBagMaterial } from './mail-data';
import { MailSystem } from './mail-system';

const BAG_ID_PREFIX = 'mailbag-';
const BAG_INSERT_RADIUS = 0.32;

interface BagRuntime {
  label: THREE.Sprite;
  /** Reset once the last insertion attempt's envelope leaves range, so a
   * failed attempt's toast doesn't spam every frame while it just sits
   * there (spec七: 失敗時顯示原因一次即可). */
  lastAttemptedEnvelopeId: string | null;
}

/**
 * Owns the empty-bag supply rack and every MailBag's own lifecycle — spawn
 * (spec六), pattern selection (spec六), physical envelope insertion (spec
 *七), and sealing (spec八). Calls back into MailSystem to keep an
 * envelope's own state (bagged/unbagged) as the single source of truth
 * there (spec: envelope state lives in ONE place) — this class only owns
 * bag records and the bag's own InteractableObject.
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

    this.physics.createStaticCuboid(BAG_RACK.posX, floorY + BAG_RACK.height / 2, BAG_RACK.posZ, BAG_RACK.width / 2, BAG_RACK.height / 2, BAG_RACK.depth / 2);
  }

  private rackLabelText(): string {
    return `空封袋供應架\n按 E 取得新袋 (${this.bags.size}/${MAX_OPEN_BAGS})`;
  }

  isPlayerNearRack(pos: THREE.Vector3): boolean {
    const dx = pos.x - BAG_RACK.posX;
    const dz = pos.z - BAG_RACK.posZ;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance + 1;
  }

  get canSpawnBag(): boolean {
    return this.bags.size < MAX_OPEN_BAGS;
  }

  /** Spawns one new open, pattern-unset MailBag near the rack (spec六: "場上
   * 空袋上限8個，不可無限生成"). No-op past the cap. */
  trySpawnBag(): void {
    if (!this.canSpawnBag) {
      this.hud.showToast('空袋數量已達上限');
      return;
    }

    const id = `${BAG_ID_PREFIX}${this.bagInstanceCounter++}`;
    const x = BAG_RACK.posX + (Math.random() - 0.5) * 0.6;
    const z = BAG_RACK.posZ + BAG_RACK.depth / 2 + 0.5 + Math.random() * 0.4;
    const y = BACK_AREA.floorY + MAIL_BAG_SIZE.height / 2 + 0.05;

    const geo = new THREE.BoxGeometry(MAIL_BAG_SIZE.width, MAIL_BAG_SIZE.height, MAIL_BAG_SIZE.depth);
    const mat = buildBagMaterial(null);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const obj = createInteractableObject(id, '空分類袋', mesh, MAIL_BAG_SIZE.width, MAIL_BAG_SIZE.height, MAIL_BAG_SIZE.depth);
    const { body, collider } = this.physics.createBoxBody(x, y, z, MAIL_BAG_SIZE.width / 2, MAIL_BAG_SIZE.height / 2, MAIL_BAG_SIZE.depth / 2, 8);
    obj.rigidBody = body;
    obj.collider = collider;
    this.interactables.set(id, obj);

    const label = createFloatingLabel('未設定\n0 封信', { width: 0.7, bg: 'rgba(20,20,20,0.75)' });
    label.position.set(0, MAIL_BAG_SIZE.height / 2 + 0.35, 0);
    mesh.add(label);

    this.bags.set(id, {
      bagId: id, destinationPattern: null, region: null, state: 'open', envelopeIds: [], capacity: MAIL_BAG_CAPACITY,
    });
    this.bagRuntime.set(id, { label, lastAttemptedEnvelopeId: null });
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
    const oldMat = obj.mesh.material as THREE.Material;
    obj.mesh.material = buildBagMaterial(pattern);
    oldMat.dispose();
    if (runtime) {
      const regionText = bag.region ? (bag.region === 'domestic' ? '國內' : '海外') : '';
      const patternText = pattern ? `${pattern.icon}${pattern.displayName}` : '未設定';
      const sealedText = bag.state === 'sealed' ? '（已封閉）' : '';
      updateFloatingLabel(runtime.label, `${patternText} ${regionText}${sealedText}\n${bag.envelopeIds.length} 封信`);
    }
  }

  /** Attempts to seal `bagId` (spec八) — requires an open bag with a pattern
   * set and at least one envelope. Locks pattern/region, blocks further
   * insertion/removal, and makes the bag a normal pickupable/placeable
   * InteractableObject (it already was one; sealing only flips `state` and
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
   * "封袋前可以取出信封") — makes it visible/physical again near the bag. */
  tryTakeOutLast(bagId: string): void {
    const bag = this.bags.get(bagId);
    if (!bag || bag.state !== 'open' || bag.envelopeIds.length === 0) return;
    const envelopeId = bag.envelopeIds.pop()!;
    this.mailSystem.setEnvelopeUnbagged(envelopeId);
    const obj = this.interactables.get(envelopeId);
    const bagObj = this.interactables.get(bagId);
    if (obj && bagObj) {
      obj.mesh.visible = true;
      obj.canPickUp = true;
      const p = bagObj.mesh.position;
      obj.mesh.position.set(p.x + (Math.random() - 0.5) * 0.3, p.y + MAIL_BAG_SIZE.height / 2 + 0.1, p.z + (Math.random() - 0.5) * 0.3);
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation(obj.mesh.position, true);
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
   * class's own bookkeeping map from growing across days indefinitely. */
  removeShippedBag(bagId: string): void {
    const obj = this.interactables.get(bagId);
    if (obj) {
      this.scene.remove(obj.mesh);
      obj.mesh.geometry.dispose();
      (obj.mesh.material as THREE.Material).dispose();
      if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
      this.interactables.delete(bagId);
    }
    this.bags.delete(bagId);
    this.bagRuntime.delete(bagId);
  }

  update(deltaTime: number): void {
    this.updateInsertion(deltaTime);
  }

  /** Passive per-bag insertion sensor (spec七: "玩家將信封物理放進袋口") —
   * mirrors MailSystem's own stamp-table sensor pattern, but distance-based
   * rather than a static Box3 since bags are mobile props. Any stamped,
   * not-yet-bagged envelope that settles within BAG_INSERT_RADIUS of an
   * OPEN bag attempts insertion exactly once per approach (guarded by
   * lastAttemptedEnvelopeId so a stationary failed envelope doesn't spam
   * the failure toast every frame). */
  private updateInsertion(_deltaTime: number): void {
    for (const bag of this.bags.values()) {
      if (bag.state !== 'open') continue;
      const bagObj = this.interactables.get(bag.bagId);
      const runtime = this.bagRuntime.get(bag.bagId);
      if (!bagObj || !runtime) continue;

      let nearbyId: string | null = null;
      for (const id of this.trackedUnbaggedEnvelopeIds()) {
        const obj = this.interactables.get(id);
        if (!obj || obj.isHeld || !obj.mesh.visible) continue;
        const dx = obj.mesh.position.x - bagObj.mesh.position.x;
        const dy = obj.mesh.position.y - bagObj.mesh.position.y;
        const dz = obj.mesh.position.z - bagObj.mesh.position.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < BAG_INSERT_RADIUS) { nearbyId = id; break; }
      }

      if (!nearbyId) {
        runtime.lastAttemptedEnvelopeId = null;
        continue;
      }
      if (runtime.lastAttemptedEnvelopeId === nearbyId) continue; // already attempted this approach
      runtime.lastAttemptedEnvelopeId = nearbyId;
      this.attemptInsert(nearbyId, bag.bagId);
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

  private attemptInsert(envelopeId: string, bagId: string): void {
    const rec = this.mailSystem.getEnvelope(envelopeId);
    const bag = this.bags.get(bagId);
    if (!rec || !bag) return;

    let failReason: string | null = null;
    if (!bag.destinationPattern) failReason = '袋子尚未設定圖樣';
    else if (bag.envelopeIds.length >= bag.capacity) failReason = '袋子已滿';
    else if (rec.state !== 'stamped') failReason = '尚未貼郵票';
    else if (rec.destination !== bag.destinationPattern) failReason = '郵票或目的地不符';

    if (failReason) {
      this.hud.showToast(failReason);
      return;
    }

    bag.envelopeIds.push(envelopeId);
    this.mailSystem.setEnvelopeBagged(envelopeId, bagId);
    const obj = this.interactables.get(envelopeId);
    if (obj) {
      obj.mesh.visible = false;
      obj.canPickUp = false;
      if (obj.rigidBody) this.physics.setBodyEnabled(obj.rigidBody, false);
    }
    this.refreshBagVisual(bagId);
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
        (obj.mesh.material as THREE.Material).dispose();
        if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
        this.interactables.delete(bag.bagId);
      }
    }
    this.bags.clear();
    this.bagRuntime.clear();
    updateFloatingLabel(this.rackLabel, this.rackLabelText());
  }
}
