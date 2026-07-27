/** Which cargo-category-data.ts CargoCategory values the daily spawn pool
 * may include, starting day 1 with no later unlock day for any of them
 * (spec "Add dual elevated unloading ports and day-one special cargo" round
 * 四: "從第1天開始...移除...天數解鎖限制"). 'large' isn't listed here — it's
 * its own CargoShapeType, already unconditionally generated via
 * DAILY_CARGO_CONFIG.largeCount (daily-flow-data.ts); this list only governs
 * cargo-category-data.ts's pickCargoCategory() pool (normal/fragile/frozen/
 * live), the one part of the daily mix that previously had no way to
 * produce frozen/live at all.
 *
 * Lives here (Phase 6: 模組邊界修正) rather than in daily-flow-data.ts,
 * where it originated — systems/cargo and systems/daily-flow each need it,
 * and daily-flow-data.ts itself already depends on systems/world-layout, so
 * systems/cargo importing it from systems/daily-flow's barrel would
 * transitively pull in daily-flow-system.ts, which imports CargoSystem from
 * systems/cargo's own barrel — a file-level circular import. Both systems
 * read this same neutral constant instead. */
export const DAILY_CARGO_CATEGORY_POOL: readonly ('normal' | 'fragile' | 'frozen' | 'live')[] =
  ['normal', 'fragile', 'frozen', 'live'];
