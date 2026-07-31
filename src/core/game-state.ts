/** Cross-system player interaction state — read/written by Player,
 * Interaction, Pickup, Pallet, Dolly, and Lost Found systems alike, so it
 * lives in core rather than under any single system. Exactly one instance
 * is created per game session (see app/game-context.ts). */
export type PlayerInteractionState = 'empty-handed' | 'holding-item' | 'placement-preview' | 'stamping-minigame' | 'vehicle-settlement' | 'pushing-dolly';

/** "Add tool hotbar and cargo hook" round: which bottom-hotbar tool is
 * currently selected — only the two USABLE slots (徒手/捕貨鉤) have a value
 * here; slots 2/4 stay locked and are never represented in this union (see
 * tool-system.ts). Read by InteractionSystem (suppress the legacy F action
 * while the hook owns F) and PickupSystem (block E-pickup entirely while
 * the hook is selected, keeping "捕貨鉤必須空手使用" true for the WHOLE time
 * it's selected, not just at the moment of switching to it). */
export type ActiveTool = 'empty' | 'cargoHook';

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
