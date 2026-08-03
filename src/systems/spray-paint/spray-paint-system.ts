import * as THREE from 'three';
import { PlayerInteractionData } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { SCENE_CONFIG } from '../world-layout';
import {
  SPRAY_COLORS, SPRAY_SIZE, SPRAY_ROTATE_STEP_DEG, SPRAY_SURFACE_LIFT, SPRAY_MAX_NORMAL_TILT,
} from './spray-paint-data';

interface SpraySpot {
  id: string;
  position: THREE.Vector3;
  yaw: number;
  colorIndex: number;
  mesh: THREE.Mesh;
}

const FLAT_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/** Lays a plane flat (facing +Y, matching every other floor decal in this
 * codebase's own `mesh.rotation.x = -Math.PI/2` convention) and THEN yaws it
 * around the WORLD vertical axis — quaternion composition order matters
 * here: FLAT_QUAT must apply first (in the plane's own local/default frame)
 * with the yaw applied on top, or a non-zero yaw would rotate around the
 * plane's original (pre-flatten) Z axis instead of the world-up axis it
 * should visually spin around once lying on the floor. */
function setFlatYawQuaternion(obj: THREE.Object3D, yaw: number): void {
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  obj.quaternion.copy(yawQuat).multiply(FLAT_QUAT);
}

/** The spray paint tool ("Fix pallet throw and add spray paint tool" round
 * spec五) — hotbar slot 4, id 'sprayCan'. Owns its own preview ghost, its own
 * placed decals (`spots`), and the "aim at an existing decal, press E to
 * cycle its color" interaction — entirely self-contained, no other system
 * needs to know spray spots exist.
 *
 * Placement surfaces are restricted to the real floor meshes passed in at
 * construction (main back-area floor, pier deck, lost-found room floor) —
 * cargo/pallet/shelves/walls/vehicles/NPCs are never even candidates for the
 * aim raycast, which is what keeps spraying on top of them impossible without
 * needing a separate exclusion list (spec五: "不可噴在Cargo、托盤、貨架、牆
 * 壁、載具或NPC上").
 *
 * Placed decals are thin planes with no collider/sensor/physics body of any
 * kind (spec五: "沒有Collider、Sensor或物理影響") and are never registered
 * into the shared `interactables` map — InteractionSystem's own crosshair
 * raycast (which only ever tests `interactables` meshes) can never see them,
 * so this tool's own separate "aim at a decal" raycast below is the only way
 * anything in the game ever targets one; zero risk of interfering with any
 * other E-interaction. */
export class SpraySystem {
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private floorSurfaces: THREE.Object3D[];
  private isLocked: () => boolean;

  private raycaster = new THREE.Raycaster();
  private previewMesh: THREE.Mesh;
  private previewValid = false;
  private previewYaw = 0;
  private wasSprayCanSelected = false;

  private spots: SpraySpot[] = [];
  private nextId = 1;
  private aimedSpot: SpraySpot | null = null;

