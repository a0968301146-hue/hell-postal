/** Temporary structured tracer for "raycast hits NPC, prompt shows, but E
 * does nothing" debugging ("Trace and fix NPC E interaction routing"
 * round) — ONE console.log per real E press covering the full pipeline
 * (raw KeyboardEvent -> game/player state -> InteractionSystem's own
 * raycast/target resolution -> LostFoundSystem's own NPC/queue state, with
 * before/after values), instead of scattered ad-hoc logs or per-frame spam.
 * DEBUG_NPC_E_INTERACTION defaults to false — flip locally only. */
export const DEBUG_NPC_E_INTERACTION = false;

export function logNpcEDebug(section: string, data: Record<string, unknown>): void {
  if (!DEBUG_NPC_E_INTERACTION) return;
  // eslint-disable-next-line no-console
  console.log(`[NPC-E-DEBUG] ${section}`, data);
}
