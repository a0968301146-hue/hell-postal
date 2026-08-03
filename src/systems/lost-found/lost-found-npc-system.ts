import * as THREE from 'three';
import {
  LOST_FOUND_NPC_SPAWN, LOST_FOUND_NPC_WAIT_SPOT, LOST_FOUND_NPC_ROUTE_WAYPOINTS, LOST_FOUND_ROOM,
} from '../../data/world/lost-found-layout-data';
import {
  createLostFoundBubble, showLostFoundBubble, updateLostFoundBubbleText, disposeLostFoundBubble, LostFoundBubble,
} from './lost-found-bubble-ui';
import { LostItemPreset } from './lost-found-data';
import { LostItemPreviewRenderer } from './lost-item-preview-renderer';
import { InteractableObject, createInteractableObject } from '../../shared/types/interactable';

const NPC_SPEED = 1.6; // m/s, simple slide-to-target movement — same convention as counter-npc-system.ts
const ARRIVE_EPS = 0.08;
const HEAD_Y = LOST_FOUND_ROOM.floorY + 1.9;

/** Raycast id for the NPC's own invisible interaction hitbox ("Fix NPC
 * direct interaction and pallet stack handling" round二) — a stable id
 * (the SAME one is re-registered every time a new daily NPC spawns, since
 * only one is ever on-screen at once — LostFoundSystem's own queue already
 * enforces that). */
export const LOST_FOUND_NPC_INTERACTABLE_ID = 'lost-found-npc';
/** Hitbox footprint (spec二: "寬約0.7m / 高約1.8m / 深約0.6m"). */
const NPC_HITBOX_WIDTH = 0.7;
const NPC_HITBOX_HEIGHT = 1.8;
const NPC_HITBOX_DEPTH = 0.6;
/** Local Y (the group's own position.y is always 0 — see spawn() below,
 * `group.position.set(x, 0, z)`) for the hitbox's own center — matches the
 * body capsule mesh's own local Y offset exactly, landing roughly at chest
 * height on the ~1.46m-tall capsule. */
const NPC_HITBOX_CENTER_Y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;

export type LostFoundNpcState = 'gone' | 'walkingIn' | 'waiting' | 'walkingOut';

/**
 * Owns the daily lost-found NPC's own entry/exit walk and physical presence
 * ("Expand modular lost found NPC flow" round 模組化: lost-found-npc-
 * system.ts — NPC進出與狀態) — deliberately no case/item knowledge here
 * beyond the one preset it's currently displaying; lost-found-system.ts
 * calls spawn()/startLeaving()/forceRemove() and reads `state`/`position`
 * rather than this class reaching into case logic, mirroring the
 * CounterNpcSystem/CounterServiceSystem split elsewhere in this codebase.
 * No physics collider (matches every other decorative NPC in this game —
 * CounterNpcSystem's queue NPCs are walk-through too).
 */
export class LostFoundNpcSystem {
  state: LostFoundNpcState = 'gone';

  private scene: THREE.Scene;
  private previewRenderer: LostItemPreviewRenderer;
  private interactables: Map<string, InteractableObject>;
  private group: THREE.Group | null = null;
  private bubble: LostFoundBubble | null = null;
  private currentPreset: LostItemPreset | null = null;
  private target = new THREE.Vector3();
  /** Remaining points to visit in order, current target first — set by
   * spawn()/startLeaving() from LOST_FOUND_NPC_ROUTE_WAYPOINTS. Popped one
   * at a time in update() as each point is reached. */
  private route: { x: number; z: number }[] = [];
  /** Invisible, non-colliding raycast hitbox ("Fix NPC direct interaction
   * and pallet stack handling" round二) — a child of `group`, so it always
   * tracks the NPC's current position/rotation for free; registered into the
   * shared `interactables` map only while `group` exists (spawn() through
   * disposeGroup()), so it's never a valid raycast target while the NPC
   * hasn't arrived yet or has already left (spec: "離場或尚未抵達時不可互
   * 動" — enforced together with LostFoundSystem's own isNpcWaiting gate). */
  private hitboxObj: InteractableObject | null = null;

  constructor(scene: THREE.Scene, previewRenderer: LostItemPreviewRenderer, interactables: Map<string, InteractableObject>) {
    this.scene = scene;
    this.previewRenderer = previewRenderer;
    this.interactables = interactables;
  }

  get position(): THREE.Vector3 | null {
    return this.group ? this.group.position : null;
  }

