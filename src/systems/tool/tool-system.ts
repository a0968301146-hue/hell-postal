import { PlayerInteractionData, ActiveTool } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { isPalletId } from '../pallet';
// Imported directly from pickup-system.ts, NOT the '../interaction' barrel —
// matches pallet-system.ts's own established reasoning for this exact same
// import (keeps this file from ever risking a future cycle through anything
// else the barrel re-exports).
import { PickupSystem } from '../interaction/pickup-system';
import { ConfigurableTool, TOOL_DEFINITIONS, loadToolLoadout } from './tool-loadout-data';
import { isToolUnlockedOnDay } from '../../data/daily-unlock-data';

/** Bottom-center 4-slot hotbar ("Add tool hotbar and cargo hook" round 一,
 * slot 2 unlocked by "Add power gloves and refine cargo hook cooldown"
 * round 三, slot 4 unlocked by "Fix pallet throw and add spray paint tool"
 * round 五, slots 2-4 made SWAPPABLE by "Add ladder tool station and
 * envelope vacuum" round三) — owns ONLY tool-selection state/input/UI.
 *
 * Deliberately does NOT know about CargoHookSystem/SpraySystem/
 * EnvelopeVacuumSystem at all — each of those watches
 * `playerData.activeTool` itself every frame and self-cancels the instant
 * it stops being its own id, so no callback/import wiring is needed in
 * either direction. It DOES need `isPalletId` (a plain exported data-only
 * helper, not a PalletSystem class reference) purely to block switching
 * tools while a pallet is held (spec四: "搬著托盤時不可切換工具，提示「請先
 * 放下托盤」").
 *
 * Slot 1 is permanently 'empty', locked. Slots 2-4 hold whichever three
 * ConfigurableTool ids the CURRENT loadout (tool-loadout-data.ts) assigns —
 * only ever changed via setLoadout(), called once at construction (reading
 * the saved/default loadout) and again whenever the tool cart's own
 * ToolLoadoutMenuUI saves a new configuration (spec三: "儲存後立即刷新
 * Hotbar圖示與數字鍵對應"). */
export class ToolSystem {
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;
  private pickupSystem: PickupSystem;
  /** "Day 1～7 每日內容與解鎖規格" round — read by trySelect() to block
   * switching to a ConfigurableTool that isn't open yet (daily-unlock-
   * data.ts, the single source of truth). Defaults to "always day 1" if
   * never wired (matches DEFAULT_TOOL_LOADOUT's own conservative baseline). */
  private getCurrentDay: () => number = () => 1;

  /** Index 0 is always 'empty' (locked slot 1); indices 1-3 mirror the
   * current loadout (slots 2-4). */
  private slotTools: ActiveTool[] = ['empty', 'powerGloves', 'cargoHook', 'sprayCan'];
  private slotEls: HTMLElement[] = [];
  private slot3CooldownOverlay: HTMLElement;
  private slot3CooldownText: HTMLElement;
  private toolNamePopup: HTMLElement;
  private toolNameTimer: number | null = null;

