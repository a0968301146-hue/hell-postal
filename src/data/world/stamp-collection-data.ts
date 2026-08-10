// 郵票收集資料 ("國家／地區圖鑑＋郵票收集系統" round). One stamp per region
// (spec五: "目前至少對應" the same 5 regions region-codex-data.ts already
// lists) — `regionId` ties every entry back to that ONE region data source
// (spec八: "地區資料 → 統一資料來源，由其他系統引用...不要重新建立另一套地
// 區名稱"), never a second hand-written region-name list.
//
// Visual design (spec六) deliberately REUSES mail-data.ts's own
// MAIL_DESTINATIONS icon/color for the 4 real shippable regions rather than
// inventing new art — those icons were themselves already chosen, in an
// earlier round, specifically to match this exact world (🏰 阿爾戈斯 =
// "王都城堡／城門意象", ⚒️ 赫菲斯提亞 = "火焰與鐵的工匠文化", 🌅 常世群島 =
// "東方海域群島...海上貿易", 🌙 阿耳忒彌西亞 = "精靈族島嶼...月光與自然魔
// 法") — so pulling them in here (rather than drawing a second, separate
// stamp illustration) is what keeps "郵票名稱與信件目的地不同步" from ever
// happening (spec八's own explicit failure mode to avoid): there is
// structurally only one place a region's icon/color can be defined, mail-
// data.ts's MAIL_DESTINATIONS, and this file always reads it fresh rather
// than copying the values in as literals. Ithaca has no MAIL_DESTINATIONS
// entry (never a shippable destination) so its own stamp gets a new, simple
// icon/color here — deliberately plainer than the four grand regions (spec:
// "不要設計成比四大地區更華麗...溫暖、樸素、生活感").
import { MailDestination } from '../../systems/mail/mail-types';
import { MAIL_DESTINATIONS, getMailDestination } from '../../systems/mail/mail-data';
import { RegionCodexId } from './region-codex-data';

export interface StampDefinition {
  stampId: string;
  regionId: RegionCodexId;
  displayName: string;
  description: string;
  illustrationId: string;
  /** Which real MailDestination this stamp's "collect on first successful
   * envelope stamping" trigger keys off (mail-system.ts's own applyStamp) —
   * null for Ithaca, whose stamp is never actually usable on an envelope
   * (see getStampCollectedState's own doc comment for how it's treated
   * instead). */
  mailDestinationId: MailDestination | null;
  icon: string;
  color: number;
  /** 視覺元素 — the spec's own bullet list of design motifs for this
   * region's stamp (spec六); descriptive data only, since no illustration/
   * image asset pipeline exists anywhere in this codebase yet (mirrors
   * region-codex-data.ts's own `illustration: null` placeholder reasoning —
   * see that file's own doc comment). */
  motifs: string[];
  /** 主色調 — the spec's own named color direction, kept as display text
   * alongside the numeric `color` above (which drives the actual rendered
   * envelope-stamp visual via mail-data.ts). */
  colorTheme: string;
}

function stampForDestination(
  stampId: string, regionId: RegionCodexId, displayName: string, description: string,
  mailDestinationId: MailDestination, motifs: string[], colorTheme: string
): StampDefinition {
  const dest = getMailDestination(mailDestinationId);
  return {
    stampId, regionId, displayName, description, illustrationId: `${stampId}-art`,
    mailDestinationId, icon: dest.icon, color: dest.color, motifs, colorTheme,
  };
}

export const STAMP_DEFINITIONS: StampDefinition[] = [
  stampForDestination(
    'stamp-argos', 'argos', '阿爾戈斯郵票', '王都城堡與城牆，鑲著王冠紋飾的金色郵票。',
    'taipei', ['王都城堡', '城牆', '王冠', '王都建築'], '金色／皇家色'
  ),
  stampForDestination(
    'stamp-hephaestia', 'hephaestia', '赫菲斯提亞郵票', '鍛爐火光映照下的礦坑與鐵鎚，鐵灰與鍛爐橙交織的郵票。',
    'taichung', ['鍛造爐', '鐵鎚', '山脈', '礦坑', '矮人鍛造工坊'], '鍛爐橙／鐵灰'
  ),
  stampForDestination(
    'stamp-evergreen-isles', 'evergreen-isles', '常世群島郵票', '朝霞海浪中的群島與鳥居剪影，融合妖怪文化元素的郵票。',
    'japan', ['群島', '海浪', '東方建築', '神社／鳥居', '妖怪文化元素'], '朝霞珊瑚／海洋色'
  ),
  stampForDestination(
    'stamp-artemisia', 'artemisia', '阿耳忒彌西亞郵票', '月光森林中的巨大古樹與魔法植物，精靈之島的郵票。',
    'usa', ['巨大古樹', '森林', '精靈建築', '月光', '花朵', '魔法植物'], '月光森林綠'
  ),
  // Ithaca — no MAIL_DESTINATIONS entry (never a shippable destination), so
  // its own icon/color are new here rather than reused; deliberately
  // plainer/warmer than the four regions above (spec: "不要設計成比四大地區
  // 更華麗...呈現主角真正的家").
  {
    stampId: 'stamp-ithaca', regionId: 'ithaca', displayName: '伊塔卡港鎮郵票',
    description: '溫暖樸素的港口小鎮剪影——主角真正的家。',
    illustrationId: 'stamp-ithaca-art', mailDestinationId: null,
    icon: '⚓', color: 0xc8935a,
    motifs: ['港口', '小鎮建築', '物流中心', '船隻', '海岸'], colorTheme: '溫暖港灣棕',
  },
];

export function getStampDefinition(stampId: string): StampDefinition | undefined {
  return STAMP_DEFINITIONS.find((s) => s.stampId === stampId);
}

export function getStampForRegion(regionId: RegionCodexId): StampDefinition | undefined {
  return STAMP_DEFINITIONS.find((s) => s.regionId === regionId);
}

/** Reverse lookup — mail-system.ts's applyStamp() only knows the
 * MailDestination it just stamped, not this file's own stampId scheme; this
 * is the ONE place that translation happens (never hand-duplicated at the
 * call site). */
export function getStampForMailDestination(dest: MailDestination): StampDefinition | undefined {
  return STAMP_DEFINITIONS.find((s) => s.mailDestinationId === dest);
}

// Module-load sanity check — every real MAIL_DESTINATIONS entry must have
// exactly one corresponding stamp, so a future destination added to
// mail-data.ts can never silently ship without its own collectible stamp.
for (const dest of MAIL_DESTINATIONS) {
  if (!getStampForMailDestination(dest.id)) {
    throw new Error(`stamp-collection-data: no StampDefinition for MailDestination "${dest.id}"`);
  }
}
