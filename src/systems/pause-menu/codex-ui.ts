import { SettingsManager } from '../settings';
import { buildVehicleCodexEntries, SPECIES_CODEX_ENTRIES, buildCargoCodexGroups, buildMailEnvelopeCodexEntries } from '../../data/codex-data';
// "國家／地區圖鑑＋郵票收集系統" round — read directly, no separate builder
// needed in game/codex-data.ts (unlike vehicle/cargo codex, this data is
// already in its final display shape).
import { REGION_CODEX_ENTRIES, RegionCodexId, isRegionCodexUnlockedOnDay } from '../../data/world/region-codex-data';
// "郵票系統重新區分" round — StampRegionId deliberately EXCLUDES 'ithaca' at
// the type level (spec一/十三: 伊塔卡港鎮完全排除郵票系統), so this file's own
// STAMP_REGION_IDS list below can never accidentally include it.
import {
  StampRegionId, StampRarity, STAMP_RARITY_ORDER, STAMP_RARITY_LABELS,
  getRequiredStampForRegion, getDecorativeStampsForRegionByRarity,
} from '../../data/world/stamp-collection-data';

const STAMP_REGION_IDS: StampRegionId[] = ['argos', 'hephaestia', 'evergreen-isles', 'artemisia'];

export type CodexTab = 'vehicle' | 'species' | 'cargo' | 'region' | 'stamp';

/**
 * Stateless render-only helper for the manual's 圖鑑 (codex) bookmark — owns
 * none of the selection/tab state itself (that stays in ManualUI, including
 * its existing bookmark-reset/Escape asymmetries), only the "given this
 * state, produce this HTML" logic for all 5 codex sub-tabs. Extracted from
 * pause-menu-ui.ts ("Phase 2 大型檔案拆分" round) as a pure move — every
 * template, condition, sort order, and unlock check below is unchanged from
 * its original ManualUI private-method form.
 */
export class CodexUI {
  private settingsManager: SettingsManager;
  private getCurrentDay: () => number;

  constructor(settingsManager: SettingsManager, getCurrentDay: () => number) {
    this.settingsManager = settingsManager;
    this.getCurrentDay = getCurrentDay;
  }

  render(
    leftPageEl: HTMLElement, rightPageEl: HTMLElement, codexTab: CodexTab,
    selection: {
      vehicleId: string | null; speciesId: string | null; cargoId: string | null;
      regionId: RegionCodexId | null; stampRegionId: StampRegionId | null;
    }
  ): void {
    if (codexTab === 'vehicle') { this.renderVehicleCodex(leftPageEl, rightPageEl, selection.vehicleId); return; }
    if (codexTab === 'cargo') { this.renderCargoCodex(leftPageEl, rightPageEl, selection.cargoId); return; }
    if (codexTab === 'region') { this.renderRegionCodex(leftPageEl, rightPageEl, selection.regionId); return; }
    if (codexTab === 'stamp') { this.renderStampCodex(leftPageEl, rightPageEl, selection.stampRegionId); return; }
    this.renderSpeciesCodex(leftPageEl, rightPageEl, selection.speciesId);
  }

