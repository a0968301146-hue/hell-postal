import * as THREE from 'three';
import { InteractableObject, createInteractableObject } from './interactable-object';
import { PhysicsSystem } from './physics-system';
import { createPackageData, createAddressLabel } from './package-data';

export const ROOM_WIDTH = 15;
export const ROOM_DEPTH = 15;
export const ROOM_HEIGHT = 8;

export const SCENE_CONFIG = {
  roomWidth: ROOM_WIDTH,
  roomDepth: ROOM_DEPTH,
  wallHeight: ROOM_HEIGHT,
  groundY: 0,
  playerEyeHeight: 1.6,
  playerSpeed: 7,
  sprintMultiplier: 1.5,
  jumpHeight: 0.5,
  gravity: 9.81,
  interactionDistance: 3,
  deltaTimeMax: 0.1,
  maxChargeTime: 2.0,
  minThrowImpulse: 3,
  maxThrowImpulse: 12,
};

export interface SceneData {
  interactables: Map<string, InteractableObject>;
  floor: THREE.Mesh;
}

export function createTestScene(scene: THREE.Scene, physics: PhysicsSystem): SceneData {
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = ROOM_DEPTH / 2;
  const wallHeight = ROOM_HEIGHT;

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = SCENE_CONFIG.groundY;
  scene.add(floor);

  // Walls
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.DoubleSide });

  const backWallGeo = new THREE.PlaneGeometry(ROOM_WIDTH, wallHeight);
  const backWall = new THREE.Mesh(backWallGeo, wallMaterial);
  backWall.position.set(0, wallHeight / 2, -halfDepth);
  scene.add(backWall);

  const frontWall = new THREE.Mesh(backWallGeo, wallMaterial);
  frontWall.position.set(0, wallHeight / 2, halfDepth);
  frontWall.rotation.y = Math.PI;
  scene.add(frontWall);

  const sideWallGeo = new THREE.PlaneGeometry(ROOM_DEPTH, wallHeight);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMaterial);
  leftWall.position.set(-halfWidth, wallHeight / 2, 0);
  leftWall.rotation.y = Math.PI / 2;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeo, wallMaterial);
  rightWall.position.set(halfWidth, wallHeight / 2, 0);
  rightWall.rotation.y = -Math.PI / 2;
  scene.add(rightWall);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(3, 6, 4);
  scene.add(dirLight);

  // Create boxes
  const interactables = new Map<string, InteractableObject>();

  const addBox = (id: string, name: string, w: number, h: number, d: number, color: number, x: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    const y = h / 2 + 0.01; // slightly above ground
    mesh.position.set(x, y, z);
    scene.add(mesh);

    const obj = createInteractableObject(id, name, mesh, w, h, d);

    // Create physics body
    const density = 200 + Math.max(w, h, d) * 300; // larger = heavier
    const { body, collider } = physics.createBoxBody(x, y, z, w / 2, h / 2, d / 2, density);
    obj.rigidBody = body;
    obj.collider = collider;

    // Package data with address label
    const pkgData = createPackageData(id, w, h, d);
    obj.packageData = pkgData;
    const label = createAddressLabel(pkgData, w, d);
    label.position.y = h / 2 + 0.001;
    mesh.add(label);
    pkgData.addressLabelMesh = label;

    interactables.set(id, obj);
  };

  // 9 boxes - positioned to avoid stamp table (Z=-6) and shelves (side walls)
  addBox('parcel-small', '小型包裹', 0.3, 0.3, 0.3, 0x8B4513, -1, -2);
  addBox('parcel-long', '長型包裹', 0.2, 0.2, 0.8, 0x654321, 2, -1);
  addBox('mailbox-medium', '中型郵件箱', 0.5, 0.5, 0.4, 0xDAA520, 0, 2);
  addBox('box-small', '小型紙箱', 0.35, 0.35, 0.35, 0xA0522D, -2, 1);
  addBox('box-medium', '中型紙箱', 0.6, 0.6, 0.5, 0xCD853F, 3, 1);
  addBox('parcel-long-2', '長型包裹 B', 0.25, 0.25, 0.9, 0x8B6914, 1, 4);
  addBox('box-large-1', '大型箱子 A', 1.0, 1.0, 1.0, 0x5F9EA0, -3, 4);
  addBox('box-large-2', '大型箱子 B', 1.1, 0.9, 1.0, 0x708090, 3, 5);
  addBox('box-large-3', '大型箱子 C', 0.9, 1.1, 1.0, 0x6B8E23, 0, 6);

  return { interactables, floor };
}
