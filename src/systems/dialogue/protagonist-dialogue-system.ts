import { SettingsManager, TextSpeed } from '../settings';
import {
  createProtagonistDialogueUi, showProtagonistDialogueText, hideProtagonistDialogueUi,
  ProtagonistDialogueUiHandle,
} from './protagonist-dialogue-ui';

/** Per-CJK-character reveal interval — same mapping/values as
 * after-work-story-system.ts's own private CHAR_INTERVAL_MS (kept as an
 * independent copy here rather than exported/shared from that file: sharing
 * would mean modifying after-work-story-system.ts's own internals beyond the
 * bounded dispatch change this round already makes there, for a 4-entry
 * constant table — a small, deliberate, low-risk duplication rather than a
 * bigger footprint change). 'standard' matches spec五's own "每個中文字約
 * 35ms" baseline. */
const CHAR_INTERVAL_MS: Record<TextSpeed, number> = { slow: 55, standard: 35, fast: 18, instant: 0 };

/**
 * "男主角台詞系統" round — generic "the protagonist says a line" engine,
 * reusable by ANY system (special-NPC story sequences via
 * AfterWorkStorySystem, future environment/prop-object interactions), NOT
 * owned by AfterWorkStorySystem (spec: "這套系統不能綁死在
 * AfterWorkStorySystem"). Renders into the screen-space bottom subtitle bar
 * (protagonist-dialogue-ui.ts) — never the 3D NPC head-bubble
 * (after-work-story-bubble-ui.ts, entirely untouched by this round).
 *
 * Owns its own document keydown listener, guarded by `isActive`, so any
 * caller can invoke say() without separately wiring input of its own —
 * EXCEPT when driven from inside AfterWorkStorySystem's own locked dialogue
 * sequence: that class's own onKeyDown explicitly no-ops its advance-key
 * handling while the currently-showing entry is a protagonist line (see its
 * own doc comment), so the two listeners never both react to the same
 * keypress.
 *
 * update(deltaTime) must be called unconditionally every frame (matching
 * every other self-guarding system in this codebase — e.g.
 * cargo-hook-system.ts/spray-paint-system.ts) — it no-ops instantly unless a
 * say() is currently in progress.
 */
export class ProtagonistDialogueSystem {
  private settingsManager: SettingsManager;
  private ui: ProtagonistDialogueUiHandle;

  private active = false;
  private lines: string[] = [];
  private lineIndex = 0;
  private revealMs = 0;
  private onComplete?: () => void;

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager;
    this.ui = createProtagonistDialogueUi();
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Starts (or restarts) a line/sequence of lines spoken by the protagonist
   * — a single string or an array played one after another. `onComplete`
   * fires once the last line has been advanced past. */
  say(lines: string | string[], onComplete?: () => void): void {
    const list = Array.isArray(lines) ? lines : [lines];
    if (list.length === 0) { onComplete?.(); return; }
    this.lines = list;
    this.lineIndex = 0;
    this.onComplete = onComplete;
    this.active = true;
    this.beginLine();
  }

  private beginLine(): void {
    this.revealMs = 0;
    const textSpeed = this.settingsManager.settings.text.textSpeed;
    if (CHAR_INTERVAL_MS[textSpeed] === 0) {
      // 'instant' — reveal the whole line immediately, no per-character wait.
      this.revealMs = this.lines[this.lineIndex].length * (CHAR_INTERVAL_MS.standard + 1);
    }
    showProtagonistDialogueText(this.ui, this.revealedText());
  }

  private get interval(): number {
    return CHAR_INTERVAL_MS[this.settingsManager.settings.text.textSpeed] || CHAR_INTERVAL_MS.standard;
  }

  private get isLineFullyRevealed(): boolean {
    const revealedChars = Math.floor(this.revealMs / this.interval);
    return revealedChars >= this.lines[this.lineIndex].length;
  }

  private revealedText(): string {
    const revealedChars = Math.min(this.lines[this.lineIndex].length, Math.floor(this.revealMs / this.interval));
    return this.lines[this.lineIndex].slice(0, revealedChars);
  }

  update(deltaTime: number): void {
    if (!this.active) return;
    this.revealMs += deltaTime * 1000;
    showProtagonistDialogueText(this.ui, this.revealedText());
  }

  private advance(): void {
    if (this.lineIndex >= this.lines.length - 1) {
      this.finish();
      return;
    }
    this.lineIndex++;
    this.beginLine();
  }

  private finish(): void {
    this.active = false;
    hideProtagonistDialogueUi(this.ui);
    const cb = this.onComplete;
    this.onComplete = undefined;
    cb?.();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.active || event.repeat) return;
    const bindings = this.settingsManager.inputBindings;
    const isAdvanceKey = event.code === 'Space' || bindings.matches('interact', event.code) || bindings.matches('pickupPlace', event.code);
    if (!isAdvanceKey) return;
    event.preventDefault();
    // Advancing past the LAST line can synchronously fire `onComplete`,
    // which (when driven from AfterWorkStorySystem) may itself transition
    // straight into a NEW state that also wants to react to keyboard input
    // (e.g. a Choice node right after this protagonist entry) — without this,
    // that later-registered `document` keydown listener would still receive
    // this SAME event after the state change and immediately act on it too
    // (confirmed via browser testing: one E press was both "finish this
    // line" AND "confirm the choice at its default highlight"). Stopping
    // propagation here is what actually enforces the "the two listeners
    // never both react to the same keypress" invariant — a state check alone
    // isn't enough once the state can change synchronously mid-event.
    event.stopImmediatePropagation();
    if (this.isLineFullyRevealed) {
      this.advance();
    } else {
      this.revealMs = this.lines[this.lineIndex].length * this.interval;
      showProtagonistDialogueText(this.ui, this.revealedText());
    }
  }
}