  constructor(
    camera: THREE.PerspectiveCamera, scene: THREE.Scene, playerData: PlayerInteractionData,
    hud: HUD, pauseManager: PauseManager, floorSurfaces: THREE.Object3D[], isLockedFn: () => boolean
  ) {
    this.camera = camera;
    this.scene = scene;
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.floorSurfaces = floorSurfaces;
    this.isLocked = isLockedFn;

    this.previewMesh = this.buildPreviewMesh();

    document.addEventListener('wheel', (e) => this.onWheel(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('contextmenu', (e) => {
      if (this.playerData.activeTool === 'sprayCan') e.preventDefault();
    });
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private buildPreviewMesh(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(SPRAY_SIZE, SPRAY_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 4;
    // Purely a ghost — must never be a candidate for ANY raycast (its own
    // targeting sweep below, InteractionSystem's, PickupSystem's, or
    // CargoHookSystem's fire()).
    mesh.raycast = () => {};
    this.scene.add(mesh);
    return mesh;
  }

  private buildSpotMesh(colorIndex: number): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(SPRAY_SIZE, SPRAY_SIZE);
    const mat = new THREE.MeshBasicMaterial({
      color: SPRAY_COLORS[colorIndex].hex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    return mesh;
  }

  /** Wheel rotates the preview 15°/notch while this tool is selected
   * (spec五) — ToolSystem.onWheel() already bails out entirely whenever
   * activeTool==='sprayCan' (see its own doc comment), the same "this tool
   * owns the wheel while active" pattern PickupSystem's placement-preview
   * rotation already established, so no double-handling risk here. */
  private onWheel(event: WheelEvent): void {
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (this.playerData.activeTool !== 'sprayCan') return;
    if (Math.abs(event.deltaY) < 1) return;
    const dir = event.deltaY > 0 ? 1 : -1;
    this.previewYaw += dir * THREE.MathUtils.degToRad(SPRAY_ROTATE_STEP_DEG);
  }

  /** Right-click creates ONE spot at the current preview position/yaw
   * (spec五: "每次右鍵只建立一塊，不可持續重複噴出大量物件" — this is a plain
   * 'mousedown' listener, fired once per press, never polled per-frame, so
   * holding the button down can't spam spots). Bare-hands/cargo-hook
   * right-click are untouched — both only ever act while their OWN
   * activeTool is selected, and this only acts while 'sprayCan' is. */
  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 2) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (this.playerData.activeTool !== 'sprayCan') return;
    if (!this.previewValid) return;
    this.createSpot();
  }

  private createSpot(): void {
    const mesh = this.buildSpotMesh(0);
    mesh.position.copy(this.previewMesh.position);
    setFlatYawQuaternion(mesh, this.previewYaw);
    this.spots.push({
      id: `spray-${this.nextId++}`,
      position: mesh.position.clone(),
      yaw: this.previewYaw,
      colorIndex: 0,
      mesh,
    });
  }

  /** E cycles the aimed decal's color (spec五: "按E依序循環六種顏色...只修改
   * 該噴漆區域"). Gated on `aimedSpot`, which update()'s own targeting sweep
   * below only ever sets while the crosshair is DIRECTLY on a spot mesh AND
   * the active tool is bare-hands-and-empty-handed or sprayCan (spec五:
   * "徒手或噴漆罐瞄準...E只在raycast命中噴漆時攔截，其他E互動維持原功能") —
   * every other tool, or bare hands while holding something else, never
   * populates `aimedSpot`, so this handler is simply a no-op for them
   * without needing its own separate tool/state check here. */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code !== 'KeyE') return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    if (!this.aimedSpot) return;
    this.cycleColor(this.aimedSpot);
  }

  private cycleColor(spot: SpraySpot): void {
    spot.colorIndex = (spot.colorIndex + 1) % SPRAY_COLORS.length;
    const mat = spot.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(SPRAY_COLORS[spot.colorIndex].hex);
    this.hud.showInteractionPrompt('噴漆區域', `E 更換顏色（${SPRAY_COLORS[spot.colorIndex].name}）`);
  }

  private findAimedSpot(): SpraySpot | null {
    if (this.spots.length === 0) return null;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    this.raycaster.far = SCENE_CONFIG.interactionDistance;
    const hits = this.raycaster.intersectObjects(this.spots.map((s) => s.mesh), false);
    if (hits.length === 0) return null;
    return this.spots.find((s) => s.mesh === hits[0].object) ?? null;
  }

  /** Aim-at-existing-decal check for the "E 更換顏色" prompt — runs whenever
   * the active tool is bare-hands (and genuinely empty-handed, not mid some
   * other holding-item flow) or sprayCan (spec五's exact "徒手或噴漆罐" pair),
   * independent of whether a spray preview is currently showing. */
  private updateAimedSpotAndPrompt(): void {
    const tool = this.playerData.activeTool;
    const eligible = tool === 'sprayCan' || (tool === 'empty' && this.playerData.state === 'empty-handed');
    const spot = eligible && this.isLocked() && !this.pauseManager.isPaused ? this.findAimedSpot() : null;

    if (spot === this.aimedSpot) {
      // Still aiming at the SAME spot — re-show every frame so its text
      // reflects the current color right after an E press, but skip the
      // redundant call entirely once nothing is targeted (avoids stomping
      // some OTHER system's legitimately-displayed prompt every frame this
      // tool has nothing of its own to show).
      if (spot) this.hud.showInteractionPrompt('噴漆區域', `E 更換顏色（${SPRAY_COLORS[spot.colorIndex].name}）`);
      return;
    }

    this.aimedSpot = spot;
    if (spot) this.hud.showInteractionPrompt('噴漆區域', `E 更換顏色（${SPRAY_COLORS[spot.colorIndex].name}）`);
    else this.hud.hideInteractionPrompt();
  }

  /** Runs unconditionally every frame, mirroring CargoHookSystem/
   * CargoInspectionSystem's own "checks pauseManager/isLocked internally,
   * never gated by the caller" convention (game-app.ts's update()). */
  update(): void {
    const isSpray = this.playerData.activeTool === 'sprayCan';
    const active = isSpray && this.isLocked() && !this.pauseManager.isPaused;

    if (!active) {
      if (this.wasSprayCanSelected) {
        // Tool deselected (or paused/unlocked mid-use) — reset the ghost's
        // rotation for next time and hide it; placed spots are untouched.
        this.previewYaw = 0;
        this.previewMesh.visible = false;
        this.previewValid = false;
      }
      this.wasSprayCanSelected = isSpray;
      this.updateAimedSpotAndPrompt();
      return;
    }
    this.wasSprayCanSelected = true;

    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(this.camera.position, direction);
    this.raycaster.far = SCENE_CONFIG.interactionDistance;
    // "Fix pallet throw and add spray paint tool" round spec五: raycasting
    // against ONLY floorSurfaces would let the ray pass straight THROUGH a
    // solid object in front of it (cargo, the pallet, a shelf, a wall) and
    // still register a valid hit on the floor plane somewhere beyond it —
    // technically never placing a decal ON that object, but visually
    // spraying "through" something the player is directly looking at, which
    // isn't what "不可噴在Cargo、托盤、貨架、牆壁、載具或NPC上" means in
    // practice. Raycasting the WHOLE scene first and requiring the CLOSEST
    // *relevant* hit specifically be one of the registered floor meshes
    // catches this: anything else being nearer means the aim is blocked by
    // that object. Existing spray spots themselves are skipped when finding
    // that closest hit — they're flat paint on the floor, not an obstacle,
    // and re-spraying over/near one is never one of spec五's excluded cases.
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    const spotMeshes = new Set<THREE.Object3D>(this.spots.map((s) => s.mesh));
    const relevantHit = hits.find((h) => !spotMeshes.has(h.object));

    if (!relevantHit || !this.floorSurfaces.includes(relevantHit.object)) {
      this.previewMesh.visible = false;
      this.previewValid = false;
      this.updateAimedSpotAndPrompt();
      return;
    }

    const hit = relevantHit;
    let worldNormal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      worldNormal = hit.face.normal.clone();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      worldNormal.applyMatrix3(normalMatrix).normalize();
    }

    this.previewValid = worldNormal.y >= SPRAY_MAX_NORMAL_TILT;
    this.previewMesh.visible = true;
    this.previewMesh.position.set(hit.point.x, hit.point.y + SPRAY_SURFACE_LIFT, hit.point.z);
    setFlatYawQuaternion(this.previewMesh, this.previewYaw);
    const mat = this.previewMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(this.previewValid ? 0x00ff88 : 0xff3333);

    this.updateAimedSpotAndPrompt();
  }
}
