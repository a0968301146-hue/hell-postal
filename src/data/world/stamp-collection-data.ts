// 郵票收集資料 ("郵票系統重新區分" round) — splits the single "one stamp per
// region" concept an earlier round built into TWO genuinely separate
// concepts that share nothing but a region id:
//
//   - 必要郵票 (RequiredStampDefinition): the SAME stamp mail-system.ts's
//     applyStamp() already validates against (spec一: "維持目前既有的寄送／
//     分類功能") — reuses mail-data.ts's own MAIL_DESTINATIONS icon/color
//     exactly as the old single-stamp design did, for the SAME "don't let a
//     stamp's identity drift from its mail destination" reason (spec八).
//     One per shippable region — 4 total, Ithaca excluded (spec一/十三: "伊
//     塔卡港鎮不需要郵票").
//   - 裝飾郵票 (DecorativeStampDefinition): NEW this round — a purely
//     collectible stamp every envelope is randomly assigned at SPAWN time
//     (mail-system.ts's spawnEnvelope), independent of the required stamp
//     and never affecting shipping/sorting (spec二: "與信件的必要郵票用途完
//     全不同...不影響信件是否正確寄送"). 8 per region (3 common + 3 rare + 2
//     super-rare, spec三), drawn via a two-stage 80/19/1 rarity roll then a
//     uniform pick within that rarity's own styles (spec四) — see
//     pickRandomDecorativeStampForRegion below.
//
// Both id schemes are namespaced distinctly (stamp-required-* vs
// stamp-<region>-<rarity>-<n>) so they can never collide inside the ONE
// shared settingsManager.collectedStamps array both register into (spec六/
//十一: "不要另外建立第二套收藏資料"). Registration timing for BOTH is owned
// entirely by mail-system.ts's applyStamp() success path (spec五/十二: 信件
// 生成/拿取/丟棄/放回都不算收藏，只有工作台成功處理才算) — this file only
// ever exports pure data + pure pick functions, never touches
// settingsManager itself (same "neutral data layer" convention
// region-codex-data.ts already established).
import { MailDestination } from '../../systems/mail/mail-types';
import { MAIL_DESTINATIONS } from '../../systems/mail/mail-data';
import { RegionCodexId } from './region-codex-data';

/** The 4 regions that actually have a stamp system — Ithaca is deliberately
 * NOT a member of this type (spec一/十三: "不建立伊塔卡港鎮必要郵票...不建立
 * 伊塔卡港鎮裝飾郵票"), enforced at the TYPE level so a future region added
 * here without updating this exclusion would be a compile error, not a
 * silent gap. */
export type StampRegionId = Exclude<RegionCodexId, 'ithaca'>;

export type StampRarity = 'common' | 'rare' | 'superRare';

/** 80/19/1 (spec三/四) — the ONE place these weights are defined;
 * pickDecorativeStampRarity below is the only reader. Percentages, not
 * fractions, purely so they read naturally against the spec's own "80%／
 * 19%／1%" wording. */
export const STAMP_RARITY_WEIGHTS: Record<StampRarity, number> = {
  common: 80,
  rare: 19,
  superRare: 1,
};

export const STAMP_RARITY_ORDER: StampRarity[] = ['common', 'rare', 'superRare'];

export const STAMP_RARITY_LABELS: Record<StampRarity, string> = {
  common: '普通',
  rare: '稀有',
  superRare: '超級稀有',
};

/** 地區必要郵票 — mail-system.ts's applyStamp() already validates a
 * `MailDestination` match; this is purely the SAME stamp's collectible
 * identity (spec九: 必要郵票也套用鎖定／已取得視覺規則, counted in the 36-
 * stamp total per spec三). Visual fields (icon/color) are read from
 * mail-data.ts's own MAIL_DESTINATIONS at module-load time (see
 * requiredStampFor below) rather than copied in as literals, so a required
 * stamp's look can never drift from the mail destination it actually
 * represents (spec八's own explicit anti-goal). */
export interface RequiredStampDefinition {
  stampId: string;
  regionId: StampRegionId;
  mailDestinationId: MailDestination;
  displayName: string;
  icon: string;
  color: number;
}

/** 裝飾郵票 — pure collectible, zero shipping/sorting role (spec二). */
export interface DecorativeStampDefinition {
  stampId: string;
  regionId: StampRegionId;
  rarity: StampRarity;
  displayName: string;
  description: string;
  icon: string;
  color: number;
  motifs: string[];
  colorTheme: string;
}

interface RegionStampTheme {
  regionId: StampRegionId;
  mailDestinationId: MailDestination;
  colorTheme: string;
  color: number;
}

