/** Common shape every gameplay system may optionally implement — game-loop.ts
 * calls `update` each frame (skipped while paused) and app/game-app.ts calls
 * `dispose` on shutdown. Both are optional since many systems are pure event
 * responders with no per-frame work, or own no disposable resources. */
export interface SystemLifecycle {
  update?(deltaTime: number): void;
  dispose?(): void;
}
