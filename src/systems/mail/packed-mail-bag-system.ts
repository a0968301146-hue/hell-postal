import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { PickupPort } from '../../shared/types/pickup-port';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
import { PackedMailBagRecord, PackedEnvelopeSnapshot, MailDestination } from './mail-types';
import { MailDestinationInfo, getMailDestination } from './mail-data';
import { getDispatchOutputPosition } from './envelope-dispatch-machine-data';

const BAG_ID_PREFIX = 'packed-mailbag-';

/** Roughly a small satchel — big enough to read as "a bag full of letters",
 * small enough that four of them (one per region) never crowd the
 * dispatcher's own front-face output row. */
const BAG_DIMENSIONS = { width: 0.4, depth: 0.32, height: 0.46 };

/** How close an unclaimed bag must still be to its OWN region's output spot
 * to count as "sitting there, blocking a new one" (spec九) — generous enough
 * to survive it settling a little off the exact drop point under gravity,
 * tight enough that a player who's carried it away no longer blocks a fresh
 * bag from generating. */
const OUTPUT_CLAIM_RADIUS = 0.7;

function disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

/** Front-panel texture — reuses the exact same region icon/displayName/
 * domestic-or-international convention drawBoxFrontCanvas (mail-data.ts)
 * already established for open mail boxes (spec九: "沿用各地區既有圖樣/標
 * 示慣例"), plus the bag's own envelope count so the count is legible
 * without a separate floating label render pass. */
