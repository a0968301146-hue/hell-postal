import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { InteractableObject } from '../shared/types/interactable';
import { PlayerInteractionData } from '../core/game-state';
import { PauseManager } from '../core/pause-manager';
import { MailSystem } from './mail/mail-system';

/** "Add ladder tool station and envelope vacuum" round五/六 — suck/blow
 * tuning, centralized here rather than scattered magic numbers, mirroring
 * every other tool's own data-constants-up-top convention in this
 * codebase. */
const VACUUM_SUCK_MAX_RANGE = 5.0;
const VACUUM_SUCK_HALF_ANGLE = THREE.MathUtils.degToRad(35);
const VACUUM_SUCK_SPEED = 7.0;
const VACUUM_CAPTURE_DISTANCE = 0.45;
const VACUUM_MAX_CAPTURED = 20;

/** "信封吸塵器升級" round — cooldown (seconds) entered every time the player
 * STOPS using the tool (releases either mouse button, see onMouseUp below),
 * indexed by the player's envelopeVacuumLevel upgrade (0..3, see
 * upgrade-data.ts): 9/7/5/3s, same curve as cargoHookLevel. While the
 * cooldown is counting down, a new suck/blow session cannot start
 * (onMouseDown's own guard) — a real gameplay restriction, not merely a UI
 * number. Ticks down unconditionally every frame regardless of tool
 * selection (mirrors cargo-hook-system.ts's own cooldownTimer, "切換工具不
 * 能繞過"), so switching away and back can't bypass it either. */
const ENVELOPE_VACUUM_COOLDOWN_BY_LEVEL: readonly number[] = [9, 7, 5, 3];

const VACUUM_BLOW_MAX_RANGE = 4.0;
const VACUUM_BLOW_HALF_ANGLE = THREE.MathUtils.degToRad(40);
/** Values AT the nozzle (distance≈0) — tapers down toward VACUUM_BLOW_MAX_RANGE
 * (spec: "距離越近推力越強"), never below 40% of these at max range. */
const VACUUM_BLOW_HORIZONTAL_SPEED_MAX = 5.5;
const VACUUM_BLOW_UP_SPEED = 0.8;
const VACUUM_BLOW_FALLOFF_FLOOR = 0.4;

/** How far in front of the camera the nozzle's own effective world-space
 * origin sits — used for both range/angle checks and where captured
 * envelopes are anchored, independent of the separate first-person
 * viewmodel prop's own fixed screen-space offset (see buildToolProp). */
const NOZZLE_FORWARD_OFFSET = 0.35;

interface CapturedEntry {
  /** Local offset from the nozzle world position, in camera-local space —
   * a small fan/stack arrangement so multiple captured envelopes don't
   * overlap/z-fight (spec: "每封信保存自己的local offset，避免全部重疊閃
   * 爍"). */
  localOffset: THREE.Vector3;
}

/**
 * A new handheld tool, "信封吸塵器" ("Add ladder tool station and envelope
 * vacuum" round四-八) — left-click sucks loose Envelopes in front of the
 * player toward the nozzle (velocity-driven while approaching, never
 * teleported — spec: "使用信封中心至吸入口方向產生速度，不直接瞬移"), right-
 * click blows them away. Only ever affects a LOOSE, unbagged, not-currently-
 * held, not-on-the-stamp-table Envelope (see isEligibleEnvelope) — Cargo,
 * lost items, pallets, the ladder, mail boxes, boxed/stamping/loaded/settled
 * envelopes, and whatever the player is currently holding are all
 * structurally untouched (this class never reads CargoSystem/PalletSystem/
 * LadderSystem/MailBagSystem state at all, only MailSystem's own per-
 * envelope record).
 *
 * Mirrors cargo-hook-system.ts's / spray-paint-system.ts's own established
 * "self-contained tool: owns its own viewmodel prop, gates ALL behavior off
 * playerData.activeTool==='envelopeVacuum', registers its own mousedown/
 * mouseup listeners" pattern — ToolSystem itself needs zero knowledge of
 * this class beyond the hotbar id/icon wiring (tool-loadout-data.ts).
 */
