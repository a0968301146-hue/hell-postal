import * as THREE from 'three';
import { PhysicsSystem } from '../../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';
import { HUD } from '../hud';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { MailDestination, PackedEnvelopeSnapshot } from './mail-types';
import { getMailDestination } from './mail-data';
import { MailSystem } from './mail-system';
import { PackedMailBagSystem } from './packed-mail-bag-system';
import {
  DISPATCH_MACHINE_CENTER, DISPATCH_MACHINE_WIDTH, DISPATCH_MACHINE_DEPTH, DISPATCH_MACHINE_HEIGHT,
  DISPATCH_HOLES, DispatchHoleConfig, DISPATCH_DISPLAY_HEIGHT_ABOVE_HOLE, DISPATCH_DISPLAY_X,
  DISPATCH_BUTTON_POSITION, DISPATCH_BUTTON_INTERACT_DISTANCE, DISPATCH_BUTTON_DEBOUNCE_SECONDS,
} from './envelope-dispatch-machine-data';

const PACK_BUTTON_ID = 'envelope-dispatch-pack-button';

/** Outward bounce velocity for a rejected envelope (spec七: "給予一個較小的
 * 向外速度，讓它彈回") — away from the machine's own interior (+X, back into
 * the room), a little lift, small lateral jitter so repeated wrong throws
 * don't all bounce to the exact same spot. */
const BOUNCE_OUT_SPEED = 2.0;
const BOUNCE_UP_SPEED = 1.2;

/** How long a rejection toast ("寄送地區不符"/"請先完成郵票") stays the
 * active reason before the SAME envelope can trigger another one — prevents
 * a slow-settling rejected envelope from spamming the toast every single
 * frame it happens to still overlap the hole's own sensor box on its way
 * back out. */
const REJECT_MESSAGE_COOLDOWN = 1.0;

function disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

/**
 * The four-region envelope dispatch machine ("Add regional envelope dispatch
 * machine" round五-八) — a coin-operated-arcade-silhouette cabinet (large
 * upright body, open front throwing chamber, backward-tilted throwing
 * platform, four holes recessed into the interior's lower-back area, a
 * left-side pack button) standing in the gap `west-shelf-1`'s removal freed
 * (see envelope-dispatch-machine-data.ts's own doc comment on the "北牆"
 * wording substitution). Fixed/static geometry only — never registered into
 * `interactables` itself (only its pack button is), so it can never be
 * raycast-targeted, picked up, or hook-affected at all, structurally
 * satisfying spec五's "不可搬運/投擲/被捕貨鉤勾取" without any exclusion code
 * anywhere else.
 *
 * Owns its own per-region envelope buffers (spec六/七) — filled by
 * continuously scanning every loose, MailSystem-eligible envelope
 * (mirrors envelope-vacuum-system.ts's own isEligibleEnvelope two-state
 * filter exactly) against each hole's static world-space sensor Box3.
 * Accepted envelopes are fully disposed here (mesh/geometry/material/body/
 * interactables entry) the instant they're buffered — spec七: "從場景/物理
 * 中暫時移除" — but their own EnvelopeRecord is deliberately left alone in
 * MailSystem's registry (still 'stamped', bagId still null) until the pack
 * button actually turns that buffer into a real PackedMailBag (only then
 * does setEnvelopeBagged fire) — so an unpacked buffered envelope still
 * correctly reads as "not yet shipped" to MailSystem.settleAtDeparture's
 * existing logic with zero changes needed there (spec十一).
 */
export class EnvelopeDispatchMachineSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private hud: HUD;
  private mailSystem: MailSystem;
  private packedMailBagSystem: PackedMailBagSystem;

  private holeBoxes: Map<MailDestination, THREE.Box3> = new Map();
  private displayLabels: Map<MailDestination, THREE.Sprite> = new Map();
  private buffers: Map<MailDestination, PackedEnvelopeSnapshot[]> = new Map();
  private rejectMessageCooldowns: Map<string, number> = new Map();
  private packButtonCooldown = 0;

  constructor(
    scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    hud: HUD, mailSystem: MailSystem, packedMailBagSystem: PackedMailBagSystem
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.hud = hud;
    this.mailSystem = mailSystem;
    this.packedMailBagSystem = packedMailBagSystem;

    for (const hole of DISPATCH_HOLES) this.buffers.set(hole.region, []);

    this.buildCabinet();
    this.buildHoles();
    this.buildDisplays();
    this.buildButton();
  }

  // --- Construction ---

  /** Cabinet shell — back/side/top panels as plain Fixed static colliders
   * (spec五: "Fixed RigidBody與靜態Collider"), plus a mid-height backward-
   * tilted throwing platform and a front marquee/header (spec五's own
   * "投籃機"-silhouette reference: upright cabinet, side panels/net,
   * tilted throwing platform, open front). No collider at all across the
   * open front — the player must be able to walk right up to and reach into
   * the throwing chamber. */
  private buildCabinet(): void {
    const c = DISPATCH_MACHINE_CENTER;
    const halfW = DISPATCH_MACHINE_WIDTH / 2;
    const halfD = DISPATCH_MACHINE_DEPTH / 2;
    const wallT = 0.06;

    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x3d3630 });
    const netMat = new THREE.MeshStandardMaterial({ color: 0x1f1c18, roughness: 0.95 });
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a });
    const marqueeMat = new THREE.MeshStandardMaterial({ color: 0xb0392a, emissive: 0x441008 });

    const group = new THREE.Group();
    group.position.set(c.x, c.y, c.z);
    this.scene.add(group);

    // Back panel (flush against the room's own west wall).
    const back = new THREE.Mesh(new THREE.BoxGeometry(wallT, DISPATCH_MACHINE_HEIGHT, DISPATCH_MACHINE_WIDTH), cabinetMat);
    back.position.set(-halfD + wallT / 2, 0, 0);
    group.add(back);
    this.physics.createStaticCuboid(c.x - halfD + wallT / 2, c.y, c.z, wallT / 2, DISPATCH_MACHINE_HEIGHT / 2, halfW);

    // Left/right side panels — "side panels/net" silhouette (spec五) — solid
    // wood-toned frame with a darker inset "net" panel.
    for (const sz of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH, DISPATCH_MACHINE_HEIGHT, wallT), cabinetMat);
      side.position.set(0, 0, sz * (halfW - wallT / 2));
      group.add(side);
      this.physics.createStaticCuboid(c.x, c.y, c.z + sz * (halfW - wallT / 2), halfD, DISPATCH_MACHINE_HEIGHT / 2, wallT / 2);

      const net = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH * 0.7, DISPATCH_MACHINE_HEIGHT * 0.4, 0.02), netMat);
      net.position.set(-DISPATCH_MACHINE_DEPTH * 0.1, DISPATCH_MACHINE_HEIGHT * 0.05, sz * (halfW - wallT - 0.015));
      group.add(net);
    }

    // Roof.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH, wallT, DISPATCH_MACHINE_WIDTH), cabinetMat);
    roof.position.set(0, DISPATCH_MACHINE_HEIGHT / 2 - wallT / 2, 0);
    group.add(roof);
    this.physics.createStaticCuboid(c.x, c.y + DISPATCH_MACHINE_HEIGHT / 2 - wallT / 2, c.z, halfD / 2, wallT / 2, halfW);

    // Front marquee header (spec五's own arcade-cabinet reference).
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.15, DISPATCH_MACHINE_HEIGHT * 0.16, DISPATCH_MACHINE_WIDTH * 0.9), marqueeMat);
    marquee.position.set(halfD - 0.08, DISPATCH_MACHINE_HEIGHT / 2 - DISPATCH_MACHINE_HEIGHT * 0.09, 0);
    group.add(marquee);

    const marqueeLabel = createFloatingLabel('地區信封出貨器', { width: 1.4, bg: 'rgba(60,10,10,0.8)', fontSize: 28 });
    marqueeLabel.position.set(0, DISPATCH_MACHINE_HEIGHT / 2 + 0.3, 0);
    group.add(marqueeLabel);

    // Throwing platform — mid-height, tilted slightly backward (toward the
    // holes, spec五: "中央有一個微微向後傾斜的投擲平台"), a real Fixed
    // collider so a thrown envelope can bounce/roll off it realistically.
    const platform = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH * 0.55, 0.05, DISPATCH_MACHINE_WIDTH * 0.85), platformMat);
    const platformLocalX = 0.1;
    const platformLocalY = -DISPATCH_MACHINE_HEIGHT * 0.12;
    const platformTilt = THREE.MathUtils.degToRad(-8); // back edge (-X) dips down
    platform.position.set(platformLocalX, platformLocalY, 0);
    platform.rotation.z = platformTilt;
    group.add(platform);
    const platformQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, platformTilt));
    this.physics.createRemovableStaticCuboid(
      c.x + platformLocalX, c.y + platformLocalY, c.z,
      platformQuat.x, platformQuat.y, platformQuat.z, platformQuat.w,
      DISPATCH_MACHINE_DEPTH * 0.275, 0.025, DISPATCH_MACHINE_WIDTH * 0.425
    );

    // Front-bottom output ledge — a low shelf completed mail bags rest on
    // (spec五: "前方下方有一個輸出/收集槽").
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, DISPATCH_MACHINE_WIDTH * 0.95), platformMat);
    ledge.position.set(halfD - 0.1, -DISPATCH_MACHINE_HEIGHT / 2 + 0.025, 0);
    group.add(ledge);
  }

  /** Four dark recessed openings on the interior's lower-back face, each
   * with a light frame outline so they read as distinct holes (spec六: "四個
   * 投入孔要清楚並排、可辨識") — plus each hole's own genuinely-static
   * sensor Box3 (world-space, built once — the machine never moves). */
  private buildHoles(): void {
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xcfa050, metalness: 0.5, roughness: 0.4 });

    for (const hole of DISPATCH_HOLES) {
      const opening = new THREE.Mesh(new THREE.BoxGeometry(hole.depth, hole.height, hole.width), holeMat);
      opening.position.set(hole.centerX, hole.centerY, hole.centerZ);
      this.scene.add(opening);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(hole.depth * 0.3, hole.height + 0.05, hole.width + 0.05), frameMat);
      frame.position.set(hole.centerX + hole.depth * 0.4, hole.centerY, hole.centerZ);
      this.scene.add(frame);

      this.holeBoxes.set(hole.region, new THREE.Box3(
        new THREE.Vector3(hole.centerX - hole.depth / 2, hole.centerY - hole.height / 2, hole.centerZ - hole.width / 2),
        new THREE.Vector3(hole.centerX + hole.depth / 2, hole.centerY + hole.height / 2, hole.centerZ + hole.width / 2)
      ));
    }
  }

  private displayText(region: MailDestination): string {
    const info = getMailDestination(region);
    return `${info.displayName}\n已投入：${this.buffers.get(region)!.length}封`;
  }

  private buildDisplays(): void {
    for (const hole of DISPATCH_HOLES) {
      const label = createFloatingLabel(this.displayText(hole.region), { width: 0.55, bg: 'rgba(20,20,20,0.8)', fontSize: 20 });
      label.position.set(DISPATCH_DISPLAY_X, hole.centerY + DISPATCH_DISPLAY_HEIGHT_ABOVE_HOLE, hole.centerZ);
      this.scene.add(label);
      this.displayLabels.set(hole.region, label);
    }
  }

  private refreshDisplay(region: MailDestination): void {
    updateFloatingLabel(this.displayLabels.get(region)!, this.displayText(region));
  }

  private buildButton(): void {
    const buttonMat = new THREE.MeshStandardMaterial({ color: 0xc0392b });
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x4a4238 });

    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.14), mountMat);
    mount.position.copy(DISPATCH_BUTTON_POSITION);
    this.scene.add(mount);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16), buttonMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(DISPATCH_BUTTON_POSITION.x + 0.06, DISPATCH_BUTTON_POSITION.y, DISPATCH_BUTTON_POSITION.z);
    this.scene.add(cap);

    const label = createFloatingLabel('打包按鈕', { width: 0.5, bg: 'rgba(20,20,20,0.75)', fontSize: 18 });
    label.position.set(DISPATCH_BUTTON_POSITION.x, DISPATCH_BUTTON_POSITION.y + 0.22, DISPATCH_BUTTON_POSITION.z);
    this.scene.add(label);

    const obj = createInteractableObject(PACK_BUTTON_ID, '打包按鈕', cap, 0.1, 0.1, 0.1);
    this.interactables.set(PACK_BUTTON_ID, obj);
  }

  // --- Targeting / interaction (read by InteractionSystem) ---

  isPackButtonTarget(id: string): boolean {
    return id === PACK_BUTTON_ID;
  }

  /** Shared "would pressing E on the button actually do something right
   * now" judgment (spec八: "距離≤2.5m", "需空手") — used for both the
   * crosshair prompt and the real E-press action so they can never disagree,
   * mirroring this codebase's established canX()/tryX() pattern (e.g.
   * LadderSystem.canPickUp/PalletSystem.canStoreHeldPallet). */
  canPressPackButton(playerPosition: THREE.Vector3, heldCount: number): boolean {
    if (heldCount !== 0) return false;
    if (this.packButtonCooldown > 0) return false;
    return playerPosition.distanceTo(DISPATCH_BUTTON_POSITION) <= DISPATCH_BUTTON_INTERACT_DISTANCE;
  }

  /** Packs every non-empty region's buffer into its own PackedMailBag (spec
   * 八) — an occupied output slot blocks ONLY that region (its buffer stays
   * intact, spec九), every other region is still processed independently.
   * Caller is expected to have already checked canPressPackButton(); this
   * always arms the debounce regardless of whether anything was actually
   * generated, since the spec's own 0.5s window is about the PHYSICAL press
   * itself, not its outcome. */
  pressPackButton(): void {
    this.packButtonCooldown = DISPATCH_BUTTON_DEBOUNCE_SECONDS;

    for (const hole of DISPATCH_HOLES) {
      const buffer = this.buffers.get(hole.region)!;
      if (buffer.length === 0) continue;

      if (this.packedMailBagSystem.isOutputSlotOccupied(hole.region)) {
        this.hud.showToast(`請先取走${hole.displayName}信封袋`);
        continue;
      }

      const newBagId = this.packedMailBagSystem.spawnBag(hole.region, buffer);
      for (const snapshot of buffer) this.mailSystem.setEnvelopeBagged(snapshot.envelopeId, newBagId);
      this.buffers.set(hole.region, []);
      this.refreshDisplay(hole.region);
    }
  }

  // --- Per-frame hole sensor scan ---

  update(deltaTime: number): void {
    if (this.packButtonCooldown > 0) this.packButtonCooldown -= deltaTime;
    for (const [id, remaining] of this.rejectMessageCooldowns) {
      const next = remaining - deltaTime;
      if (next <= 0) this.rejectMessageCooldowns.delete(id); else this.rejectMessageCooldowns.set(id, next);
    }
    this.updateHoleSensors();
  }

  /** Same combined eligibility filter envelope-vacuum-system.ts's own
   * isEligibleEnvelope establishes (loose, unbagged/unstamped-or-stamped,
   * not held, not on the stamp table) — a 'bagged'/'shipped' envelope is
   * never a legitimate free-flying candidate here either. */
  private isEligibleEnvelope(id: string, obj: InteractableObject): boolean {
    const rec = this.mailSystem.getEnvelope(id);
    if (!rec) return false;
    if (rec.state !== 'unstamped' && rec.state !== 'stamped') return false;
    if (obj.isHeld || !obj.mesh.visible) return false;
    if (obj.rigidBody && !obj.rigidBody.isEnabled()) return false;
    if (this.mailSystem.readyEnvelopeId === id) return false;
    return true;
  }

  private updateHoleSensors(): void {
    for (const [id, obj] of this.interactables) {
      if (!this.isEligibleEnvelope(id, obj)) continue;
      const rec = this.mailSystem.getEnvelope(id)!;
      for (const hole of DISPATCH_HOLES) {
        const box = this.holeBoxes.get(hole.region)!;
        if (!box.containsPoint(obj.mesh.position)) continue;
        this.processEnvelopeAtHole(id, obj, rec.state, rec.destination, rec.visualPresetId, hole);
        break; // one hole match per envelope per frame is enough
      }
    }
  }

  private processEnvelopeAtHole(
    id: string, obj: InteractableObject, state: string, destination: MailDestination, visualPresetId: string, hole: DispatchHoleConfig
  ): void {
    if (state === 'unstamped') {
      this.bounce(obj);
      this.showRejectMessage(id, '請先完成郵票');
      return;
    }
    if (destination !== hole.region) {
      this.bounce(obj);
      this.showRejectMessage(id, '寄送地區不符');
      return;
    }
    this.consumeEnvelope(id, obj, destination, visualPresetId, hole);
  }

  private showRejectMessage(envelopeId: string, text: string): void {
    if (this.rejectMessageCooldowns.has(envelopeId)) return;
    this.rejectMessageCooldowns.set(envelopeId, REJECT_MESSAGE_COOLDOWN);
    this.hud.showToast(text);
  }

  private bounce(obj: InteractableObject): void {
    if (!obj.rigidBody) return;
    const lateral = (Math.random() - 0.5) * 0.8;
    obj.rigidBody.setLinvel({ x: BOUNCE_OUT_SPEED, y: BOUNCE_UP_SPEED, z: lateral }, true);
    obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Correct-hole acceptance (spec七) — dedupe is structural: once disposed
   * and removed from `interactables`, this same envelope id can never be
   * found by updateHoleSensors' own live scan again, so there's no separate
   * "already consumed" set to maintain. */
  private consumeEnvelope(id: string, obj: InteractableObject, destination: MailDestination, visualPresetId: string, hole: DispatchHoleConfig): void {
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    disposeMaterial(obj.mesh.material);
    if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
    this.interactables.delete(id);
    this.rejectMessageCooldowns.delete(id);

    this.buffers.get(hole.region)!.push({ envelopeId: id, destination, visualPresetId });
    this.refreshDisplay(hole.region);
  }

  /** Wired into DailyFlowSystem's resetTools callback, alongside
   * PackedMailBagSystem.resetDaily() (spec十一: "新一天開始時清空所有出貨器
   * 緩衝"). Buffered envelopes' own InteractableObject/mesh/body were already
   * disposed back when they were consumed (see consumeEnvelope) — their
   * EnvelopeRecord still exists in MailSystem until its own resetDaily runs
   * right after this, at which point it's swept exactly like any other
   * still-registered daily envelope; nothing here needs to touch MailSystem
   * directly. */
  resetDaily(): void {
    for (const hole of DISPATCH_HOLES) {
      this.buffers.set(hole.region, []);
      this.refreshDisplay(hole.region);
    }
    this.rejectMessageCooldowns.clear();
    this.packButtonCooldown = 0;
  }
}
