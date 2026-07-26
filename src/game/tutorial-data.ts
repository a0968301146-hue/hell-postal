// Tutorial catalogue data (spec section 六). Pure data — SettingsManager
// owns which entries are actually unlocked (persisted progress), ManualUI
// just renders TUTORIAL_ENTRIES against that unlocked set.

export type TutorialEventKey =
  | 'move' | 'pickup' | 'counterReceive' | 'stamp'
  | 'conveyor' | 'sorting' | 'cargoLoaded' | 'vehicleDeparted' | 'cargoLabelSeen'
  | 'unloadingStarted' | 'cargoPileTouched' | 'boxOrganized'
  | 'palletUsed' | 'dollyUsed' | 'outboundShipped' | 'dayCompleted' | 'vehicleCalled';

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

// This round's main teaching sequence is the daily unload->sort->ship-via-
// vehicle loop. The old counter/envelope/ground-outbound-zone entries are
// NOT deleted (their systems still exist, disabled/unused — see
// feature-flags.ts and outbound-zone-system.ts) but are force-locked so
// they never surface as reachable content in the main tutorial list.
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
    title: '啟動北側卸貨口',
    unlockEvent: 'unloadingStarted',
    body: '走到北側卸貨口旁的「開始卸貨」按鈕，按下互動鍵即可啟動卸貨：閘門短暫蓄力後打開，今日的貨品會分成數個波次、一批批噴射進入卸貨區，過程中請站在閘門正前方以外的安全距離。同一天只能卸貨一次，必須先完成當日所有貨品的出貨才能再次卸貨。',
  },
  {
    id: 'identify-cargo',
    title: '辨識貨品種類',
    unlockEvent: 'cargoLabelSeen',
    body: '每件貨品一生成就自帶種類標籤，直接印在貨品表面（方形貨品的側面或頂面、滾筒貨品的圓柱面），標示它是哪一種貨品，玩家無法編輯或移除。標籤會跟著貨品一起被拿取、放置、投擲、疊上整理托盤，方便你一眼分辨貨堆裡的貨品種類。',
  },
  {
    id: 'break-up-pile',
    title: '拆開貨堆',
    unlockEvent: 'cargoPileTouched',
    body: '貨品卸下後會在北側卸貨區堆成一團。拿起、搬運或推開貨品即可拆開貨堆、清出走道，方便將貨品一一搬往中央整理區。',
  },
  {
    id: 'use-pallet',
    title: '使用整理托盤',
    unlockEvent: 'palletUsed',
    body: '將方形或大型貨品放上中央的整理托盤，可以直接用放置模式精準疊放，不需要對齊特定格位。保持穩定靜置一小段時間後，該件貨品就會被標記為已完成整理。看向整理托盤本身按互動鍵可以將托盤連同上面所有貨品一起拿起，貨品的相對位置與擺放方式會被完整保留；再按一次即可將整組貨品一起放下。托盤無法用蓄力鍵投擲。整組托盤也可以直接搬進已停靠載具的貨艙。',
  },
  {
    // "移除滾筒架" round: the roller rack no longer exists, so this entry
    // can never legitimately unlock again — force-locked with an empty
    // body, same convention as every other removed-this-round entry below
    // (organize-box/use-dolly/ship-to-outbound/etc.), rather than deleting
    // it outright.
    id: 'organize-roller',
    title: '使用滾筒架整理滾筒貨物',
    unlockEvent: null,
    forceLocked: true,
    body: '',
  },
  {
    id: 'call-vehicle',
    title: '呼叫載具',
    unlockEvent: 'vehicleCalled',
    body: '今日卸貨完成後，即可在大廳中央按下「呼叫載具」，同時呼叫陸運與海運兩台載具：陸運從南側進場，海運從東側進場，各自停靠既有碼頭。當天已有載具時無法重複呼叫。',
  },
  {
    id: 'load-vehicle',
    title: '將整理完成的貨物裝入載具',
    unlockEvent: 'cargoLoaded',
    body: '把已完成整理的貨品搬進任一台已停靠載具的貨艙範圍，保持穩定一小段時間後即完成出貨、計入今日已裝載數量，並保留在載具上供你查看。尚未完成整理的貨品放進貨艙不會被計入，畫面會提示「這件貨品尚未完成整理」；已出貨的貨品若被重新拿出貨艙，也會恢復為未出貨狀態。',
  },
  {
    id: 'vehicle-departure',
    title: '讓載具出發',
    unlockEvent: 'vehicleDeparted',
    body: '今日貨品全部裝載完成後，在大廳中央按下「載具出發」，兩台載具會一起固定貨物並離場。等待兩台都完成離場後，畫面會顯示今日完成的簡單總結。',
  },
  {
    id: 'end-day',
    title: '結束今天',
    unlockEvent: 'dayCompleted',
    body: '兩台載具都離場後，走到「結束今天」按鈕旁按下互動鍵，場地與工具（托盤、拖板車、卸貨閘門）就會重置，進入下一天。',
  },
  {
    id: 'organize-box',
    title: '整理方形貨品',
    unlockEvent: null,
    forceLocked: true,
    body: '',
  },
  {
    id: 'use-dolly',
    title: '使用拖板車',
    unlockEvent: null,
    forceLocked: true,
    body: '',
  },
  {
    id: 'ship-to-outbound',
    title: '送往出貨區',
    unlockEvent: null,
    forceLocked: true,
    body: '',
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
    body: '',
  },
  {
    id: 'lost-and-found',
    title: '失物招領',
    unlockEvent: null,
    forceLocked: true,
    body: '',
  },
];
