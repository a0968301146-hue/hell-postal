import * as THREE from 'three';
import { InteractableObject } from './interactable-object';
import { PhysicsSystem } from './physics-system';

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

export function createTestScene(scene: THREE.Scene, _physics: PhysicsSystem): SceneData {
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

  // No test packages are spawned here anymore (removed with the old prototype
  // room). Kept as an empty map — envelope/sorting-box/stamp-station systems
  // populate `interactables` themselves after this scene is built.
  const interactables = new Map<string, InteractableObject>();

  return { interactables, floor };
}
