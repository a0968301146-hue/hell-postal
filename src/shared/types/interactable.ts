import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PackageData } from '../../game/package-data';

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

/** The shared "anything the player can pick up/place/throw" primitive — read
 * and mutated by many systems (cargo, pallet, vehicle, lost-found, legacy
 * envelope/counter flows). Lives in shared/types rather than any one system
 * since no single system owns it. */
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
  // "貨物勾勾修改" round — a generic reverse-lookup tag, mirroring
  // CargoSystem's own `mesh.userData.cargoId` convention but for EVERY
  // interactable (cargo, envelopes, lost-found items, pallets, mail bags,
  // ...), not just cargo. Lets a raycast hit anywhere in this mesh's own
  // subtree resolve back to `id` via a simple parent walk, without needing
  // a per-category resolver (CargoSystem.resolveCargoFromObject only ever
  // finds cargo). Purely additive — nothing currently reads this field, so
  // it changes no existing behavior; CargoHookSystem is the first reader.
  mesh.userData.interactableId = id;
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
