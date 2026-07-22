import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PackageData } from './package-data';

export type PlayerInteractionState = 'empty-handed' | 'holding-item' | 'placement-preview' | 'stamping-minigame' | 'vehicle-settlement' | 'pushing-dolly';

export interface PlayerInteractionData {
  state: PlayerInteractionState;
  heldObjectId: string | null;
  targetedObjectId: string | null;
}

/** Describes the interior volume of a movable container, for content capture/restore. */
export interface ContainerBounds {
  /** Interior usable width along local X. */
  innerWidth: number;
  /** Interior usable depth along local Z. */
  innerDepth: number;
  /** Interior usable height along local Y. */
  innerHeight: number;
  /** Local-space offset from the container mesh root to the center of the interior volume. */
  interiorCenterOffset: THREE.Vector3;
  /** Safety margin (meters) used when detecting/clamping contents inside this container. */
  tolerance: number;
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
  containerBounds: ContainerBounds | null;
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
    containerBounds: null,
  };
}

export function createPlayerInteractionData(): PlayerInteractionData {
  return {
    state: 'empty-handed',
    heldObjectId: null,
    targetedObjectId: null,
  };
}
