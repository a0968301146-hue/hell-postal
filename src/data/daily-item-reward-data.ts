// "每日獲得道具" round — plain data only, mirroring daily-unlock-data.ts's
// own established "data file, system reads it" convention (this round's
// spec四: "先建立資料結構...不要自行創作大量道具"). Deliberately NOT an
// inventory/shop system — a NewItemReward is purely a display card (name/
// description/image), never granted into any real item/tool state; the
// player is only shown what's new, nothing here mutates game logic.

export interface NewItemReward {
  id: string;
  name: string;
  description: string;
  /** Placeholder-only this round (spec四) — always null today. A future
   * round wiring in real art only needs to fill this field per item; no
   * control-flow anywhere branches on whether it's set except
   * item-reward-ui.ts's own "no image yet" placeholder box. */
  image: string | null;
}

export interface DailyItemReward {
  day: number;
  items: NewItemReward[];
}

/** Day 1 only, one placeholder card — enough to exercise the full UI flow
 * end to end without inventing real item content ahead of an actual
 * design decision (spec四: "如果目前還沒有正式決定每天拿到什麼道具，可以先
 * 建立placeholder資料"). Every other day intentionally has NO entry below
 * — getDailyItemReward() returns an empty array for them, which is exactly
 * what should suppress the popup entirely (spec五: "沒有獎勵 → 不顯示空白
 * UI") rather than showing an empty card. */
const DAY1_ITEM_REWARD: DailyItemReward = {
  day: 1,
  items: [
    { id: 'placeholder-item', name: '新道具', description: '這是新獲得的道具。', image: null },
  ],
};

const DAILY_ITEM_REWARDS: Record<number, DailyItemReward> = {
  1: DAY1_ITEM_REWARD,
};

/** THE one place a day's reward list is read (mirrors
 * daily-unlock-data.ts's own getEffectiveDayUnlockConfig as "the one
 * lookup every caller uses" convention) — returns an empty array for any
 * day with no configured reward, never undefined, so callers never need a
 * defensive `?? []` of their own. */
export function getDailyItemReward(day: number): NewItemReward[] {
  return DAILY_ITEM_REWARDS[day]?.items ?? [];
}
