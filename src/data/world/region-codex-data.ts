// 國家／地區圖鑑資料 ("世界觀地區命名修正＋國家圖鑑＋Day 1～8 解鎖架構" round)
//
// Pure data structure only this round (spec三: "圖鑑目前先建立資料架構，不
// 需要過度複雜") — deliberately NOT wired into pause-menu-ui.ts's existing
// codex tabs (game/codex-data.ts) yet; that's a separate follow-up once a
// UI layout is actually wanted. Kept in data/world/ alongside every other
// static lore/layout data file (campfire-area-data.ts, mail-layout-data.ts,
// ...), not systems/, since this is pure world-building content with zero
// gameplay logic of its own.
//
// mail-data.ts's own MAIL_DESTINATIONS remains the single source of truth
// for a region's PLAYER-FACING short name/icon/color used in stamps/
// envelopes/mail bags (spec: "不要讓不同系統各自硬編碼地點名稱") — this file
// is a SEPARATE, richer lore/reference dataset (full name+subtitle, land
// area, founding era, residents, history, ...) for the future codex UI, not
// a second copy of that same short-form display data. `id` here intentionally
// mirrors mail-data.ts's own MailDestination id scheme (with Ithaca added,
// which mail-data.ts has no entry for at all — it is the player's own home
// town, never a shippable destination, confirmed with the requester in an
// earlier round) so a future UI can cross-reference the two by id if wanted,
// without this file importing/depending on mail-data.ts.
export type RegionCodexId = 'argos' | 'hephaestia' | 'evergreen-isles' | 'artemisia' | 'ithaca';

export interface RegionCodexEntry {
  id: RegionCodexId;
  /** 地區名稱 — e.g. "阿爾戈斯". */
  name: string;
  /** 副標題 — e.g. "王都". */
  subtitle: string;
  /** 地區類型 — short classification phrase. */
  regionType: string;
  /** 土地面積 — kept as a display string (e.g. "約 18 萬 km²") rather than a
   * bare number; the source spec itself only ever gives approximate
   * figures, never an exact value to do arithmetic on. */
  landArea: string;
  /** 建立時間 — same "approximate, display-string" reasoning as landArea. */
  founded: string;
  /** 主要居民. */
  mainResidents: string[];
  /** 歷史介紹 — free-form paragraph(s), joined with \n\n where the source
   * spec itself separates a region's own history from its protagonist-
   * specific background (Argos only). */
  history: string;
  /** 地區特色 — the source spec's own "世界觀定位"/核心特色 short summary. */
  regionFeatures: string;
  /** 主要產出 — ONLY filled where the source spec explicitly lists specific
   * export goods (currently Artemisia only); left as an empty array
   * everywhere else rather than guessed (spec六: "不要猜，不要自行平衡"). */
  mainExports: string[];
  /** 物流特色 — ONLY filled where the source spec explicitly describes a
   * production/transit chain relevant to logistics (Hephaestia's own
   * mining->export pipeline, Ithaca's own crossroads-port role); empty
   * string everywhere else, same "don't invent" reasoning as mainExports. */
  logisticsFeatures: string;
  /** 目前是否已解鎖 — Day 1～8 unlock specifics beyond Ithaca (the confirmed
   * Day 1 starting town) have NOT been provided yet (spec六: "不要自行決定
   * 解鎖天數"), so every other region stays `false`/`unlockDay: null` here
   * until that data arrives — this is a placeholder, not a real gameplay
   * gate (nothing in the live game currently reads this field). */
  isUnlocked: boolean;
  /** 解鎖天數 — null until the requester provides it (see isUnlocked's own
   * doc comment). */
  unlockDay: number | null;
  /** 圖鑑圖片／插圖預留欄位 — no illustration/image asset pipeline exists
   * anywhere in this codebase yet (mirrors game/codex-data.ts's own
   * VehicleCodexEntry.description/traits "尚未收錄" placeholder convention
   * for the same reason) — always null for now. */
  illustration: string | null;
}

