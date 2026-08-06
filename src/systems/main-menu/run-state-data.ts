import { LocalStorageAdapter } from '../../adapters/local-storage/local-storage-adapter';

/** "Add main menu and return player after dock story" round 四: the ONE
 * lightweight signal MainMenuSystem's own "繼續遊戲" button needs to know
 * (a) whether there is anything to continue at all, and (b) which day to
 * resume at. Deliberately NOT a second full save system — every OTHER piece
 * of real progress (skill levels, available settlement score, day-1 story
 * completion) already persists itself independently via its own owning
 * system's own localStorage key (UpgradeSystem/hp_manual_upgrades_v2,
 * AfterWorkStorySystem/hp_after_work_story_v1) and is restored automatically
 * on construction regardless of this key. Per-cargo positions, NPC queue
 * state, and vehicle animation progress are NEVER captured here (spec:
 * "不儲存大型Mesh或物理資料到此key") — same intentional limitation
 * settings-manager.ts's own SettingsManager.save() doc comment already
 * documents for the same reason. */
export interface RunState {
  hasActiveRun: boolean;
  currentDay: number;
  runId: string;
  lastSavedAt: number;
}

const RUN_STATE_STORAGE_KEY = 'hp_run_state_v1';

function isValidRunState(value: unknown): value is RunState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hasActiveRun === 'boolean' &&
    typeof v.currentDay === 'number' && v.currentDay >= 1 &&
    typeof v.runId === 'string' &&
    typeof v.lastSavedAt === 'number'
  );
}

/** Returns null whenever there is genuinely nothing to continue (never
 * played, or a corrupt/missing save) — MainMenuSystem reads this directly to
 * decide whether "繼續遊戲" is enabled at all (spec: "若沒有可繼續的存檔：
 * 繼續遊戲顯示為停用狀態"). */
export function loadRunState(): RunState | null {
  const storage = new LocalStorageAdapter();
  const saved = storage.getJSON<unknown>(RUN_STATE_STORAGE_KEY);
  if (!isValidRunState(saved) || !saved.hasActiveRun) return null;
  return saved;
}

export function saveRunState(state: RunState): void {
  const storage = new LocalStorageAdapter();
  storage.setJSON(RUN_STATE_STORAGE_KEY, state);
}

/** A fresh run id — timestamp+random is more than sufficient uniqueness for
 * a single-player local save, no need for a real UUID library dependency. */
export function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
