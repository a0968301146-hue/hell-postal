// Centralized settings data shapes + localStorage keys + defaults, per spec
// section 十四 ("不要複製兩套互不相容的設定資料" / "localStorage key 使用集中常數").
// This file is pure data/types — SettingsManager (settings-manager.ts) owns
// the runtime instance, persistence and "apply to the live game" logic.

export const STORAGE_KEYS = {
  settings: 'hp_manual_settings_v1',
  progress: 'hp_manual_progress_v1',
} as const;

export const CURRENT_GAME_VERSION = 'v0.1.0';

export interface MouseSettings {
  sensitivity: number; // 0.2–3.0 multiplier, 1.0 = current default feel
  invertY: boolean;
}

export type DisplayMode = 'fullscreen' | 'windowed';
export type ResolutionPreset = 'native' | '1920x1080' | '1280x720';
export type QualityPreset = 'low' | 'medium' | 'high';

export interface DisplaySettings {
  displayMode: DisplayMode;
  resolution: ResolutionPreset;
  quality: QualityPreset;
  /** 0–100, mapped to renderer.toneMappingExposure. */
  brightness: number;
  /** Vertical FOV in degrees, matches THREE.PerspectiveCamera.fov. */
  fov: number;
}

export interface AudioSettings {
  master: number; // 0-100
  sfx: number;
  ambient: number;
  music: number;
}

export type SubtitleSize = 'small' | 'medium' | 'large';
export type TextSpeed = 'slow' | 'standard' | 'fast' | 'instant';

export interface TextSettings {
  subtitleSize: SubtitleSize;
  textSpeed: TextSpeed;
}

export interface DataSettings {
  language: 'zh-TW';
  autoSave: boolean;
}

export interface SettingsState {
  mouse: MouseSettings;
  display: DisplaySettings;
  audio: AudioSettings;
  text: TextSettings;
  data: DataSettings;
  /** Action -> KeyboardEvent.code. See input-binding-manager.ts. */
  keyBindings: Record<string, string>;
}

export function createDefaultSettings(): SettingsState {
  return {
    mouse: { sensitivity: 1.0, invertY: false },
    display: { displayMode: 'windowed', resolution: 'native', quality: 'high', brightness: 50, fov: 75 },
    audio: { master: 80, sfx: 80, ambient: 80, music: 60 },
    text: { subtitleSize: 'medium', textSpeed: 'standard' },
    data: { language: 'zh-TW', autoSave: true },
    keyBindings: {},
  };
}

/** Progress-side persisted data — separate from settings because it grows
 * from gameplay events, not a settings-page form. Kept in its own
 * localStorage key (STORAGE_KEYS.progress) so clearing settings doesn't
 * wipe unlock progress and vice versa. */
export interface ProgressState {
  score: number;
  discoveredVehicles: string[];
  unlockedTutorials: string[];
  discoveredSpecies: string[];
}

export function createDefaultProgress(): ProgressState {
  return {
    score: 0,
    discoveredVehicles: [],
    unlockedTutorials: [],
    discoveredSpecies: [],
  };
}
