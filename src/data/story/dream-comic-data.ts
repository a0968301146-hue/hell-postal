// "每日起床＋夢境漫畫" round — Day1~7 dream content (spec八). Every panel's
// text is built ONLY from what after-work-story-data.ts's own AFTER_WORK_
// STORIES already establishes about that day's NPC (spec六/十二: "不要自行大
// 幅創造與目前故事矛盾的新設定") — each entry's `relatedNpcName` matches the
// SAME day-number key in AFTER_WORK_STORIES exactly (spec七's own "Day N夢境
// →Day N特殊NPC" framing), so the dream (played at day N's own START, via
// DailyFlowSystem.state hitting 'ready') always narratively PRECEDES that
// NPC's own after-work reveal (played at day N's own END, once the day's
// vehicles depart) — same calendar day, dream first, meeting second, exactly
// the "夢在遇到NPC之前" ordering spec七 asks for, without renumbering
// anything.
//
// Deliberately impressionistic/silhouette framing throughout ("模糊的記
// 憶"/an unnamed figure) rather than stating flatly "這是你爺爺" — the
// existing lines never have the protagonist's grandfather explicitly say his
// own name either, so a dream that stayed just as indirect avoids asserting
// any fact after-work-story-data.ts doesn't already support (spec六's own
// "不要直接亂寫" applies here too, not just to missing-NPC cases).
//
// Day7 has NO entry here — see this round's own completion report for why
// (AFTER_WORK_STORIES[7] is an isLetterDay with no visiting NPC at all;
// npcName is '' and the sender, 阿元, is an ABSENT character mentioned only
// inside the letter body, not someone with an established personal history
// to dream about). DreamComicSystem's own trigger check no-ops gracefully
// when DREAM_COMICS[day] is undefined (mirrors AfterWorkStorySystem's own
// `if (!config) return;` pattern for a day with no story entry) — Day7
// simply begins without a room/dream beat until this gap is filled in.
//
// Day8 has NO entry here either (spec十: "先不要自行新增新的夢境內容") — it
// already has its own distinct entrance (AfterWorkStorySystem.
// checkGiantCakeDayStart, driven directly by currentDay===8, independent of
// this file/DreamComicSystem entirely).
import { DreamComicDay } from '../../systems/dream-comic/dream-comic-types';

export const DREAM_COMICS: Record<number, DreamComicDay> = {
  1: {
    day: 1,
    relatedNpcName: '老碼頭工人',
    theme: '雨中的小碼頭',
    panels: [
      { placeholderLabel: 'DAY 1 · PANEL 1', text: '模糊的記憶——一座小小的木造碼頭，雨聲很大。' },
      { placeholderLabel: 'DAY 1 · PANEL 2', text: '一個高大的身影，在風雨中仍點著一盞燈，沒有要離開的意思。' },
      { placeholderLabel: 'DAY 1 · PANEL 3', text: '「送到這裡的，從來不只是貨物而已。」一個溫和的聲音這麼說著。' },
      { placeholderLabel: 'DAY 1 · PANEL 4', text: '醒來的時候，只記得那盞燈，還有雨聲。' },
    ],
  },
  2: {
    day: 2,
    relatedNpcName: '阿珠姨',
    theme: '收工後的咖啡香',
    panels: [
      { placeholderLabel: 'DAY 2 · PANEL 1', text: '模糊的記憶——木桌上，一壺剛煮好的咖啡冒著熱氣。' },
      { placeholderLabel: 'DAY 2 · PANEL 2', text: '有人在忙碌了一整天後，笑著問了一句「今天累不累？」' },
      { placeholderLabel: 'DAY 2 · PANEL 3', text: '那個聲音聽起來很熟悉，卻怎麼也想不起是誰。' },
    ],
  },
  3: {
    day: 3,
    relatedNpcName: '阿海',
    theme: '天窗下的星星',
    panels: [
      { placeholderLabel: 'DAY 3 · PANEL 1', text: '模糊的記憶——夜晚的天窗下，星星靜靜地掛著。' },
      { placeholderLabel: 'DAY 3 · PANEL 2', text: '一個人獨自坐在那裡，說著「運送貨物，其實是把人跟人重新連在一起」。' },
      { placeholderLabel: 'DAY 3 · PANEL 3', text: '星光下的側臉，看起來既疲憊，又有點滿足。' },
    ],
  },
  4: {
    day: 4,
    relatedNpcName: '陳伯',
    theme: '泛黃的照片',
    panels: [
      { placeholderLabel: 'DAY 4 · PANEL 1', text: '模糊的記憶——一疊泛黃的照片，散落在桌上。' },
      { placeholderLabel: 'DAY 4 · PANEL 2', text: '照片裡，一群人扛著貨物，笑得很大聲。' },
      { placeholderLabel: 'DAY 4 · PANEL 3', text: '角落有個不太上鏡的身影，卻總是被拍進最多張照片裡。' },
    ],
  },
  5: {
    day: 5,
    relatedNpcName: '小夏',
    theme: '夏天的海邊',
    panels: [
      { placeholderLabel: 'DAY 5 · PANEL 1', text: '模糊的記憶——夏天的海邊，收工的鈴聲剛剛響起。' },
      { placeholderLabel: 'DAY 5 · PANEL 2', text: '一群人衝進海裡，笑鬧聲蓋過了浪聲。' },
      { placeholderLabel: 'DAY 5 · PANEL 3', text: '有個人游得不快，卻總是最後一個上岸——好像在等著誰。' },
    ],
  },
  6: {
    day: 6,
    relatedNpcName: '阿古',
    theme: '海面上的小船',
    panels: [
      { placeholderLabel: 'DAY 6 · PANEL 1', text: '模糊的記憶——海面上，一艘小船的輪廓漂在燈籠光裡。' },
      { placeholderLabel: 'DAY 6 · PANEL 2', text: '年輕的聲音說著：「我想有一天，能開著自己的船到處送貨。」' },
      { placeholderLabel: 'DAY 6 · PANEL 3', text: '另一個溫和的聲音回答：「準備好了就去，這裡會等你回來。」' },
    ],
  },
};