function drawPackedBagFrontCanvas(dest: MailDestinationInfo, count: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = `#${dest.color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 160, 200);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 152, 192);

  ctx.textAlign = 'center';
  ctx.font = '52px sans-serif';
  ctx.fillText(dest.icon, 80, 78);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(dest.displayName, 80, 128);
  ctx.font = '15px sans-serif';
  ctx.fillText(dest.region === 'domestic' ? '國內' : '海外', 80, 156);
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`內含 ${count} 封`, 80, 182);

  return canvas;
}

/** Plain burlap/canvas-cloth material — every surface except the front
 * panel's own region texture (mirrors buildBoxPlainMaterial's role for open
 * mail boxes, spec九: "布/紙袋/奇幻郵袋風格，而非硬紙箱"). */
function buildClothMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9c8259, roughness: 0.95 });
}

function buildPackedBagMaterials(dest: MailDestinationInfo, count: number): THREE.Material[] {
  const front = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(drawPackedBagFrontCanvas(dest, count)) });
  const cloth = buildClothMaterial();
  // BoxGeometry face order: [+x, -x, +y, -y, +z, -z] — front panel on +z.
  return [cloth, cloth, cloth, cloth, front, cloth];
}

/**
 * Owns every sealed, already-full PackedMailBag ("Add regional envelope
 * dispatch machine" round九/十) — generated exclusively by
 * EnvelopeDispatchMachineSystem's own pack-button handler (this class never
 * decides WHEN to pack, only how a bag is built/tracked once handed a
 * region's buffered envelope snapshots), picked up/placed/thrown through
 * PickupSystem's entirely GENERIC single-mesh flow (unlike MailBagSystem's
 * open boxes, a packed bag's contents are fixed data, not live physically-
 * simulated child objects, so it needs no MailBoxCarryHooks-style
 * reparenting hook at all — see the class's own doc comment in
 * pickup-system.ts for why that hook exists specifically for boxes with
 * still-independent physical contents). Never sets `mesh.userData.
 * cargoSizeClass = 'small'`, so PickupSystem.isExclusiveItem's existing
 * default (spec十: "以單一容器方式拿起，不能與其他物品一起多拿") applies with
 * zero extra code.
 */
export class PackedMailBagSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private pickupSystem: PickupPort;

  private bags: Map<string, PackedMailBagRecord> = new Map();
  private bagInstanceCounter = 0;

  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, pickupSystem: PickupPort) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.pickupSystem = pickupSystem;
  }

  isBag(id: string): boolean {
    return this.bags.has(id);
  }

  getBag(id: string): PackedMailBagRecord | undefined {
    return this.bags.get(id);
  }

  getAllBagIds(): string[] {
    return [...this.bags.keys()];
  }

  getBagRegion(id: string): 'domestic' | 'international' | null {
    return this.bags.get(id)?.region ?? null;
  }

  /** Read by create-game-systems.ts's own combined bagPatternLookup wiring
   * (see mail-system.ts's setBagPatternLookup doc comment) — a packed bag's
   * own destination never cycles/changes after generation (unlike an open
   * MailBagRecord's own F-cyclable pattern), so this is simply the fixed
   * value set at spawn. */
  getBagDestination(id: string): MailDestination | null {
    return this.bags.get(id)?.destination ?? null;
  }

  /** spec九: "若該地區輸出位置已有未領取信封袋，則不生成新袋、不清空緩衝
   * 區" — true only while a still-existing, not-currently-held bag for this
   * EXACT region is still physically resting at (or very near) its own
   * output spot; once picked up or carried away, the slot is free again. */
  isOutputSlotOccupied(destination: MailDestination): boolean {
    const outputPos = getDispatchOutputPosition(destination);
    for (const bag of this.bags.values()) {
      if (bag.destination !== destination) continue;
      const obj = this.interactables.get(bag.bagId);
      if (!obj || obj.isHeld) continue;
      if (obj.mesh.position.distanceTo(outputPos) <= OUTPUT_CLAIM_RADIUS) return true;
    }
    return false;
  }

  /** Generates exactly one new packed bag for `destination` from the given
   * (already-collected) envelope snapshots — called only by
   * EnvelopeDispatchMachineSystem's own pressPackButton(), which is
   * responsible for having already verified isOutputSlotOccupied() is false
   * and envelopeData.length > 0 (spec八: "每次按鈕最多產生4個袋子...空地區不
   * 產生任何東西"), and for clearing its own per-region buffer immediately
   * after this call succeeds. */
  spawnBag(destination: MailDestination, envelopeData: PackedEnvelopeSnapshot[]): string {
    const destInfo = getMailDestination(destination);
    const id = `${BAG_ID_PREFIX}${this.bagInstanceCounter++}`;
    const outputPos = getDispatchOutputPosition(destination);
    const x = outputPos.x;
    const z = outputPos.z;
    const y = outputPos.y + BAG_DIMENSIONS.height / 2 + 0.03;

    const geo = new THREE.BoxGeometry(BAG_DIMENSIONS.width, BAG_DIMENSIONS.height, BAG_DIMENSIONS.depth);
    const mats = buildPackedBagMaterials(destInfo, envelopeData.length);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, z);

    // Cinched cloth-sack neck + tie accents (spec九: "布/紙袋/奇幻郵袋風格") —
    // purely cosmetic children, distinguishing the silhouette from a plain
    // box even though the body itself stays a Box for a clean, legible
    // front texture.
    const clothMat = buildClothMaterial();
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(BAG_DIMENSIONS.width * 0.32, BAG_DIMENSIONS.width * 0.46, 0.08, 10), clothMat);
    neck.position.set(0, BAG_DIMENSIONS.height / 2 + 0.03, 0);
    mesh.add(neck);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(BAG_DIMENSIONS.width * 0.3, 0.018, 6, 12), clothMat);
    tie.position.set(0, BAG_DIMENSIONS.height / 2 + 0.07, 0);
    tie.rotation.x = Math.PI / 2;
    mesh.add(tie);

    this.scene.add(mesh);

    const { body, collider } = this.physics.createBoxBody(x, y, z, BAG_DIMENSIONS.width / 2, BAG_DIMENSIONS.height / 2, BAG_DIMENSIONS.depth / 2, 6);

    const displayName = `${destInfo.displayName}信封袋`;
    const obj = createInteractableObject(id, displayName, mesh, BAG_DIMENSIONS.width, BAG_DIMENSIONS.height, BAG_DIMENSIONS.depth);
    obj.rigidBody = body;
    obj.collider = collider;
    this.interactables.set(id, obj);

    const label = createFloatingLabel(`${destInfo.displayName}信封袋\n內含${envelopeData.length}封信`, { width: 0.7, bg: 'rgba(20,20,20,0.75)' });
    label.position.set(0, BAG_DIMENSIONS.height / 2 + 0.35, 0);
    mesh.add(label);

    this.bags.set(id, {
      bagId: id,
      destination,
      region: destInfo.region,
      envelopeIds: envelopeData.map((e) => e.envelopeId),
      envelopeData,
      envelopeCount: envelopeData.length,
    });

    return id;
  }

  /** Called by VehicleControlSystem's own departure-time bay scan/teardown
   * (mirrors MailBagSystem.removeShippedBag exactly) once this bag has
   * actually departed inside a vehicle. */
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
  }

  /** Wired into DailyFlowSystem's resetTools callback, same daily-reset
   * convention as MailBagSystem/MailSystem's own resetDaily (spec十一: "新
   * 一天開始時清空所有出貨器緩衝與尚未出貨的信封袋") — called BEFORE
   * mailSystem.resetDaily() in that same reset callback, mirroring
   * mailBagSystem's own ordering (any bag-referenced envelope id must be
   * gone from bookkeeping before MailSystem sweeps every remaining envelope,
   * though in this system's case the underlying envelope objects were
   * already disposed back when they entered the dispatcher's own hole — see
   * EnvelopeDispatchMachineSystem). */
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
    this.bagInstanceCounter = 0;
  }
}
