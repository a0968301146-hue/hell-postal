/** Generic "remember how to undo this" bag — collects DOM listener removals,
 * GameEventBus unsubscribes, or any other zero-arg cleanup callback, and
 * runs them all (in reverse registration order) exactly once from
 * app/game-app.ts's own dispose(). Satisfies spec十's "每個事件監聽都必須可
 * dispose" for anything registered through it. */
export class DisposeManager {
  private cleanups: (() => void)[] = [];
  private disposed = false;

  /** Registers a cleanup callback and returns it unchanged, so call sites can
   * still hold their own reference if they need to unregister early. */
  add(cleanup: () => void): () => void {
    this.cleanups.push(cleanup);
    return cleanup;
  }

  /** Convenience wrapper for the common `addEventListener` case — registers
   * the listener and returns a bound `removeEventListener` cleanup. */
  addEventListener<K extends keyof WindowEventMap>(
    target: Window | Document | HTMLElement,
    type: K | string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.cleanups.length - 1; i >= 0; i--) this.cleanups[i]();
    this.cleanups = [];
  }
}