export class EnvelopeVacuumSystem {
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private camera: THREE.PerspectiveCamera;
  private mailSystem: MailSystem;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;

  private toolProp: THREE.Group;
  private isSucking = false;
  private isBlowing = false;
  private captured: Map<string, CapturedEntry> = new Map();

  /** "信封吸塵器升級" round — pushed by UpgradeSystem.applyEffect (0..3),
   * same narrow-setter convention as CargoHookSystem.setUpgradeLevel. */
  private upgradeLevel = 0;
  private cooldownTimer = 0;

  constructor(
    physics: PhysicsSystem, interactables: Map<string, InteractableObject>,
    playerData: PlayerInteractionData, camera: THREE.PerspectiveCamera, viewModelScene: THREE.Scene,
    mailSystem: MailSystem, pauseManager: PauseManager, isLockedFn: () => boolean
  ) {
    this.physics = physics;
    this.interactables = interactables;
    this.playerData = playerData;
    this.camera = camera;
    this.mailSystem = mailSystem;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;

    this.toolProp = this.buildToolProp();
    this.toolProp.visible = false;
    viewModelScene.add(this.toolProp);

    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    document.addEventListener('contextmenu', (e) => {
      if (this.playerData.activeTool === 'envelopeVacuum') e.preventDefault();
    });
  }

