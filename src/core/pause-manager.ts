// Centralized pause-reason management (spec section 三). Multiple systems
// can each have their own reason to want the game paused at the same time
// (the manual, a settlement panel, a minigame) — a single boolean would let
// whichever one closes last incorrectly resume the game out from under the
// others. A Set of independent reasons means closing one UI only clears its
// own reason; the game only actually resumes once the set is empty.

export type PauseReason = 'manual' | 'settlement' | 'stampMinigame';

export class PauseManager {
  private reasons: Set<PauseReason> = new Set();
  private listeners: Set<(isPaused: boolean) => void> = new Set();

  get isPaused(): boolean {
    return this.reasons.size > 0;
  }

  has(reason: PauseReason): boolean {
    return this.reasons.has(reason);
  }

  add(reason: PauseReason): void {
    const wasPaused = this.isPaused;
    this.reasons.add(reason);
    if (!wasPaused) this.notify();
  }

  remove(reason: PauseReason): void {
    const wasPaused = this.isPaused;
    this.reasons.delete(reason);
    if (wasPaused && !this.isPaused) this.notify();
  }

  /** Fires only on the isPaused boolean actually flipping (not on every
   * add/remove of an individual reason), so listeners don't need to
   * re-derive "is anything still pausing us" themselves. */
  onChange(listener: (isPaused: boolean) => void): void {
    this.listeners.add(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.isPaused);
  }
}