// Reused verbatim from the earlier round's single-stamp design (spec's own
// visual-motif direction never changed, only the data SHAPE around it) —
// mail-data.ts's MAIL_DESTINATIONS remains the actual source of each
// region's real icon/color; `color`/`colorTheme` here are this file's own
// flavor-text layer for decorative stamps, kept in sync by hand since they
// describe painted illustrations mail-data.ts has no reason to know about.
const REGION_THEMES: RegionStampTheme[] = [
  { regionId: 'argos', mailDestinationId: 'taipei', colorTheme: '金色／皇家色', color: 0xd4af37 },
  { regionId: 'hephaestia', mailDestinationId: 'taichung', colorTheme: '鍛爐橙／鐵灰', color: 0xcc5500 },
  { regionId: 'evergreen-isles', mailDestinationId: 'japan', colorTheme: '朝霞珊瑚／海洋色', color: 0xff7f50 },
  { regionId: 'artemisia', mailDestinationId: 'usa', colorTheme: '月光森林綠', color: 0x5f8a6f },
];

function requiredStampFor(regionId: StampRegionId, mailDestinationId: MailDestination, displayName: string, icon: string, color: number): RequiredStampDefinition {
  return { stampId: `stamp-required-${regionId}`, regionId, mailDestinationId, displayName, icon, color };
}

export const REQUIRED_STAMPS: RequiredStampDefinition[] = [
  requiredStampFor('argos', 'taipei', '阿爾戈斯必要郵票', '🏰', 0xd4af37),
  requiredStampFor('hephaestia', 'taichung', '赫菲斯提亞必要郵票', '⚒️', 0xcc5500),
  requiredStampFor('evergreen-isles', 'japan', '常世群島必要郵票', '🌅', 0xff7f50),
  requiredStampFor('artemisia', 'usa', '阿耳忒彌西亞必要郵票', '🌙', 0x5f8a6f),
];

interface DecorativeStampSeed {
  rarity: StampRarity;
  displayName: string;
  description: string;
  icon: string;
  motifs: string[];
}

