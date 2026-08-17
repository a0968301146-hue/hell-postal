// "新增兔子吉祥物" round — plain data only, no scene-graph or gameplay logic
// (matches this codebase's own established convention: pallet-data.ts,
// after-work-story-data.ts, etc.). Deliberately separate from
// mascot-guide-system.ts (spec五: "資料與系統分離") so future content only
// ever means adding another MascotGuideEntry here, never touching the
// system's own state machine.
//
// "兔子吉祥物互動方式修改" round — the 4 categories below are now content-
// management metadata ONLY (spec二: 分類仍保留在資料結構中，只作為內容管理
// 用途，不直接顯示給玩家). Player-facing selection is gone; every E-press
// picks one random entry from the FULL pool (see
// getAllAvailableMascotGuideEntries), regardless of category.

/** The 4 top-level categories (spec六) — content-management metadata only,
 * never rendered to the player (see this file's own doc comment above). */
export type MascotGuideCategory = 'logistics' | 'world' | 'species' | 'grandpa';

export const MASCOT_GUIDE_CATEGORIES: { id: MascotGuideCategory; label: string }[] = [
  { id: 'logistics', label: '物流指南' },
  { id: 'world', label: '世界與地區' },
  { id: 'species', label: '種族' },
  { id: 'grandpa', label: '物流中心與爺爺' },
];

/** One piece of guide content — the rabbit's own dialogue lines on a given
 * topic (spec五: 至少要有 ID/分類/標題/對話內容/解鎖條件/閱讀狀態). `lines`
 * plays one at a time, E advances (spec七), matching the same "typed content
 * plays sequentially" shape as every other dialogue-ish content list in this
 * codebase — but this file owns none of the read/reveal STATE itself
 * (mascot-guide-system.ts does), same separation as tutorial-data.ts vs
 * SettingsManager's own unlockedTutorials. */
export interface MascotGuideEntry {
  id: string;
  category: MascotGuideCategory;
  title: string;
  lines: string[];
  /** Optional day gate (spec五: "解鎖條件／解鎖Day，如果目前架構適合") —
   * omitted means always available regardless of DailyFlowSystem.currentDay.
   * None of this round's own test entries use it (spec六: "先建立系統架構＋
   * 少量測試內容"), but the shape is here so a future entry can opt in
   * without another data migration. */
  unlockDay?: number;
}

/** "先建立系統架構＋少量測試內容" — exactly one entry per category (spec
 *六), demonstrating the rabbit's own established personality (spec十: 熟悉
 * 物流中心／很早以前就開始幫忙／熟悉爺爺／親切／老員工的從容感／偶爾吐槽玩
 * 家／不要過度賣萌) without committing to a large volume of real worldbuilding
 * text yet — real content gets authored in a later round. */
export const MASCOT_GUIDE_ENTRIES: MascotGuideEntry[] = [
  {
    id: 'logistics-pallet-basics',
    category: 'logistics',
    title: '整理托盤怎麼用？',
    lines: [
      '看到中央那幾張托盤了嗎？把方形或大型貨物放上去，它會自動幫你排整齊。',
      '托盤本身也能整組搬起來喔——連同上面的貨物一起，很方便吧？',
      '別問我為什麼知道，我在這裡待的時間可比你想像得久多了。',
    ],
  },
  {
    id: 'world-argos-intro',
    category: 'world',
    title: '阿爾戈斯是什麼樣的地方？',
    lines: [
      '阿爾戈斯是王都，高塔跟石板路，第一次去很容易迷路。',
      '不過說真的，把各地貨物送往王國各處的，還是我們這種物流中心喔。',
      '沒有我們，王都的商人大概連早餐都送不到吧，哼哼。',
    ],
  },
  {
    id: 'species-dwarf-intro',
    category: 'species',
    title: '矮人是什麼樣的種族？',
    lines: [
      '矮人啊，力氣大、手藝好，很多重型貨物都是他們製造的。',
      '住在山裡的礦坑城鎮，跟我們物流中心也算是老交情了。',
      '別看他們矮，扛起貨物來可比你這個新人俐落多了。',
    ],
  },
  {
    id: 'grandpa-founding',
    category: 'grandpa',
    title: '這座物流中心是怎麼開始的？',
    lines: [
      '一開始這裡只有一間木屋，你爺爺一個人扛下所有事。',
      '我從那個時候就在這裡了，陪他一起熬過最忙的那幾年。',
      '現在變成這樣子，他要是看到，一定會很驕傲的。',
    ],
  },
];

/** Every entry currently available regardless of category (spec三: 每次互動
 * 時，直接從所有可用話語中隨機抽取一筆) — the ONLY lookup mascot-guide-
 * system.ts uses now; per-category lookup is gone along with the category
 * selection UI. */
export function getAllAvailableMascotGuideEntries(currentDay: number): MascotGuideEntry[] {
  return MASCOT_GUIDE_ENTRIES.filter((e) => e.unlockDay === undefined || currentDay >= e.unlockDay);
}
