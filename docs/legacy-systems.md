# `src/game/` legacy prototype files

Phase 6 scope note: this document only catalogs the 23 files remaining in
`src/game/` — it does not move or delete any of them (that stays out of
scope for this round). The one exception, `cargo-compliance.ts`, is covered
separately at the bottom: it was confirmed fully unreferenced and deleted
this round per explicit permission in the Phase 6 spec.

`src/game/` predates the Phase 1–5 modular refactor (`src/systems/<name>/`).
Some of these files are genuinely dead prototype code; others are quietly
live infrastructure that just never got moved out of `src/game/` because
moving them wasn't in scope for any round so far. The "status" column below
is what actually happens at runtime today, not what the file name suggests.

Feature flags live in `src/game/feature-flags.ts`:
- `ENABLE_LEGACY_COUNTER = false`
- `ENABLE_LEGACY_MAIL_FLOW = false`
- `ENABLE_VEHICLE_LOADING_FLOW = true`
- `ENABLE_LEGACY_TEST_CARGO = false`

## Live / core infrastructure (not legacy, despite the folder)

These are imported by currently-active systems outside `src/game/` and run
every session regardless of any feature flag. Recommendation: leave in
place this round; a future round could relocate them into `src/systems/`
or `src/shared/`, but that's a naming/location cleanup, not a functional
change, so it's out of scope here.

| File | Still imported? | Flag | Disabled? | Recommendation |
|---|---|---|---|---|
| `compass-ui.ts` | Yes — `app/create-game-systems.ts` | none | No — updates every frame | Keep (live) |
| `feature-flags.ts` | Yes — multiple systems read these flags | n/a (defines the flags) | No | Keep (live) |
| `tutorial-data.ts` | Yes — `systems/pause-menu/pause-menu-ui.ts`, `systems/settings/settings-manager.ts` | none | No | Keep (live) |
| `codex-data.ts` | Yes — `systems/pause-menu/pause-menu-ui.ts` (manual/codex vehicle info) | none | No | Keep (live) |
| `dolly-data.ts` | Yes — `dolly-system.ts` AND `systems/player/player-system.ts` (`DOLLY_PUSH_SPEED_MULTIPLIER`) | none | No | Keep (live) |
| `dolly-system.ts` | Yes — `app/create-game-systems.ts`, `systems/interaction` | none | No — constructed & updated unconditionally (back-area flatbed dolly) | Keep (live) |
| `package-data.ts` | Yes — `shared/types/interactable.ts` (`PackageData` is part of the core `InteractableObject` type), plus legacy-flow files below | none (core type also used by legacy flow) | No | Keep (live) |

## Legacy, wired but functionally inert (flag-gated off)

