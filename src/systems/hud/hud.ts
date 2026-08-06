import { coldValueTierColor } from '../cargo/cold-value-data';

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
  private aimedColdValueEl: HTMLElement;

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

    // "冷凍貨物系統修改" round四 — crosshair-aim 冷藏值 readout, directly
    // below #interaction-prompt (spec四: "在目前互動提示(UI)下方新增"), shown
    // only while the crosshair is genuinely aimed at frozen cargo
    // (updateAimedColdValue below), hidden immediately otherwise.
    this.aimedColdValueEl = document.createElement('div');
    this.aimedColdValueEl.id = 'aimed-cold-value-prompt';
    hud.appendChild(this.aimedColdValueEl);

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
   * slow-blinking (spec二: "25%以下時...每0.5秒慢速閃爍一次") once below
   * 25%. */
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

  /** "冷凍貨物系統修改" round四 — the crosshair-aim "冷藏值：XX%" line, shown
   * only while genuinely aiming at frozen cargo (caller passes null
   * otherwise — see FreezerSystem.refreshAimedColdValueHud). */
  updateAimedColdValue(coldValue: number | null): void {
    if (coldValue === null) {
      this.aimedColdValueEl.classList.remove('visible');
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(coldValue)));
    this.aimedColdValueEl.textContent = `冷藏值：${pct}%`;
    this.aimedColdValueEl.classList.add('visible');
  }

  showInteractionPrompt(name: string, action: string): void {
    this.promptEl.textContent = `${name}\n${action}`;
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
    finalScore: number; onContinue: () => void;
  }): void {
    const {
      total, shipped, unshipped, penalty, lostFoundMissedCount, lostFoundPenalty,
      lostItemTotal, lostItemHandedOver, lostItemStoredCount, lostItemUnstoredCount, lostItemPenalty,
      mailTotal, mailShipped, mailUnshipped, mailPenalty,
      frozenTotal, frozenTier100, frozenTier75, frozenTier50, frozenTier25, frozenPenalty,
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
