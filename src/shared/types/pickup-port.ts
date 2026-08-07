import * as THREE from 'three';

/** Minimal neutral contract for "the one thing that owns pickup/placement"
 * (Phase 6: 模組邊界修正). Other systems depend on this narrow interface
 * instead of importing PickupSystem (systems/interaction) directly — that
 * would need to go through systems/interaction's own index.ts, which
 * re-exports InteractionSystem, which itself depends on VehicleControlSystem
 * and LostFoundSystem to dispatch E-key actions; importing PickupSystem
 * through the same barrel would create a file-level circular import.
 *
 * Only lists the methods actually called from outside systems/interaction
 * today — VehicleControlSystem registers/deregisters a docked vehicle's
 * cargo bed as a placement surface, LostFoundSystem force-drops a held item
 * on hand-over or day reset. PickupSystem implements this interface; the
 * SAME instance is injected everywhere (see app/create-game-systems.ts). */
export interface PickupPort {
  /** Registers a surface items can be placed onto (e.g. a docked vehicle's
   * cargo bed) while it exists. */
  addPlacementSurface(surface: THREE.Object3D): void;
  /** Deregisters a surface previously passed to addPlacementSurface. */
  removePlacementSurface(surface: THREE.Object3D): void;
  /** Forces whatever's currently held out of the player's hands without
   * placing it (the object stays wherever it was left — still invisible/
   * physics-disabled — it's the caller's job to dispose or restore it). */
  forceDropHeld(): void;
  /** "失物招領系統修改" round — swaps the currently-held VIEWMODEL clone's
   * geometry/material to match its (already-updated) world mesh, e.g. right
   * after an in-place model swap while the item is still held. No-op if
   * `id` isn't anywhere in the current held stack. */
  refreshHeldViewMesh(id: string): void;
}
