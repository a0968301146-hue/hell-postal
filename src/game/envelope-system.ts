import * as THREE from 'three';
import { PhysicsSystem } from '../adapters/rapier/physics-system';
import { InteractableObject, createInteractableObject } from '../shared/types/interactable';
import { EnvelopeData, createAllEnvelopes, createEnvelopeAddressLabel, createEnvelopeStampVisual } from './envelope-data';
import { SCENE_CONFIG } from '../systems/world-layout';
import { BACK_AREA } from '../systems/world-layout';
import { createFloatingLabel } from '../adapters/three/world-label-system';

const FLOOR_Y = BACK_AREA.floorY;

// Envelope dimensions
const ENV_WIDTH = 0.32;
const ENV_HEIGHT = 0.03;
const ENV_DEPTH = 0.22;
const ENV_HITPROXY_HEIGHT = 0.14; // thicker invisible proxy for raycasting

// Crate config — relocated into the back-area work furniture cluster (see logistics-layout-data.ts)
const CRATE_POS = { x: -8, z: 12 };
const CRATE_SIZE = { w: 0.8, h: 0.5, d: 0.6 };
const CRATE_ID = 'incoming-envelope-crate';

export class EnvelopeSystem {
  private scene: THREE.Scene;
  private physics: PhysicsSystem;
  private interactables: Map<string, InteractableObject>;
  private enabled: boolean;
  private envelopeQueue: EnvelopeData[] = [];
  envelopeDataMap: Map<string, EnvelopeData> = new Map();
  crateObj!: InteractableObject;
  interiorPlane!: THREE.Mesh;

  /** `enabled` gates this whole system out of the scene (spec "每日貨品清空
   * 核心流程" section 三: envelope work equipment must not appear this
   * round) while keeping the class itself intact for a future round —
   * see feature-flags.ts ENABLE_LEGACY_MAIL_FLOW. */
  constructor(
    scene: THREE.Scene,
    physics: PhysicsSystem,
    interactables: Map<string, InteractableObject>,
    enabled: boolean
  ) {
    this.scene = scene;
    this.physics = physics;
    this.interactables = interactables;
    this.enabled = enabled;
    if (!enabled) return;

    this.envelopeQueue = createAllEnvelopes();
    console.log('Envelope queue created:', this.envelopeQueue.length);

    this.createCrate();
  }

  getEnvelopeData(envelopeId: string): EnvelopeData | undefined {
    return this.envelopeDataMap.get(envelopeId);
  }

  hasEnvelopes(): boolean {
    return this.envelopeQueue.length > 0;
  }

  get remainingCount(): number {
    return this.envelopeQueue.length;
  }

  isPlayerNearCrate(playerPos: THREE.Vector3): boolean {
    if (!this.enabled) return false;
    const cratePos = this.crateObj.mesh.position;
    const dx = playerPos.x - cratePos.x;
    const dz = playerPos.z - cratePos.z;
    return Math.sqrt(dx * dx + dz * dz) < SCENE_CONFIG.interactionDistance;
  }

  isCrate(obj: InteractableObject): boolean {
    return obj.id === CRATE_ID;
  }