  /** Rebuilds the vehicle codex list from VehicleConfig fresh on every
   * render ("Fix vehicle codex cargo list rendering" round) — rather than
   * a snapshot cached once in the constructor, so there is no cached
   * object for a hot-reload/long-lived-tab edge case to ever leave stale.
   * VehicleConfig is immutable static data, so this costs nothing
   * meaningful (six small objects) and always reflects whatever
   * vehicle-data.ts currently exports. */
  private renderVehicleCodex(leftPageEl: HTMLElement, rightPageEl: HTMLElement, selectedVehicleId: string | null): void {
    const vehicleCodex = buildVehicleCodexEntries();
    const rows = vehicleCodex.map((v) => {
      const discovered = this.settingsManager.isVehicleDiscovered(v.id);
      const active = v.id === selectedVehicleId ? 'active' : '';
      return `
        <div class="manual-list-row ${discovered ? '' : 'locked'} ${active}" data-vehicle-id="${v.id}">
          <span class="manual-list-icon">${discovered ? '🚚' : '❔'}</span>
          <span>${discovered ? v.displayName : '尚未發現'}</span>
        </div>`;
    }).join('');
    leftPageEl.innerHTML = `<h2 class="manual-page-title">已發現載具</h2><div class="manual-list">${rows}</div>`;

    const selected = vehicleCodex.find((v) => v.id === selectedVehicleId && this.settingsManager.isVehicleDiscovered(v.id))
      ?? vehicleCodex.find((v) => this.settingsManager.isVehicleDiscovered(v.id));
    if (!selected) {
      rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未發現任何載具</p><p class="manual-hint">在大廳按下呼叫載具即可發現</p></div>`;
      return;
    }
    rightPageEl.innerHTML = `
      <h2 class="manual-page-title">${selected.displayName}</h2>
      <div class="manual-vehicle-preview">${selected.transportLabel === '海運' ? '⛵' : '🚚'}</div>
      <div class="manual-data-row"><span>運輸方式</span><span>${selected.transportLabel}</span></div>
      <div class="manual-data-row"><span>可受理路線</span><span>${selected.acceptedRegionLabels.join('、')}</span></div>
      <div class="manual-data-row"><span>可受理貨物</span><span>${selected.acceptedCargoLabels.join('、')}</span></div>
      <div class="manual-data-row"><span>可運送信件</span><span>${selected.mailCapabilityLabel}</span></div>
      <div class="manual-data-row"><span>大致裝載空間</span><span>${selected.cargoArea.width.toFixed(1)} × ${selected.cargoArea.length.toFixed(1)} × ${selected.cargoArea.height.toFixed(1)} m</span></div>
      <div class="manual-data-row"><span>特性</span><span>${selected.traits}</span></div>
      <p class="manual-body-text">${selected.description}</p>
    `;
  }

  private renderSpeciesCodex(leftPageEl: HTMLElement, rightPageEl: HTMLElement, selectedSpeciesId: string | null): void {
    const rows = SPECIES_CODEX_ENTRIES.map((s) => {
      const active = s.id === selectedSpeciesId ? 'active' : '';
      // All five are undiscovered this round — see codex-data.ts doc comment.
      return `
        <div class="manual-list-row locked ${active}" data-species-id="${s.id}">
          <span class="manual-list-icon">❔</span>
          <span>尚未發現</span>
        </div>`;
    }).join('');
    leftPageEl.innerHTML = `<h2 class="manual-page-title">顧客種族</h2><div class="manual-list">${rows}</div>`;
    rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未發現</p><p class="manual-hint">顧客種族系統尚未實作</p></div>`;
  }

  /** Cargo codex ("Organize and expand cargo shape presets" round spec八:
   * "貨物圖鑑按種類整理：一般/易碎/大型貨物/冷凍/活物/信件"). Rebuilt fresh on
   * every render, same reasoning as renderVehicleCodex — CargoShapePreset
   * data is immutable static data, so re-reading it costs nothing and can
   * never go stale. No unlock/discovery gating (unlike the vehicle codex) —
   * every confirmed preset is always listed, since there's no in-game
   * "discover a cargo shape" event to gate on. */
  private renderCargoCodex(leftPageEl: HTMLElement, rightPageEl: HTMLElement, selectedCargoId: string | null): void {
    const groups = buildCargoCodexGroups();
    const groupRows = groups.map((g) => {
      const items = g.entries.map((e) => {
        const active = e.id === selectedCargoId ? 'active' : '';
        return `
          <div class="manual-list-row ${active}" data-cargo-id="${e.id}">
            <span class="manual-list-icon" style="color:${e.colorHex}">■</span>
            <span>${e.displayName}</span>
          </div>`;
      }).join('');
      return `<h3 class="manual-subheading">${g.label}</h3>${items}`;
    }).join('');
    const mailEnvelopeEntries = buildMailEnvelopeCodexEntries();
    const mailItems = mailEnvelopeEntries.map((m) => {
      const id = `mail-${m.id}`;
      const active = id === selectedCargoId ? 'active' : '';
      return `
        <div class="manual-list-row ${active}" data-cargo-id="${id}">
          <span class="manual-list-icon">✉️</span>
          <span>${m.displayName}</span>
        </div>`;
    }).join('');
    leftPageEl.innerHTML = `
      <h2 class="manual-page-title">貨物圖鑑</h2>
      <div class="manual-list">${groupRows}<h3 class="manual-subheading">信件</h3>${mailItems}</div>
    `;

    if (selectedCargoId?.startsWith('mail-')) {
      const mailEntry = mailEnvelopeEntries.find((m) => `mail-${m.id}` === selectedCargoId);
      if (mailEntry) {
        rightPageEl.innerHTML = `
          <h2 class="manual-page-title">${mailEntry.displayName}</h2>
          <div class="manual-vehicle-preview">✉️</div>
          <div class="manual-data-row"><span>說明</span><span>${mailEntry.note}</span></div>
        `;
        return;
      }
    }

    const allEntries = groups.flatMap((g) => g.entries);
    const selected = allEntries.find((e) => e.id === selectedCargoId) ?? allEntries[0];
    if (!selected) {
      rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">📦</div><p>尚無資料</p></div>`;
      return;
    }
    rightPageEl.innerHTML = `
      <h2 class="manual-page-title">${selected.displayName}</h2>
      <div class="manual-vehicle-preview" style="color:${selected.colorHex}">■</div>
      <div class="manual-data-row"><span>種類</span><span>${selected.categoryLabel}</span></div>
      <div class="manual-data-row"><span>尺寸</span><span>${selected.sizeLabel}</span></div>
      <div class="manual-data-row"><span>搬運特性</span><span>${selected.carryTraits}</span></div>
      <div class="manual-data-row"><span>是否可放托盤</span><span>${selected.palletLabel}</span></div>
    `;
  }

  /** 國家／地區圖鑑 ("國家／地區圖鑑＋郵票收集系統" round). Rebuilt fresh on
   * every render, same reasoning as renderVehicleCodex/renderCargoCodex —
   * REGION_CODEX_ENTRIES is immutable static data, this.getCurrentDay() is
   * the only thing that changes. A locked region shows only its name/
   * silhouette (spec四: "未解鎖地區：顯示地區名稱／基本輪廓／鎖定狀態，詳細
   * 資料保持鎖定") — same "list is always fully visible, detail pane is
   * what's gated" convention as the vehicle codex's own isVehicleDiscovered
   * check. "郵票系統重新區分" round: the old nested "地區郵票" block that
   * used to live at the bottom of this pane was removed — browsing stamps
   * is now the dedicated 郵票 tab's own exclusive job (renderStampCodex
   * below), so there is only ever ONE place in the UI a stamp's collected
   * status is shown, never two that could drift out of sync. */
  private renderRegionCodex(leftPageEl: HTMLElement, rightPageEl: HTMLElement, selectedRegionId: RegionCodexId | null): void {
    const day = this.getCurrentDay();
    const rows = REGION_CODEX_ENTRIES.map((r) => {
      const unlocked = isRegionCodexUnlockedOnDay(r.id, day);
      const active = r.id === selectedRegionId ? 'active' : '';
      return `
        <div class="manual-list-row ${unlocked ? '' : 'locked'} ${active}" data-region-id="${r.id}">
          <span class="manual-list-icon">${unlocked ? '🗺️' : '❔'}</span>
          <span>${unlocked ? r.name : '尚未解鎖'}</span>
        </div>`;
    }).join('');
    leftPageEl.innerHTML = `<h2 class="manual-page-title">地區圖鑑</h2><div class="manual-list">${rows}</div>`;

    const selected = REGION_CODEX_ENTRIES.find((r) => r.id === selectedRegionId && isRegionCodexUnlockedOnDay(r.id, day))
      ?? REGION_CODEX_ENTRIES.find((r) => isRegionCodexUnlockedOnDay(r.id, day));
    if (!selected) {
      rightPageEl.innerHTML = `<div class="manual-placeholder"><div class="manual-placeholder-icon">❔</div><p>尚未解鎖任何地區</p></div>`;
      return;
    }

    rightPageEl.innerHTML = `
      <h2 class="manual-page-title">${selected.name}｜${selected.subtitle}</h2>
      <div class="manual-data-row"><span>地區類型</span><span>${selected.regionType}</span></div>
      <div class="manual-data-row"><span>土地面積</span><span>${selected.landArea}</span></div>
      <div class="manual-data-row"><span>建立時間</span><span>${selected.founded}</span></div>
      <div class="manual-data-row"><span>主要居民</span><span>${selected.mainResidents.join('、')}</span></div>
      <p class="manual-body-text">${selected.history.replace(/\n/g, '<br>')}</p>
      <div class="manual-data-row"><span>地區特色</span><span>${selected.regionFeatures}</span></div>
      ${selected.mainExports.length > 0 ? `<div class="manual-data-row"><span>主要產出</span><span>${selected.mainExports.join('、')}</span></div>` : ''}
      ${selected.logisticsFeatures ? `<div class="manual-data-row"><span>物流特色</span><span>${selected.logisticsFeatures}</span></div>` : ''}
    `;
  }

  /** One stamp's own icon box — collected shows its real icon on a
   * region-tinted background, uncollected shows a black silhouette with a
   * centered yellow "?" (spec九: "顯示黑色剪影／剪影中央顯示黃色「？」／不
   * 顯示真實郵票圖案／不顯示真實名稱") — a plain glyph rather than the ❔
   * emoji used elsewhere in this file, since that emoji's own built-in
   * colors can't be recolored to the spec's specific black+yellow
   * combination via CSS. Shared by every stamp category this tab renders
   * (required + all 3 decorative rarities), so the visual rule can never
   * drift between them (spec九's own "同時套用" requirement). */
  private renderStampIconBox(collected: boolean, icon: string, color: number): string {
    if (!collected) return `<div class="stamp-icon-box locked">?</div>`;
    return `<div class="stamp-icon-box" style="background:#${color.toString(16).padStart(6, '0')}22;color:#${color.toString(16).padStart(6, '0')}">${icon}</div>`;
  }

  /** 郵票圖鑑 ("郵票獨立圖鑑分類" round, restructured by "郵票系統重新區分"
   * round spec七/八). Left list is now the 4 stamp regions themselves
   * (StampRegionId — Ithaca structurally cannot appear, spec十三) rather
   * than individual stamps; picking one shows that region's full
   * collection on the right, laid out in the spec's own fixed order (spec
   * 八: 必要郵票 → 普通 → 稀有 → 超級稀有, never interleaved). Every stamp
   * slot in every category is always rendered regardless of collected
   * state (spec九: "不要讓未取得郵票消失") — only renderStampIconBox's own
   * per-item visual differs. Collected-status source is, for both
   * categories, the ONE real settingsManager.isStampCollected — no second
   * stamp-collection data source (spec六/十一), and no day-based lock on
   * the region SELECTOR itself (spec十四's own "4個地區都可以選擇" —
   * distinct from the region CODEX tab's own day-gated unlock, an
   * unrelated concept this tab doesn't reuse). */
  private renderStampCodex(leftPageEl: HTMLElement, rightPageEl: HTMLElement, selectedStampRegionId: StampRegionId | null): void {
    const rows = STAMP_REGION_IDS.map((id) => {
      const region = REGION_CODEX_ENTRIES.find((r) => r.id === id);
      const active = id === selectedStampRegionId ? 'active' : '';
      return `
        <div class="manual-list-row ${active}" data-stamp-region-id="${id}">
          <span class="manual-list-icon">🗺️</span>
          <span>${region ? region.name : id}</span>
        </div>`;
    }).join('');
    leftPageEl.innerHTML = `<h2 class="manual-page-title">郵票圖鑑</h2><div class="manual-list">${rows}</div>`;

    const regionId = selectedStampRegionId ?? STAMP_REGION_IDS[0];
    const region = REGION_CODEX_ENTRIES.find((r) => r.id === regionId);
    const required = getRequiredStampForRegion(regionId);
    const requiredCollected = !!required && this.settingsManager.isStampCollected(required.stampId);

    const rarityBlocks = STAMP_RARITY_ORDER.map((rarity: StampRarity) => {
      const stamps = getDecorativeStampsForRegionByRarity(regionId, rarity);
      const items = stamps.map((s) => {
        const collected = this.settingsManager.isStampCollected(s.stampId);
        return `
          <div class="stamp-grid-item ${collected ? '' : 'locked'}">
            ${this.renderStampIconBox(collected, s.icon, s.color)}
            <span class="stamp-grid-name">${collected ? s.displayName : '尚未取得'}</span>
          </div>`;
      }).join('');
      return `
        <h4 class="stamp-rarity-heading stamp-rarity-${rarity}">${STAMP_RARITY_LABELS[rarity]}</h4>
        <div class="stamp-grid">${items}</div>
      `;
    }).join('');

    rightPageEl.innerHTML = `
      <h2 class="manual-page-title">${region ? region.name : regionId}｜郵票收藏</h2>
      <h3 class="manual-subheading">地區必要郵票</h3>
      <div class="stamp-grid">
        <div class="stamp-grid-item ${requiredCollected ? '' : 'locked'}">
          ${required ? this.renderStampIconBox(requiredCollected, required.icon, required.color) : ''}
          <span class="stamp-grid-name">${requiredCollected ? required!.displayName : '尚未取得'}</span>
        </div>
      </div>
      <h3 class="manual-subheading">裝飾郵票</h3>
      ${rarityBlocks}
    `;
  }
}