  constructor(
    playerData: PlayerInteractionData, hud: HUD, pauseManager: PauseManager, isLockedFn: () => boolean,
    pickupSystem: PickupSystem, getCurrentDay?: () => number
  ) {
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;
    this.pickupSystem = pickupSystem;
    if (getCurrentDay) this.getCurrentDay = getCurrentDay;

    const container = hud.getContainer();

    const hotbar = document.createElement('div');
    hotbar.id = 'hotbar';

    for (let i = 0; i < 4; i++) {
      const el = this.buildSlotElement(String(i + 1));
      this.slotEls.push(el);
      hotbar.appendChild(el);
    }
    container.appendChild(hotbar);

    // "Improve cargo hook aerial pickup" round spec五: "工具欄第3格顯示冷卻
    // 遮罩與剩餘秒數" — a rising dark overlay (height = remaining/total) plus
    // a centered countdown label, hidden while off cooldown. Built once here
    // (detached until whichever slot currently equips cargoHook exists — see
    // refreshSlotContents()), since only cargoHook has a cooldown at all.
    this.slot3CooldownOverlay = document.createElement('div');
    this.slot3CooldownOverlay.className = 'hotbar-cooldown-overlay';
    this.slot3CooldownText = document.createElement('div');
    this.slot3CooldownText.className = 'hotbar-cooldown-text';

    this.toolNamePopup = document.createElement('div');
    this.toolNamePopup.id = 'tool-name-popup';
    container.appendChild(this.toolNamePopup);

    // Every fresh page load starts back on bare-hands (spec一: "不需要保存
    // 最後選擇的工具") — playerData already defaults activeTool to 'empty'
    // (see createPlayerInteractionData). The loadout ITSELF does persist
    // (spec: "重新整理後保留配置") — read once here, same reasoning
    // upgrade-system.ts reads its own save once at construction.
    this.setLoadout(loadToolLoadout());

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('wheel', (e) => this.onWheel(e));
  }

  /** "Add regional envelope dispatch machine" round一: slot 1 (empty-hand)
   * no longer shows a lock icon — it renders exactly like slots 2-4 (own
   * icon/name, same yellow selected-outline), since the "permanently
   * fixed" rule is already enforced purely in code (slotTools[0] is never
   * touched by setLoadout) and needs no separate visual treatment. */
  private buildSlotElement(key: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hotbar-slot';
    el.innerHTML = `
      <span class="hotbar-key">${key}</span>
      <span class="hotbar-icon"></span>
      <span class="hotbar-name"></span>
    `;
    return el;
  }

  /** "工具欄未解鎖道具規格重製" round — a slot whose tool isn't open yet today
   * renders GENUINELY BLANK (spec三: "不是灰色圖示/鎖頭圖示/可以選但不能使
   * 用，而是完全沒有圖示...空白欄位"), not merely dimmed — deliberately the
   * OPPOSITE visual treatment from the tool cart's own locked pool items
   * (which stay visible-but-dark, see tool-loadout-menu-ui.ts). 'empty' is
   * never gated (isToolUnlockedOnDay's own contract), so slot 1 always
   * renders normally. */
  private renderSlotContent(index: number): void {
    const el = this.slotEls[index];
    const tool = this.slotTools[index];
    const iconEl = el.querySelector('.hotbar-icon')!;
    const nameEl = el.querySelector('.hotbar-name')!;
    if (!isToolUnlockedOnDay(tool, this.getCurrentDay())) {
      iconEl.textContent = '';
      nameEl.textContent = '';
      return;
    }
    const def = TOOL_DEFINITIONS[tool];
    iconEl.textContent = def.icon;
    nameEl.textContent = def.displayName;
  }

  /** Re-renders every slot's lock-aware content against whatever day it is
   * RIGHT NOW — called once from setLoadout (construction/cart-close) and
   * again from create-game-systems.ts on every day transition (a newly
   * unlocked tool must appear in its slot immediately, not just next time
   * the loadout happens to change). */
  refreshLoadoutDisplay(): void {
    for (let i = 0; i < 4; i++) this.renderSlotContent(i);
  }

