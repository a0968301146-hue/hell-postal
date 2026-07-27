import * as THREE from 'three';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';
import { LostItemPreset } from './lost-found-data';
import { LostItemPreviewRenderer } from './lost-item-preview-renderer';

/**
 * The NPC's head-mounted speech bubble ("Expand modular lost found NPC
 * flow" round 五: NPC頭頂對話框). Reuses world-label-system.ts's existing
 * billboard-sprite UI architecture (a THREE.Sprite parented directly to the
 * NPC's own THREE.Group automatically follows its head position with zero
 * per-frame code) — extended this round ("Expand lost found return storage
 * and scoring" round 二) to ALSO composite a small preview image of the
 * target item's actual 3D model, drawn directly onto the same canvas
 * alongside its name and a prompt line, rather than a second sprite.
 */
export interface LostFoundBubble {
  sprite: THREE.Sprite;
}

const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 260;
const IMAGE_SIZE = 148;
const IMAGE_TOP = 14;

/** Builds the bubble sprite, parented at local (0, headOffsetY, 0) — the
 * caller (lost-found-npc-system.ts) adds it as a child of the NPC group.
 * Starts hidden and blank — only drawn/shown once the NPC has actually
 * arrived and is waiting (see showLostFoundBubble below), not from the
 * moment it spawns/starts walking in. */
export function createLostFoundBubble(headOffsetY: number): LostFoundBubble {
  const sprite = createFloatingLabel('', { width: 1.1, canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT });
  sprite.position.set(0, headOffsetY, 0);
  sprite.visible = false;
  return { sprite };
}

function getCanvasAndTexture(bubble: LostFoundBubble): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const material = bubble.sprite.material as THREE.SpriteMaterial;
  const texture = material.map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  return { canvas, ctx: canvas.getContext('2d')!, texture };
}

function drawFrame(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(30,25,45,0.88)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
}

/** Renders `preset`'s own model preview (via the ONE shared
 * LostItemPreviewRenderer — spec: "只建立一個預覽Renderer") plus its display
 * name and a prompt line (spec二: "我在找這個失物" style text) onto the
 * bubble's canvas, then makes it visible. Called once per case, when the
 * NPC actually arrives at the counter — see lost-found-npc-system.ts. */
export function showLostFoundBubble(
  bubble: LostFoundBubble, previewRenderer: LostItemPreviewRenderer, preset: LostItemPreset, promptText: string
): void {
  const { canvas, ctx, texture } = getCanvasAndTexture(bubble);
  drawFrame(ctx, canvas);

  const previewCanvas = previewRenderer.renderPreview(preset);
  const imageX = (canvas.width - IMAGE_SIZE) / 2;
  ctx.drawImage(previewCanvas, imageX, IMAGE_TOP, IMAGE_SIZE, IMAGE_SIZE);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(preset.displayName, canvas.width / 2, IMAGE_TOP + IMAGE_SIZE + 30);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#d8d0e8';
  ctx.fillText(promptText, canvas.width / 2, IMAGE_TOP + IMAGE_SIZE + 62);

  texture.needsUpdate = true;
  bubble.sprite.visible = true;
}

/** Case-complete/missed update (spec: "對話框更新") — swaps to a plain
 * text-only line (thank-you or disappointed message), kept visible through
 * the walk-out (only actually hidden/cleared once the NPC fully disposes).
 * Reuses world-label-system.ts's standard text-only drawing rather than
 * this file's own image compositing — the preview image is only relevant
 * while the NPC is still waiting for the correct item. */
export function updateLostFoundBubbleText(bubble: LostFoundBubble, text: string): void {
  updateFloatingLabel(bubble.sprite, text);
  bubble.sprite.visible = true;
}

/** Releases the sprite's canvas texture/material — call alongside removing
 * the NPC group from the scene. Does NOT touch the shared
 * LostItemPreviewRenderer, which outlives any single NPC/bubble instance. */
export function disposeLostFoundBubble(bubble: LostFoundBubble): void {
  const mat = bubble.sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}
