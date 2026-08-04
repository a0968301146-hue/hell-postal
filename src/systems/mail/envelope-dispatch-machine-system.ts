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
  DISPATCH_BACK_PANEL_THICKNESS, DISPATCH_RAMP,
  DISPATCH_BUTTON_POSITION, DISPATCH_BUTTON_INTERACT_DISTANCE, DISPATCH_BUTTON_DEBOUNCE_SECONDS,
} from './envelope-dispatch-machine-data';

const PACK_BUTTON_ID = 'envelope-dispatch-pack-button';

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
 * machine" round五-八, reshaped by its own follow-up round into a genuine
 * basketball-arcade/chute silhouette per the requester's own sketch) —
 * standing in the gap `west-shelf-1`'s removal freed (see
 * envelope-dispatch-machine-data.ts's own doc comment on the "北牆" wording
 * substitution). Structure: a thick base plinth + open-front left/right side
 * panels (buildCabinet), ONE upright back panel flush against the real wall
 * carrying all four holes in a 2x2 grid (buildBackPanel), and a single
 * continuous ramp rising from the open front entry up to the base of that
 * panel (buildRamp) — no more four separate boxes protruding across the
 * front. Fixed/static geometry only — never registered into `interactables`
 * itself (only its pack button is), so it can never be raycast-targeted,
 * picked up, or hook-affected at all, structurally satisfying spec's "不可
 * 搬運/投擲/被捕貨鉤勾取" without any exclusion code anywhere else.
 *
 * Owns its own per-region envelope buffers (spec) — filled by continuously
 * scanning every loose, MailSystem-eligible envelope (mirrors
 * envelope-vacuum-system.ts's own isEligibleEnvelope two-state filter
 * exactly) against each hole's static world-space sensor Box3, itself
 * straddling the back panel's own front face (so an envelope whose physical
 * collider is stopped flush against the panel still has its CENTER register
 * inside the sensor). Accepted envelopes are fully disposed here (mesh/
 * geometry/material/body/interactables entry) the instant they're buffered
 * — spec: "該信封從場景中移除" — but their own EnvelopeRecord is deliberately
 * left alone in MailSystem's registry (still 'stamped', bagId still null)
 * until the pack button actually turns that buffer into a real
 * PackedMailBag (only then does setEnvelopeBagged fire) — so an unpacked
 * buffered envelope still correctly reads as "not yet shipped" to
 * MailSystem.settleAtDeparture's existing logic with zero changes needed
 * there.
 *
 * REJECTED envelopes (wrong region, or not yet stamped) are never touched
 * physically at all (spec: "不要吞掉...保持物理") — no scripted "bounce"
 * impulse. The ramp collider itself (real slope, low friction — see
 * buildRamp) does the entire "slides back to the player" job under ordinary
 * gravity: anything that doesn't get consumed either lands on the ramp
 * directly or rests briefly against the panel's own solid face above it and
 * then falls onto the ramp, both cases sliding back down toward the open
 * front on their own.
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
    this.buildBackPanel();
    this.buildRamp();
    this.buildDisplays();
    this.buildButton();
  }

  // --- Construction ---

  /** Base plinth + open-front left/right side panels only (spec: "底部要有
   * 厚重的機台本體...左右兩側有側板...前方下半部是開放的投遞入口區"). No back
   * panel, no front panel, no top-heavy protruding boxes — those are exactly
   * what this rework removes. No collider across the open front — the
   * player must be able to walk right up to and reach into the throwing
   * area. */
  private buildCabinet(): void {
    const c = DISPATCH_MACHINE_CENTER;
    const halfW = DISPATCH_MACHINE_WIDTH / 2;
    const halfD = DISPATCH_MACHINE_DEPTH / 2;
    const wallT = 0.08;
    const plinthHeight = 0.15;

    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x3d3630 });
    const marqueeMat = new THREE.MeshStandardMaterial({ color: 0xb0392a, emissive: 0x441008 });

    const group = new THREE.Group();
    group.position.set(c.x, c.y, c.z);
    this.scene.add(group);

    // Thick base plinth — full footprint, floor level.
    const plinthLocalY = -DISPATCH_MACHINE_HEIGHT / 2 + plinthHeight / 2;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH, plinthHeight, DISPATCH_MACHINE_WIDTH), cabinetMat);
    plinth.position.set(0, plinthLocalY, 0);
    group.add(plinth);
    this.physics.createStaticCuboid(c.x, c.y + plinthLocalY, c.z, halfD, plinthHeight / 2, halfW);

    // Left/right side panels — full height, full depth (spec: "左右兩側有側
    // 板"), leaving the front entirely open below.
    for (const sz of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(DISPATCH_MACHINE_DEPTH, DISPATCH_MACHINE_HEIGHT, wallT), cabinetMat);
      side.position.set(0, 0, sz * (halfW - wallT / 2));
      group.add(side);
      this.physics.createStaticCuboid(c.x, c.y, c.z + sz * (halfW - wallT / 2), halfD, DISPATCH_MACHINE_HEIGHT / 2, wallT / 2);
    }

    // Front marquee header (basketball-arcade-machine silhouette cue).
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.15, DISPATCH_MACHINE_HEIGHT * 0.14, DISPATCH_MACHINE_WIDTH * 0.9), marqueeMat);
    marquee.position.set(halfD - 0.08, DISPATCH_MACHINE_HEIGHT / 2 - DISPATCH_MACHINE_HEIGHT * 0.08, 0);
    group.add(marquee);

    const marqueeLabel = createFloatingLabel('地區信封出貨器', { width: 1.4, bg: 'rgba(60,10,10,0.8)', fontSize: 28 });
    marqueeLabel.position.set(0, DISPATCH_MACHINE_HEIGHT / 2 + 0.3, 0);
    group.add(marqueeLabel);

    // Front-bottom output ledge — a low shelf completed mail bags rest on.
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, DISPATCH_MACHINE_WIDTH * 0.95), cabinetMat);
    ledge.position.set(halfD - 0.1, -DISPATCH_MACHINE_HEIGHT / 2 + 0.025, 0);
    group.add(ledge);
  }

  /** The single upright back panel (spec: "出貨器最內側、靠牆的位置做一整面
   * 直立背板") flush against the real wall, carrying all four holes in a 2x2
   * grid (spec: "背板上要顯示四個寄送地區名稱...地區配置為2x2"). Holes are
   * dark recessed openings cut visually into the panel's own front face
   * (spec: "洞口不要做成前方四個箱體，要做在背板上") with a light frame
   * outline each, plus each hole's own genuinely-static world-space sensor
   * Box3 (the machine never moves, so these are built once). The panel's OWN
   * collider is a single solid slab spanning its whole footprint — an
   * envelope that misses a hole simply rests flush against this same panel
   * (its physics collider stops it there) rather than tunneling through, and
   * from there falls under gravity onto the ramp just below (see
   * buildRamp). */
  private buildBackPanel(): void {
    const c = DISPATCH_MACHINE_CENTER;
    const halfD = DISPATCH_MACHINE_DEPTH / 2;
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x4a3f34 });
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xcfa050, metalness: 0.5, roughness: 0.4 });

    const panelLocalX = -halfD + DISPATCH_BACK_PANEL_THICKNESS / 2;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(DISPATCH_BACK_PANEL_THICKNESS, DISPATCH_MACHINE_HEIGHT, DISPATCH_MACHINE_WIDTH),
      panelMat
    );
    panel.position.set(panelLocalX, 0, 0);
    panel.position.add(c);
    this.scene.add(panel);
    this.physics.createStaticCuboid(
      c.x + panelLocalX, c.y, c.z,
      DISPATCH_BACK_PANEL_THICKNESS / 2, DISPATCH_MACHINE_HEIGHT / 2, DISPATCH_MACHINE_WIDTH / 2
    );

    for (const hole of DISPATCH_HOLES) {
      const opening = new THREE.Mesh(new THREE.BoxGeometry(0.04, hole.height, hole.width), holeMat);
      opening.position.set(hole.centerX - 0.15, hole.centerY, hole.centerZ);
      this.scene.add(opening);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, hole.height + 0.06, hole.width + 0.06), frameMat);
      frame.position.set(hole.centerX - 0.13, hole.centerY, hole.centerZ);
      this.scene.add(frame);

      this.holeBoxes.set(hole.region, new THREE.Box3(
        new THREE.Vector3(hole.centerX - hole.depth / 2, hole.centerY - hole.height / 2, hole.centerZ - hole.width / 2),
        new THREE.Vector3(hole.centerX + hole.depth / 2, hole.centerY + hole.height / 2, hole.centerZ + hole.width / 2)
      ));
    }
  }

  /** The ramp ("green zone" in the spec's own sketch) — one continuous
   * tilted surface from the open front entry up to the base of the back
   * panel's hole grid, built from the exact same two endpoints
   * (DISPATCH_RAMP) for both the visual mesh and the physics collider via
   * THREE.Quaternion.setFromUnitVectors (maps local +X, the box's own long
   * axis, onto the bottom->top direction — avoids any sign-confusion an
   * atan2-based Euler angle would risk here). Low collider friction (mirrors
   * unloading-system.ts's own chute collider, which uses the same low-
   * friction convention for a surface things are meant to slide down) is
   * what actually makes "沒投中的信封沿斜坡滑回玩家" happen — with the
   * ramp's own real slope, gravity's downhill component alone exceeds this
   * friction, so a resting envelope keeps sliding by itself, no scripted
   * "slide back" code needed at all. */
  private buildRamp(): void {
    const { bottom, top, crossWidth, thickness } = DISPATCH_RAMP;
    const dir = new THREE.Vector3().subVectors(top, bottom);
    const length = dir.length();
    dir.normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const center = new THREE.Vector3().addVectors(bottom, top).multiplyScalar(0.5);

    const rampMat = new THREE.MeshStandardMaterial({ color: 0x5f7a5a });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, crossWidth), rampMat);
    mesh.position.copy(center);
    mesh.quaternion.copy(quat);
    this.scene.add(mesh);

    const RAMP_FRICTION = 0.2;
    this.physics.createStaticCuboidRotated(
      center.x, center.y, center.z,
      length / 2, thickness / 2, crossWidth / 2,
      quat, RAMP_FRICTION
    );
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

  /** Rejected envelopes are deliberately left completely untouched
   * physically (spec: "不要吞掉...保持物理，讓它沿綠色斜坡滑回前方") — no
   * velocity/impulse is ever applied here; the ramp's own real slope and low
   * collider friction (buildRamp) are what carry it back to the player under
   * ordinary gravity, whether it's currently resting on the ramp directly or
   * momentarily against the back panel's solid face just above it. */
  private processEnvelopeAtHole(
    id: string, obj: InteractableObject, state: string, destination: MailDestination, visualPresetId: string, hole: DispatchHoleConfig
  ): void {
    if (state === 'unstamped') {
      this.showRejectMessage(id, '請先完成郵票');
      return;
    }
    if (destination !== hole.region) {
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

  /** Correct-hole acceptance (spec: "該信封從場景中移除...顯示對應提示") —
   * dedupe is structural: once disposed and removed from `interactables`,
   * this same envelope id can never be found by updateHoleSensors' own live
   * scan again, so there's no separate "already consumed" set to maintain. */
  private consumeEnvelope(id: string, obj: InteractableObject, destination: MailDestination, visualPresetId: string, hole: DispatchHoleConfig): void {
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();
    disposeMaterial(obj.mesh.material);
    if (obj.rigidBody) this.physics.removeRigidBody(obj.rigidBody);
    this.interactables.delete(id);
    this.rejectMessageCooldowns.delete(id);

    this.buffers.get(hole.region)!.push({ envelopeId: id, destination, visualPresetId });
    this.refreshDisplay(hole.region);
    this.hud.showToast(`${hole.displayName}信封已投入`);
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
