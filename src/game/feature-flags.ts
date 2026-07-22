// Centralized switches for which parts of the main scene/flow are active
// this round (spec "貨物標籤與載具相容判定" round's follow-up: "每日貨品清空
// 核心流程 v0.1"). The old counter/vehicle-loading/mail flow is NOT deleted
// — its classes and data still exist and still work if re-enabled — it's
// just kept out of the current main loop by passing these flags into each
// system's constructor (game.ts) rather than scattering `if` checks for
// "is this round's daily-flow the active mode" across many files.
export const ENABLE_LEGACY_COUNTER = false;
export const ENABLE_LEGACY_MAIL_FLOW = false;
export const ENABLE_VEHICLE_LOADING_FLOW = false;
export const ENABLE_LEGACY_TEST_CARGO = false;