  /** Spawns just outside the west gate and starts walking in toward its own
   * waiting spot. No-op if an NPC is already present. `preset` is the day's
   * target lost item — kept for the head bubble's model preview once
   * arrived (see update()'s arrival branch). `displayName` becomes the
   * interaction hitbox's own prompt title (spec二: "顯示：NPC名稱 / E
   * 交談"). */
  spawn(preset: LostItemPreset, displayName: string): void {
    if (this.group) return;

    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9a05a });
    const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const body = new THREE.Mesh(capsuleGeo, bodyMat);
    body.position.y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;
    group.add(body);

    // Invisible interaction hitbox (spec二: "寬約0.7m / 高約1.8m / 深約
    // 0.6m...不可見...沒有物理阻擋...可被既有InteractionSystem準心raycast命
    // 中") — genuinely see-through (opacity 0) rather than mesh.visible=
    // false, since InteractionSystem's own raycast target list
    // (getInteractableMeshes()) filters out any mesh with visible===false
    // entirely, which would make it permanently unraycastable.
    const hitboxGeo = new THREE.BoxGeometry(NPC_HITBOX_WIDTH, NPC_HITBOX_HEIGHT, NPC_HITBOX_DEPTH);
    const hitboxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitboxMesh.position.set(0, NPC_HITBOX_CENTER_Y, 0);
    // "Trace and fix NPC E interaction routing" round三: the hitbox carries
    // its own ownership data directly — InteractionSystem resolves "is this
    // the lost-found NPC" from THIS, never by comparing a raw id string
    // against an imported constant (spec: "不要依Mesh名稱字串猜測NPC").
    hitboxMesh.userData.interactionType = 'lostFoundNpc';
    hitboxMesh.userData.npcId = LOST_FOUND_NPC_INTERACTABLE_ID;
    group.add(hitboxMesh);
    const hitboxObj = createInteractableObject(LOST_FOUND_NPC_INTERACTABLE_ID, displayName, hitboxMesh, NPC_HITBOX_WIDTH, NPC_HITBOX_HEIGHT, NPC_HITBOX_DEPTH);
    // canPickUp=true only to satisfy the shared raycast filter's own
    // requirement — never actually meant to be picked up (same pattern as
    // the mail rack / vehicle buttons / pallet racks).
    hitboxObj.canPickUp = true;
    this.interactables.set(LOST_FOUND_NPC_INTERACTABLE_ID, hitboxObj);
    this.hitboxObj = hitboxObj;

    group.position.set(LOST_FOUND_NPC_SPAWN.x, 0, LOST_FOUND_NPC_SPAWN.z);
    this.scene.add(group);
    this.group = group;

    // Bubble starts hidden/blank while walking in — only drawn+shown once
    // arrived (see update()'s arrival branch), per spec: "NPC抵達櫃檯後，在
    // 頭頂顯示對話框".
    this.currentPreset = preset;
    const bubble = createLostFoundBubble(HEAD_Y + 0.35);
    group.add(bubble.sprite);
    this.bubble = bubble;

    this.setRoute([...LOST_FOUND_NPC_ROUTE_WAYPOINTS, LOST_FOUND_NPC_WAIT_SPOT]);
    this.state = 'walkingIn';
  }

  /** Starts the walk back out through the same west gate, retracing the same
   * waypoints in reverse (spec: "離開時沿相同路線走出"). Bubble stays visible
   * — caller updates its text to a thank-you/disappointed line via
   * updateBubbleText() before or after calling this. */
  startLeaving(): void {
    if (!this.group || this.state !== 'waiting') return;
    this.setRoute([...[...LOST_FOUND_NPC_ROUTE_WAYPOINTS].reverse(), LOST_FOUND_NPC_SPAWN]);
    this.state = 'walkingOut';
  }

  private setRoute(points: { x: number; z: number }[]): void {
    this.route = points.slice(1);
    this.target.set(points[0].x, 0, points[0].z);
  }

  updateBubbleText(text: string): void {
    if (this.bubble) updateLostFoundBubbleText(this.bubble, text);
  }

  /** Swaps the bubble to its name+model-preview form — called by
   * LostFoundSystem once it advances a waiting NPC from the greeting stage
   * into waitingForItem ("Add sequential lost-found visitors and held cargo
   * feedback" round二: "進入waitingForItem後...顯示需要的失物名稱與模型預
   * 覽"), never automatically on arrival anymore (see update()'s own arrival
   * branch below, which has no bubble content of its own — LostFoundSystem
   * always shows the greeting text right after via updateBubbleText()
   * instead). No-op if this NPC has no target preset. */
  showItemNeed(promptText: string): void {
    if (this.bubble && this.currentPreset) {
      showLostFoundBubble(this.bubble, this.previewRenderer, this.currentPreset, promptText);
    }
  }

  /** Immediate removal, no walk-out animation — day reset only (spec: "清除
   * 尚未完成案件的NPC與失物"). */
  forceRemove(): void {
    this.disposeGroup();
    this.state = 'gone';
  }

  update(deltaTime: number): void {
    if (!this.group || this.state === 'waiting' || this.state === 'gone') return;

    const pos = this.group.position;
    const dx = this.target.x - pos.x;
    const dz = this.target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVE_EPS) {
      if (this.route.length > 0) {
        const next = this.route.shift()!;
        this.target.set(next.x, 0, next.z);
        return;
      }
      if (this.state === 'walkingIn') {
        this.state = 'waiting';
        // No counter to "face" any more ("Fix NPC direct interaction and
        // pallet stack handling" round一) — just keep whatever heading the
        // final approach step already produced (see the movement branch
        // below, `Math.atan2(dx, dz)`), which already reads as roughly
        // "facing back toward the player's own east-side door" since that's
        // the general direction of approach.
        // Bubble content is now entirely LostFoundSystem's call (spec二:
        // greeting first, no item name/preview yet) — it calls
        // updateBubbleText() with a random greeting immediately after this
        // arrival, so nothing needs to be shown here.
      } else if (this.state === 'walkingOut') {
        this.disposeGroup();
        this.state = 'gone';
      }
      return;
    }

    const step = Math.min(NPC_SPEED * deltaTime, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    if (dist > 0.02) this.group.rotation.y = Math.atan2(dx, dz);
  }

  private disposeGroup(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    if (this.bubble) disposeLostFoundBubble(this.bubble);
    this.bubble = null;
    this.currentPreset = null;
    if (this.hitboxObj) {
      this.interactables.delete(LOST_FOUND_NPC_INTERACTABLE_ID);
      this.hitboxObj = null;
    }
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material?.dispose();
      }
    });
    this.group = null;
  }
}
