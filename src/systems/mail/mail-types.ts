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

export type MailBagState = 'open' | 'sealed';

export interface MailBagRecord {
  bagId: string;
  /** null until the player sets it via F at the bag (spec六: "unset"). */
  destinationPattern: MailDestination | null;
  region: MailRegion | null;
  state: MailBagState;
  envelopeIds: string[];
  capacity: number;
}