// 3 common + 3 rare + 2 super-rare per region (spec三) — common styles read
// as everyday regional scenery, rare as notable landmarks, super-rare as
// legendary/mythic imagery, echoing the earlier round's own established
// visual-motif direction for each region rather than inventing an
// unrelated look.
const DECORATIVE_SEEDS: Record<StampRegionId, DecorativeStampSeed[]> = {
  argos: [
    { rarity: 'common', displayName: '王都城門', description: '阿爾戈斯王都的主城門剪影。', icon: '🚪', motifs: ['城門', '王都建築'] },
    { rarity: 'common', displayName: '城牆哨塔', description: '沿著王都城牆矗立的哨塔。', icon: '🗼', motifs: ['城牆', '哨塔'] },
    { rarity: 'common', displayName: '集市街景', description: '王都熱鬧的多種族集市街景。', icon: '🏪', motifs: ['集市', '王都建築'] },
    { rarity: 'rare', displayName: '王宮尖塔', description: '阿爾戈斯王宮高聳的尖塔。', icon: '🏯', motifs: ['王宮', '尖塔'] },
    { rarity: 'rare', displayName: '騎士徽章', description: '王國騎士團的正式徽章。', icon: '🛡️', motifs: ['騎士徽章', '王國紋飾'] },
    { rarity: 'rare', displayName: '噴泉廣場', description: '王都中央廣場的雕像噴泉。', icon: '⛲', motifs: ['廣場', '噴泉'] },
    { rarity: 'superRare', displayName: '王冠寶座', description: '鑲著王冠紋飾的王座，王都的權力象徵。', icon: '👑', motifs: ['王冠', '寶座'] },
    { rarity: 'superRare', displayName: '建國紀念碑', description: '紀念阿爾戈斯建國的古老石碑。', icon: '🗿', motifs: ['建國紀念碑', '王都歷史'] },
  ],
  hephaestia: [
    { rarity: 'common', displayName: '鍛造爐火', description: '赫菲斯提亞工坊中熊熊燃燒的鍛造爐火。', icon: '🔥', motifs: ['鍛造爐', '爐火'] },
    { rarity: 'common', displayName: '礦坑入口', description: '通往山脈深處礦區的坑道入口。', icon: '⛏️', motifs: ['礦坑', '山脈'] },
    { rarity: 'common', displayName: '鐵鎚工具', description: '矮人工匠常用的鐵鎚與鍛造工具。', icon: '🔨', motifs: ['鐵鎚', '矮人鍛造工坊'] },
    { rarity: 'rare', displayName: '山城全景', description: '由山城、礦區、工坊組成的赫菲斯提亞聯邦全景。', icon: '🏔️', motifs: ['山城', '礦山'] },
    { rarity: 'rare', displayName: '齒輪機械', description: '矮人工匠精巧的齒輪機械裝置。', icon: '⚙️', motifs: ['齒輪', '矮人工藝'] },
    { rarity: 'rare', displayName: '熔爐大殿', description: '赫菲斯提亞最大的中央熔爐大殿。', icon: '🏭', motifs: ['熔爐', '鍛造工坊'] },
    { rarity: 'superRare', displayName: '矮人王徽', description: '矮人鍛造之城歷代領主的王徽紋樣。', icon: '🪓', motifs: ['矮人王徽', '鍛造傳承'] },
    { rarity: 'superRare', displayName: '傳說神兵', description: '傳說中由赫菲斯提亞大師鍛造的神兵。', icon: '⚔️', motifs: ['傳說神兵', '鍛造傳說'] },
  ],
  'evergreen-isles': [
    { rarity: 'common', displayName: '朝霞海浪', description: '常世群島清晨朝霞映照下的海浪。', icon: '🌊', motifs: ['朝霞', '海浪'] },
    { rarity: 'common', displayName: '鳥居剪影', description: '島上神社前的鳥居剪影。', icon: '⛩️', motifs: ['鳥居', '神社'] },
    { rarity: 'common', displayName: '漁村港口', description: '群島間往來船隻停靠的漁村港口。', icon: '🚤', motifs: ['漁村', '港口'] },
    { rarity: 'rare', displayName: '妖怪祭典', description: '人類與妖怪共同慶祝的島嶼祭典。', icon: '🏮', motifs: ['妖怪文化元素', '祭典'] },
    { rarity: 'rare', displayName: '神社階梯', description: '通往山頂神社的悠長石階。', icon: '🎎', motifs: ['神社', '石階'] },
    { rarity: 'rare', displayName: '竹林小徑', description: '島嶼深處靜謐的竹林小徑。', icon: '🎋', motifs: ['竹林', '群島風光'] },
    { rarity: 'superRare', displayName: '九尾狐傳說', description: '常世群島流傳已久的九尾狐傳說。', icon: '🦊', motifs: ['妖怪文化元素', '九尾狐傳說'] },
    { rarity: 'superRare', displayName: '龍神海域', description: '傳說中龍神鎮守的群島外海海域。', icon: '🐉', motifs: ['龍神傳說', '海洋'] },
  ],
  artemisia: [
    { rarity: 'common', displayName: '森林小徑', description: '阿耳忒彌西亞林間的靜謐小徑。', icon: '🌲', motifs: ['森林'] },
    { rarity: 'common', displayName: '花田景色', description: '精靈聚落周邊盛開的花田。', icon: '🌸', motifs: ['花朵', '森林'] },
    { rarity: 'common', displayName: '藤蔓拱門', description: '精靈建築間常見的自然藤蔓拱門。', icon: '🍃', motifs: ['魔法植物', '精靈建築'] },
    { rarity: 'rare', displayName: '巨樹聚落', description: '精靈依附巨大古樹建立的聚落。', icon: '🌳', motifs: ['巨大古樹', '精靈建築'] },
    { rarity: 'rare', displayName: '月光池畔', description: '林間映著月光的靜謐池畔。', icon: '🌕', motifs: ['月光', '森林'] },
    { rarity: 'rare', displayName: '精靈建築', description: '精靈城市中融合自然的建築群。', icon: '🏛️', motifs: ['精靈建築', '森林'] },
    { rarity: 'superRare', displayName: '世界樹之心', description: '傳說中阿耳忒彌西亞最古老的世界樹之心。', icon: '✨', motifs: ['巨大古樹', '魔法植物', '傳說'] },
    { rarity: 'superRare', displayName: '精靈女王徽記', description: '精靈文明歷代女王的古老徽記。', icon: '🦋', motifs: ['精靈女王徽記', '精靈文明'] },
  ],
};

function buildDecorativeStamps(): DecorativeStampDefinition[] {
  const out: DecorativeStampDefinition[] = [];
  for (const theme of REGION_THEMES) {
    const seeds = DECORATIVE_SEEDS[theme.regionId];
    const counters: Record<StampRarity, number> = { common: 0, rare: 0, superRare: 0 };
    for (const seed of seeds) {
      counters[seed.rarity] += 1;
      const rarityKey = seed.rarity === 'superRare' ? 'superrare' : seed.rarity;
      out.push({
        stampId: `stamp-${theme.regionId}-${rarityKey}-${counters[seed.rarity]}`,
        regionId: theme.regionId,
        rarity: seed.rarity,
        displayName: seed.displayName,
        description: seed.description,
        icon: seed.icon,
        color: theme.color,
        motifs: seed.motifs,
        colorTheme: theme.colorTheme,
      });
    }
  }
  return out;
}

