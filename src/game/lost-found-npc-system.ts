import * as THREE from 'three';
import {
  LOST_FOUND_NPC_SPAWN, LOST_FOUND_NPC_WAIT_SPOT, LOST_FOUND_NPC_ROUTE_WAYPOINTS, LOST_FOUND_ROOM,
} from './lost-found-layout-data';
import {
  createLostFoundBubble, showLostFoundBubble, updateLostFoundBubbleText, disposeLostFoundBubble, LostFoundBubble,
} from './lost-found-bubble-ui';

const NPC_SPEED = 1.6; // m/s, simple slide-to-target movement — same convention as counter-npc-system.ts
const ARRIVE_EPS = 0.08;
const HEAD_Y = LOST_FOUND_ROOM.floorY + 1.9;

export type LostFoundNpcState = 'gone' | 'walkingIn' | 'waiting' | 'walkingOut';

/**
 * Owns the daily lost-found NPC's own entry/exit walk and physical presence
 * ("Expand modular lost found NPC flow" round 模組化: lost-found-npc-
 * system.ts — NPC進出與狀態) — deliberately no case/item knowledge here;
 * lost-found-system.ts calls spawn()/startLeaving()/forceRemove() and
 * reads `state`/`position` rather than this class reaching into case logic,
 * mirroring the CounterNpcSystem/CounterServiceSystem split elsewhere in
 * this codebase. No physics collider (matches every other decorative NPC in
 * this game — CounterNpcSystem's queue NPCs are walk-through too).
 */
export class LostFoundNpcSystem {
  state: LostFoundNpcState = 'gone';

  private scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private bubble: LostFoundBubble | null = null;
  private target = new THREE.Vector3();
  private itemDisplayName = '';
  /** Remaining points to visit in order, current target first — set by
   * spawn()/startLeaving() from LOST_FOUND_NPC_ROUTE_WAYPOINTS so the NPC
   * ducks around the counter's own footprint instead of cutting straight
   * through it ("Adjust lost found counter orientation" round 驗證: 互動不穿
   * 模). Popped one at a time in update() as each point is reached. */
  private route: { x: number; z: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get position(): THREE.Vector3 | null {
    return this.group ? this.group.position : null;
  }

  /** Spawns just outside the west gate and starts walking in toward the
   * counter's east-side waiting spot, via LOST_FOUND_NPC_ROUTE_WAYPOINTS
   * (spec二: NPC從西側門外生成，經大門走到櫃檯等待位置). No-op if an NPC is
   * already present. */
  spawn(itemDisplayName: string): void {
    if (this.group) return;

    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9a05a });
    const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8);
    const body = new THREE.Mesh(capsuleGeo, bodyMat);
    body.position.y = LOST_FOUND_ROOM.floorY + 0.28 + 0.45;
    group.add(body);

    group.position.set(LOST_FOUND_NPC_SPAWN.x, 0, LOST_FOUND_NPC_SPAWN.z);
    this.scene.add(group);
    this.group = group;

    // Bubble starts hidden (createLostFoundBubble's own default) while
    // walking in — only shown once arrived (see update()'s arrival branch),
    // per spec五: "NPC抵達櫃檯後，在頭頂顯示對話框".
    this.itemDisplayName = itemDisplayName;
    const bubble = createLostFoundBubble(itemDisplayName, HEAD_Y + 0.35);
    group.add(bubble.sprite);
    this.bubble = bubble;

    this.setRoute([...LOST_FOUND_NPC_ROUTE_WAYPOINTS, LOST_FOUND_NPC_WAIT_SPOT]);
    this.state = 'walkingIn';
  }

  /** Starts the walk back out through the same west gate, retracing the same
   * waypoints in reverse (spec二: 離開時沿相同路線走出). Bubble stays visible
   * (spec七: "對話框更新") — caller updates its text to a thank-you line via
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

  /** Immediate removal, no walk-out animation — day reset only (spec七: "清
   * 除尚未完成案件的NPC與失物"). */
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
        if (this.bubble) showLostFoundBubble(this.bubble, this.itemDisplayName);
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