These are still constructed (or imported by something that's constructed)
so they compile and run, but the relevant feature flag keeps their actual
behavior from ever triggering — either the constructor no-ops when the
flag is false, or the code path that would call into them is unreachable
(e.g. `envelope-stamp-station.ts` never sets `readyEnvelopeId` when
`ENABLE_LEGACY_MAIL_FLOW` is false, so `stamp-minigame.ts` can never start).
Recommendation: keep as-is — they're cheap to leave wired and either could
be re-enabled or ported to Unity later; deleting working, flag-gated
systems isn't a "boundary fix," it's a scope change this round explicitly
avoids.

| File | Still imported? | Flag | Disabled? | Recommendation |
|---|---|---|---|---|
| `destination-data.ts` | Yes — `envelope-data.ts`, `package-data.ts`, `sorting-box-data.ts`, `counter-service-system.ts` | `ENABLE_LEGACY_MAIL_FLOW` / `ENABLE_LEGACY_COUNTER` | Yes | Keep |
| `stamp-data.ts` | Yes — same + `stamp-minigame.ts` | `ENABLE_LEGACY_MAIL_FLOW` / `ENABLE_LEGACY_COUNTER` | Yes | Keep |
| `envelope-data.ts` | Yes — `envelope-system.ts`, `mail-sorting-system.ts`, `counter-service-system.ts` | `ENABLE_LEGACY_MAIL_FLOW` | Yes | Keep |
| `sorting-box-data.ts` | Yes — `mail-sorting-system.ts`, `sorting-box-system.ts` | `ENABLE_LEGACY_MAIL_FLOW` | Yes | Keep |
| `counter-npc-system.ts` | Yes — `app/create-game-systems.ts`, `counter-service-system.ts` | `ENABLE_LEGACY_COUNTER` | Yes — constructed but `.update()` never called | Keep |
| `stamp-minigame.ts` | Yes — `app/game-app.ts` | `ENABLE_LEGACY_MAIL_FLOW` (indirectly, via `envelope-stamp-station.ts` never producing a ready envelope) | Yes — unreachable | Keep |
| `mail-sorting-system.ts` | Yes — `app/create-game-systems.ts` | `ENABLE_LEGACY_MAIL_FLOW` | Yes — constructed but `.update()` never called | Keep |
| `counter-layout-data.ts` | Yes — `counter-npc-system.ts`, `counter-service-system.ts` | `ENABLE_LEGACY_COUNTER` | Yes | Keep |
| `counter-service-system.ts` | Yes — `app/create-game-systems.ts`, `systems/interaction` | `ENABLE_LEGACY_COUNTER` | Yes — constructed but `.update()` never called | Keep |
| `envelope-stamp-station.ts` | Yes — `app/create-game-systems.ts`, `systems/interaction` | `ENABLE_LEGACY_MAIL_FLOW` | Yes — table mesh never built when off | Keep |
| `envelope-system.ts` | Yes — `app/create-game-systems.ts`, `systems/interaction` | `ENABLE_LEGACY_MAIL_FLOW` | Yes — crate/interior plane never built when off | Keep |
| `sorting-box-system.ts` | Yes — `app/create-game-systems.ts`, `mail-sorting-system.ts`, `systems/interaction` | `ENABLE_LEGACY_MAIL_FLOW` | Yes — boxes never built when off | Keep |

## Legacy and fully orphaned (zero references anywhere in `src/`)

Nothing imports these — not even a flag-gated construction site. Each has
an explicit comment at its would-be call site in
`app/create-game-systems.ts` explaining why it was dropped from the active
flow (front-office/dividing-wall removal for the conveyor; cargo now ships
by riding a vehicle instead of walking into a ground zone for the outbound
zone). No counterpart exists for `scale-system.ts` / `sign-system.ts` at
all. These are the strongest delete candidates, but per Phase 6 scope
("不要移動這23個舊原型檔案"), no action is taken on them this round —
listed here only for a future cleanup round to act on.

| File | Still imported? | Flag | Disabled? | Recommendation |
|---|---|---|---|---|
| `conveyor-system.ts` | No | n/a | Yes — never constructed | Delete (future round) |
| `scale-system.ts` | No | n/a | Yes — never constructed | Delete (future round) |
| `sign-system.ts` | No | n/a | Yes — never constructed | Delete (future round) |
| `outbound-zone-system.ts` | No | n/a | Yes — never constructed | Delete (future round) |

## `cargo-compliance.ts` (deleted this round)

Searched exhaustively before deleting:
- Static imports: `grep -rn "from '.*cargo-compliance'"` across all of
  `src/` — zero matches.
- Dynamic imports: `grep -rn "import(.*cargo-compliance"` — zero matches.
- String/reflective references to its exports (`evaluateCargoOutcome`,
  `scoreForOutcome`, `CargoOutcome`, `POINTS_CORRECT_CARGO`,
  `POINTS_INCORRECT_CARGO`) anywhere outside the file itself — zero
  matches.
- The only remaining references were three doc comments (`hud.ts`,
  `systems/cargo/cargo-data.ts`, `systems/vehicle/vehicle-data.ts`)
  pointing at it as "the" departure-judgment source — all three were
  stale: `systems/vehicle/vehicle-control-system.ts` has its own
  independent, currently-live judgment (`vehicleAcceptsCargo` /
  `effectiveCargoKind`) that never called into `cargo-compliance.ts`.
  Those three comments were updated to point at
  `vehicle-control-system.ts` instead, with no logic changes anywhere.

Conclusion: confirmed fully unreferenced, deleted (`git rm`). No doubt
remained, so nothing here needed to be kept "just in case."

One pre-existing, unrelated observation surfaced during this search (not
changed, since Phase 6 doesn't touch gameplay values): `vehicleAcceptsCargo`
only checks `cargo.cargoType` against `VehicleConfig.acceptedCargoTypes` —
`acceptedRouteTypes` / `cargo.routeType` (which `cargo-compliance.ts` used
to also check) aren't actually consulted at departure judgment time in the
current build; `acceptedRouteTypes` is only read for the codex/manual's
display labels (`codex-data.ts`). This predates Phase 6 and is left
untouched.
