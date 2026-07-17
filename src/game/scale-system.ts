import * as THREE from 'three';
import { PhysicsSystem } from './physics-system';
import { InteractableObject } from './interactable-object';
import { MAX_PACKAGE_WEIGHT_KG } from './package-data';

const SCALE_POS = { x: 2.5, z: -5.5 };
const PLATFORM_W = 1.3;
const PLATFORM_D = 1.3;
const PLATFORM_H = 0.25;
const BASE_H = 0.12;
const SCREEN_W = 0.5;
const SCREEN_H = 0.3;

type ScaleState = 'empty' | 'measuring' | 'normal' | 'overweight' | 'multiple' | 'invalid';

export class ScaleSystem {
  private scene: THREE.Scene;
  private interactables: Map<string, InteractableObject>;
  private sensorBox: THREE.Box3;
  private stableTimer = 0;
  private currentState: ScaleState = 'empty';
  private displayCanvas: HTMLCanvasElement;
  private displayTexture: THREE.CanvasTexture;
  private lastDisplayState: string = '';
  platformTopMesh!: THREE.Mesh; // exposed for placement raycasting

  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>) {
    this.scene = scene;
    this.interactables = interactables;

    // Create display canvas
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 256;
    this.displayCanvas.height = 160;
    this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);

    this.createScaleMesh();
    this.createPhysics(physics);

    // Sensor above platform
    const topY = BASE_H + PLATFORM_H;
    this.sensorBox = new THREE.Box3(
      new THREE.Vector3(SCALE_POS.x - PLATFORM_W / 2 + 0.05, topY, SCALE_POS.z - PLATFORM_D / 2 + 0.05),
      new THREE.Vector3(SCALE_POS.x + PLATFORM_W / 2 - 0.05, topY + 1.5, SCALE_POS.z + PLATFORM_D / 2 - 0.05)
    );

    this.updateDisplay('empty', null);
    console.log('Scale system created at', SCALE_POS);
  }

  update(deltaTime: number): void {
    // Find packages on scale
    const packagesOnScale: InteractableObject[] = [];

    for (const obj of this.interactables.values()) {
      if (obj.isHeld || !obj.mesh.visible) continue;
      if (!obj.rigidBody) continue;
      if (!obj.packageData) continue; // only packages

      const pos = obj.mesh.position;
      if (!this.sensorBox.containsPoint(pos)) continue;

      // Check if it's an envelope (skip thin objects)
      if (obj.height <= 0.05) continue;

      // Check velocity
      const lv = obj.rigidBody.linvel();
      const av = obj.rigidBody.angvel();
      const speed = Math.sqrt(lv.x ** 2 + lv.y ** 2 + lv.z ** 2);
      const angSpeed = Math.sqrt(av.x ** 2 + av.y ** 2 + av.z ** 2);
      if (speed < 0.4 && angSpeed < 0.4) {
        packagesOnScale.push(obj);
      }
    }

    // Check for non-package items (envelopes, containers)
    let hasInvalidItem = false;
    for (const obj of this.interactables.values()) {
      if (obj.isHeld || !obj.mesh.visible || !obj.rigidBody) continue;
      if (obj.packageData) continue; // skip packages (handled above)
      if (obj.height <= 0.05) { // envelope
        const pos = obj.mesh.position;
        if (this.sensorBox.containsPoint(pos)) { hasInvalidItem = true; break; }
      }
      if (obj.mesh.userData.sortingBoxId || obj.mesh.userData.crateId) {
        const pos = obj.mesh.position;
        if (this.sensorBox.containsPoint(pos)) { hasInvalidItem = true; break; }
      }
    }

    if (packagesOnScale.length === 0 && !hasInvalidItem) {
      this.stableTimer = 0;
      if (this.currentState !== 'empty') {
        this.currentState = 'empty';
        this.updateDisplay('empty', null);
      }
      return;
    }

    if (hasInvalidItem && packagesOnScale.length === 0) {
      this.stableTimer = 0;
      if (this.currentState !== 'invalid') {
        this.currentState = 'invalid';
        this.updateDisplay('invalid', null);
      }
      return;
    }

    if (packagesOnScale.length > 1) {
      this.stableTimer = 0;
      if (this.currentState !== 'multiple') {
        this.currentState = 'multiple';
        this.updateDisplay('multiple', null);
      }
      return;
    }

    // Single stable package
    this.stableTimer += deltaTime;
    if (this.stableTimer < 0.3) {
      if (this.currentState !== 'measuring') {
        this.currentState = 'measuring';
        this.updateDisplay('measuring', null);
      }
      return;
    }

    const pkg = packagesOnScale[0];
    if (!pkg.packageData) return;

    pkg.packageData.hasBeenWeighed = true;
    pkg.packageData.isOverweight = pkg.packageData.weightKg > MAX_PACKAGE_WEIGHT_KG;

    const state: ScaleState = pkg.packageData.isOverweight ? 'overweight' : 'normal';
    if (this.currentState !== state || this.lastDisplayState !== pkg.id) {
      this.currentState = state;
      this.lastDisplayState = pkg.id;
      this.updateDisplay(state, pkg.packageData);
    }
  }

  private updateDisplay(state: ScaleState, pkg: import('./package-data').PackageData | null): void {
    const ctx = this.displayCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 160);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 252, 156);

    ctx.textAlign = 'center';

    switch (state) {
      case 'empty':
        ctx.fillStyle = '#888';
        ctx.font = '18px sans-serif';
        ctx.fillText('請放置包裹', 128, 85);
        break;
      case 'measuring':
        ctx.fillStyle = '#ffcc00';
        ctx.font = '18px sans-serif';
        ctx.fillText('秤重中...', 128, 85);
        break;
      case 'normal':
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(`重量：${pkg!.weightKg.toFixed(1)} kg`, 128, 65);
        ctx.fillStyle = '#44ff44';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('狀態：正常', 128, 110);
        break;
      case 'overweight':
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(`重量：${pkg!.weightKg.toFixed(1)} kg`, 128, 65);
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('狀態：超重', 128, 110);
        break;
      case 'multiple':
        ctx.fillStyle = '#ffaa00';
        ctx.font = '16px sans-serif';
        ctx.fillText('請一次放置', 128, 70);
        ctx.fillText('一件包裹', 128, 100);
        break;
      case 'invalid':
        ctx.fillStyle = '#ff8800';
        ctx.font = '18px sans-serif';
        ctx.fillText('無法辨識', 128, 85);
        break;
    }

    this.displayTexture.needsUpdate = true;
  }

  private createScaleMesh(): void {
    const group = new THREE.Group();
    group.position.set(SCALE_POS.x, 0, SCALE_POS.z);

    // Base
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const baseGeo = new THREE.BoxGeometry(PLATFORM_W + 0.1, BASE_H, PLATFORM_D + 0.1);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = BASE_H / 2;
    group.add(base);

    // Platform (top surface)
    const platMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const platGeo = new THREE.BoxGeometry(PLATFORM_W, PLATFORM_H, PLATFORM_D);
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.position.y = BASE_H + PLATFORM_H / 2;
    platform.userData.surfaceType = 'scale-platform';
    group.add(platform);
    this.platformTopMesh = platform;

    // Screen post
    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const postGeo = new THREE.BoxGeometry(0.04, 0.6, 0.04);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(PLATFORM_W / 2 + 0.08, BASE_H + PLATFORM_H + 0.3, 0);
    group.add(post);

    // Screen
    const screenGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    const screenMat = new THREE.MeshBasicMaterial({ map: this.displayTexture });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(PLATFORM_W / 2 + 0.08, BASE_H + PLATFORM_H + 0.6, 0.03);
    group.add(screen);

    // Label
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128; labelCanvas.height = 32;
    const lctx = labelCanvas.getContext('2d')!;
    lctx.fillStyle = '#333'; lctx.fillRect(0, 0, 128, 32);
    lctx.fillStyle = '#fff'; lctx.font = '14px sans-serif'; lctx.textAlign = 'center';
    lctx.fillText('包裹秤重機', 64, 22);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelGeo = new THREE.PlaneGeometry(0.35, 0.08);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, BASE_H + PLATFORM_H + 0.02, PLATFORM_D / 2 + 0.01);
    group.add(label);

    this.scene.add(group);
    group.updateMatrixWorld(true);
  }

  private createPhysics(physics: PhysicsSystem): void {
    // Platform collider (fixed, for packages to rest on)
    physics.createStaticCuboid(
      SCALE_POS.x, BASE_H + PLATFORM_H / 2, SCALE_POS.z,
      PLATFORM_W / 2, PLATFORM_H / 2, PLATFORM_D / 2
    );
    // Base collider
    physics.createStaticCuboid(
      SCALE_POS.x, BASE_H / 2, SCALE_POS.z,
      (PLATFORM_W + 0.1) / 2, BASE_H / 2, (PLATFORM_D + 0.1) / 2
    );
    // Screen post collider
    physics.createStaticCuboid(
      SCALE_POS.x + PLATFORM_W / 2 + 0.08, BASE_H + PLATFORM_H + 0.3, SCALE_POS.z,
      0.03, 0.3, 0.03
    );
  }
}
