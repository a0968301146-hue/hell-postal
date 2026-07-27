import * as THREE from 'three';
import { LostItemPreset, buildLostItemGeometry } from './lost-found-data';

const PREVIEW_SIZE = 128;

/**
 * Renders a small thumbnail image of a LostItemPreset's actual 3D model
 * ("Expand lost found return storage and scoring" round 二: NPC對話框顯示
 * "使用當日目標失物的實際3D模型製作縮圖", not a fixed emoji or unrelated
 * icon). Owns exactly ONE offscreen `<canvas>` + `THREE.WebGLRenderer` +
 * one small dedicated scene/camera/light, created once in the constructor
 * and reused for every renderPreview() call (spec: "只建立一個預覽
 * Renderer，不得每幀或每個物件重建") — each call only swaps which mesh sits
 * in that shared scene, disposing the previous one first, then re-renders
 * the same canvas. The preview mesh is PURELY visual: no RigidBody,
 * Collider, or interactables registration is ever created here (spec:
 * "模型預覽只包含視覺模型").
 *
 * Callers (lost-found-bubble-ui.ts) must copy the returned canvas's pixels
 * (e.g. via `ctx.drawImage`) into their own canvas immediately — the
 * returned HTMLCanvasElement is the renderer's own live backing canvas, its
 * contents change on the next renderPreview() call.
 */
export class LostItemPreviewRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private currentMesh: THREE.Mesh | null = null;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 3, 2.5);
    this.scene.add(key);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 10);
    this.camera.position.set(0, 0.22, 1.0);
    this.camera.lookAt(0, 0, 0);
  }

  /** Re-renders the shared canvas with `preset`'s own model (built via the
   * SAME buildLostItemGeometry() the real world item uses — see
   * lost-found-data.ts — so the thumbnail always genuinely matches what's
   * actually in the scene) and returns the renderer's backing canvas.
   * Auto-scales/centers so every preset frames similarly regardless of its
   * own raw size. */
  renderPreview(preset: LostItemPreset): HTMLCanvasElement {
    this.clearCurrentMesh();

    const geo = buildLostItemGeometry(preset.shape, preset.visualHalfExtents);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: preset.color }));
    const { x, y, z } = preset.visualHalfExtents;
    const maxDim = Math.max(x, y, z) * 2;
    if (maxDim > 0) mesh.scale.setScalar(0.55 / maxDim);
    mesh.rotation.y = Math.PI * 0.2;
    mesh.rotation.x = Math.PI * 0.05;
    this.scene.add(mesh);
    this.currentMesh = mesh;

    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  private clearCurrentMesh(): void {
    if (!this.currentMesh) return;
    this.scene.remove(this.currentMesh);
    this.currentMesh.geometry.dispose();
    (this.currentMesh.material as THREE.Material).dispose();
    this.currentMesh = null;
  }

  dispose(): void {
    this.clearCurrentMesh();
    this.renderer.dispose();
  }
}
