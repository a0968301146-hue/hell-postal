import * as THREE from 'three';
import { InteractableObject } from '../../shared/types/interactable';

/** "Pickup system 架構整理" round Phase 2 — MailBoxCarryHooks/
 * PalletThrowHooks/HeldItemAccess live in their own file, mirroring
 * PickupPort's own doc comment (../../shared/types/pickup-port.ts): both
 * PickupSystem and PlacementPreview need these types, and PlacementPreview
 * must NOT import PickupSystem itself (that would recreate the exact
 * PickupSystem↔PlacementPreview cycle the HeldItemAccess narrow-interface
 * was designed to avoid — confirmed by `madge --circular` when these were
 * still declared inline in pickup-system.ts). PickupSystem re-exports all
 * three below so every existing external importer (create-game-systems.ts,
 * pallet-system.ts, upgrade-system.ts, packed-mail-bag-system.ts, this
 * folder's own index.ts barrel) keeps working unchanged. */

/** "Remove sealing and add physical mail box contents" round三/十: a narrow,
 * mail-box-specific parallel to this file's own EXISTING generic container
 * carry system (captureContainerContents/restoreContainerContents, built for
 * sortingBoxId/crateId containers) — kept as a SEPARATE hook rather than
 * folded into that system because mail boxes have a stricter requirement the
 * generic one doesn't (spec三: contained envelopes must stay VISIBLE and
 * visually follow the box's own rotation while held), which the generic
 * system's hide-and-track-in-a-side-array approach doesn't provide.
 * Set once via setMailBoxHooks() from create-game-systems.ts (after both
 * PickupSystem and MailBagSystem exist, avoiding a constructor-time circular
 * dependency), then invoked from pickUp()/confirmPlacement()/executeThrow()
 * ALONGSIDE (never replacing) the existing isContainer checks — the two are
 * mutually exclusive since mail boxes never set sortingBoxId/crateId. */
export interface MailBoxCarryHooks {
  isMailBox(obj: InteractableObject): boolean;
  prepareForCarry(obj: InteractableObject): void;
  restoreAfterPlacement(obj: InteractableObject, boxVelocity: THREE.Vector3): void;
  restoreForThrow(obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void;
}

/** "Add placement rotation and pallet cargo straps" round spec三: the same
 * narrow-hook pattern as MailBoxCarryHooks above, for the ONE thing this
 * file's generic executeThrow() can't do on its own — the pallet's own
 * rigid body is PERMANENTLY kinematic (see pallet-system.ts) while
 * parked/carried, which silently ignores the impulse/velocity calls
 * executeThrow() is about to make, so `prepareForThrow` must flip it to a
 * real dynamic body (and, if rope-bound, create the cargo fixed joints)
 * BEFORE that happens. `onThrown` fires right after, once the pallet's own
 * actual post-impulse velocity is known, so bound/just-released cargo can
 * be given a matching starting velocity. Set once via setPalletThrowHooks()
 * from create-game-systems.ts. */
export interface PalletThrowHooks {
  isPallet(obj: InteractableObject): boolean;
  /** "Fix cargo placement on pallet surface" round spec五: an already
   * rope-bound pallet must refuse any NEW cargo placed on it (bound cargo's
   * relative arrangement is the whole point of the rope) until the player
   * unbinds it again — checked once per placement-preview frame so
   * updatePlacementPreview can short-circuit straight to invalid+the
   * dedicated toast, without needing its own isRopeBound-shaped field. */
  isPalletRopeBound(obj: InteractableObject): boolean;
  prepareForThrow(obj: InteractableObject): void;
  onThrown(obj: InteractableObject, linearVelocity: THREE.Vector3, angularVelocity: THREE.Vector3): void;
}

/** "Pickup system 架構整理" round Phase 2 — the narrow contract
 * PlacementPreview (and PickupSystem's own placeIntoContainer, which stays
 * core but still needs to cancel an in-progress charge) use to reach back
 * into PickupSystem's own core held-item state, WITHOUT depending on
 * PickupSystem itself (spec: "不要讓PlacementPreview直接依賴整個
 * PickupSystem...請使用明確參數或窄介面"). Same shape/spirit as
 * MailBoxCarryHooks/PalletThrowHooks above — a small structural interface
 * PickupSystem implements, passed to a sibling module rather than that
 * module importing PickupSystem's own (much larger) type. */
export interface HeldItemAccess {
  getActiveHeldItem(): InteractableObject | null;
  releaseTopHeldItem(): void;
  getMailBoxHooks(): MailBoxCarryHooks | null;
  getPalletThrowHooks(): PalletThrowHooks | null;
}