  /** Take one envelope from the crate and spawn it in the world */
  takeEnvelope(): InteractableObject | null {
    if (this.envelopeQueue.length === 0) return null;

    const envData = this.envelopeQueue.shift()!;
    this.envelopeDataMap.set(envData.envelopeId, envData);

    // Create envelope mesh
    const geo = new THREE.BoxGeometry(ENV_WIDTH, ENV_HEIGHT, ENV_DEPTH);
    const mat = new THREE.MeshStandardMaterial({ color: 0xFFFACD });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.envelopeId = envData.envelopeId;

    const cratePos = this.crateObj.mesh.position;
    mesh.position.set(cratePos.x, cratePos.y + 1.5, cratePos.z);
    this.scene.add(mesh);

    // Address label on top
    const label = createEnvelopeAddressLabel(envData);
    label.rotation.x = -Math.PI / 2;
    label.position.y = ENV_HEIGHT / 2 + 0.001;
    label.userData.ownerEnvelopeId = envData.envelopeId;
    mesh.add(label);

    // HitProxy — invisible but raycastable volume above envelope
    const proxyGeo = new THREE.BoxGeometry(ENV_WIDTH * 1.25, ENV_HITPROXY_HEIGHT, ENV_DEPTH * 1.25);
    const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.y = ENV_HITPROXY_HEIGHT / 2 - ENV_HEIGHT / 2;
    proxy.userData.ownerEnvelopeId = envData.envelopeId;
    proxy.userData.isHitProxy = true;
    mesh.add(proxy);

    // Create interactable
    const obj = createInteractableObject(envData.envelopeId, `信封：${envData.recipientName}`, mesh, ENV_WIDTH, ENV_HEIGHT, ENV_DEPTH);
    obj.packageData = {
      packageId: envData.envelopeId,
      recipientName: envData.recipientName,
      streetLine: envData.streetLine,
      destinationId: envData.destinationId,
      destinationName: envData.destinationName,
      requiredStampId: envData.requiredStampId,
      isStamped: envData.isStamped,
      appliedStampId: envData.appliedStampId,
      addressLabelMesh: label,
      stampVisualMesh: null,
      overweightLabelMesh: null,
      sizeCategory: 'small',
      weightKg: 0.05,
      maxAllowedWeightKg: 10,
      isOverweight: false,
      hasBeenWeighed: false,
      hasOverweightLabel: false,
    };

    // Physics body (use min collider height for stability)
    const colliderHalfH = Math.max(ENV_HEIGHT / 2, 0.02);
    const { body, collider } = this.physics.createBoxBody(
      cratePos.x, cratePos.y + 1.5, cratePos.z,
      ENV_WIDTH / 2, colliderHalfH, ENV_DEPTH / 2,
      50
    );
    obj.rigidBody = body;
    obj.collider = collider;

    this.interactables.set(envData.envelopeId, obj);
    return obj;
  }

  applyStampToEnvelope(envelopeId: string, stampId: string): void {
    const envData = this.envelopeDataMap.get(envelopeId);
    if (!envData) return;
    envData.isStamped = true;
    envData.appliedStampId = stampId;

    const obj = this.interactables.get(envelopeId);
    if (!obj) return;
    if (obj.packageData) {
      obj.packageData.isStamped = true;
      obj.packageData.appliedStampId = stampId;
    }

    const stampMesh = createEnvelopeStampVisual(stampId);
    stampMesh.rotation.x = -Math.PI / 2;
    stampMesh.position.set(ENV_WIDTH * 0.25, ENV_HEIGHT / 2 + 0.002, -ENV_DEPTH * 0.2);
    stampMesh.userData.ownerEnvelopeId = envelopeId;
    obj.mesh.add(stampMesh);
  }

