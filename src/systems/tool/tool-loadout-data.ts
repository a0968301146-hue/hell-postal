import { ActiveTool } from '../../core/game-state';
import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';

/** "Add ladder tool station and envelope vacuum" round三 — the swappable
 * subset of ActiveTool. Slot 1 ('empty') is permanently fixed and never
 * part of a loadout; slots 2-4 hold exactly one ConfigurableTool each,
 * picked from this pool at the tool cart (spec三: "玩家同時只能攜帶其中3種
 * 工具，剩餘工具留在推車"). */
export type ConfigurableTool = 'powerGloves' | 'cargoHook' | 'sprayCan' | 'envelopeVacuum';

export const ALL_CONFIGURABLE_TOOLS: ConfigurableTool[] = ['powerGloves', 'cargoHook', 'sprayCan', 'envelopeVacuum'];

export const TOOL_DEFINITIONS: Record<ActiveTool, { icon: string; displayName: string }> = {
  empty: { icon: '✋', displayName: '徒手' },
  powerGloves: { icon: '🧤', displayName: '力量手套' },
  cargoHook: { icon: '🪝', displayName: '捕貨鉤' },
  sprayCan: { icon: '🎨', displayName: '噴漆罐' },
  envelopeVacuum: { icon: '🌪️', displayName: '信封吸塵器' },
};

/** Current default configuration (spec三: "預設配置保持目前狀態") — the
 * pre-existing three tools stay equipped exactly as before this round;
 * envelopeVacuum starts left behind at the tool cart. */
export const DEFAULT_TOOL_LOADOUT: [ConfigurableTool, ConfigurableTool, ConfigurableTool] = ['powerGloves', 'cargoHook', 'sprayCan'];

/** Independent localStorage key (spec: "使用獨立localStorage") — never
 * touched by the upgrade-save reset flow or any other system's own key. */
const TOOL_LOADOUT_STORAGE_KEY = 'hp_tool_loadout_v1';

function isValidLoadout(value: unknown): value is [ConfigurableTool, ConfigurableTool, ConfigurableTool] {
  if (!Array.isArray(value) || value.length !== 3) return false;
  if (!value.every((t) => ALL_CONFIGURABLE_TOOLS.includes(t))) return false;
  return new Set(value).size === 3; // spec: "不允許相同工具重複放入多格"
}

/** Reads the saved loadout, falling back to DEFAULT_TOOL_LOADOUT whenever
 * the save is missing or corrupt (spec: "存檔缺少或損壞時回到預設配置") —
 * mirrors settings-manager.ts's own field-by-field-fallback convention. */
export function loadToolLoadout(): [ConfigurableTool, ConfigurableTool, ConfigurableTool] {
  const storage = new LocalStorageAdapter();
  const saved = storage.getJSON<unknown>(TOOL_LOADOUT_STORAGE_KEY);
  if (isValidLoadout(saved)) return saved;
  return [...DEFAULT_TOOL_LOADOUT];
}

export function saveToolLoadout(loadout: [ConfigurableTool, ConfigurableTool, ConfigurableTool]): void {
  const storage = new LocalStorageAdapter();
  storage.setJSON(TOOL_LOADOUT_STORAGE_KEY, loadout);
}