  /** Applies a NEW slots-2-4 loadout ("Add ladder tool station and envelope
   * vacuum" round三) — called once at construction and again whenever the
   * tool cart saves a change. If the tool CURRENTLY selected is no longer
   * in the new loadout, forces back to slot 1 first (spec: "替換目前正在
   *選中的工具時，關閉UI後自動切回第1格空手") — reusing trySelect's own
   * empty-handed-normalize logic rather than duplicating it. */
  setLoadout(loadout: [ConfigurableTool, ConfigurableTool, ConfigurableTool]): void {
    const current = this.playerData.activeTool;
    this.slotTools = ['empty', loadout[0], loadout[1], loadout[2]];
    if (current !== 'empty' && !(this.slotTools as ActiveTool[]).includes(current)) {
      this.trySelect('empty');
    }
    this.refreshLoadoutDisplay();

    // Re-attach the cooldown mask to whichever slot (if any) currently
    // equips cargoHook — detaches it entirely if cargoHook isn't equipped
    // at all right now, so it can never linger visually on an unrelated
    // tool's slot.
    const cargoHookIndex = this.slotTools.indexOf('cargoHook');
    this.slot3CooldownOverlay.remove();
    this.slot3CooldownText.remove();
    if (cargoHookIndex !== -1) {
      this.slotEls[cargoHookIndex].appendChild(this.slot3CooldownOverlay);
      this.slotEls[cargoHookIndex].appendChild(this.slot3CooldownText);
    }

    this.updateSelectionUI();
  }

  private updateSelectionUI(): void {
    for (let i = 0; i < 4; i++) {
      this.slotEls[i].classList.toggle('selected', this.playerData.activeTool === this.slotTools[i]);
    }
  }

  private showToolNamePopup(tool: ActiveTool): void {
    this.toolNamePopup.textContent = TOOL_DEFINITIONS[tool].displayName;
    this.toolNamePopup.classList.add('visible');
    if (this.toolNameTimer !== null) window.clearTimeout(this.toolNameTimer);
    this.toolNameTimer = window.setTimeout(() => {
      this.toolNamePopup.classList.remove('visible');
      this.toolNameTimer = null;
    }, 1200);
  }

  /** Shared select attempt for digit-key/wheel input — public so
   * CargoHookSystem could in principle still call it, though it no longer
   * does (the tool stays selected through a catch — see cargo-hook-
   * system.ts's own doc comment). Enforces:
   * - "搬著托盤或梯子時不可切換工具" — checked FIRST since it applies
   *   regardless of which tool is being switched TO or FROM (pallet/ladder
   *   carrying both set playerData.state away from 'empty-handed', so the
   *   second check below already covers the ladder case too; the pallet
   *   gets its own extra toast since isPalletId is a cheap data-only check
   *   available here without an import cycle — the ladder has no
   *   equivalent lightweight id-only helper, so it just falls under the
   *   generic "must be empty-handed" message instead).
   * - "捕貨鉤／噴漆罐／信封吸塵器必須空手使用...若玩家正在持有任何物品：不可
   *   切換" (prior rounds; pallet/ladder/dolly holds also set state away
   *   from 'empty-handed', so this one check covers every kind of
   *   "currently holding something" case, not just PickupSystem's own
   *   heldObjectId).
   * Does NOT gate on cargo-hook cooldown — a cooldown only blocks FIRING
   * (see CargoHookSystem.onMouseDown), the tool can still be selected/
   * deselected freely while it counts down.
   *
   * "Fully fix bare-hands NPC interaction" round二: switching TO 'empty'
   * additionally, defensively, force-normalizes playerData.state back to
   * 'empty-handed' (and heldObjectId to null) whenever nothing is actually
   * held (PickupSystem.heldCount===0 and not a pallet) — see this method's
   * own prior doc comment history for the full reasoning; kept unchanged
   * this round. */
  trySelect(tool: ActiveTool): void {
    if (this.playerData.activeTool === tool) return;
    if (isPalletId(this.playerData.heldObjectId)) {
      this.hud.showToast('請先放下托盤');
      return;
    }
    // "Day 1～7 每日內容與解鎖規格" round — a tool not yet open today
    // (daily-unlock-data.ts) can still sit in a hotbar slot (the loadout
    // itself isn't day-gated, only actually USING a tool is), but selecting
    // it is blocked here, the ONE place ActiveTool actually changes.
    if (!isToolUnlockedOnDay(tool, this.getCurrentDay())) {
      this.hud.showToast('此道具尚未解鎖');
      return;
    }
    if ((tool === 'cargoHook' || tool === 'sprayCan' || tool === 'envelopeVacuum') && this.playerData.state !== 'empty-handed') {
      this.hud.showToast('請先放下手上的物品');
      return;
    }
    this.playerData.activeTool = tool;
    if (tool === 'empty' && this.pickupSystem.heldCount === 0 && !isPalletId(this.playerData.heldObjectId)) {
      this.playerData.state = 'empty-handed';
      this.playerData.heldObjectId = null;
    }
    this.updateSelectionUI();
    this.showToolNamePopup(tool);
  }