  private createCrate(): void {
    // Open-top container: root at BOTTOM CENTER, 5 faces visible, top open
    const hw = CRATE_SIZE.w / 2;
    const hd = CRATE_SIZE.d / 2;
    const wt = 0.05; // wall thickness
    const bt = 0.06; // bottom thickness
    const wallH = CRATE_SIZE.h - bt;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B6B4A });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x9E8B6E, side: THREE.DoubleSide });

    // Root mesh (invisible, center origin)
    const rootGeo = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const rootMeshMat = new THREE.MeshBasicMaterial({ visible: false });
    const crateMesh = new THREE.Mesh(rootGeo, rootMeshMat);
    const startY = FLOOR_Y + 0.005; // bottom-origin, just above the back-area floor
    crateMesh.position.set(CRATE_POS.x, startY, CRATE_POS.z);
    crateMesh.userData.crateId = CRATE_ID;
    crateMesh.userData.bottomOrigin = true;
    this.scene.add(crateMesh);

    // Bottom (root is at bottom, so Y starts from 0)
    const bottomGeo = new THREE.BoxGeometry(CRATE_SIZE.w, bt, CRATE_SIZE.d);
    const bottom = new THREE.Mesh(bottomGeo, woodMat);
    bottom.position.y = bt / 2;
    crateMesh.add(bottom);

    // Inner floor
    const innerFloorGeo = new THREE.PlaneGeometry(CRATE_SIZE.w - wt * 2, CRATE_SIZE.d - wt * 2);
    const innerFloor = new THREE.Mesh(innerFloorGeo, innerMat);
    innerFloor.rotation.x = -Math.PI / 2;
    innerFloor.position.y = bt + 0.002;
    crateMesh.add(innerFloor);

    // Four walls
    const wallBaseY = bt + wallH / 2;
    const frontGeo = new THREE.BoxGeometry(CRATE_SIZE.w, wallH, wt);
    const front = new THREE.Mesh(frontGeo, woodMat);
    front.position.set(0, wallBaseY, hd - wt / 2);
    crateMesh.add(front);

    const back = new THREE.Mesh(frontGeo, woodMat);
    back.position.set(0, wallBaseY, -hd + wt / 2);
    crateMesh.add(back);

    const sideGeo = new THREE.BoxGeometry(wt, wallH, CRATE_SIZE.d);
    const leftW = new THREE.Mesh(sideGeo, woodMat);
    leftW.position.set(-hw + wt / 2, wallBaseY, 0);
    crateMesh.add(leftW);

    const rightW = new THREE.Mesh(sideGeo, woodMat);
    rightW.position.set(hw - wt / 2, wallBaseY, 0);
    crateMesh.add(rightW);

    // Interior placement plane (invisible, for E-key placement into crate)
    const planeGeo = new THREE.PlaneGeometry(CRATE_SIZE.w - wt * 2 - 0.02, CRATE_SIZE.d - wt * 2 - 0.02);
    const planeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const interiorPlane = new THREE.Mesh(planeGeo, planeMat);
    interiorPlane.rotation.x = -Math.PI / 2;
    interiorPlane.position.y = bt + 0.04;
    interiorPlane.userData.interiorPlane = true;
    interiorPlane.userData.ownerSortingContainerId = CRATE_ID;
    crateMesh.add(interiorPlane);
    this.interiorPlane = interiorPlane;

    // Label on front face — floating billboard, always faces the player
    const labelMesh = createFloatingLabel(`待整理信封\n剩餘: ${this.envelopeQueue.length} 封`, { width: 0.5 });
    labelMesh.position.set(0, CRATE_SIZE.h * 0.55, CRATE_SIZE.d / 2 + 0.008);
    crateMesh.add(labelMesh);

    // Fake envelopes visual inside (as child)
    const envVisGeo = new THREE.BoxGeometry(0.28, 0.15, 0.18);
    const envVisMat = new THREE.MeshStandardMaterial({ color: 0xFFF8DC });
    const envStack = new THREE.Mesh(envVisGeo, envVisMat);
    envStack.position.y = 0.1;
    crateMesh.add(envStack);

    // Create as interactable (movable)
    const obj = createInteractableObject(CRATE_ID, '待整理信封箱', crateMesh, CRATE_SIZE.w, CRATE_SIZE.h, CRATE_SIZE.d);
    obj.containerBounds = {
      innerWidth: CRATE_SIZE.w - wt * 2,
      innerDepth: CRATE_SIZE.d - wt * 2,
      innerHeight: wallH,
      interiorCenterOffset: new THREE.Vector3(0, bt + wallH / 2, 0),
      tolerance: 0.02,
    };

    // Single Dynamic body at box center; bottom + 4 walls are colliders
    // attached via local offsets so they move together with the container
    // (open top, no separate static colliders left behind at spawn).
    const wt2 = wt / 2;
    const wallHalf = wallH / 2;
    const bodyCenterY = startY + CRATE_SIZE.h / 2;
    const bodyDesc = this.physics.createDynamicBodyDesc(CRATE_POS.x, bodyCenterY, CRATE_POS.z, 800);
    const body = this.physics.createDynamicBody(bodyDesc);
    body.setEnabledRotations(false, true, false, true);
    body.setLinearDamping(1.5);
    body.setAngularDamping(2.0);

    const bottomLocalY = -CRATE_SIZE.h / 2 + bt / 2;
    const wallLocalY = -CRATE_SIZE.h / 2 + bt + wallHalf;
    this.physics.addColliderToBody(body, 0, bottomLocalY, 0, hw, bt / 2, hd); // bottom
    this.physics.addColliderToBody(body, 0, wallLocalY, hd - wt2, hw, wallHalf, wt2); // front
    this.physics.addColliderToBody(body, 0, wallLocalY, -(hd - wt2), hw, wallHalf, wt2); // back
    this.physics.addColliderToBody(body, -(hw - wt2), wallLocalY, 0, wt2, wallHalf, hd); // left
    this.physics.addColliderToBody(body, hw - wt2, wallLocalY, 0, wt2, wallHalf, hd); // right

    obj.rigidBody = body;
    obj.collider = null; // multiple colliders, tracked by body

    this.interactables.set(CRATE_ID, obj);
    this.crateObj = obj;
  }
}
