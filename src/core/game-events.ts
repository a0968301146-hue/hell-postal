/** Payloads for the cross-system day-lifecycle events — the ONLY things that
 * flow through the shared bus (spec: "只有跨多個系統的生命週期事件才使用
 * typed events，不要把所有操作都丟進Event Bus"). Everything narrower stays a
 * direct public-method call between the two systems involved (e.g.
 * `vehicleSystem.callVehicles()`), not an event. */
export interface GameEventMap {
  dayStarted: { day: number };
  unloadingStarted: undefined;
  unloadingCompleted: { cargoIds: string[] };
  vehiclesCalled: undefined;
  vehiclesDeparted: undefined;
  dailyShippingCompleted: undefined;
  lostFoundStarted: undefined;
  lostFoundCompleted: undefined;
  dayCompleted: { day: number };
}

export type GameEventName = keyof GameEventMap;
type Listener<K extends GameEventName> = (payload: GameEventMap[K]) => void;

/** Minimal typed pub/sub for the events above. Every `on()` call returns an
 * unsubscribe function so callers can register it with DisposeManager
 * (spec十: "每個事件監聽都必須可dispose"). Deliberately has no wildcard/"any
 * event" subscription and no event other than the ones in GameEventMap, so
 * it can't grow into an untraceable message dump. */
export class GameEventBus {
  private listeners = new Map<GameEventName, Set<Listener<GameEventName>>>();

  on<K extends GameEventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<GameEventName>);
    return () => set!.delete(listener as Listener<GameEventName>);
  }

  emit<K extends GameEventName>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) listener(payload);
  }

  /** Drops every registered listener — called once from app/game-app.ts's
   * dispose(). */
  dispose(): void {
    this.listeners.clear();
  }
}