  /** Simple handheld fantasy prop — wood handle, brass fittings, a cloth
   * collection sack, an open front nozzle (spec七: "木材、黃銅與布袋結構...
   * 不要現代家電或科技造型"). Same low-poly-primitive convention as
   * cargo-hook-system.ts's own buildToolProp. */
  private buildToolProp(): THREE.Group {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3f28 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d3e, metalness: 0.6, roughness: 0.35 });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x7a6a52 });

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.24, 8), woodMat);
    handle.rotation.x = Math.PI / 2.5;
    group.add(handle);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.22, 10), clothMat);
    body.position.set(0, 0.02, -0.16);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 10, 1, true), brassMat);
    nozzle.position.set(0, 0.02, -0.32);
    nozzle.rotation.x = -Math.PI / 2;
    group.add(nozzle);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), brassMat);
    ring.position.set(0, 0.02, -0.06);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.position.set(0.42, -0.38, -0.6);
    group.rotation.y = -0.25;
    return group;
  }

  /** "信封吸塵器升級" round — the ONE push point UpgradeSystem.applyEffect
   * calls into for envelopeVacuumLevel (0..3). */
  setUpgradeLevel(level: number): void {
    this.upgradeLevel = level;
  }

  private get cooldownDuration(): number {
    return ENVELOPE_VACUUM_COOLDOWN_BY_LEVEL[this.upgradeLevel] ?? ENVELOPE_VACUUM_COOLDOWN_BY_LEVEL[0];
  }

  /** Same combined predicate the exploration research established: a
   * loose, unbagged, not-currently-held, not-on-the-stamp-table envelope. */
  private isEligibleEnvelope(id: string, obj: InteractableObject): boolean {
    const rec = this.mailSystem.getEnvelope(id);
    if (!rec) return false;
    if (rec.state !== 'unstamped' && rec.state !== 'stamped') return false;
    if (obj.isHeld || !obj.mesh.visible) return false;
    if (this.mailSystem.readyEnvelopeId === id) return false;
    if (obj.rigidBody && !obj.rigidBody.isEnabled()) return false;
    return true;
  }

  private computeSlotOffset(index: number): THREE.Vector3 {
    const perRing = 6;
    const ring = Math.floor(index / perRing);
    const angle = (index % perRing) * ((Math.PI * 2) / perRing);
    const radius = 0.05 + ring * 0.035;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.06 - ring * 0.025);
  }

  private getNozzleWorldPosition(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return this.camera.position.clone().add(dir.multiplyScalar(NOZZLE_FORWARD_OFFSET));
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.playerData.activeTool !== 'envelopeVacuum') return;
    if (!this.isLocked() || this.pauseManager.isPaused) return;
    // "信封吸塵器升級" round — a new suck/blow session cannot start while
    // the cooldown from the LAST session is still counting down (real
    // restriction, not just a UI number — see class field's own doc
    // comment).
    if (this.cooldownTimer > 0) return;
    if (event.button === 0) {
      this.isSucking = true;
      this.isBlowing = false;
    } else if (event.button === 2) {
      // Spec六: "左鍵與右鍵同時按下時：左鍵吸取優先，不執行吹風".
      if (!this.isSucking) this.isBlowing = true;
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      if (this.isSucking) this.cooldownTimer = this.cooldownDuration;
      this.isSucking = false;
      this.releaseAllCaptured();
    } else if (event.button === 2) {
      if (this.isBlowing) this.cooldownTimer = this.cooldownDuration;
      this.isBlowing = false;
    }
  }

  /** Spec五 last line / spec八: switching tools, opening any menu, losing
   * pointer lock, or the game pausing must all safely release every
   * captured envelope — checked once per frame here rather than scattered
   * across every possible trigger site. */
  private canUseThisFrame(): boolean {
    return (
      this.playerData.activeTool === 'envelopeVacuum' &&
      this.playerData.state === 'empty-handed' &&
      this.isLocked() &&
      !this.pauseManager.isPaused
    );
  }

  update(deltaTime: number): void {
    const isSelected = this.playerData.activeTool === 'envelopeVacuum';
    this.toolProp.visible = isSelected;

    // "信封吸塵器升級" round — ticks down unconditionally, regardless of
    // tool selection/pause/lock state, so switching away mid-cooldown can
    // never bypass it (same reasoning as cargo-hook-system.ts's own
    // cooldownTimer).
    if (this.cooldownTimer > 0) this.cooldownTimer = Math.max(0, this.cooldownTimer - deltaTime);

    if (!this.canUseThisFrame()) {
      if (this.captured.size > 0) this.releaseAllCaptured();
      // A forced stop (tool switch/pause/menu/lock loss) mid-session still
      // starts the cooldown, same as a normal mouseup release — otherwise
      // switching tools away and back would be a free way to dodge it.
      if (this.isSucking || this.isBlowing) this.cooldownTimer = this.cooldownDuration;
      this.isSucking = false;
      this.isBlowing = false;
      return;
    }

    if (this.isSucking) {
      this.updateSuck();
    } else if (this.isBlowing) {
      this.updateBlow();
    }
  }

  private updateSuck(): void {
    const nozzlePos = this.getNozzleWorldPosition();
    const camQuat = this.camera.quaternion;

    // Captured envelopes always follow the nozzle first (spec: "吸住期間跟
    // 隨吸入口移動與旋轉").
    for (const [id, entry] of this.captured) {
      const obj = this.interactables.get(id);
      if (!obj) { this.captured.delete(id); continue; }
      const worldPos = entry.localOffset.clone().applyQuaternion(camQuat).add(nozzlePos);
      obj.mesh.position.copy(worldPos);
      obj.mesh.quaternion.copy(camQuat);
      if (obj.rigidBody) {
        obj.rigidBody.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
        obj.rigidBody.setRotation({ x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w }, true);
      }
    }

    if (this.captured.size >= VACUUM_MAX_CAPTURED) return;

    const camPos = this.camera.position;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    for (const [id, obj] of this.interactables) {
      if (this.captured.size >= VACUUM_MAX_CAPTURED) break;
      if (this.captured.has(id)) continue;
      if (!this.isEligibleEnvelope(id, obj)) continue;

      const toObj = obj.mesh.position.clone().sub(camPos);
      const dist = toObj.length();
      if (dist > VACUUM_SUCK_MAX_RANGE || dist < 1e-4) continue;
      const dirNorm = toObj.clone().normalize();
      if (camDir.angleTo(dirNorm) > VACUUM_SUCK_HALF_ANGLE) continue;

      const distToNozzle = obj.mesh.position.distanceTo(nozzlePos);
      if (distToNozzle <= VACUUM_CAPTURE_DISTANCE) {
        if (obj.rigidBody) {
          obj.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
          obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
          // Spec: "暫時停用信封彼此的碰撞，避免吸入口抖動" — disabling the
          // body entirely (same as pallet-system.ts's own pinned-cargo
          // convention) structurally satisfies this: a disabled Rapier body
          // collides with nothing at all.
          this.physics.setBodyEnabled(obj.rigidBody, false);
        }
        this.captured.set(id, { localOffset: this.computeSlotOffset(this.captured.size) });
        continue;
      }

      if (obj.rigidBody) {
        const toNozzle = nozzlePos.clone().sub(obj.mesh.position).normalize();
        obj.rigidBody.wakeUp();
        obj.rigidBody.setLinvel({ x: toNozzle.x * VACUUM_SUCK_SPEED, y: toNozzle.y * VACUUM_SUCK_SPEED, z: toNozzle.z * VACUUM_SUCK_SPEED }, true);
      }
    }
  }

  private updateBlow(): void {
    const camPos = this.camera.position;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    for (const [id, obj] of this.interactables) {
      if (this.captured.has(id)) continue; // spec六: 不可吹動目前被吸入口captured的信封
      if (!this.isEligibleEnvelope(id, obj)) continue;
      if (!obj.rigidBody) continue;

      const toObj = obj.mesh.position.clone().sub(camPos);
      const dist = toObj.length();
      if (dist > VACUUM_BLOW_MAX_RANGE || dist < 1e-4) continue;
      const dirNorm = toObj.clone().normalize();
      if (camDir.angleTo(dirNorm) > VACUUM_BLOW_HALF_ANGLE) continue;

      // Spec: "距離越近推力越強" — linear taper from full strength at the
      // nozzle down to VACUUM_BLOW_FALLOFF_FLOOR at max range.
      const falloff = THREE.MathUtils.lerp(1, VACUUM_BLOW_FALLOFF_FLOOR, dist / VACUUM_BLOW_MAX_RANGE);
      const horizontal = dirNorm.clone().multiplyScalar(VACUUM_BLOW_HORIZONTAL_SPEED_MAX * falloff);
      obj.rigidBody.wakeUp();
      obj.rigidBody.setLinvel({ x: horizontal.x, y: VACUUM_BLOW_UP_SPEED * falloff, z: horizontal.z }, true);
    }
  }

  /** Spec五: "所有captured信封同步到目前世界座標／恢復Dynamic RigidBody及
   * Collider／清除captured狀態／給予很小的向下／向前速度／信封從吸塵器口自
   * 然掉落／不可瞬移回原本位置" — since updateSuck() already kept every
   * captured envelope's mesh/body position synced to the nozzle every
   * frame it was held, simply re-enabling physics FROM WHEREVER IT CURRENTLY
   * SITS and nudging its velocity already satisfies "never teleports back",
   * with no separate position write needed here. */
  private releaseAllCaptured(): void {
    if (this.captured.size === 0) return;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    for (const [id] of this.captured) {
      const obj = this.interactables.get(id);
      if (!obj || !obj.rigidBody) continue;
      this.physics.setBodyEnabled(obj.rigidBody, true);
      obj.rigidBody.wakeUp();
      const dropVel = camDir.clone().multiplyScalar(0.35);
      dropVel.y -= 0.25;
      obj.rigidBody.setLinvel({ x: dropVel.x, y: dropVel.y, z: dropVel.z }, true);
      obj.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.captured.clear();
  }
}
