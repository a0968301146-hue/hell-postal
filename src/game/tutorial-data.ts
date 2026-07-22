// Tutorial catalogue data (spec section 六). Pure data — SettingsManager
// owns which entries are actually unlocked (persisted progress), ManualUI
// just renders TUTORIAL_ENTRIES against that unlocked set.

export type TutorialEventKey =
  | 'move' | 'pickup' | 'counterReceive' | 'stamp'
  | 'conveyor' | 'sorting' | 'cargoLoaded' | 'vehicleDeparted' | 'cargoLabelSeen'
  | 'unloadingStarted' | 'cargoPileTouched' | 'boxOrganized' | 'rollerOrganized'
  | 'palletUsed' | 'dollyUsed' | 'outboundShipped' | 'dayCompleted';

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

// This round's main teaching sequence is the daily unload->sort->ship loop
// (spec "每日貨品清空核心流程" section 二十一). The old counter/envelope/
// vehicle-loading entries are NOT deleted (their systems still exist,
// disabled — see feature-flags.ts) but are force-locked so they never
// surface as reachable content in the main tutorial list this round.
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
    id: 'start-unloading',
    title: '啟動卸貨',
    unlockEvent: 'unloadingStarted',
    body: '走到西側卸貨口旁的「開始卸貨」按鈕，按下互動鍵即可啟動卸貨：閘門打開後，今日的貨品會依序滑落進卸貨區。同一天只能卸貨一次，必須先清空當日所有貨品才能再次卸貨。',
  },
  {
    id: 'break-up-pile',
    title: '拆開貨堆',
    unlockEvent: 'cargoPileTouched',
    body: '貨品卸下後會在卸貨區堆成一團。拿起、搬運或推開貨品即可拆開貨堆、清出走道，方便將貨品一一搬往整理區。',
  },
  {
    id: 'organize-box',
    title: '整理方形貨品',
    unlockEvent: 'boxOrganized',
    body: '將方形貨品放上中央的整理托盤，保持穩定靜置一小段時間後，該件貨品就會被標記為已完成整理，之後即可送往出貨區。',
  },
  {
    id: 'organize-roller',
    title: '整理滾筒貨品',
    unlockEvent: 'rollerOrganized',
    body: '滾筒形貨品要放進牆邊的滾筒固定架，保持穩定靜置一小段時間後即完成整理。滾筒放上托盤、或方形貨品放進滾筒架，都不會被視為完成整理。',
  },
  {
    id: 'use-pallet',
    title: '使用托盤',
    unlockEvent: 'palletUsed',
    body: '托盤是本輪整理方形貨品的固定平台，可以直接用放置模式將貨品精準疊放在托盤上，不需要對齊特定格位。',
  },
  {
    id: 'use-dolly',
    title: '使用拖板車',
    unlockEvent: 'dollyUsed',
    body: '靠近拖板車按下互動鍵即可推行，車上範圍內的貨品會一起跟著移動，方便一次搬運多件已整理完成的貨品前往出貨區。再按一次互動鍵即可放開。',
  },
  {
    id: 'ship-to-outbound',
    title: '送往出貨區',
    unlockEvent: 'outboundShipped',
    body: '已完成整理的貨品搬到東側出貨區即會自動被送出、計入今日完成數量。尚未完成整理的貨品進入出貨區不會被移除，畫面會提示「這件貨品尚未完成整理」。',
  },
  {
    id: 'end-day',
    title: '結束今天',
    unlockEvent: 'dayCompleted',
    body: '今日貨品全部清空後，畫面會顯示「今日貨品已全部清空」。走到「結束今天」按鈕旁按下互動鍵，場地與工具（托盤範圍、拖板車、卸貨閘門）就會重置，進入下一天。',
  },
  {
    id: 'counter-receive',
    title: '臨櫃接收貨物',
    unlockEvent: null,
    forceLocked: true,
    body: '開業後 NPC 會排隊上前寄件，靠近櫃檯拿起客人留下的包裹或信封，即完成臨櫃收件。',
  },
  {
    id: 'package-weighing',
    title: '辨識貨物標籤',
    unlockEvent: null,
    forceLocked: true,
    body: '每件貨物生成時就已經附有標籤，一件貨物可能同時有多個標籤。標籤會顯示這件貨物的運送路線與特性，玩家應該依照標籤自行整理貨物、判斷該用陸運還是海運，以及目前的載具是否能正確受理。',
  },
  {
    id: 'stamp-labeling',
    title: '貼標籤與貼郵票',
    unlockEvent: null,
    forceLocked: true,
    body: '將信封放上信封貼郵票桌，按下互動鍵開始貼郵票小遊戲，依照地址資訊選擇正確的郵票。',
  },
  {
    id: 'cargo-sorting',
    title: '貨物分類',
    unlockEvent: null,
    forceLocked: true,
    body: '已貼票的信封需要放入對應目的地與郵資的分類箱，箱子會自動偵測放入的信封並判斷是否正確分類。',
  },
  {
    id: 'conveyor-belt',
    title: '使用輸送帶',
    unlockEvent: null,
    forceLocked: true,
    body: '前台窗口收到的貨物會沿著輸送帶滑向後場，貨物進入輸送帶偵測範圍後會自動被帶往下方。',
  },
  {
    id: 'cargo-loading',
    title: '貨物裝載',
    unlockEvent: null,
    forceLocked: true,
    body: '將貨物放置於載具貨艙範圍內即完成裝載，普通貨物與大型貨物都可以自由堆放，不需要對齊固定格位。',
  },
  {
    id: 'vehicle-departure',
    title: '送出載具',
    unlockEvent: null,
    forceLocked: true,
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
