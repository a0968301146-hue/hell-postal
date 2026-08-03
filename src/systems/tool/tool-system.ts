import { PlayerInteractionData, ActiveTool } from '../../core/game-state';
import { HUD } from '../hud';
import { PauseManager } from '../../core/pause-manager';
import { isPalletId } from '../pallet';
// Imported directly from pickup-system.ts, NOT the '../interaction' barrel —
// matches pallet-system.ts's own established reasoning for this exact same
// import (keeps this file from ever risking a future cycle through anything
// else the barrel re-exports).
import { PickupSystem } from '../interaction/pickup-system';

const TOOL_NAME: Record<ActiveTool, string> = {
  empty: '徒手',
  powerGloves: '力量手套',
  cargoHook: '捕貨鉤',
  sprayCan: '噴漆罐',
};

/** Bottom-center 4-slot hotbar ("Add tool hotbar and cargo hook" round 一,
 * slot 2 unlocked by "Add power gloves and refine cargo hook cooldown"
 * round 三, slot 4 unlocked by "Fix pallet throw and add spray paint tool"
 * round 五) — owns ONLY tool-selection state/input/UI.
 *
 * Deliberately does NOT know about CargoHookSystem at all — CargoHookSystem
 * watches `playerData.activeTool` itself every frame and self-cancels the
 * instant it stops being 'cargoHook', so no callback/import wiring is
 * needed in either direction. It DOES need `isPalletId` (a plain exported
 * data-only helper, not a PalletSystem class reference — see
 * pallet-data.ts's own doc comment on why it's exported this way) purely to
 * block switching tools while a pallet is held (spec四: "搬著托盤時不可切換工
 * 具，提示「請先放下托盤」"). */
export class ToolSystem {
  private playerData: PlayerInteractionData;
  private hud: HUD;
  private pauseManager: PauseManager;
  private isLocked: () => boolean;
  private pickupSystem: PickupSystem;

  private slot1El: HTMLElement;
  private slot2El: HTMLElement;
  private slot3El: HTMLElement;
  private slot4El: HTMLElement;
  private slot3CooldownOverlay: HTMLElement;
  private slot3CooldownText: HTMLElement;
  private toolNamePopup: HTMLElement;
  private toolNameTimer: number | null = null;

  /** Wheel-cycle order matches the visible slot order left-to-right —
   * "Fix pallet throw and add spray paint tool" round spec五: "滾輪工具切換
   * 改為1→2→3→4循環". */
  private readonly WHEEL_CYCLE: ActiveTool[] = ['empty', 'powerGloves', 'cargoHook', 'sprayCan'];

  constructor(playerData: PlayerInteractionData, hud: HUD, pauseManager: PauseManager, isLockedFn: () => boolean, pickupSystem: PickupSystem) {
    this.playerData = playerData;
    this.hud = hud;
    this.pauseManager = pauseManager;
    this.isLocked = isLockedFn;
    this.pickupSystem = pickupSystem;

    const container = hud.getContainer();

    const hotbar = document.createElement('div');
    hotbar.id = 'hotbar';

    this.slot1El = this.buildSlot('1', '✋', '徒手', false);
    this.slot2El = this.buildSlot('2', '🧤', '力量手套', false);
    this.slot3El = this.buildSlot('3', '🪝', '捕貨鉤', false);
    this.slot4El = this.buildSlot('4', '🎨', '噴漆罐', false);

    // "Improve cargo hook aerial pickup" round spec五: "工具欄第3格顯示冷卻
    // 遮罩與剩餘秒數" — a rising dark overlay (height = remaining/total) plus
    // a centered countdown label, both hidden while off cooldown. Only slot 3
    // ever needs this (only cargoHook has a cooldown), so it's built directly
    // here rather than generalizing buildSlot() for a case nothing else uses.
    this.slot3CooldownOverlay = document.createElement('div');
    this.slot3CooldownOverlay.className = 'hotbar-cooldown-overlay';
    this.slot3El.appendChild(this.slot3CooldownOverlay);
    this.slot3CooldownText = document.createElement('div');
    this.slot3CooldownText.className = 'hotbar-cooldown-text';
    this.slot3El.appendChild(this.slot3CooldownText);

    hotbar.appendChild(this.slot1El);
    hotbar.appendChild(this.slot2El);
    hotbar.appendChild(this.slot3El);
    hotbar.appendChild(this.slot4El);
    container.appendChild(hotbar);

    this.toolNamePopup = document.createElement('div');
    this.toolNamePopup.id = 'tool-name-popup';
    container.appendChild(this.toolNamePopup);

    // Every fresh page load starts back on bare-hands (spec一: "不需要保存
    // 最後選擇的工具") — playerData already defaults activeTool to 'empty'
    // (see createPlayerInteractionData), this just syncs the visuals to it.
    this.updateSelectionUI();

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('wheel', (e) => this.onWheel(e));
  }

