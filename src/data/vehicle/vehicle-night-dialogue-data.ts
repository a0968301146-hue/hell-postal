// "回歸對話＋離開表演" round (spec二: "台詞集中放在資料檔案，不要把大量文字硬
// 編碼在System裡") — placeholder (程序插槽, not final narrative) dialogue
// lines for the two automatic, vehicle-initiated popups
// vehicle-night-cleaning-system.ts drives: the greeting shown the moment a
// vehicle returns for the night (before cleaning unlocks — spec一/二), and
// the thank-you shown once every one of that vehicle's own nightly points
// is cleaned (carried over from the previous "UI排查" round's own
// VEHICLE_THANKYOU_LINES, moved here rather than left inline in the system
// file). Both are plain `Record<vehicleId, string[]>` — no narrative logic,
// pure data — matching vehicle-cleaning-data.ts's own established
// "data file, system reads it" convention.

export const VEHICLE_RETURN_LINES: Record<string, string[]> = {
  'land-frog-01': ['今天也辛苦了……', '可以幫我整理一下嗎？'],
  'land-rockgiant-01': ['回來了。', '身上好像有點髒。'],
  'land-snail-01': ['慢慢來就好……', '我的殼需要整理一下。'],
  'sea-ray-01': ['今天跑了一趟。', '背上好像沾了不少東西。'],
  'sea-turtle-01': ['回來了。', '龜殼上好像有些東西需要清理。'],
  'sea-kraken-01': ['……回來了。', '觸手有點髒。'],
};

export const VEHICLE_THANKYOU_LINES: Record<string, string[]> = {
  'land-frog-01': ['呱……謝謝你幫我清潔。', '舒服多了！'],
  'land-rockgiant-01': ['……', '謝謝。'],
  'land-snail-01': ['我的殼舒服多了。', '謝謝你。'],
  'sea-ray-01': ['謝謝你幫我擦乾淨。', '舒服多了。'],
  'sea-turtle-01': ['謝謝你清理龜殼。', '輕鬆多了。'],
  'sea-kraken-01': ['……', '謝謝。'],
};

/** Fallback used only if a vehicleId isn't found in the maps above
 * (defensive — every real vehicle has its own entry). */
export const DIALOGUE_LINE_RETURN_FALLBACK = ['回來了。'];
export const DIALOGUE_LINE_THANKYOU_FALLBACK = ['謝謝你幫我整理乾淨。'];
