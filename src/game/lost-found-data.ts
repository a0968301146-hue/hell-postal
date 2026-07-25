// Case + item data for the west-side lost & found desk ("Reduce daily cargo
// and add lost found desk" round 三). Deliberately independent of
// cargo-data.ts/vehicle-data.ts — these items are never cargo, never ride a
// vehicle, and never touch DAILY_CARGO_CONFIG. lost-found-system.ts reads
// this data to build the shelf and drive the one case; it never hand-picks
// item names/colors/text inline.

export interface LostFoundItemDef {
  /** Suffix only — lost-found-system.ts prefixes this to build the full
   * InteractableObject id (e.g. 'lostfound-item-silver-pocketwatch'). */
  id: string;
  displayName: string;
  color: number;
}

export interface LostFoundCaseDef {
  id: string;
  customerName: string;
  /** Shown via LostFoundUI when the player first talks to the customer. */
  requestText: string;
  /** Which LOST_FOUND_ITEMS[].id the player must bring to the counter. */
  targetItemId: string;
  successText: string;
  wrongText: string;
}

/** Every item on the shelf — one correct match for the active case, the
 * rest are decoys so "拿錯可重試" (spec三) has something to actually get
 * wrong. */
export const LOST_FOUND_ITEMS: LostFoundItemDef[] = [
  { id: 'silver-pocketwatch', displayName: '銀色懷錶', color: 0xc0c0c0 },
  { id: 'red-umbrella', displayName: '紅色雨傘', color: 0xb03030 },
  { id: 'brown-suitcase', displayName: '棕色行李箱', color: 0x6b4a2a },
];

/** Exactly one case this round (spec: "先製作一個可完整測試的案件，不擴充故事
 * 內容") — lost-found-system.ts activates LOST_FOUND_CASES[0] on start and
 * does not cycle to another after it's solved. */
export const LOST_FOUND_CASES: LostFoundCaseDef[] = [
  {
    id: 'case-001',
    customerName: '委託人',
    requestText: '「我把一只銀色懷錶忘在貨物裡了，錶面上刻著花紋……可以請你幫我找找嗎？」',
    targetItemId: 'silver-pocketwatch',
    successText: '「就是這個！太感謝你了。」',
    wrongText: '「這……好像不是我要找的東西，麻煩再找找看。」',
  },
];