export const DECORATIVE_STAMPS: DecorativeStampDefinition[] = buildDecorativeStamps();

// Module-load sanity check — every region must have exactly 3/3/2
// common/rare/superRare decorative stamps (spec三), so a future edit to
// DECORATIVE_SEEDS can never silently drift from the spec's own fixed
// counts without failing loudly.
for (const theme of REGION_THEMES) {
  const own = DECORATIVE_STAMPS.filter((s) => s.regionId === theme.regionId);
  const counts = { common: 0, rare: 0, superRare: 0 };
  for (const s of own) counts[s.rarity]++;
  if (counts.common !== 3 || counts.rare !== 3 || counts.superRare !== 2) {
    throw new Error(`stamp-collection-data: region "${theme.regionId}" must have exactly 3 common + 3 rare + 2 superRare decorative stamps, found ${JSON.stringify(counts)}`);
  }
}

export function getRequiredStampForRegion(regionId: StampRegionId): RequiredStampDefinition | undefined {
  return REQUIRED_STAMPS.find((s) => s.regionId === regionId);
}

/** mail-system.ts's applyStamp() only knows the MailDestination it just
 * validated, not this file's own region-id scheme — the ONE place that
 * translation happens. */
export function getRequiredStampForMailDestination(dest: MailDestination): RequiredStampDefinition | undefined {
  return REQUIRED_STAMPS.find((s) => s.mailDestinationId === dest);
}

/** Which StampRegionId a given MailDestination belongs to — derived from
 * REQUIRED_STAMPS (the one place that pairing is defined) rather than a
 * second hand-written mapping table. */
export function getStampRegionForMailDestination(dest: MailDestination): StampRegionId | undefined {
  return getRequiredStampForMailDestination(dest)?.regionId;
}

export function getDecorativeStamp(stampId: string): DecorativeStampDefinition | undefined {
  return DECORATIVE_STAMPS.find((s) => s.stampId === stampId);
}

export function getDecorativeStampsForRegion(regionId: StampRegionId): DecorativeStampDefinition[] {
  return DECORATIVE_STAMPS.filter((s) => s.regionId === regionId);
}

export function getDecorativeStampsForRegionByRarity(regionId: StampRegionId, rarity: StampRarity): DecorativeStampDefinition[] {
  return DECORATIVE_STAMPS.filter((s) => s.regionId === regionId && s.rarity === rarity);
}

/** Stage 1 of the two-stage draw (spec四: "第一階段：決定稀有度") — a single
 * weighted roll against STAMP_RARITY_WEIGHTS (80/19/1), NOT an 8-way
 * equal-probability pick across that region's whole pool (spec's own
 * explicit "請不要把全部8枚裝飾郵票視為同一個等機率池" warning). */
export function pickDecorativeStampRarity(): StampRarity {
  const totalWeight = STAMP_RARITY_ORDER.reduce((sum, r) => sum + STAMP_RARITY_WEIGHTS[r], 0);
  let roll = Math.random() * totalWeight;
  for (const rarity of STAMP_RARITY_ORDER) {
    roll -= STAMP_RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return STAMP_RARITY_ORDER[STAMP_RARITY_ORDER.length - 1];
}

/** Stage 2 of the two-stage draw (spec四: "第二階段：決定樣式") — a uniform
 * pick among ONLY that region+rarity's own styles (3/3/2), called with the
 * rarity stage 1 already decided. Exported separately from
 * pickRandomDecorativeStampForRegion below purely so tests can drive each
 * stage independently. */
export function pickDecorativeStampStyle(regionId: StampRegionId, rarity: StampRarity): DecorativeStampDefinition {
  const pool = getDecorativeStampsForRegionByRarity(regionId, rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** The full two-stage draw (spec四) — called once per envelope at SPAWN
 * time (mail-system.ts's spawnEnvelope), never at collection time; the
 * result is stored on the envelope's own EnvelopeRecord.decorativeStampId
 * and only reaches settingsManager.collectedStamps later, if and when that
 * SAME envelope is successfully processed at the stamp table (spec五). */
export function pickRandomDecorativeStampForRegion(regionId: StampRegionId): DecorativeStampDefinition {
  const rarity = pickDecorativeStampRarity();
  return pickDecorativeStampStyle(regionId, rarity);
}

// Module-load sanity check — every real MAIL_DESTINATIONS entry (mail-data.
// ts) must have exactly one corresponding required stamp, so a future
// destination added there can never silently ship without one (mirrors the
// equivalent check the old single-stamp design already had).
for (const dest of MAIL_DESTINATIONS) {
  if (!getRequiredStampForMailDestination(dest.id)) {
    throw new Error(`stamp-collection-data: no RequiredStampDefinition for MailDestination "${dest.id}"`);
  }
}
