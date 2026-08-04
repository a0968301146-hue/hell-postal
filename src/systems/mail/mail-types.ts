// Shared type vocabulary for the mail/envelope-stamping module ("Add
// modular envelope stamping and regional mail bag system" round). Kept
// self-contained (no import from systems/cargo/systems/vehicle) so this
// module's own region concept never gets coupled to CargoRegion — even
// though the values happen to read the same ('domestic'/'international'),
// mail region is a wholly independent piece of data (spec九: 信件袋裝載判定
// 只看國內／海外，不看特定載具名稱).
export type MailRegion = 'domestic' | 'international';

export type MailDestination = 'taipei' | 'taichung' | 'japan' | 'usa';

export type EnvelopeState = 'unstamped' | 'stamped' | 'bagged' | 'shipped';

export interface EnvelopeRecord {
  envelopeId: string;
  destination: MailDestination;
  region: MailRegion;
  requiredStamp: MailDestination;
  attachedStamp: MailDestination | null;
  state: EnvelopeState;
  /** Which MailBag currently holds this envelope, if any — set the moment
   * state becomes 'bagged', cleared if taken back out of an unsealed bag. */
  bagId: string | null;
  /** "Add playable envelope visual presets" round: which
   * MailEnvelopeVisualPreset.id (mail-data.ts) this specific envelope was
   * spawned with — picked independently of `destination`/`region`/
   * `requiredStamp` (spec: "目的地、國內／海外、requiredStamp 與外型彼此獨
   * 立...不可把外型當成目的地判斷依據"), fixed at spawn and never re-picked.
   * Drives the actual mesh/materials built at spawn and rebuilt on stamping
   * (mail-data.ts buildEnvelopeGeometry/buildEnvelopeMaterials) — nothing
   * else (region/stamp/bag judgment) ever reads this field. */
  visualPresetId: string;
}

/** "Remove sealing and add physical mail box contents" round一: sealing is
 * gone entirely — a mail box no longer has a separate lifecycle state of
 * its own at all, only ever "open" in the old sense. The 3 conceptual
 * states the spec still describes (empty / destination-set / holding
 * envelopes) are derived directly from `destinationPattern`/`envelopeIds`
 * wherever needed, never stored as a redundant parallel field that could
 * drift out of sync with them. */
export interface MailBagRecord {
  bagId: string;
  /** null until the player sets it via F at the bag (spec六: "unset"), or
   * the first correctly-stamped envelope to settle inside auto-sets it. */
  destinationPattern: MailDestination | null;
  region: MailRegion | null;
  envelopeIds: string[];
  capacity: number;
}

/** A snapshot of one envelope's identifying data, frozen into a
 * PackedMailBag at pack time ("Add regional envelope dispatch machine"
 * round) — the ORIGINAL EnvelopeRecord stays the single source of truth for
 * that envelope's own live state (still owned by MailSystem, mirrored via
 * setEnvelopeBagged exactly like MailBagSystem's own envelopes), this is
 * only the display-facing copy a bag needs to show/settle without a second
 * MailSystem lookup per envelope. */
export interface PackedEnvelopeSnapshot {
  envelopeId: string;
  destination: MailDestination;
  visualPresetId: string;
}

/** A sealed, already-full regional mail bag ("Add regional envelope dispatch
 * machine" round九) — unlike MailBagRecord (an open container envelopes can
 * still be inserted into/removed from after spawn), a PackedMailBag's
 * contents are FIXED the moment EnvelopeDispatchMachineSystem generates it;
 * the individual envelope objects that funded it are already gone from the
 * scene (consumed into the dispatcher's own per-region buffer the instant
 * they passed through a hole's sensor — see EnvelopeDispatchMachineSystem).
 * Physical fields (mesh/rigidBody/isHeld) deliberately live on the shared
 * InteractableObject instead of being duplicated here, mirroring
 * MailBagRecord's own established split; `isLoaded`/`isSettled` are likewise
 * never cached here — VehicleControlSystem's own departure-time bay scan
 * (mirroring its existing MailBagSystem scan) decides both freshly every
 * time, exactly like every other loadable container in this codebase. */
export interface PackedMailBagRecord {
  bagId: string;
  destination: MailDestination;
  region: MailRegion;
  envelopeIds: string[];
  envelopeData: PackedEnvelopeSnapshot[];
  envelopeCount: number;
}
