import * as THREE from 'three';
import { createFloatingLabel, updateFloatingLabel } from './world-label-system';

/**
 * The NPC's head-mounted speech bubble ("Expand modular lost found NPC
 * flow" round 五: NPC頭頂對話框). Reuses world-label-system.ts's existing
 * billboard-sprite UI architecture (spec: "使用現有UI架構或獨立
 * lost-found-bubble-ui模組") rather than a second DOM-based UI — a
 * THREE.Sprite parented directly to the NPC's own THREE.Group automatically
 * follows its head position with zero per-frame code (position is local to
 * the parent), which also automatically satisfies "對話框跟隨NPC頭部位置"
 * and "NPC離開後隱藏並清除" (the sprite is simply disposed/removed along
 * with the rest of the NPC group — see lost-found-npc-system.ts).
 */
export interface LostFoundBubble {
  sprite: THREE.Sprite;
}

/** Builds the bubble sprite, parented at local (0, headOffsetY, 0) — the
 * caller (lost-found-npc-system.ts) adds it as a child of the NPC group.
 * Starts hidden — only shown once the NPC has actually arrived and is
 * waiting (spec五: "NPC抵達櫃檯後，在頭頂顯示對話框"), not from the moment
 * it spawns/starts walking in. */
export function createLostFoundBubble(itemDisplayName: string, headOffsetY: number): LostFoundBubble {
  const sprite = createFloatingLabel(bubbleText(itemDisplayName), { width: 1.1, bg: 'rgba(30,25,45,0.82)' });
  sprite.position.set(0, headOffsetY, 0);
  sprite.visible = false;
  return { sprite };
}

function bubbleText(itemDisplayName: string): string {
  return `我在找：${itemDisplayName}`;
}

/** Shows/refreshes the "我在找：X" text (spec五 exact format) and makes the
 * bubble visible. */
export function showLostFoundBubble(bubble: LostFoundBubble, itemDisplayName: string): void {
  updateFloatingLabel(bubble.sprite, bubbleText(itemDisplayName));
  bubble.sprite.visible = true;
}

/** Case-complete update (spec七: "對話框更新") — swaps to a plain thank-you
 * line, kept visible through the walk-out (only actually hidden/cleared
 * once the NPC fully disposes — spec五: "NPC離開後隱藏並清除"). */
export function updateLostFoundBubbleText(bubble: LostFoundBubble, text: string): void {
  updateFloatingLabel(bubble.sprite, text);
}

/** Releases the sprite's canvas texture/material — call alongside removing
 * the NPC group from the scene. */
export function disposeLostFoundBubble(bubble: LostFoundBubble): void {
  const mat = bubble.sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}
