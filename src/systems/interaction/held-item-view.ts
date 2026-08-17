import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';

/** "Pickup system 架構整理" round Phase 1 — the player's first-person
 * held-item viewmodel rig, pulled out of PickupSystem (spec: 一個檔案負責一
 * 個清楚的 Gameplay Responsibility, "玩家手上拿著的物品如何顯示" is its own
 * clear responsibility, distinct from "是否持有/可否拾取" which stays in
 * PickupSystem's own core state). Pure visual/view-model concern — this
 * class never touches playerData, heldStack, or any pickup RULE, only "given
 * an object was just added/removed/needs its clone refreshed, keep the
 * first-person clones positioned/visible correctly".
 *
 * `viewModelScene`/`viewModelCamera` are a SHARED first-person rig, not
 * exclusive to held items — game-app.ts's own render loop renders this
 * scene/camera pair every frame, and cargo-hook-system.ts/envelope-vacuum-
 * system.ts both add their OWN handheld tool prop meshes into this same
 * scene (see create-game-systems.ts). This class owns constructing it
 * (that responsibility has to live somewhere, and it was already built here
 * before this round), but PickupSystem keeps re-exposing both fields
 * unchanged for those existing external readers — see its own
 * `viewModelScene`/`viewModelCamera` getters.
 *
 * Unity/C# 對應：HeldItemView（掛在 FP Camera 底下的獨立 component，管自己
 * 的 viewmodel render layer），PlayerPickupController 持有參考並在
 * pickup/release 時呼叫它 — 跟這裡「PickupSystem 持有 HeldItemView 實例、在
 * 對應時機委派呼叫」的形狀一致。 */
export class HeldItemView {
  readonly viewModelScene: THREE.Scene;
  readonly viewModelCamera: THREE.PerspectiveCamera;