  /** Called every frame by CargoHookSystem regardless of which tool is
   * currently selected, so the cooldown mask stays visible even if the
   * player switches away mid-cooldown — a no-op if cargoHook isn't
   * currently equipped in any slot at all (see setLoadout's own detach
   * logic above). */
  setCooldown(remainingSeconds: number, totalSeconds: number): void {
    if (remainingSeconds <= 0) {
      this.slot3CooldownOverlay.style.height = '0%';
      this.slot3CooldownText.textContent = '';
      this.slot3CooldownText.classList.remove('visible');
      return;
    }
    const ratio = Math.min(1, remainingSeconds / totalSeconds);
    this.slot3CooldownOverlay.style.height = `${ratio * 100}%`;
    this.slot3CooldownText.textContent = remainingSeconds.toFixed(1);
    this.slot3CooldownText.classList.add('visible');
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    // "新增兔子吉祥物" round — the rabbit guide panel (and every other
    // existing modal that reuses this same 'stamping-minigame' lock
    // convention, e.g. the envelope minigame itself) also reads
    // Digit1-4 for its own navigation; without this guard those presses
    // fall through and ALSO reselect a hotbar slot underneath the modal.
    if (this.playerData.state === 'stamping-minigame') return;

    if (event.code === 'Digit1') { this.trySelect('empty'); return; }
    if (event.code === 'Digit2') { this.trySelect(this.slotTools[1]); return; }
    if (event.code === 'Digit3') { this.trySelect(this.slotTools[2]); return; }
    if (event.code === 'Digit4') { this.trySelect(this.slotTools[3]); return; }
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    // "Add placement rotation and pallet cargo straps" round spec一: "放置
    // 預覽期間，滾輪不可切換工具欄" — PickupSystem's own wheel handler owns
    // the wheel entirely while placing a normal held item; the pallet's own
    // placement preview is live for the WHOLE time it's held (no separate
    // discrete state — see pallet-system.ts), so carrying it is the second
    // condition here — the ladder's own carry/preview is identical.
    if (this.playerData.state === 'placement-preview') return;
    if (isPalletId(this.playerData.heldObjectId)) return;
    // "Fix pallet throw and add spray paint tool" round spec五: "噴漆預覽存
    // 在時，滾輪不切換工具" — spray-paint has no separate discrete "preview
    // mode" the way held-item placement does (its projection is just the
    // tool's normal behavior the whole time it's selected — see
    // spray-paint-system.ts), so the same "own the wheel while this tool is
    // active" pattern as the placement-preview check above applies here:
    // SpraySystem registers its OWN 'wheel' listener for rotation, gated on
    // this exact same activeTool check.
    if (this.playerData.activeTool === 'sprayCan') return;
    if (Math.abs(event.deltaY) < 1) return;
    // Cycles through the four usable slots in visible left-to-right order
    // (spec五: "滾輪工具切換改為1→2→3→4循環"), direction-aware so scrolling
    // back reverses it.
    const currentIndex = this.slotTools.indexOf(this.playerData.activeTool);
    const dir = event.deltaY > 0 ? 1 : -1;
    const nextIndex = (currentIndex + dir + this.slotTools.length) % this.slotTools.length;
    this.trySelect(this.slotTools[nextIndex]);
  }
}
