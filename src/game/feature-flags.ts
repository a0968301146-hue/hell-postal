// Centralized switches for which parts of the main scene/flow are active.
// The old counter/mail flow is NOT deleted — its classes and data still
// exist and still work if re-enabled — it's just kept out of the current
// main loop by passing these flags into each system's constructor
// (game.ts) rather than scattering `if` checks across many files.
export const ENABLE_LEGACY_COUNTER = false;
export const ENABLE_LEGACY_MAIL_FLOW = false;
// Re-enabled ("北側卸貨口/重新啟用呼叫載具" round section 六) — 呼叫載具/載具
// 出發 are back in the main flow, now gated by DailyFlowSystem's state
// instead of the old always-available rule (see vehicle-control-system.ts
// canCall/canDepart).
export const ENABLE_VEHICLE_LOADING_FLOW = true;
export const ENABLE_LEGACY_TEST_CARGO = false;
// TEMPORARY TEST CHEAT — remove before public demo. Gates whether the
// "完成當日" test cheat button (lost-found room, north wall — see
// complete-day-cheat-system.ts) is built into the world at all. Kept as its
// own flag (not folded into any of the above) so it can be flipped off with
// zero other changes once no longer needed.
export const ENABLE_COMPLETE_DAY_CHEAT = true;
