import * as THREE from 'three';
import { createFloatingLabel, updateFloatingLabel } from '../../adapters/three/world-label-system';

/**
 * "Add day one dock story event" round — reuses world-label-system.ts's
 * existing billboard-sprite CanvasTexture infrastructure directly (spec三:
 * "沿用既有NPC彈出式對話泡泡...使用現有CanvasTexture文字排版"), the exact
 * same generic building blocks lost-found-bubble-ui.ts's own doc comment
 * describes reusing. updateFloatingLabel already redraws into the SAME
 * canvas/texture in place (`texture.needsUpdate = true`, never a new
 * THREE.CanvasTexture) — exactly the "不可每幀建立新Texture" requirement,
 * satisfied for free by that existing helper; this module only adds its own
 * CJK-aware line-wrap on top; a fresh texture only ever exists once per
 * bubble instance (created by createFloatingLabel, disposed by
 * disposeStoryBubble), never once per character/frame.
 */

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 220;
const FONT_SIZE = 24;
const SPRITE_WORLD_WIDTH = 2.2;
const BUBBLE_BG = 'rgba(25,20,15,0.85)';
const BUBBLE_FG = '#f5ead0';
const TEXT_SIDE_MARGIN = 24;

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d')!;
  ctx.font = `bold ${FONT_SIZE}px sans-serif`;
  return ctx;
}

/** Greedy per-character wrap (CJK text carries no spaces to word-wrap on —
 * same reasoning as lost-found-bubble-ui.ts's own wrapTextLines, a fresh
 * small implementation here rather than importing that one so this module
 * stays independent of lost-found's own file, matching this round's own
 * "not modifying the existing lost-found bubble module" scope). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  let current = '';
  for (const ch of text) {
    const attempt = current + ch;
    if (current.length > 0 && ctx.measureText(attempt).width > maxWidth) {
      result.push(current);
      current = ch;
    } else {
      current = attempt;
    }
  }
  if (current.length > 0) result.push(current);
  return result.length > 0 ? result : [''];
}

/** Wraps a full dialogue line to real '\n' breaks ONCE, fitting
 * CANVAS_WIDTH — the typewriter reveal in after-work-story-system.ts then
 * only ever slices increasing prefixes of THIS already-wrapped string, so
 * line breaks never shift mid-reveal. */
export function wrapStoryLine(fullText: string): string {
  const ctx = getMeasureCtx();
  const maxWidth = CANVAS_WIDTH - TEXT_SIDE_MARGIN * 2;
  return wrapLines(ctx, fullText, maxWidth).join('\n');
}

/** Builds the NPC's own head-mounted dialogue sprite — starts hidden/blank,
 * shown only once the story actually begins (see
 * AfterWorkStorySystem.beginLine). */
export function createStoryBubble(headOffsetY: number): THREE.Sprite {
  const sprite = createFloatingLabel('', {
    width: SPRITE_WORLD_WIDTH, canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT,
    fontSize: FONT_SIZE, bg: BUBBLE_BG, fg: BUBBLE_FG,
  });
  sprite.position.set(0, headOffsetY, 0);
  sprite.visible = false;
  return sprite;
}

/** Redraws the CURRENTLY REVEALED prefix of the active line in place — the
 * one call site this round's typewriter timer invokes every frame while
 * revealing (updateFloatingLabel itself only ever toggles
 * `texture.needsUpdate`, never recreates the texture). */
export function showStoryBubbleText(sprite: THREE.Sprite, revealedText: string): void {
  updateFloatingLabel(sprite, revealedText, { fontSize: FONT_SIZE, bg: BUBBLE_BG, fg: BUBBLE_FG });
  sprite.visible = true;
}

export function hideStoryBubble(sprite: THREE.Sprite): void {
  sprite.visible = false;
}

/** Releases the sprite's own canvas texture/material — call once, alongside
 * removing the NPC group from the scene (mirrors
 * lost-found-bubble-ui.ts's own disposeLostFoundBubble). */
export function disposeStoryBubble(sprite: THREE.Sprite): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}
