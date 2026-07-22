// Centralized cargo-vs-vehicle outcome judgment (spec section 八 + 十) — the
// ONLY place these rules should live, so a future rule change only touches
// this one file instead of being re-derived inside settlement code.
//
// This round no longer judges label correctness at all — every cargo item
// spawns with its labels already fixed/correct (see cargo-data.ts), so the
// only question at departure is whether the VEHICLE was allowed to accept
// this cargo's route/type. Labels are purely something the PLAYER reads;
// the system never re-derives rules from them (spec section 八: "系統判定
// 的資料來源仍是CargoData，不要依靠材質像素或畫面文字反向解析").
import { CargoData } from './cargo-data';
import { VehicleConfig } from './vehicle-data';

export interface CargoOutcome {
  routeCompatible: boolean;
  cargoTypeCompatible: boolean;
  /** True only when both checks pass. */
  successful: boolean;
}

export function evaluateCargoOutcome(cargo: CargoData, vehicle: VehicleConfig): CargoOutcome {
  const routeCompatible = vehicle.acceptedRouteTypes.includes(cargo.routeType);
  const cargoTypeCompatible = vehicle.acceptedCargoTypes.includes(cargo.cargoType);
  return {
    routeCompatible,
    cargoTypeCompatible,
    successful: routeCompatible && cargoTypeCompatible,
  };
}

/** Scoring constants (spec section 十一) — centralized here so nothing
 * re-derives "how much is a correct/incorrect item worth" elsewhere. */
export const POINTS_CORRECT_CARGO = 1;
export const POINTS_INCORRECT_CARGO = -1;

export function scoreForOutcome(outcome: CargoOutcome): number {
  return outcome.successful ? POINTS_CORRECT_CARGO : POINTS_INCORRECT_CARGO;
}
