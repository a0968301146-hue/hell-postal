/** Cross-system player interaction state — read/written by Player,
 * Interaction, Pickup, Pallet, Dolly, and Lost Found systems alike, so it
 * lives in core rather than under any single system. Exactly one instance
 * is created per game session (see app/game-context.ts). */
export type PlayerInteractionState = 'empty-handed' | 'holding-item' | 'placement-preview' | 'stamping-minigame' | 'vehicle-settlement' | 'pushing-dolly';

/** "Add tool hotbar and cargo hook" round: which bottom-hotbar tool is
 * currently selected — 'powerGloves' added by "Add power gloves and refine
 * cargo hook cooldown" round, 'sprayCan' added by "Fix pallet throw and add
 * spray paint tool" round (slot 4). Read by PickupSystem (block generic
 * E-pickup of individual cargo/envelopes/lost items/mail boxes unless
 * activeTool==='empty' — cargoHook, powerGloves, and sprayCan each have
 * their own dedicated interaction instead, keeping the "must be empty-handed
 * to target a NEW item" invariant true for the whole time any of them is
 * selected, not just at the moment of switching to it) and by PalletSystem
 * (only powerGloves may pick up the pallet). */
/** 'envelopeVacuum' added by "Add ladder tool station and envelope vacuum"
 * round三 — only ever selectable via the tool cart's swappable loadout
 * (see tool-loadout-data.ts), never a permanently-fixed hotbar slot. */
export type ActiveTool = 'empty' | 'cargoHook' | 'powerGloves' | 'sprayCan' | 'envelopeVacuum';

export interface PlayerInteractionData {
  state: PlayerInteractionState;
  heldObjectId: string | null;
  targetedObjectId: string | null;
  activeTool: ActiveTool;
}

export function createPlayerInteractionData(): PlayerInteractionData {
  return {
    state: 'empty-handed',
    heldObjectId: null,
    targetedObjectId: null,
    activeTool: 'empty',
  };
}
