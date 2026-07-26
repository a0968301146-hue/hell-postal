import * as THREE from 'three';
import {
  STORAGE_KEYS, SettingsState, ProgressState, DisplayMode, ResolutionPreset, QualityPreset,
  createDefaultSettings, createDefaultProgress,
} from './settings-data';
import { InputBindingManager } from '../adapters/browser-input/input-binding-manager';
import { TutorialEventKey, TUTORIAL_ENTRIES } from './tutorial-data';

function mergeSettings(saved: Partial<SettingsState> | null): SettingsState {
  const base = createDefaultSettings();
  if (!saved) return base;
  return {
    mouse: { ...base.mouse, ...saved.mouse },
    display: { ...base.display, ...saved.display },
    audio: { ...base.audio, ...saved.audio },
    text: { ...base.text, ...saved.text },
    data: { ...base.data, ...saved.data },
    keyBindings: { ...base.keyBindings, ...saved.keyBindings },
  };
}

function mergeProgress(saved: Partial<ProgressState> | null): ProgressState {
  const base = createDefaultProgress();
  if (!saved) return base;
  return {
    score: typeof saved.score === 'number' ? saved.score : base.score,
    discoveredVehicles: Array.isArray(saved.discoveredVehicles) ? saved.discoveredVehicles : base.discoveredVehicles,
    unlockedTutorials: Array.isArray(saved.unlockedTutorials) ? saved.unlockedTutorials : base.unlockedTutorials,
    discoveredSpecies: Array.isArray(saved.discoveredSpecies) ? saved.discoveredSpecies : base.discoveredSpecies,
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Owns the ONE copy of settings + progress data (spec: "不要複製兩套互不相容
 * 的設定資料"), loads it from localStorage on construction, and applies the
 * "live" categories (mouse handled by PlayerController reading .settings
 * directly each frame; display/text are applied here since this class holds
 * the camera/renderer references and DOM body class). Persistence:
 * setters call `maybeAutoSave()`, which only writes to localStorage when
 * data.autoSave is on — the manual "立即儲存" button (data page) always
 * calls save() regardless of that flag.
 */
export class SettingsManager {
  settings: SettingsState;
  progress: ProgressState;
  inputBindings: InputBindingManager;

  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  constructor(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.camera = camera;
    this.renderer = renderer;

    this.settings = mergeSettings(readJson<SettingsState>(STORAGE_KEYS.settings));
    this.progress = mergeProgress(readJson<ProgressState>(STORAGE_KEYS.progress));
    this.inputBindings = new InputBindingManager(this.settings.keyBindings);

    // Renderer needs a tone-mapping mode other than the three.js default
    // (NoToneMapping) for toneMappingExposure to have any visible effect —
    // Linear keeps the brightness slider's effect simple/predictable
    // (straight multiply) rather than ACES's filmic color-shifting curve.
    this.renderer.toneMapping = THREE.LinearToneMapping;

    this.applyDisplayAll();
    this.applyTextClass();
  }

  // ---- persistence ----

  private maybeAutoSave(): void {
    if (this.settings.data.autoSave) this.save();
  }

  /** Always writes, regardless of autoSave — used by the manual "立即儲存"
   * (spec十一): settings + score + discoveredVehicles + unlockedTutorials +
   * discoveredSpecies. Deliberately does NOT attempt to save per-cargo
   * positions, NPC queue state, vehicle animation progress or rigid-body
   * velocities — none of that is tracked here (see completion report). */
  save(): void {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(this.progress));
  }

  // ---- mouse ----

  setMouseSensitivity(v: number): void {
    this.settings.mouse.sensitivity = v;
    this.maybeAutoSave();
  }

  setInvertY(v: boolean): void {
    this.settings.mouse.invertY = v;
    this.maybeAutoSave();
  }

  // ---- key bindings ----

  /** Persists the current InputBindingManager state into settings.keyBindings. */
  syncKeyBindings(): void {
    this.settings.keyBindings = this.inputBindings.getAll();
    this.maybeAutoSave();
  }

  // ---- display ----

  private applyDisplayAll(): void {
    this.applyFov();
    this.applyBrightness();
    this.applyQuality();
    this.applyResolution();
  }

  private applyFov(): void {
    this.camera.fov = this.settings.display.fov;
    this.camera.updateProjectionMatrix();
  }

  setFov(v: number): void {
    this.settings.display.fov = v;
    this.applyFov();
    this.maybeAutoSave();
  }

  private applyBrightness(): void {
    // 0-100 slider -> 0-2 exposure, 50 -> 1.0 (unchanged from default look).
    this.renderer.toneMappingExposure = this.settings.display.brightness / 50;
  }

  setBrightness(v: number): void {
    this.settings.display.brightness = v;
    this.applyBrightness();
    this.maybeAutoSave();
  }

  private applyQuality(): void {
    const preset: QualityPreset = this.settings.display.quality;
    const cap = preset === 'low' ? 1 : preset === 'medium' ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio;
    this.renderer.setPixelRatio(cap);
  }

  setQuality(preset: QualityPreset): void {
    this.settings.display.quality = preset;
    this.applyQuality();
    this.maybeAutoSave();
  }

  /** Web-prototype limitation (spec 八): a browser tab can't be resized by
   * the page itself, so "resolution" here means the renderer's INTERNAL
   * drawing-buffer size (rendered at a fixed pixel size via
   * `renderer.setSize(w, h, false)`, `updateStyle=false` so the canvas's
   * CSS box stays 100%/100% and is stretched/letterboxed to fill whatever
   * the actual browser window is) — not the real window/tab dimensions. */
  private applyResolution(): void {
    const preset: ResolutionPreset = this.settings.display.resolution;
    if (preset === 'native') {
      this.renderer.setSize(window.innerWidth, window.innerHeight, true);
      this.camera.aspect = window.innerWidth / window.innerHeight;
    } else {
      const [w, h] = preset.split('x').map(Number);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    this.camera.updateProjectionMatrix();
  }

  setResolution(preset: ResolutionPreset): void {
    this.settings.display.resolution = preset;
    this.applyResolution();
    this.maybeAutoSave();
  }

  /** Call from the window 'resize' handler — re-applies native sizing only
   * if that's the active preset; fixed presets intentionally ignore window
   * resizes (their internal buffer size is fixed by design). */
  onWindowResize(): void {
    if (this.settings.display.resolution === 'native') this.applyResolution();
  }

  /** Returns a user-facing message on failure (spec: "顯示非阻塞式文字提示"),
   * null on success — the caller (ManualUI) owns how to display it. */
  async setDisplayMode(mode: DisplayMode): Promise<string | null> {
    try {
      if (mode === 'fullscreen') {
        if (!document.fullscreenEnabled) return '此瀏覽器不支援全螢幕';
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      this.settings.display.displayMode = mode;
      this.maybeAutoSave();
      return null;
    } catch {
      return '瀏覽器拒絕了全螢幕請求';
    }
  }

  // ---- audio (data-only this round — no audio system exists yet) ----

  setVolume(channel: keyof SettingsState['audio'], v: number): void {
    this.settings.audio[channel] = v;
    this.maybeAutoSave();
  }

  // ---- text ----

  private applyTextClass(): void {
    document.body.classList.remove('text-size-small', 'text-size-medium', 'text-size-large');
    document.body.classList.add(`text-size-${this.settings.text.subtitleSize}`);
  }

  setSubtitleSize(size: SettingsState['text']['subtitleSize']): void {
    this.settings.text.subtitleSize = size;
    this.applyTextClass();
    this.maybeAutoSave();
  }

  /** Stored + available for a future dialogue system (spec 十). Nothing in
   * this prototype currently renders text with a typewriter/reveal effect
   * for this to drive, so changing it has no visible effect yet — see
   * completion report. */
  setTextSpeed(speed: SettingsState['text']['textSpeed']): void {
    this.settings.text.textSpeed = speed;
    this.maybeAutoSave();
  }

  // ---- data ----

  setAutoSave(v: boolean): void {
    this.settings.data.autoSave = v;
    // Saving here (regardless of the new value) matches "設定變更後自動保存"
    // for every OTHER toggle; flipping autoSave itself is the one settings
    // change that should always persist immediately so the choice sticks.
    this.save();
  }

  // ---- progress ----

  addScore(points: number): void {
    this.progress.score += points;
    this.maybeAutoSave();
  }

  markVehicleDiscovered(id: string): void {
    if (this.progress.discoveredVehicles.includes(id)) return;
    this.progress.discoveredVehicles.push(id);
    this.maybeAutoSave();
  }

  isVehicleDiscovered(id: string): boolean {
    return this.progress.discoveredVehicles.includes(id);
  }

  fireTutorialEvent(key: TutorialEventKey): void {
    // Multiple tutorial entries could in principle share an event key; mark
    // all matching, de-duplicated against what's already unlocked.
    let changed = false;
    for (const entry of TUTORIAL_ENTRIES) {
      if (entry.unlockEvent === key && !this.progress.unlockedTutorials.includes(entry.id)) {
        this.progress.unlockedTutorials.push(entry.id);
        changed = true;
      }
    }
    if (changed) this.maybeAutoSave();
  }

  isTutorialUnlocked(id: string): boolean {
    return this.progress.unlockedTutorials.includes(id);
  }
}
