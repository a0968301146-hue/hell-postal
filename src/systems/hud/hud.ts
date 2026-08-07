import { coldValueTierColor } from '../cargo/cold-value-data';
import { calmValueTierColor } from '../cargo/living-cargo-data';

export class HUD {
  private hudRoot: HTMLElement;
  private crosshairEl: HTMLElement;
  private promptEl: HTMLElement;
  private instructionsEl: HTMLElement;
  private tooFarEl: HTMLElement;
  private chargeBarContainer: HTMLElement;
  private chargeBarFill: HTMLElement;
  private shipmentSummaryEl: HTMLElement;
  private tooFarTimer: number | null = null;
  private dailyFlowEl: HTMLElement;
  private dailyCompleteEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;
  private dayTransitionEl: HTMLElement;
  private dayTransitionTimer: number | null = null;
  private heldCountEl: HTMLElement;
  private envelopeStackEl: HTMLElement;
  private coldValuePanelEl: HTMLElement;
  private coldValuePercentEl: HTMLElement;
  private coldValueTrackEl: HTMLElement;
  private coldValueFillEl: HTMLElement;
  /** "活物貨物系統" round spec四 — same right-side vertical-slider shape as
   * coldValue above, offset horizontally so both can be visible together
   * (spec七: "兩個UI可以同時顯示在右側" — a single item can't currently be
   * both frozen AND live at once since CargoCategory is exclusive, but a
   * multi-carry player could easily be holding one of each simultaneously,
   * so the two panels are independent DOM elements/positions rather than
   * sharing one). */
  private calmValuePanelEl: HTMLElement;
  private calmValuePercentEl: HTMLElement;
  private calmValueTrackEl: HTMLElement;
  private calmValueFillEl: HTMLElement;
  /** "冷凍貨物系統修改" round五 (UI correction pass) — the crosshair-aim
   * "\n冷藏值：XX%" line is no longer its own separate DOM element/window
   * (spec四: "這個提示直接顯示在準心互動UI即可。不用另外開視窗。"); instead
   * it's a plain string suffix showInteractionPrompt appends onto the SAME
   * #interaction-prompt text it already renders every frame. Empty string
   * whenever not aiming at frozen cargo. */
  private aimedColdValueSuffix = '';
  /** "準心貨物數值提示" round — same suffix pattern as aimedColdValueSuffix
   * above, for live cargo's own "F 安撫\n安撫值：XX%" lines (spec: "冷凍貨物
   * 只顯示冷藏值...活物貨物只顯示安撫值...若同時具有兩種屬性，則冷藏值在
   * 前、安撫值在後" — showInteractionPrompt below appends cold THEN calm, so
   * this ordering holds automatically whenever both are ever non-empty).
   * Empty string whenever not aiming at live cargo. */
  private aimedCalmValueSuffix = '';

  constructor() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.appendChild(hud);
    this.hudRoot = hud;

    this.crosshairEl = document.createElement('div');
    this.crosshairEl.id = 'crosshair';
    this.crosshairEl.textContent = '+';
    hud.appendChild(this.crosshairEl);

    this.promptEl = document.createElement('div');
    this.promptEl.id = 'interaction-prompt';
    hud.appendChild(this.promptEl);

    this.tooFarEl = document.createElement('div');
    this.tooFarEl.id = 'too-far-prompt';
    this.tooFarEl.textContent = '距離太遠';
    hud.appendChild(this.tooFarEl);

    // Charge bar
    this.chargeBarContainer = document.createElement('div');
    this.chargeBarContainer.id = 'charge-bar-container';
    this.chargeBarFill = document.createElement('div');
    this.chargeBarFill.id = 'charge-bar-fill';
    this.chargeBarContainer.appendChild(this.chargeBarFill);
    hud.appendChild(this.chargeBarContainer);

    this.shipmentSummaryEl = document.createElement('div');
    this.shipmentSummaryEl.id = 'shipment-summary';
    hud.appendChild(this.shipmentSummaryEl);