export const REGION_CODEX_ENTRIES: RegionCodexEntry[] = [
  {
    id: 'argos',
    name: '阿爾戈斯',
    subtitle: '王都',
    regionType: '王國首都／商業中心',
    landArea: '約 18 萬 km²',
    founded: '約 700 年前',
    mainResidents: ['人類', '矮人', '精靈', '獸人', '哥布林族', '少量其他魔物'],
    history:
      '約 700 年前，多個人類領地結盟建立王國，阿爾戈斯成為王都。隨著魔物與人類的貿易逐漸增加，王都逐漸成為真正的多種族城市。\n\n' +
      '主角背景：主角年輕時離開伊塔卡港鎮，前往阿爾戈斯找工作，曾在王都的商業／物流相關公司擔任普通職員。阿爾戈斯代表主角過去努力生活、但逐漸感到疲憊的地方。',
    regionFeatures: '繁華、多種族、商業中心、王國中心',
    mainExports: [],
    logisticsFeatures: '',
    isUnlocked: false,
    unlockDay: null,
    illustration: null,
  },
  {
    id: 'hephaestia',
    name: '赫菲斯提亞',
    subtitle: '矮人鍛造之城',
    regionType: '矮人鍛造都市／工業聯邦',
    landArea: '約 7 萬 km²',
    founded: '約 1,200 年前',
    mainResidents: ['矮人', '岩石族', '地精／穴居魔物', '人類工匠', '少量獸人'],
    history:
      '矮人最早在山脈中建立的城市之一。並非單一巨大國家，而是由山城、礦區、工坊組成的聯邦。',
    regionFeatures: '工業、鍛造、礦山、重型貨物',
    mainExports: [],
    logisticsFeatures: '主要產業：採礦 → 冶煉 → 鍛造 → 製造 → 出口',
    isUnlocked: false,
    unlockDay: null,
    illustration: null,
  },
  {
    id: 'evergreen-isles',
    name: '常世群島',
    subtitle: '東方群島',
    regionType: '群島／多島聯合',
    landArea: '約 11 萬 km²',
    founded: '約 900 年前',
    mainResidents: ['人類', '獸人', '狐妖族', '狸妖族', '河童族', '天狗族', '其他妖怪族'],
    history:
      '由許多島嶼組成，沒有非常強大的中央政府。各島擁有領主、神社、村落、港口。島嶼之間主要透過船隻與海洋魔物往來。核心特色：人類與妖怪共同生活。\n\n' +
      '註："東雲"目前不是正式地區名稱，之後若需要，可設定為常世群島中的其中一座主要島嶼。',
    regionFeatures: '群島、海洋、妖怪、多種族共存',
    mainExports: [],
    logisticsFeatures: '',
    isUnlocked: false,
    unlockDay: null,
    illustration: null,
  },
  {
    id: 'artemisia',
    name: '阿耳忒彌西亞',
    subtitle: '精靈之島',
    regionType: '精靈文明／森林島嶼',
    landArea: '約 9 萬 km²',
    founded: '約 1,500 年前',
    mainResidents: ['精靈', '半精靈', '樹靈族', '花妖族', '少量人類', '其他森林魔物'],
    history:
      '四個主要大型地區中歷史最悠久的文明之一。精靈最早在島上建立聚落，經過長時間發展形成現在的精靈社會。並非單純的「精靈國家」，而是一座由森林、村落、精靈城市共同構成的島嶼。',
    regionFeatures: '森林、自然、魔法、精靈文明',
    mainExports: ['藥草', '植物', '魔法材料', '稀有種子', '活體生物'],
    logisticsFeatures: '',
    isUnlocked: false,
    unlockDay: null,
    illustration: null,
  },
  {
    id: 'ithaca',
    name: '伊塔卡港鎮',
    subtitle: '主角故鄉',
    regionType: '海港小鎮／物流轉運中心',
    landArea: '約 1,500 km²',
    founded: '約 400 年前',
    mainResidents: [
      '人類', '矮人', '精靈', '獸人', '哥布林族', '骷髏族／不死族', '狐妖族', '河童族', '其他旅居魔物',
    ],
    history:
      '最初只是海邊的小型聚落。因為位於王都、矮人領地、東方群島、精靈之島的交通路線附近，因此逐漸發展成重要轉運港。核心特色：沒有單一主要種族，許多不同種族的人並不一定留在自己的故鄉，而會選擇在伊塔卡定居。\n\n' +
      '伊塔卡是主角故鄉、爺爺的物流中心所在地，也是遊戲主要舞台。',
    regionFeatures: '普通、生活化、多種族混居的小型港鎮',
    mainExports: [],
    logisticsFeatures: '王都／矮人領地／東方群島／精靈之島交通路線交會處，重要轉運港',
    isUnlocked: true,
    unlockDay: 1,
    illustration: null,
  },
];

export function getRegionCodexEntry(id: RegionCodexId): RegionCodexEntry | undefined {
  return REGION_CODEX_ENTRIES.find((r) => r.id === id);
}
