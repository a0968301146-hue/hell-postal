/** Minimal neutral contract for "the thing that can register a static
 * collider" (Phase 7: 解除最後一個循環依賴). WorldLayoutSystem depends on
 * this narrow interface instead of importing the concrete PhysicsSystem
 * class from adapters/rapier — adapters must never import FROM systems
 * (PhysicsSystem previously imported PLAYER_SPAWN from systems/world-layout
 * to build the player capsule, which combined with world-layout-system.ts's
 * own import of PhysicsSystem to create a file-level circular import; see
 * app/game-context.ts for the fix on that side — player spawn position is
 * now passed into PhysicsSystem.init() as a parameter instead), but systems
 * calling INTO an adapter for physical operations is the allowed direction
 * — doing it through a port keeps that direction honest and swappable.
 *
 * Only lists the one method world-layout-system.ts actually calls today —
 * every wall/floor collider it builds is a static cuboid. PhysicsSystem
 * implements this interface; the same instance is injected everywhere (see
 * app/game-context.ts's createLogisticsScene call). */
export interface PhysicsWorldPort {
  /** Registers a fixed (non-moving) box collider at the given world
   * position and half-extents. */
  createStaticCuboid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void;
}