  private buildSlot(key: string, icon: string, name: string, locked: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hotbar-slot' + (locked ? ' locked' : '');
    el.innerHTML = `
      <span class="hotbar-key">${key}</span>
      <span class="hotbar-icon">${icon}</span>
      <span class="hotbar-name">${name}</span>
      <span class="hotbar-lock">🔒</span>
    `;
    return el;
  }

  private updateSelectionUI(): void {
    this.slot1El.classList.toggle('selected', this.playerData.activeTool === 'empty');
    this.slot2El.classList.toggle('selected', this.playerData.activeTool === 'powerGloves');
    this.slot3El.classList.toggle('selected', this.playerData.activeTool === 'cargoHook');
    this.slot4El.classList.toggle('selected', this.playerData.activeTool === 'sprayCan');
  }

  private showToolNamePopup(tool: ActiveTool): void {
    this.toolNamePopup.textContent = TOOL_NAME[tool];
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
   * - "搬著托盤時不可切換工具" (spec四, this round) — checked FIRST since it
   *   applies regardless of which tool is being switched TO or FROM.
   * - "捕貨鉤必須空手使用...若玩家正在持有任何物品：不可切換至捕貨鉤"
   *   (prior round; Pallet/dolly holds also set state away from
   *   'empty-handed', so this one check covers every kind of "currently
   *   holding something" case, not just PickupSystem's own heldObjectId).
   * - "噴漆罐必須空手使用" ("Fix pallet throw and add spray paint tool" round
   *   spec五) — same reasoning/gate as cargoHook above.
   * Does NOT gate on cargo-hook cooldown — a cooldown only blocks FIRING
   * (see CargoHookSystem.onMouseDown), the tool can still be selected/
   * deselected freely while it counts down.
   *
   * "Fully fix bare-hands NPC interaction" round二: switching TO 'empty'
   * additionally, defensively, force-normalizes playerData.state back to
   * 'empty-handed' (and heldObjectId to null) whenever nothing is actually
   * held (PickupSystem.heldCount===0 and not a pallet) — a genuinely
   * exhaustive audit of every heldStack/state writer in this codebase found
   * every one of them already correctly paired, but InteractionSystem's own
   * entire empty-handed priority chain (bulletin board / TV / vehicle
   * buttons / mail rack / pallet racks / the lost-found NPC counter) is
   * gated behind a single `if (playerData.state !== 'empty-handed') return;`
   * check — so ANY future desync between "nothing genuinely held" and a
   * stale non-'empty-handed' state, from this file or any other, would
   * silently route every one of those E-presses into PickupSystem's
   * unrelated 'holding-item' branch instead and look exactly like "E does
   * nothing". This makes returning to slot 1 the one guaranteed place that
   * class of bug can never survive, regardless of where it originates. */
  trySelect(tool: ActiveTool): void {
    if (this.playerData.activeTool === tool) return;
    if (isPalletId(this.playerData.heldObjectId)) {
      this.hud.showToast('請先放下托盤');
      return;
    }
    if ((tool === 'cargoHook' || tool === 'sprayCan') && this.playerData.state !== 'empty-handed') {
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
   * currently selected, so the cooldown mask on slot 3 stays visible even
   * if the player switches away mid-cooldown. */
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

    if (event.code === 'Digit1') { this.trySelect('empty'); return; }
    if (event.code === 'Digit2') { this.trySelect('powerGloves'); return; }
    if (event.code === 'Digit3') { this.trySelect('cargoHook'); return; }
    if (event.code === 'Digit4') { this.trySelect('sprayCan'); return; }
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isLocked()) return;
    if (this.pauseManager.isPaused) return;
    // "Add placement rotation and pallet cargo straps" round spec一: "放置
    // 預覽期間，滾輪不可切換工具欄" — PickupSystem's own wheel handler owns
    // the wheel entirely while placing a normal held item; the pallet's own
    // placement preview is live for the WHOLE time it's held (no separate
    // discrete state — see pallet-system.ts), so carrying it is the second
    // condition here.
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
    const currentIndex = this.WHEEL_CYCLE.indexOf(this.playerData.activeTool);
    const dir = event.deltaY > 0 ? 1 : -1;
    const nextIndex = (currentIndex + dir + this.WHEEL_CYCLE.length) % this.WHEEL_CYCLE.length;
    this.trySelect(this.WHEEL_CYCLE[nextIndex]);
  }
}