    this.instructionsEl = document.createElement('div');
    this.instructionsEl.id = 'instructions-panel';
    this.instructionsEl.innerHTML = `
      <p>點擊畫面開始</p>
      <p>WASD 移動 ｜ Shift 奔跑</p>
      <p>Space 跳躍</p>
      <p>滑鼠控制視角</p>
      <p>E 拿起物件 / 進入放置模式</p>
      <p>按住 Q 蓄力丟出</p>
      <p>左鍵 確認放置 ｜ 右鍵 取消</p>
      <p>Esc 解除滑鼠鎖定</p>
      <p>Tab 開啟物流手冊</p>
    `;
    hud.appendChild(this.instructionsEl);

    // Daily flow status panel (spec "每日貨品清空核心流程" section 十八) —
    // top-right, deliberately not top-left where CompassUI already sits.
    this.dailyFlowEl = document.createElement('div');
    this.dailyFlowEl.id = 'daily-flow-panel';
    hud.appendChild(this.dailyFlowEl);

    this.dailyCompleteEl = document.createElement('div');
    this.dailyCompleteEl.id = 'daily-complete-banner';
    this.dailyCompleteEl.textContent = '今日貨品已全部清空';
    hud.appendChild(this.dailyCompleteEl);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'daily-toast';
    hud.appendChild(this.toastEl);

    this.dayTransitionEl = document.createElement('div');
    this.dayTransitionEl.id = 'day-transition';
    hud.appendChild(this.dayTransitionEl);

    // "多件搬運" held-count indicator ("Add bulletin board upgrade system"
    // round spec五A: "HUD顯示『持有 2/3』") — persistent, not just folded
    // into the transient interaction prompt, so it stays visible while the
    // player looks around without aiming at anything in particular.
    this.heldCountEl = document.createElement('div');
    this.heldCountEl.id = 'held-count-panel';
    hud.appendChild(this.heldCountEl);

    // Envelope stack status ("Add envelope stacks and expand pallet
    // inventory" round spec二: "信封：目前數量／容量" + 目前模式) —
    // persistent, same top-right convention as #held-count-panel just above
    // (a different held-item concept — this tracks EnvelopeStackSystem's own
    // dedicated carry, never PickupSystem's generic heldStack).
    this.envelopeStackEl = document.createElement('div');
    this.envelopeStackEl.id = 'envelope-stack-panel';
    hud.appendChild(this.envelopeStackEl);

    // "Add freezer shelves and frozen cargo freshness system" round (second
    // redesign pass spec五/六/七) — a screen right-center VERTICAL slider,
    // completely hidden unless holding frozen cargo (same "visible" class
    // toggle convention as heldCountEl/envelopeStackEl above, now on the
    // outer panel so the "冷藏值"/percent label hides together with the bar).
    // The fill is a plain top-anchored solid-blue div inside the track —
    // never color-tiered — whose own height *is* the coldValue percentage
    // (updateColdValueStatus below): its TOP edge stays fixed at the
    // track's own top, and only its bottom edge recedes upward as coldValue
    // drops (spec五: "最上面固定。下面越來越少。不要變成由下往上縮。").
    this.coldValuePanelEl = document.createElement('div');
    this.coldValuePanelEl.id = 'cold-value-panel';
    const label = document.createElement('div');
    label.id = 'cold-value-label';
    label.textContent = '冷藏值';
    this.coldValuePercentEl = document.createElement('div');
    this.coldValuePercentEl.id = 'cold-value-percent';
    this.coldValueTrackEl = document.createElement('div');
    this.coldValueTrackEl.id = 'cold-value-slider';
    this.coldValueFillEl = document.createElement('div');
    this.coldValueFillEl.id = 'cold-value-slider-fill';
    this.coldValueTrackEl.appendChild(this.coldValueFillEl);
    this.coldValuePanelEl.appendChild(label);
    this.coldValuePanelEl.appendChild(this.coldValuePercentEl);
    this.coldValuePanelEl.appendChild(this.coldValueTrackEl);
    hud.appendChild(this.coldValuePanelEl);

