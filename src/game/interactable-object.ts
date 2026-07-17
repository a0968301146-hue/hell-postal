import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PackageData } from './package-data';

export type PlayerInteractionState = 'empty-handed' | 'holding-item' | 'placement-preview' | 'stamping-minigame';

export interface PlayerInteractionData {
  state: PlayerInteractionState;
  heldObjectId: string | null;
  targetedObjectId: string | null;
}

export interface InteractableObject {
  id: string;
  displayName: string;
  mesh: THREE.Mesh;
  canPickUp: boolean;
  isHeld: boolean;
  originalParent: THREE.Object3D | null;
  originalMaterial: THREE.MeshStandardMaterial;
  rigidBody: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  width: number;
  height: number;
  depth: number;
  packageData: PackageData | null;
}

export function createInteractableObject(
  id: string,
  displayName: string,
  mesh: THREE.Mesh,
  width: number,
  height: number,
  depth: number
): InteractableObject {
  return {
    id,
    displayName,
    mesh,
    canPickUp: true,
    isHeld: false,
    originalParent: null,
    originalMaterial: mesh.material as THREE.MeshStandardMaterial,
    rigidBody: null,
    collider: null,
    width,
    height,
    depth,
    packageData: null,
  };
}

export function createPlayerInteractionData(): PlayerInteractionData {
  return {
    state: 'empty-handed',
    heldObjectId: null,
    targetedObjectId: null,
  };
}
