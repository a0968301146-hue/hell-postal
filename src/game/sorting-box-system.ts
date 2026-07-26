import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../shared/types/interactable';
import {
  SortingBoxData, SortingBoxConfig, SORTING_BOX_CONFIGS, SORTING_BOX_CAPACITY,
  SBOX_WIDTH, SBOX_DEPTH, SBOX_HEIGHT, SBOX_WALL_THICKNESS,
  createSortingBoxData
} from './sorting-box-data';
import { BACK_AREA } from './logistics-layout-data';
import { createFloatingLabel } from '../adapters/three/world-label-system';

// Bottom plate thickness
const BOTTOM_THICKNESS = 0.08;
const FLOOR_Y = BACK_AREA.floorY;

export class SortingBoxSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  boxes: Map<string, SortingBoxData> = new Map();
  private countTextures: Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }> = new Map();
  interiorPlanes: Map<string, THREE.Mesh> = new Map();

  /** `enabled` gates all sorting boxes out of the scene this round (spec
   * "每日貨品清空核心流程" section 三 — see feature-flags.ts
   * ENABLE_LEGACY_MAIL_FLOW). Every query method here is already naturally
   * safe when `boxes`/`interiorPlanes` stay empty (isSortingBox/isPlacedBox/
   * getInteriorBottomY all fall through to a false/null miss), so no extra
   * guards are needed beyond skipping createAllBoxes(). */
  constructor(scene: THREE.Scene, physics: PhysicsSystem, interactables: Map<string, InteractableObject>, enabled: boolean) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    if (!enabled) return;
    this.createAllBoxes();
    console.log('Sorting boxes created:', this.boxes.size);
  }

  getBoxData(boxId: string): SortingBoxData | undefined { return this.boxes.get(boxId); }
  isSortingBox(obj: InteractableObject): boolean { return this.boxes.has(obj.id); }
  isPlacedBox(obj: InteractableObject): boolean {
    const b = this.boxes.get(obj.id);
    return !!b && b.isPlaced && !b.isHeld;
  }
  onBoxPickedUp(boxId: string): void { const b = this.boxes.get(boxId); if (b) { b.isHeld = true; b.isPlaced = false; } }
  onBoxPlacedDown(boxId: string): void { const b = this.boxes.get(boxId); if (b) { b.isHeld = false; b.isPlaced = true; } }

  getSensorBox(boxId: string): THREE.Box3 | null {
    const data = this.boxes.get(boxId);
    if (!data || !data.isPlaced) return null;
    const obj = this.interactables.get(boxId);
    if (!obj || !obj.mesh.visible) return null;
    // Root at BOTTOM CENTER
    const pos = obj.mesh.position;
    const innerHW = (SBOX_WIDTH - SBOX_WALL_THICKNESS * 2) / 2;
    const innerHD = (SBOX_DEPTH - SBOX_WALL_THICKNESS * 2) / 2;
    return new THREE.Box3(
      new THREE.Vector3(pos.x - innerHW, pos.y + BOTTOM_THICKNESS, pos.z - innerHD),
      new THREE.Vector3(pos.x + innerHW, pos.y + SBOX_HEIGHT + 0.1, pos.z + innerHD)
    );
  }

  getInteriorBottomY(boxId: string): number | null {
    const obj = this.interactables.get(boxId);
    if (!obj) return null;
    // Root at bottom, interior floor = root.y + BOTTOM_THICKNESS
    return obj.mesh.position.y + BOTTOM_THICKNESS;
  }

  recordSort(boxId: string, envelopeId: string): boolean {
    const box = this.boxes.get(boxId);
    if (!box) return false;
    if (box.envelopeIds.includes(envelopeId)) return false;
    if (box.envelopeCount >= box.capacity) return false;
    box.envelopeIds.push(envelopeId);
    box.envelopeCount++;
    this.updateCountLabel(boxId);
    return true;
  }

  private createAllBoxes(): void {
    for (const config of SORTING_BOX_CONFIGS) this.createBox(config);
  }

  private createBox(config: SortingBoxConfig): void {
    const data = createSortingBoxData(config);
    this.boxes.set(data.boxId, data);

    const mesh = this.createOpenBoxMesh(data);
    const rootY = FLOOR_Y + 0.005;
    mesh.position.set(config.posX, rootY, config.posZ);
    mesh.userData.sortingBoxId = data.boxId;
    mesh.userData.bottomOrigin = true;
    this.scene.add(mesh);

    const obj = createInteractableObject(data.boxId, data.displayName, mesh, SBOX_WIDTH, SBOX_HEIGHT, SBOX_DEPTH);
    obj.packageData = null;
    obj.containerBounds = {
      innerWidth: SBOX_WIDTH - SBOX_WALL_THICKNESS * 2,
      innerDepth: SBOX_DEPTH - SBOX_WALL_THICKNESS * 2,
      innerHeight: SBOX_HEIGHT - BOTTOM_THICKNESS,
      interiorCenterOffset: new THREE.Vector3(0, (BOTTOM_THICKNESS + SBOX_HEIGHT) / 2, 0),
      tolerance: 0.02,
    };

    // Create a single Dynamic body at box center
    const bodyCenterY = rootY + SBOX_HEIGHT / 2;
    const bodyDesc = this.physics.createDynamicBodyDesc(config.posX, bodyCenterY, config.posZ, 600);
    const body = this.physics.createDynamicBody(bodyDesc);
    body.setEnabledRotations(false, true, false, true);
    body.setLinearDamping(1.5);
    body.setAngularDamping(2.0);

    // Attach 5 colliders to this body using LOCAL offsets from body center
    const hw = SBOX_WIDTH / 2;
    const hd = SBOX_DEPTH / 2;
    const hh = SBOX_HEIGHT / 2;
    const wt2 = SBOX_WALL_THICKNESS / 2;
    const wallH = (SBOX_HEIGHT - BOTTOM_THICKNESS) / 2;
    const bottomLocalY = -hh + BOTTOM_THICKNESS / 2;
    const wallLocalY = -hh + BOTTOM_THICKNESS + wallH;

    // Bottom plate
    this.physics.addColliderToBody(body, 0, bottomLocalY, 0, hw, BOTTOM_THICKNESS / 2, hd);
    // Front wall
    this.physics.addColliderToBody(body, 0, wallLocalY, hd - wt2, hw, wallH, wt2);
    // Back wall
    this.physics.addColliderToBody(body, 0, wallLocalY, -(hd - wt2), hw, wallH, wt2);
    // Left wall
    this.physics.addColliderToBody(body, -(hw - wt2), wallLocalY, 0, wt2, wallH, hd);
    // Right wall
    this.physics.addColliderToBody(body, hw - wt2, wallLocalY, 0, wt2, wallH, hd);

    obj.rigidBody = body;
    obj.collider = null; // multiple colliders, tracked by body

    this.interactables.set(data.boxId, obj);
  }

  private createOpenBoxMesh(data: SortingBoxData): THREE.Mesh {
    // Root mesh — invisible tiny cube, origin at BOTTOM CENTER
    const rootGeo = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const rootMat = new THREE.MeshBasicMaterial({ visible: false });
    const root = new THREE.Mesh(rootGeo, rootMat);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5C4A3A });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x7A6B5A, side: THREE.DoubleSide });
    const hw = SBOX_WIDTH / 2;
    const hd = SBOX_DEPTH / 2;
    const wt = SBOX_WALL_THICKNESS;
    const wallH = SBOX_HEIGHT - BOTTOM_THICKNESS;

    // Bottom plate (root at bottom, so Y starts at 0)
    const bottomGeo = new THREE.BoxGeometry(SBOX_WIDTH, BOTTOM_THICKNESS, SBOX_DEPTH);
    const bottom = new THREE.Mesh(bottomGeo, wallMat);
    bottom.position.y = BOTTOM_THICKNESS / 2;
    root.add(bottom);

    // Inner floor visible from top
    const innerFloorGeo = new THREE.PlaneGeometry(SBOX_WIDTH - wt * 2, SBOX_DEPTH - wt * 2);
    const innerFloor = new THREE.Mesh(innerFloorGeo, innerMat);
    innerFloor.rotation.x = -Math.PI / 2;
    innerFloor.position.y = BOTTOM_THICKNESS + 0.002;
    root.add(innerFloor);

    // Four walls (from BOTTOM_THICKNESS up to SBOX_HEIGHT)
    const wallBaseY = BOTTOM_THICKNESS + wallH / 2;

    const frontGeo = new THREE.BoxGeometry(SBOX_WIDTH, wallH, wt);
    const frontWall = new THREE.Mesh(frontGeo, wallMat);
    frontWall.position.set(0, wallBaseY, hd - wt / 2);
    root.add(frontWall);

    const backWall = new THREE.Mesh(frontGeo, wallMat);
    backWall.position.set(0, wallBaseY, -hd + wt / 2);
    root.add(backWall);

    const sideGeo = new THREE.BoxGeometry(wt, wallH, SBOX_DEPTH);
    const leftWall = new THREE.Mesh(sideGeo, wallMat);
    leftWall.position.set(-hw + wt / 2, wallBaseY, 0);
    root.add(leftWall);

    const rightWall = new THREE.Mesh(sideGeo, wallMat);
    rightWall.position.set(hw - wt / 2, wallBaseY, 0);
    root.add(rightWall);

    // Front label — floating billboard, always faces the player
    const labelMesh = createFloatingLabel(`${data.icon} ${data.destinationName}\n分類箱`, { width: 0.55 });
    labelMesh.position.set(0, SBOX_HEIGHT * 0.7, hd + 0.005);
    root.add(labelMesh);

    // Count label — also billboard, redrawn whenever the count changes
    const countCanvas = document.createElement('canvas');
    countCanvas.width = 128; countCanvas.height = 48;
    this.drawCountLabel(countCanvas, 0);
    const countTex = new THREE.CanvasTexture(countCanvas);
    const countMat = new THREE.SpriteMaterial({ map: countTex, transparent: true, depthWrite: false });
    const countMesh = new THREE.Sprite(countMat);
    countMesh.raycast = () => {}; // decorative only — see world-label-system.ts for why
    countMesh.scale.set(0.32, 0.12, 1);
    countMesh.position.set(0, SBOX_HEIGHT * 0.45, hd + 0.005);
    root.add(countMesh);
    this.countTextures.set(data.boxId, { canvas: countCanvas, texture: countTex });

    // Interior placement plane (for E-key direct placement and placement preview)
    const planeGeo = new THREE.PlaneGeometry(SBOX_WIDTH - wt * 2 - 0.02, SBOX_DEPTH - wt * 2 - 0.02);
    const planeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = BOTTOM_THICKNESS + 0.04; // just above bottom plate
    plane.userData.interiorPlane = true;
    plane.userData.surfaceType = 'container-interior';
    plane.userData.ownerSortingContainerId = data.boxId;
    root.add(plane);
    this.interiorPlanes.set(data.boxId, plane);

    // HitProxy
    const proxyGeo = new THREE.BoxGeometry(SBOX_WIDTH * 1.05, SBOX_HEIGHT * 1.05, SBOX_DEPTH * 1.05);
    const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.y = SBOX_HEIGHT / 2; // center of box volume
    proxy.userData.ownerSortingBoxId = data.boxId;
    proxy.userData.isHitProxy = true;
    root.add(proxy);

    return root;
  }

  private drawCountLabel(canvas: HTMLCanvasElement, count: number): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 48);
    ctx.fillStyle = '#E8E8D0'; ctx.fillRect(0, 0, 128, 48);
    ctx.fillStyle = '#333'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`信件：${count} / ${SORTING_BOX_CAPACITY}`, 64, 30);
  }

  private updateCountLabel(boxId: string): void {
    const box = this.boxes.get(boxId);
    const td = this.countTextures.get(boxId);
    if (!box || !td) return;
    this.drawCountLabel(td.canvas, box.envelopeCount);
    td.texture.needsUpdate = true;
  }
}