    // "活物貨物系統" round spec四 — same right-side vertical-slider shape as
    // 冷藏值 above (spec: "位置：與冷藏值相同"), offset to its own slot
    // (#calm-value-panel sits further right, see style.css) so both can be
    // visible together without overlapping. No color-tier fixed CSS either
    // — background set inline per-frame (calmValueTierColor: green/yellow/
    // red), hidden entirely unless holding live cargo.
    this.calmValuePanelEl = document.createElement('div');
    this.calmValuePanelEl.id = 'calm-value-panel';
    const calmLabel = document.createElement('div');
    calmLabel.id = 'calm-value-label';
    calmLabel.textContent = '安撫值';
    this.calmValuePercentEl = document.createElement('div');
    this.calmValuePercentEl.id = 'calm-value-percent';
    this.calmValueTrackEl = document.createElement('div');
    this.calmValueTrackEl.id = 'calm-value-slider';
    this.calmValueFillEl = document.createElement('div');
    this.calmValueFillEl.id = 'calm-value-slider-fill';
    this.calmValueTrackEl.appendChild(this.calmValueFillEl);
    this.calmValuePanelEl.appendChild(calmLabel);
    this.calmValuePanelEl.appendChild(this.calmValuePercentEl);
    this.calmValuePanelEl.appendChild(this.calmValueTrackEl);
    hud.appendChild(this.calmValuePanelEl);
  }

  /** "Add tool hotbar and cargo hook" round spec九: "工具欄UI可接入既有HUD容
   * 器" — ToolSystem/CargoHookSystem build and own their own DOM (hotbar,
   * tool-name popup, viewmodel hook prop's world-space rope/head) but append
   * it here rather than to document.body directly, so it lives inside the
   * same #hud stacking context/z-index as everything else instead of
   * becoming a second overlay root. */
  getContainer(): HTMLElement {
    return this.hudRoot;
  }

  /** "Add main menu and return player after dock story" round 二: hides
   * every gameplay HUD element (crosshair, interaction prompts, toolbar —
   * everything appended via getContainer(), plus everything built directly
   * in this constructor) in ONE call, since the toolbar/tool-name popup are
   * themselves children of the same #hud root (see getContainer's own doc
   * comment above) — MainMenuSystem's full-screen overlay needs nothing
   * gameplay-related visible behind it. */
  setRootVisible(visible: boolean): void {
    this.hudRoot.style.display = visible ? '' : 'none';
  }

  /** Daily flow status panel — updated every frame from game.ts's loop
   * (cheap text-only DOM write, same pattern CompassUI already uses).
   * organized/loaded track two independent things now that shipping goes
   * through a vehicle's cargoBounds instead of a ground zone: a box/roller
   * can be fully organized (on its pallet/rack) well before it's actually
   * carried into a docked vehicle and shipped. */
  updateDailyFlow(params: {
    day: number; stateLabel: string; total: number;
    unorganized: number; organized: number; remaining: number; loaded: number;
    /** Emphasized banner text (spec: "今日貨物已全部裝載" / "今日貨物已全部
     * 送出"), or null to hide the banner — game.ts derives this from
     * DailyFlowSystem.state so HUD doesn't need to know state semantics. */
    bannerText: string | null;
  }): void {
    const { day, stateLabel, total, unorganized, organized, remaining, loaded, bannerText } = params;
    this.dailyFlowEl.innerHTML = `
      <p class="daily-flow-day">第 ${day} 天</p>
      <p>今日狀態：${stateLabel}</p>
      <p>今日貨物總數：${total}</p>
      <p>尚未完成整理：${unorganized}　已完成整理：${organized}</p>
      <p>尚未裝載：${remaining}　已裝載：${loaded} / ${total}</p>
    `;
    if (bannerText) {
      this.dailyCompleteEl.textContent = bannerText;
      this.dailyCompleteEl.classList.add('visible');
    } else {
      this.dailyCompleteEl.classList.remove('visible');
    }
  }

  /** Brief, non-blocking message (spec: "不要使用 browser alert") — reused
   * for both the outbound zone's "尚未完成整理"/"已送達出貨區" messages and
   * the unload/end-day buttons' blocked reasons. */
  showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('visible');
      this.toastTimer = null;
    }, 1800);
  }

  /** "第 X 天完成" transition text (spec 十九) — brief, auto-hides, does
   * NOT pause the game (resetting happens instantly under it). */
  showDayTransition(text: string): void {
    this.dayTransitionEl.textContent = text;
    this.dayTransitionEl.classList.add('visible');
    if (this.dayTransitionTimer !== null) window.clearTimeout(this.dayTransitionTimer);
    this.dayTransitionTimer = window.setTimeout(() => {
      this.dayTransitionEl.classList.remove('visible');
      this.dayTransitionTimer = null;
    }, 2000);
  }

  showInstructions(): void { this.instructionsEl.classList.remove('hidden'); }
  hideInstructions(): void { this.instructionsEl.classList.add('hidden'); }

  /** Only shown once `max` > 1 (i.e. 多件搬運 has actually been purchased)
   * — Lv.0's own max of 1 stays visually identical to before this round. */
  updateHeldCount(count: number, max: number): void {
    if (max <= 1) {
      this.heldCountEl.classList.remove('visible');
      return;
    }
    this.heldCountEl.textContent = `持有 ${count}/${max}`;
    this.heldCountEl.classList.add('visible');
  }

  /** Envelope stack carry status (spec二: "信封：目前數量／容量" + 目前模式)
   * — shown only while the player is actually carrying at least one
   * envelope, mirroring updateHeldCount's own "hide when not relevant"
   * convention. */
  updateEnvelopeStackStatus(count: number, capacity: number, mode: 'stack' | 'single'): void {
    if (count <= 0) {
      this.envelopeStackEl.classList.remove('visible');
      return;
    }
    const modeText = mode === 'stack' ? '整疊模式' : '單張模式';
    this.envelopeStackEl.textContent = `信封：${count}／${capacity}\n${modeText}`;
    this.envelopeStackEl.style.whiteSpace = 'pre-line';
    this.envelopeStackEl.classList.add('visible');
  }

  /** "Add freezer shelves and frozen cargo freshness system" round, extended
   * by "冷凍貨物系統修改" round一/二 — shown only while actively holding a
   * frozen-category item (caller passes null otherwise); both the "冷藏值/
   * XX%" text and the fill height are set DIRECTLY from coldValue every
   * frame (fill height *is* the percentage — top edge fixed at the track's
   * own top, only the bottom edge recedes upward as coldValue drops), now
   * also color-tiered (coldValueTierColor: blue/yellow/orange/red) and
   * slow-blinking (spec二: "25%以下可加入慢速閃爍，約每0.8秒Alpha淡入淡出")
   * once below 25% — the actual fade animation lives in style.css
   * (.cold-value-blink), this method only toggles the class. */
  updateColdValueStatus(coldValue: number | null): void {
    if (coldValue === null) {
      this.coldValuePanelEl.classList.remove('visible');
      this.coldValuePanelEl.classList.remove('cold-value-blink');
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(coldValue)));
    this.coldValuePercentEl.textContent = `${pct}%`;
    this.coldValueFillEl.style.height = `${pct}%`;
    this.coldValueFillEl.style.background = coldValueTierColor(coldValue);
    this.coldValuePanelEl.classList.add('visible');
    this.coldValuePanelEl.classList.toggle('cold-value-blink', coldValue < 25);
  }

  /** "活物貨物系統" round spec四 — shown only while actively holding a
   * live-category item (caller passes null otherwise); mirrors
   * updateColdValueStatus above (top-anchored fill height = calmValue%,
   * background color tiered via calmValueTierColor's own unified 75/50
   * boundaries), plus its own slow blink ("當低於50%時：每秒慢速閃爍一次")
   * below 50%. */
  updateCalmValueStatus(calmValue: number | null): void {
    if (calmValue === null) {
      this.calmValuePanelEl.classList.remove('visible');
      this.calmValuePanelEl.classList.remove('calm-value-blink');
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(calmValue)));
    this.calmValuePercentEl.textContent = `${pct}%`;
    this.calmValueFillEl.style.height = `${pct}%`;
    this.calmValueFillEl.style.background = calmValueTierColor(calmValue);
    this.calmValuePanelEl.classList.add('visible');
    this.calmValuePanelEl.classList.toggle('calm-value-blink', calmValue < 50);
  }

  /** "冷凍貨物系統修改" round四, redone in round五 — the crosshair-aim
   * "冷藏值：XX%" line is now just a stored suffix showInteractionPrompt
   * below appends to its own text, never a second DOM element/window
   * (caller passes null when not aiming at frozen cargo — see
   * FreezerSystem.refreshAimedColdValueHud). "準心貨物數值提示" round:
   * value now inserted BEFORE the action (spec: "冷凍貨物／冷藏值：68%／E
   * 拿起"), not after — see showInteractionPrompt below. Caller already
   * gates this to empty-handed + genuinely aiming at frozen cargo. */
  updateAimedColdValue(coldValue: number | null): void {
    if (coldValue === null) {
      this.aimedColdValueSuffix = '';
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(coldValue)));
    this.aimedColdValueSuffix = `\n冷藏值：${pct}%`;
  }

  /** "準心貨物數值提示" round — the crosshair-aim "安撫值：XX%" line for live
   * cargo, same suffix mechanism/ordering as updateAimedColdValue above
   * (the earlier "F 安撫" hint line is dropped — the new spec's own worked
   * examples show only the value line, and this whole feature is now
   * scoped to empty-handed anyway, so a soothe hint made little sense
   * here). Caller (LivingCargoSystem.refreshAimedCalmValueHud) already
   * gates this to empty-handed + genuinely aiming at live cargo. */
  updateAimedCalmValue(calmValue: number | null): void {
    if (calmValue === null) {
      this.aimedCalmValueSuffix = '';
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(calmValue)));
    this.aimedCalmValueSuffix = `\n安撫值：${pct}%`;
  }

  /** Inserts the current crosshair-aim 冷藏值/安撫值 suffixes (each empty
   * unless genuinely aiming at that category of cargo while empty-handed)
   * BETWEEN the name and the action — never a second DOM element/window.
   * Cold before calm (spec: "若同時具有兩種屬性...依此順序排列") — only one
   * is ever non-empty today since CargoCategory is exclusive, but the
   * concatenation order itself already encodes the required priority for
   * whenever that changes. */
  showInteractionPrompt(name: string, action: string): void {
    this.promptEl.textContent = `${name}${this.aimedColdValueSuffix}${this.aimedCalmValueSuffix}\n${action}`;
    this.promptEl.style.whiteSpace = 'pre-line';
    this.promptEl.classList.add('visible');
  }
  hideInteractionPrompt(): void { this.promptEl.classList.remove('visible'); }

  setCrosshairActive(active: boolean): void {
    this.crosshairEl.classList.toggle('active', active);
  }

  /** Cargo hook's own crosshair state ("Add tool hotbar and cargo hook"
   * round spec七: "瞄準有效Cargo時，捕貨鉤準心顯示可勾取狀態") — a SEPARATE
   * CSS class from setCrosshairActive's 'active' above, so cargo-hook's own
   * per-frame indicator never fights over the same class with
   * InteractionSystem's unrelated (and untouched) targeting highlight. */
  setCargoHookReady(ready: boolean): void {
    this.crosshairEl.classList.toggle('hook-ready', ready);
  }

  /** Single-line transient prompt, reusing the SAME #interaction-prompt
   * element InteractionSystem already owns (spec九: no second prompt
   * system) — cargo-hook-system.ts calls this every frame it's the active
   * tool, running AFTER InteractionSystem.update() each frame (see
   * game-app.ts), so it always has the final say on the prompt's content
   * while selected; once the player switches away, this simply stops being
   * called and InteractionSystem's own untouched per-frame logic (which
   * still runs regardless of the active tool) resumes owning the element
   * from the very next frame with no explicit hand-back needed. */
  showToolPrompt(text: string): void {
    this.promptEl.textContent = text;
    this.promptEl.style.whiteSpace = 'normal';
    this.promptEl.classList.add('visible');
  }

  showTooFar(): void {
    this.tooFarEl.classList.add('visible');
    if (this.tooFarTimer !== null) window.clearTimeout(this.tooFarTimer);
    this.tooFarTimer = window.setTimeout(() => {
      this.tooFarEl.classList.remove('visible');
      this.tooFarTimer = null;
    }, 2000);
  }

  /** "Add placement rotation and pallet cargo straps" round spec一: updated
   * to surface the new wheel-rotate control alongside the existing E/left-
   * click placement and Q-throw hints (spec一's exact wording). */
  showPlacementPrompt(isValid: boolean): void {
    this.promptEl.textContent = isValid ? '滾輪旋轉　E放置　Q丟出\n右鍵：取消' : '此處無法放置\n右鍵：取消';
    this.promptEl.style.whiteSpace = 'pre-line';
    this.promptEl.classList.add('visible');
  }

  showChargeBar(ratio: number): void {
    this.chargeBarContainer.classList.add('visible');
    this.chargeBarFill.style.width = `${ratio * 100}%`;
    // Color gradient: green to yellow to red
    if (ratio < 0.5) {
      this.chargeBarFill.style.backgroundColor = '#44ff44';
    } else if (ratio < 0.8) {
      this.chargeBarFill.style.backgroundColor = '#ffcc00';
    } else {
      this.chargeBarFill.style.backgroundColor = '#ff4444';
    }
  }

  hideChargeBar(): void {
    this.chargeBarContainer.classList.remove('visible');
    this.chargeBarFill.style.width = '0%';
  }

  /** Combined land+sea settlement panel (spec section 十五/十九) — shown
   * only once BOTH routes have finished departing, stays open (game paused
   * behind it) until the player clicks 繼續. Each route's breakdown always
   * satisfies correctCount+incompatibleCount === loadedCount
   * (see vehicle-control-system.ts's vehicleAcceptsCargo). */
  showVehicleSettlement(params: {
    land: { vehicleName: string; loadedCount: number; correctCount: number; incompatibleCount: number; scoreChange: number };
    sea: { vehicleName: string; loadedCount: number; correctCount: number; incompatibleCount: number; scoreChange: number };
    totalCount: number;
    totalCorrect: number;
    totalIncorrect: number;
    totalScoreChange: number;
    cumulativeScore: number;
    onContinue: () => void;
  }): void {
    const { land, sea, totalCount, totalCorrect, totalIncorrect, totalScoreChange, cumulativeScore, onContinue } = params;
    const landEmpty = land.loadedCount === 0;
    const seaEmpty = sea.loadedCount === 0;

    let emptyNote = '';
    if (landEmpty && seaEmpty) emptyNote = '<p class="summary-empty">本次陸運與海運皆為空載</p>';
    else if (landEmpty) emptyNote = '<p class="summary-empty">陸運本次空載出發</p>';
    else if (seaEmpty) emptyNote = '<p class="summary-empty">海運本次空載出發</p>';

    const routeBlock = (label: string, r: typeof land) => `
      <div class="summary-route">
        <p class="summary-route-title">${label}：${r.vehicleName}</p>
        <p>本次裝載件數：${r.loadedCount} 件</p>
        <p>正確受理：${r.correctCount} 件　不相容貨物：${r.incompatibleCount} 件</p>
        <p>${label}分數變化：${r.scoreChange >= 0 ? '+' : ''}${r.scoreChange}</p>
      </div>`;

    this.shipmentSummaryEl.innerHTML = `
      <p class="summary-title">兩台載具已出發</p>
      ${emptyNote}
      ${routeBlock('陸運', land)}
      ${routeBlock('海運', sea)}
      <p>本次總件數：${totalCount} 件</p>
      <p>本次正確件數：${totalCorrect} 件　本次錯誤件數：${totalIncorrect} 件</p>
      <p>本次總分變化：${totalScoreChange >= 0 ? '+' : ''}${totalScoreChange}</p>
      <p>累積分數：${cumulativeScore}</p>
      <p class="summary-note">（原型暫定計分，僅供測試，非正式規格）</p>
      <button id="settlement-continue-btn">繼續</button>
    `;
    this.shipmentSummaryEl.classList.add('visible');
    const btn = this.shipmentSummaryEl.querySelector('#settlement-continue-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.hideVehicleSettlement();
      onContinue();
    }, { once: true });
  }

  hideVehicleSettlement(): void {
    this.shipmentSummaryEl.classList.remove('visible');
  }

  /** Day-complete panel ("Add six cargo vehicles and unrestricted departure
   * scoring" round) — shown once BOTH routes have finished departing,
   * reuses the same DOM element/pause-then-繼續 pattern as the old
   * showVehicleSettlement (kept intact above, still unused). Fields come
   * straight from VehicleControlSystem's departure-time settlement snapshot
   * (spec二: 今日貨物總數/成功出貨數量/未出貨數量/未出貨扣分/當日最終分數).
   * lostFoundMissed/lostFoundPenalty added ("Spawn lost found NPC during
   * unloading and penalize missed interaction" round 三: 結算顯示"失物招領：
   * 未接待"/"失物招領扣分"). lostItem* fields added ("Expand lost found
   * return storage and scoring" round 七: 今日失物總數/成功交還0或1/已收納
   * 數量/未收納數量/失物收納扣分 — independent line items from
   * lostFoundMissed/lostFoundPenalty above, spec: "兩條獨立項目"). */
  showDayCompleteSummary(params: {
    total: number; shipped: number; unshipped: number; penalty: number;
    lostFoundMissedCount: number; lostFoundPenalty: number;
    lostItemTotal: number; lostItemHandedOver: number; lostItemStoredCount: number; lostItemUnstoredCount: number; lostItemPenalty: number;
    mailTotal: number; mailShipped: number; mailUnshipped: number; mailPenalty: number;
    frozenTotal: number; frozenTier100: number; frozenTier75: number; frozenTier50: number; frozenTier25: number; frozenPenalty: number;
    liveTotal: number; liveComfortableCount: number; liveAnxiousCount: number; liveScaredCount: number; liveBonus: number;
    finalScore: number; onContinue: () => void;
  }): void {
    const {
      total, shipped, unshipped, penalty, lostFoundMissedCount, lostFoundPenalty,
      lostItemTotal, lostItemHandedOver, lostItemStoredCount, lostItemUnstoredCount, lostItemPenalty,
      mailTotal, mailShipped, mailUnshipped, mailPenalty,
      frozenTotal, frozenTier100, frozenTier75, frozenTier50, frozenTier25, frozenPenalty,
      liveTotal, liveComfortableCount, liveAnxiousCount, liveScaredCount, liveBonus,
      finalScore, onContinue,
    } = params;
    // "Add sequential lost-found visitors and held cargo feedback" round
    // 一/六: up to DAILY_LOST_FOUND_NPC_COUNT NPCs a day now, so this line
    // reports a COUNT of missed NPCs rather than a single yes/no.
    const lostFoundLine = lostFoundMissedCount > 0
      ? `<p>失物招領：未接待 ${lostFoundMissedCount} 位</p><p>失物招領扣分：-${lostFoundPenalty}</p>`
      : `<p>失物招領：全數已接待</p>`;
    // Denominator = today's total NPC count — every one of today's NPCs is
    // either handed-over (counted in lostItemHandedOver) or missed (counted
    // in lostFoundMissedCount) by settlement time, so the two sums to it
    // without needing a separate "how many NPCs today" param.
    const npcCountToday = lostItemHandedOver + lostFoundMissedCount;
    const lostItemLine = `
      <p>今日失物總數：${lostItemTotal}</p>
      <p>成功交還：${lostItemHandedOver}／${npcCountToday}</p>
      <p>已收納失物：${lostItemStoredCount}</p>
      <p>未收納失物：${lostItemUnstoredCount}</p>
      <p>失物收納扣分：${lostItemPenalty > 0 ? '-' : ''}${lostItemPenalty}</p>
    `;
    // Mail settlement ("Add modular envelope stamping and regional mail bag
    // system" round 十一) — its own independent block, same
    // per-item-penalty convention as 未出貨扣分 above (spec: "每封未寄出信件
    // 使用現有『每件未出貨扣分值』").
    const mailLine = `
      <p>今日信件總數：${mailTotal}</p>
      <p>已寄出信件：${mailShipped}</p>
      <p>未寄出信件：${mailUnshipped}</p>
      <p>信件扣分：${mailPenalty > 0 ? '-' : ''}${mailPenalty}</p>
    `;
    // "Add freezer shelves and frozen cargo freshness system" round spec六
    // — same independent-line-item convention as lostItemLine/mailLine
    // above; only shown at all once at least one frozen item actually
    // shipped today (mirrors lostFoundLine's own "nothing to report" case).
    const frozenLine = frozenTotal > 0 ? `
      <p>今日冷凍貨物總數：${frozenTotal}</p>
      <p>100%新鮮：${frozenTier100}　75%新鮮：${frozenTier75}　50%新鮮：${frozenTier50}　25%新鮮：${frozenTier25}</p>
      <p>冷藏扣分：${frozenPenalty > 0 ? '-' : ''}${frozenPenalty}</p>
    ` : '';
    // "活物安撫值規格" round spec七 — same independent-line-item convention as
    // frozenLine above, THREE unified tiers; liveBonus can be negative (害怕
    // tier settles below neutral), so the sign is shown explicitly either way.
    const liveLine = liveTotal > 0 ? `
      <p>今日活物貨物總數：${liveTotal}</p>
      <p>舒服：${liveComfortableCount}　焦慮：${liveAnxiousCount}　害怕：${liveScaredCount}</p>
      <p>安撫加分：${liveBonus >= 0 ? '+' : ''}${liveBonus}</p>
    ` : '';
    this.shipmentSummaryEl.innerHTML = `
      <p class="summary-title">六台載具已出發</p>
      <p>今日貨物總數：${total}</p>
      <p>成功出貨：${shipped}</p>
      <p>未出貨：${unshipped}</p>
      <p>未出貨扣分：${penalty > 0 ? '-' : ''}${penalty}</p>
      ${lostFoundLine}
      ${lostItemLine}
      ${mailLine}
      ${frozenLine}
      ${liveLine}
      <p>當日最終分數：${finalScore}</p>
      <p class="summary-title">今日貨物已全部送出</p>
      <button id="settlement-continue-btn">繼續</button>
    `;
    this.shipmentSummaryEl.classList.add('visible');
    const btn = this.shipmentSummaryEl.querySelector('#settlement-continue-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.hideVehicleSettlement();
      onContinue();
    }, { once: true });
  }
}
