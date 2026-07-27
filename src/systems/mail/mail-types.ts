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
