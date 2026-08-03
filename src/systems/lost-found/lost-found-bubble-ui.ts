import * as THREE from 'three';
import { createFloatingLabel } from '../../adapters/three/world-label-system';
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

// "Fix pallet throw and add spray paint tool" round三: widened from the
// original 220px so long NPC lines (greetings/requests/thank-yous routinely
// run well past 10 CJK characters — see lost-found-data.ts's text pools)
// stop getting cut off at the canvas edge. MIN_CANVAS_HEIGHT is a floor, not
// a fixed size — showLostFoundBubble/updateLostFoundBubbleText below measure
// the actual wrapped line count first and grow the canvas (and the sprite's
// world-space scale, so the billboard itself visibly grows) to fit, the
// closest in-world equivalent of a CSS box whose "height依內容自動延伸".
const CANVAS_WIDTH = 320;
const MIN_CANVAS_HEIGHT = 260;
const IMAGE_SIZE = 148;
const IMAGE_TOP = 14;
const TEXT_SIDE_MARGIN = 20;
const SPRITE_WORLD_WIDTH = 1.4;

/** Builds the bubble sprite, parented at local (0, headOffsetY, 0) — the
 * caller (lost-found-npc-system.ts) adds it as a child of the NPC group.
 * Starts hidden and blank — only drawn/shown once the NPC has actually
 * arrived and is waiting (see showLostFoundBubble below), not from the
 * moment it spawns/starts walking in. */
export function createLostFoundBubble(headOffsetY: number): LostFoundBubble {
  const sprite = createFloatingLabel('', { width: SPRITE_WORLD_WIDTH, canvasWidth: CANVAS_WIDTH, canvasHeight: MIN_CANVAS_HEIGHT });
  sprite.position.set(0, headOffsetY, 0);
  sprite.visible = false;
  return { sprite };
}

/** Greedy character-by-character wrap (CSS `overflow-wrap: anywhere`'s
 * in-canvas equivalent — CJK text has no spaces to word-wrap on, so
 * measuring per-character is the only approach that actually keeps every
 * line inside `maxWidth`) — `ctx.font` must already be set by the caller.
 * Literal '\n' in `text` is still honored as a hard line break. */
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const hardLines = text.split('\n');
  const result: string[] = [];
  for (const hardLine of hardLines) {
    if (hardLine.length === 0) { result.push(''); continue; }
    let current = '';
    for (const ch of hardLine) {
      const attempt = current + ch;
      if (current.length > 0 && ctx.measureText(attempt).width > maxWidth) {
        result.push(current);
        current = ch;
      } else {
        current = attempt;
      }
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

function drawFrame(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(30,25,45,0.88)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
}

/** Resizes the bubble's backing canvas to fit `contentHeight` (never below
 * MIN_CANVAS_HEIGHT) and grows the sprite's world-space scale to match — the
 * canvas element's `.height`/`.width` setters always clear its pixel
 * content, which is fine here since every caller redraws immediately after.
 * Reassigning either dimension also invalidates the CanvasTexture, hence
 * the `needsUpdate` on return. */
function resizeBubbleCanvas(bubble: LostFoundBubble, contentHeight: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const material = bubble.sprite.material as THREE.SpriteMaterial;
  const texture = material.map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, Math.ceil(contentHeight));
  canvas.width = CANVAS_WIDTH;
  canvas.height = canvasHeight;
  bubble.sprite.scale.set(SPRITE_WORLD_WIDTH, SPRITE_WORLD_WIDTH * (canvasHeight / CANVAS_WIDTH), 1);
  texture.needsUpdate = true;
  return { canvas, ctx: canvas.getContext('2d')!, texture };
}

/** Renders `preset`'s own model preview (via the ONE shared
 * LostItemPreviewRenderer — spec: "只建立一個預覽Renderer") plus its display
 * name and a prompt line (spec二: "我在找這個失物" style text) onto the
 * bubble's canvas, then makes it visible. Called once per case, when the
 * NPC actually arrives at the counter — see lost-found-npc-system.ts. */
export function showLostFoundBubble(
  bubble: LostFoundBubble, previewRenderer: LostItemPreviewRenderer, preset: LostItemPreset, promptText: string
): void {
  const maxTextWidth = CANVAS_WIDTH - TEXT_SIDE_MARGIN * 2;
  const measureCtx = ((bubble.sprite.material as THREE.SpriteMaterial).map!.image as HTMLCanvasElement).getContext('2d')!;

  measureCtx.font = 'bold 24px sans-serif';
  const nameLines = wrapTextLines(measureCtx, preset.displayName, maxTextWidth);
  measureCtx.font = '20px sans-serif';
  const promptLines = wrapTextLines(measureCtx, promptText, maxTextWidth);

  const nameLineHeight = 30;
  const promptLineHeight = 26;
  const textTop = IMAGE_TOP + IMAGE_SIZE + 30;
  const textBlockHeight = nameLines.length * nameLineHeight + promptLines.length * promptLineHeight;
  const contentHeight = textTop + textBlockHeight + 20;

  const { canvas, ctx, texture } = resizeBubbleCanvas(bubble, contentHeight);
  drawFrame(ctx, canvas);

  const previewCanvas = previewRenderer.renderPreview(preset);
  const imageX = (canvas.width - IMAGE_SIZE) / 2;
  ctx.drawImage(previewCanvas, imageX, IMAGE_TOP, IMAGE_SIZE, IMAGE_SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  let y = textTop;
  for (const line of nameLines) { ctx.fillText(line, canvas.width / 2, y); y += nameLineHeight; }

  ctx.fillStyle = '#d8d0e8';
  ctx.font = '20px sans-serif';
  for (const line of promptLines) { ctx.fillText(line, canvas.width / 2, y); y += promptLineHeight; }

  texture.needsUpdate = true;
  bubble.sprite.visible = true;
}

/** Case-complete/missed update (spec: "對話框更新") — swaps to a plain
 * text-only line (thank-you or disappointed message, or greeting text +
 * the "按 E 繼續" interaction prompt on one more line — see
 * lost-found-system.ts's own `${pickRandomGreeting()}\n${LOST_FOUND_CONTINUE_PROMPT}`
 * caller). Implements its own wrap+resize locally (see wrapTextLines/
 * resizeBubbleCanvas above) rather than delegating to world-label-system.ts's
 * shared updateFloatingLabel — kept local so the wider/auto-height dialogue
 * box only affects this NPC bubble, not every other floating label in the
 * game that still reuses the original shared helper unchanged. */
export function updateLostFoundBubbleText(bubble: LostFoundBubble, text: string): void {
  const maxTextWidth = CANVAS_WIDTH - TEXT_SIDE_MARGIN * 2;
  const fontSize = 22;
  const lineHeight = fontSize + 8;
  const measureCtx = ((bubble.sprite.material as THREE.SpriteMaterial).map!.image as HTMLCanvasElement).getContext('2d')!;
  measureCtx.font = `bold ${fontSize}px sans-serif`;
  const lines = wrapTextLines(measureCtx, text, maxTextWidth);
  const contentHeight = lines.length * lineHeight + 40;

  const { canvas, ctx, texture } = resizeBubbleCanvas(bubble, contentHeight);
  drawFrame(ctx, canvas);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));

  texture.needsUpdate = true;
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
