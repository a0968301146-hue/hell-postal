// Tutorial catalogue data (spec section 六). Pure data — SettingsManager
// owns which entries are actually unlocked (persisted progress), ManualUI
// just renders TUTORIAL_ENTRIES against that unlocked set.

export type TutorialEventKey =
  | 'move' | 'pickup' | 'counterReceive' | 'stamp'
  | 'conveyor' | 'sorting' | 'cargoLoaded' | 'vehicleDeparted' | 'cargoLabelSeen';

export interface TutorialEntry {
  id: string;
  title: string;
  /** Event key that unlocks this entry, or null if it can never unlock
   * this round (forceLocked below is what actually matters for those). */
  unlockEvent: TutorialEventKey | null;
  /** Always shows "尚未解鎖" regardless of unlockedTutorials — used for
   * topics whose underlying system is disabled or not yet built this round
   * (包裹秤重 / 失物招領), per spec section 六. */
  forceLocked?: boolean;
  body: string;
}

// NOTE on "貨物分類": the spec's explicit trigger list (六) does not name a
// trigger for this entry. Rather than force-lock it (spec doesn't ask for
// that either — only 包裹秤重/失物招領 are named as force-locked), this round
// infers a reasonable trigger — the first successful envelope sort — wired
// from MailSortingSystem's existing success path. Disclosed in the
// completion report as an addition beyond the literal spec list.
export const TUTORIAL_ENTRIES: TutorialEntry[] = [
  {
    id: 'basic-movement',
    title: '基礎移動與互動',
    unlockEvent: 'move',
    body: 'WASD 移動、滑鼠環顧四周、Shift 奔跑、Space 跳躍。靠近可互動物件時，畫面中央會出現提示文字，按下互動鍵即可進行。',
  },
  {
    id: 'pickup-place-throw',
    title: '拿取、放置與投擲',
    unlockEvent: 'pickup',
    body: '看向物件並按下拾取鍵可以拿起它。拿著物件時，再按一次可進入放置模式，用滑鼠瞄準放置位置；按住蓄力投擲鍵可以蓄力後放開丟出。',
  },
  {
    id: 'counter-receive',
    title: '臨櫃接收貨物',
    unlockEvent: 'counterReceive',
    body: '開業後 NPC 會排隊上前寄件，靠近櫃檯拿起客人留下的包裹或信封，即完成臨櫃收件。',
  },
  {
    id: 'package-weighing',
    title: '辨識貨物標籤',
    unlockEvent: 'cargoLabelSeen',
    body: '每件貨物生成時就已經附有標籤，一件貨物可能同時有多個標籤。標籤會顯示這件貨物的運送路線與特性，玩家應該依照標籤自行整理貨物、判斷該用陸運還是海運，以及目前的載具是否能正確受理。不相容的貨物仍然會被載具送走，但會在結算時扣分；載具出發前不會自動提醒或攔截。',
  },
  {
    id: 'stamp-labeling',
    title: '貼標籤與貼郵票',
    unlockEvent: 'stamp',
    body: '將信封放上信封貼郵票桌，按下互動鍵開始貼郵票小遊戲，依照地址資訊選擇正確的郵票。',
  },
  {
    id: 'cargo-sorting',
    title: '貨物分類',
    unlockEvent: 'sorting',
    body: '已貼票的信封需要放入對應目的地與郵資的分類箱，箱子會自動偵測放入的信封並判斷是否正確分類。',
  },
  {
    id: 'conveyor-belt',
    title: '使用輸送帶',
    unlockEvent: 'conveyor',
    body: '前台窗口收到的貨物會沿著輸送帶滑向後場，貨物進入輸送帶偵測範圍後會自動被帶往下方。',
  },
  {
    id: 'cargo-loading',
    title: '貨物裝載',
    unlockEvent: 'cargoLoaded',
    body: '將貨物放置於載具貨艙範圍內即完成裝載，普通貨物與大型貨物都可以自由堆放，不需要對齊固定格位。',
  },
  {
    id: 'vehicle-departure',
    title: '送出載具',
    unlockEvent: 'vehicleDeparted',
    body: '在大廳中央按下「載具出發」，已停靠的載具會固定貨物並離場，離場後會顯示本次的結算內容。',
  },
  {
    id: 'lost-and-found',
    title: '失物招領',
    unlockEvent: null,
    forceLocked: true,
    body: '',
  },
];
