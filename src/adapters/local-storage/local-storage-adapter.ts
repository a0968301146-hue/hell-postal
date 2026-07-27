/** Thin, typed wrapper around the browser's localStorage — the ONE place
 * `window.localStorage` may be touched directly. Systems (settings, in the
 * future scoring/progress persistence) read/write through this instead of
 * calling localStorage themselves, so a future Unity port only needs to
 * swap this one adapter for a Unity Save System implementation (spec六).
 * Never changes key names or serialization format on its own — callers own
 * both, exactly as before this refactor (spec: "保留現有localStorage key"). */
export class LocalStorageAdapter {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage unavailable/full — silently no-op, matching this
      // prototype's existing tolerance for a non-persistent session.
    }
  }

  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  getJSON<T>(key: string): T | null {
    const raw = this.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setJSON<T>(key: string, value: T): void {
    this.setItem(key, JSON.stringify(value));
  }
}