  /** One viewmodel clone + base offset per currently-held item, in pickup
   * order (index 0 = held longest, last index = most recently picked up /
   * "top of stack"). Always kept the same length as PickupSystem's own
   * heldStack — every add()/removeTop() call here happens in lockstep with
   * the corresponding heldStack.push()/pop() there. */
  private heldViewMeshes: THREE.Mesh[] = [];
  private heldViewBasePositions: THREE.Vector3[] = [];
  /** Each held item's OWN size-driven distance/height (distanceForSize's
   * result, before the recency slot offset is layered on top) — kept
   * parallel to heldViewMeshes so reslot() can recompute every item's final
   * position from scratch whenever the stack's top changes, without needing
   * to re-derive each one's own distance from its InteractableObject again. */
  private heldViewOwnBase: { y: number; z: number }[] = [];
  /** Per-slot lateral offset applied on top of an item's own natural
   * held-position calculation, so up to 3 simultaneously-held items don't
   * visually overlap/jitter against each other ("Add bulletin board upgrade
   * system" round spec五A: "手持物品之間不能互相碰撞或抖動") — a fixed,
   * simple layout rather than a collision-aware one, adequate since
   * multi-carry-eligible items are always small cargo. */
  private readonly HELD_SLOT_OFFSETS: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.34, -0.06, 0.2),
    new THREE.Vector3(-0.34, -0.06, 0.2),
  ];

  /** Held-item camera-local anchor baseline ("Add sequential lost-found
   * visitors and held cargo feedback" round二: suggested starting values) —
   * local to viewModelCamera, which sits at the local origin looking down -Z
   * (see the constructor below), so this is genuinely camera-relative, never
   * a world coordinate. Roughly center-low: X=0 (screen-horizontal center),
   * Y=-0.35 (below the crosshair), Z=-0.85 (in front of the camera,
   * comfortably past the 0.01 near plane). */
  private readonly HELD_ANCHOR_X = 0;
  private readonly HELD_ANCHOR_Y = -0.35;
  private readonly HELD_ANCHOR_Z = -0.85;

  /** A medium item's own rough footprint (matches cargo-shape-presets.ts's
   * 'medium-box', ~0.4m) — distanceForSize()'s own reference point: items
   * near this size sit at the anchor baseline unchanged, smaller ones get
   * pulled a little closer, bigger ones get pushed further away and lower. */
  private readonly HELD_MEDIUM_REF_DIM = 0.45;

  constructor() {
    // ViewModel scene (separate from world)
    this.viewModelScene = new THREE.Scene();
    this.viewModelScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const vmLight = new THREE.DirectionalLight(0xffffff, 0.6);
    vmLight.position.set(1, 2, 1);
    this.viewModelScene.add(vmLight);

    // ViewModel camera (synced to main camera every frame — see syncCamera)
    this.viewModelCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);
  }

  /** The TOP (most-recently-added) viewmodel clone and its resting base
   * position, read-only — used only by charge-shake (currently still in
   * PickupSystem, moving to PlacementPreview in Phase 2) to nudge/reset the
   * one viewmodel that visibly shakes while charging a throw. Every other
   * held item's own clone is never touched by that effect. */
  get topMesh(): THREE.Mesh | null {
    return this.heldViewMeshes[this.heldViewMeshes.length - 1] ?? null;
  }
  get topBase(): THREE.Vector3 | null {
    return this.heldViewBasePositions[this.heldViewBasePositions.length - 1] ?? null;
  }

  /** Per-item distance/height nudge off HELD_ANCHOR_* ("Add sequential
   * lost-found visitors and held cargo feedback" round二: "依貨物Collider
   * 尺寸自動調整距離...小型稍靠近、中型標準距離、大型稍微向下、向前移，避免
   * 模型塞滿整個畫面"). Continuous in maxDim rather than a hard 3-way snap,
   * so there's no visible pop as an item's size crosses a boundary.
   * Containers (mail box/sorting box) get an extra fixed push on top — they
   * read as noticeably bulkier than their raw maxDim alone would suggest,
   * being held two-handed out in front rather than cradled like a box. */
  private distanceForSize(maxDim: number, isContainer: boolean): { z: number; y: number } {
    const oversize = Math.max(0, maxDim - this.HELD_MEDIUM_REF_DIM);
    const undersize = Math.max(0, this.HELD_MEDIUM_REF_DIM - maxDim);
    // Large cargo (up to ~1.6m on an axis, see LARGE_CARGO_SHAPE_PRESETS)
    // needs a much bigger push than the 0.6/0.3 ratio below alone gives —
    // tuned against an actual screenshot so the crosshair/prompt text stay
    // clear of it (spec二: "避免模型塞滿整個畫面") without ever scaling it.
    let z = this.HELD_ANCHOR_Z - oversize * 1.3 + undersize * 0.35;
    let y = this.HELD_ANCHOR_Y - oversize * 0.65;
    if (isContainer) {
      z -= 0.55;
      y -= 0.2;
    }
    return { z, y };
  }

  /** Adds ONE more viewmodel clone for `obj` on top of whatever's already
   * held (never removes existing ones — see removeTop() below for how each
   * one is later cleared). Call this in lockstep with pushing `obj.id` onto
   * PickupSystem's own heldStack. */
  add(obj: InteractableObject): void {
    // Clone the entire mesh tree (including children like walls, labels for containers)
    const cloned = obj.mesh.clone(true);
    cloned.frustumCulled = false;
    // The caller already set obj.mesh.visible = false (hiding the WORLD
    // mesh) before calling this — Object3D.clone() copies that `visible`
    // flag too, so the freshly-cloned VIEWMODEL root would silently inherit
    // it and never render (THREE's renderer skips a whole invisible subtree
    // without even checking children). The viewmodel is a wholly separate
    // THREE.Scene/clone from the world mesh, so it must always be visible on
    // its own regardless of the source mesh's current state.
    cloned.visible = true;

    // Remove hitproxies from viewmodel first (they're invisible and waste
    // raycasting) so we don't bother giving them owned resources below.
    const toRemove: THREE.Object3D[] = [];
    cloned.traverse((child) => {
      if (child.userData.isHitProxy || child.userData.interiorPlane) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(c => c.parent?.remove(c));

    // Object3D.clone() does NOT deep-clone geometry/material — the cloned
    // meshes still reference the exact same geometry/material instances as
    // the world mesh. Give the viewmodel its own copies so dispose() can
    // safely dispose them without freeing resources the world mesh needs.
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;
        child.geometry = child.geometry.clone();
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => m.clone());
        } else if (child.material) {
          child.material = child.material.clone();
        }
      }
    });

    const viewMesh = cloned as THREE.Mesh;

    // Held-item camera-local anchor ("Add sequential lost-found visitors and
    // held cargo feedback" round二) — HELD_ANCHOR_* is local to
    // viewModelCamera (which itself sits at the local origin, see the
    // constructor), never a world-space coordinate, so this naturally
    // tracks wherever the player is looking with zero extra work. Baseline
    // sits center-low (spec二: "螢幕水平中央、比準心低約25%~35%畫面高度"),
    // roughly a medium item's own resting distance; distanceForSize() below
    // nudges it per-item from there. Every held item — cargo, envelopes,
    // lost items, mail/sorting boxes — shares this SAME anchor+function
    // (spec二: "信封、失物與信封箱可使用同一套anchor，但依尺寸調整距離"),
    // never a per-item-type hardcoded position.
    const maxDim = Math.max(obj.width, obj.height, obj.depth);
    const isContainer = obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId;
    const { z: distZ, y: distY } = this.distanceForSize(maxDim, isContainer);
    if (isContainer) {
      // Slight tilt toward camera so the player can see inside while carrying.
      cloned.rotation.x = 0.2;
    }

    // Deliberately NEVER scales the clone (spec二: "不可縮放貨物模型") — a
    // large item avoids filling the screen purely via distanceForSize()
    // above pushing it further away/lower, not by shrinking its model.

    this.heldViewMeshes.push(viewMesh);
    this.heldViewBasePositions.push(new THREE.Vector3()); // placeholder — reslot() below fills every slot in
    this.heldViewOwnBase.push({ y: distY, z: distZ });
    this.viewModelScene.add(viewMesh);
    this.reslot();
  }

  /** Assigns each held item's SCREEN slot (spec二: "activeHeldItem...放在
   * 畫面中央偏下...其他手持物可稍微向左右錯開，不可全部完全重疊") by RECENCY,
   * not pickup order — heldViewMeshes/heldViewOwnBase stay oldest-first
   * (index 0 = held longest), but the slot offset is looked up by DISTANCE
   * FROM THE TOP, so the most-recently-picked-up item always lands at
   * HELD_SLOT_OFFSETS[0] — dead center — regardless of how many older items
   * are also held, and every earlier item shifts outward one slot as each
   * new item is added on top of it. Called from both add() and removeTop()
   * since removing the current top also promotes whichever item was
   * underneath it back to center. */
  private reslot(): void {
    const n = this.heldViewMeshes.length;
    for (let i = 0; i < n; i++) {
      const slotFromTop = n - 1 - i;
      const offset = this.HELD_SLOT_OFFSETS[Math.min(slotFromTop, this.HELD_SLOT_OFFSETS.length - 1)];
      const own = this.heldViewOwnBase[i];
      const basePos = new THREE.Vector3(this.HELD_ANCHOR_X + offset.x, own.y + offset.y, own.z + offset.z);
      this.heldViewBasePositions[i] = basePos;
      this.heldViewMeshes[i].position.copy(basePos);
      this.heldViewMeshes[i].rotation.set(0, 0, 0); // clear any charge-shake rotation from before the reslot
    }
  }

  /** "失物招領系統修改" round — swaps the viewmodel clone AT `index`'s own
   * geometry/material to match its (already-updated) world mesh `obj`, e.g.
   * right after LostFoundSystem.revealLostItem() swaps the black-ball
   * placeholder's world mesh to the real model — spec: "黑色球直接在玩家手上
   * 變成真正的失物外觀", never requiring the item to be dropped/re-picked-up
   * first. `add()` above only clones geometry/material ONCE at pickup time,
   * so without this the viewmodel would keep showing the stale black sphere
   * indefinitely even after the world mesh (and any later pickup) already
   * shows the real thing. Caller (PickupSystem.refreshHeldViewMesh) resolves
   * `id` to an index via its own heldStack before calling this — this class
   * never looks up ids itself, it has no concept of "held item ids", only
   * "clone at this index". */
  refresh(index: number, obj: InteractableObject): void {
    const viewMesh = this.heldViewMeshes[index];
    if (!viewMesh) return;

    const oldGeo = viewMesh.geometry;
    const oldMat = viewMesh.material;
    viewMesh.geometry = obj.mesh.geometry.clone();
    viewMesh.material = Array.isArray(obj.mesh.material)
      ? obj.mesh.material.map((m) => m.clone())
      : (obj.mesh.material as THREE.Material).clone();
    oldGeo.dispose();
    if (Array.isArray(oldMat)) oldMat.forEach((m) => m.dispose());
    else oldMat.dispose();
  }

  private dispose(mesh: THREE.Mesh): void {
    this.viewModelScene.remove(mesh);
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  /** Removes just the TOP (most-recently-added) viewmodel clone — call this
   * in lockstep with popping PickupSystem's own heldStack. Reslots the
   * remainder afterward — whichever item was directly underneath the
   * removed one is now the new top, and needs to visually snap into the
   * center slot (spec二), not stay wherever its old side slot left it. */
  removeTop(): void {
    const mesh = this.heldViewMeshes.pop();
    this.heldViewBasePositions.pop();
    this.heldViewOwnBase.pop();
    if (mesh) this.dispose(mesh);
    this.reslot();
  }

  /** Keeps the viewmodel camera's projection matched to the real one every
   * frame — the viewmodel camera itself stays fixed at its own local origin
   * (each held clone is positioned relative to IT, never the world), only
   * FOV/aspect need to track the main camera. */
  syncCamera(mainCamera: THREE.PerspectiveCamera): void {
    this.viewModelCamera.aspect = mainCamera.aspect;
    this.viewModelCamera.fov = mainCamera.fov;
    this.viewModelCamera.updateProjectionMatrix();
  }

  onResize(): void {
    this.viewModelCamera.aspect = window.innerWidth / window.innerHeight;
    this.viewModelCamera.updateProjectionMatrix();
  }
}
