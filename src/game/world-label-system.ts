import * as THREE from 'three';

export interface FloatingLabelOptions {
  width?: number;
  fontSize?: number;
  bg?: string;
  fg?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}

/**
 * A THREE.Sprite always faces the camera by construction (no per-frame
 * update needed) — that's the whole "billboard" requirement satisfied for
 * free, which is why this is a factory rather than a system with update().
 */
export function createFloatingLabel(text: string, opts: FloatingLabelOptions = {}): THREE.Sprite {
  const canvasWidth = opts.canvasWidth ?? 256;
  const canvasHeight = opts.canvasHeight ?? 96;
  const fontSize = opts.fontSize ?? 26;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = opts.bg ?? 'rgba(20, 20, 20, 0.72)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2);

  ctx.fillStyle = opts.fg ?? '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = text.split('\n');
  const lineHeight = fontSize + 6;
  const startY = canvasHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvasWidth / 2, startY + i * lineHeight));

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);

  const width = opts.width ?? 0.9;
  const height = width * (canvasHeight / canvasWidth);
  sprite.scale.set(width, height, 1);
  sprite.userData.isFloatingLabel = true;
  // Purely decorative — must never participate in raycasting. Three.js's
  // Sprite.raycast() requires raycaster.camera to be set, which none of the
  // game's raycasters do (they're built from camera.position/direction, not
  // Raycaster.setFromCamera), so any recursive intersectObjects() call that
  // reaches one of these as a mesh child throws. No-op it out entirely.
  sprite.raycast = () => {};

  return sprite;
}

/** Redraw an existing floating label's text in place (for labels that change, e.g. a counter). */
export function updateFloatingLabel(sprite: THREE.Sprite, text: string, opts: FloatingLabelOptions = {}): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const texture = material.map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const fontSize = opts.fontSize ?? 26;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = opts.bg ?? 'rgba(20, 20, 20, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  ctx.fillStyle = opts.fg ?? '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = text.split('\n');
  const lineHeight = fontSize + 6;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));

  texture.needsUpdate = true;
}
