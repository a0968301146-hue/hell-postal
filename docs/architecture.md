# 異世界物流中心 — 模組化架構

本文件描述 `refactor/modular-systems` 分支完成的架構重構。這是一次**純架構重構**：不新增/刪除玩法、不改數值、不改場景位置、不改畫面效果、不改玩家操作、不改任何現有公開行為。

## 一、模組目錄

```
src/
├─ app/                      # 組合根（composition root）
│  ├─ game-app.ts            # GameApp — 建立系統、注入依賴、啟動/銷毀
│  ├─ game-context.ts        # GameContext — 引擎級單例（scene/camera/physics/hud/...）
│  ├─ game-loop.ts           # GameLoop — requestAnimationFrame 排程 + deltaTime clamp
│  └─ bootstrap.ts           # WebGL 檢查、啟動 GameApp、載入畫面收尾
│
├─ core/                     # 跨系統基礎設施
│  ├─ game-events.ts         # GameEventBus — 僅供跨系統生命週期事件
│  ├─ lifecycle.ts           # SystemLifecycle 介面（update?/dispose?）
│  ├─ pause-manager.ts       # PauseManager（唯一一套暫停系統）
│  ├─ dispose-manager.ts     # DisposeManager — 事件監聽/清理集中管理
│  └─ game-state.ts          # PlayerInteractionData（跨系統玩家互動狀態）
│
├─ adapters/                 # 瀏覽器/引擎依賴隔離層
│  ├─ three/                 # three-renderer.ts, world-label-system.ts
│  ├─ rapier/                # physics-system.ts
│  ├─ browser-input/         # input-binding-manager.ts
│  └─ local-storage/         # local-storage-adapter.ts
│
├─ systems/                  # 13 個玩法系統（見下方「二、系統責任」）
│  ├─ player/  interaction/  pause-menu/  settings/
│  ├─ cargo/  cargo-inspection/  unloading/  pallet/
│  ├─ vehicle/  daily-flow/  scoring/  hud/
│  └─ lost-found/  world-layout/
│
├─ shared/
│  └─ types/interactable.ts  # InteractableObject（跨系統共用型別）
│
└─ game/                     # 尚未搬移的舊版/停用系統（見「五、技術債」）
```

每個 `systems/<name>/` 皆有一個 `index.ts` 作為對外唯一入口（barrel），其餘系統只能 `import ... from '../<name>'`，禁止深入引用內部檔案（兩個已記錄的例外見「四、依賴圖」）。

## 二、系統責任

| 系統 | 負責 | 不負責 |
|---|---|---|
| player | 移動/跑步/跳躍/速度 | UI、貨物/載具判斷 |
| interaction | 輸入、射線互動、E/F/Q 派發 | 直接改其他系統內部狀態（一律呼叫公開方法） |
| pause-menu | 暫停選單/教學/圖鑑/設定頁 UI | 暫停狀態本身（沿用 core/PauseManager） |
| settings | 設定與進度持久化、輸入綁定 | UI 顯示 |
| cargo | 貨物實體註冊、ID、類型、狀態、生成/刪除 | 每日結算、載具移動、HUD DOM |
| cargo-inspection | 準心命中貨物、顯示種類/地區彈出 UI | 第二套射線（沿用 interaction 的命中結果） |
| unloading | 北側到貨口、貨物流分配、生成節奏 | 每日總數（由 daily-flow 提供） |
| pallet | 托盤/滾輪架生成、移動、貨物跟隨 | 每日完成或發車判斷 |
| vehicle | 六台載具、六個停靠點、進出場、cargoBounds、裝載判定 | — |
| daily-flow | 天數、今日階段、卸貨/呼叫/出貨/失物招領/隔天 | Mesh/RigidBody/DOM |
| scoring | 出貨/未出貨數量、扣分、每日結算 | 自行掃描場景（只讀取呼叫端提供的數值） |
| hud | 顯示天數/狀態/貨物數/裝載數/未出貨數/分數 | 修改遊戲狀態 |
| lost-found | 每日一名 NPC、失物資料/生成、交還判斷、隔日清理 | — |
| world-layout | 牆壁、房間、門洞、到貨口、停靠點位置資料 | — |

## 三、系統公開 API（節錄）

- `systems/player` → `PlayerController`
- `systems/interaction` → `InteractionSystem`, `PickupSystem`
- `systems/pause-menu` → `ManualUI`
- `systems/settings` → `SettingsManager`, 及 settings-data 的型別/常數
- `systems/cargo` → `CargoSystem`, `CargoData`/`CargoType` 等型別, 貨物 presets
- `systems/cargo-inspection` → `CargoInspectionSystem`, `CargoInspectionUI`
- `systems/unloading` → `UnloadingSystem`
- `systems/pallet` → `PalletSystem`, `PALLET_ID`, `RollerRackSystem`
- `systems/vehicle` → `VehicleSystem`, `VehicleControlSystem`, 載具資料
- `systems/daily-flow` → `DailyFlowSystem`, `DailyState`, 每日/到貨口設定
- `systems/scoring` → `ScoringSystem`（`settleDeparture(total, shippedCorrect, unshipped)`）, `DepartureSettlement`
- `systems/hud` → `HUD`
- `systems/lost-found` → `LostFoundSystem`, `LostFoundUI`, `LostFoundNpcSystem`
- `systems/world-layout` → `createLogisticsScene`, `SCENE_CONFIG`, 場地座標常數

## 四、依賴圖與例外

大方向：`app` → `systems/*` → `adapters` / `core` / `shared`；`systems/*` 之間互相只透過 `index.ts`。

已記錄的兩個**刻意繞過 barrel** 的例外（避免檔案級循環匯入）：

1. `systems/vehicle/vehicle-control-system.ts` 與 `systems/lost-found/lost-found-system.ts` 都直接 `import { PickupSystem } from '../interaction/pickup-system'`（不經過 `systems/interaction/index.ts`）。原因：該 barrel 同時匯出 `InteractionSystem`，而 `InteractionSystem` 本身依賴 `VehicleControlSystem`/`LostFoundSystem`，經過 barrel 會形成循環。`pickup-system.ts` 本身對兩者皆無依賴，直接匯入不會造成循環。
2. `systems/world-layout` 的兩個檔案直接 `import ... from '../lost-found/lost-found-layout-data'`（不經過 `systems/lost-found/index.ts`），原因相同：`lost-found` barrel 匯出的 `LostFoundSystem` 依賴 `world-layout`（取得 `SCENE_CONFIG`），經過 barrel 會形成循環；`lost-found-layout-data.ts` 本身零依賴，直接匯入安全。

## 五、主要事件流程

每日流程（daily-flow 為狀態機中心）：

```
ready → (開始卸貨) unloading → (卸貨完成) sorting → (至少一台載具停靠) loading
  → (今日全部出貨) completed → (按下發車) departing
  → (六台全部離場) dayComplete → (按下結束今天) resetting → ready（天數+1）
```

跨系統事件目前以「建構子注入的回呼」實作（例：`onAllVehiclesDeparted`、`onFirstUnload`、`resetTools`），語意上對應 `core/game-events.ts` 定義的 `dayStarted`/`unloadingStarted`/`unloadingCompleted`/`vehiclesCalled`/`vehiclesDeparted`/`dailyShippingCompleted`/`lostFoundStarted`/`lostFoundCompleted`/`dayCompleted` 九種生命週期事件。`GameEventBus` 已建立為共用基礎設施，尚未全面取代既有回呼（見「六、技術債」）。

失物招領（lost-found）流程：卸貨開始 → 選定當日案件、延遲後噴出失物（不計入 dailyCargoIds）→ 六台載具全部離場（daily-flow 的 `onAllVehiclesDeparted`）→ NPC 從西側門進場、等待 → 玩家交還（正確/錯誤）→ NPC 離場或隔日清理。

## 六、Unity 對應方式

| 現有 | Unity 對應 |
|---|---|
| `systems/*/data.ts`、`systems/*/*-data.ts` | ScriptableObject |
| `systems/*/*-system.ts` | MonoBehaviour 或純 C# Service |
| `systems/*/ *-ui.ts` | Canvas Presenter |
| `adapters/rapier/physics-system.ts` | Unity Physics（PhysX） |
| `adapters/browser-input/input-binding-manager.ts` | Unity Input System |
| `adapters/local-storage/local-storage-adapter.ts` | Unity Save System（PlayerPrefs 或自訂存檔） |
| `core/game-events.ts` | Unity 的 C# event / UnityEvent |

`systems/*` 底下的**型別與資料**（貨物類型、國內/海外、六台載具資料、載具可接受貨物、每日貨量、分數公式、每日流程狀態、失物案件資料）不依賴 Three.js/Rapier/DOM，可直接對應 Unity 端資料類別。三個例外：`shared/types/interactable.ts` 的 `InteractableObject` 型別本身持有 `THREE.Mesh`/`RAPIER.RigidBody`（因為它同時是渲染/物理控點），以及各系統 `*-system.ts`/`*-ui.ts` 檔案本身（渲染/DOM 實作層），移植 Unity 時才需要重寫。

## 七、新增功能時應修改哪個模組

- 貨物種類/外觀 → `systems/cargo`
- 到貨口/生成節奏 → `systems/unloading`（總數改 `systems/daily-flow`）
- 新載具或裝載規則 → `systems/vehicle`
- 分數規則 → `systems/scoring`
- HUD 顯示欄位 → `systems/hud`
- 失物案件/NPC 行為 → `systems/lost-found`
- 房間/牆壁/門洞座標 → `systems/world-layout`
- 玩家輸入映射 → `adapters/browser-input`
- 系統間新的生命週期通知 → `core/game-events.ts` 新增事件型別

## 八、尚未整理的技術債

1. **`src/game/` 仍保留 23 個檔案**：皆為停用中的舊版原型系統（envelope/mail-sorting/counter-service/dolly/stamp-minigame/sorting-box/scale/sign/conveyor/outbound-zone，多數由 `feature-flags.ts` 關閉）與跨系統資料（`codex-data.ts`、`tutorial-data.ts`、`destination-data.ts`、`stamp-data.ts`、`package-data.ts`、`counter-layout-data.ts`、`compass-ui.ts`）。這些不在需求列出的 13 個系統內，為降低本次重構風險刻意未搬移／未刪除；`cargo-compliance.ts` 目前無任何引用者（疑似死碼，同樣未刪除，留待後續確認）。
2. **`SCENE_CONFIG` 與 world-layout 資料同檔**：`systems/world-layout/world-layout-system.ts` 同時匯出場景建置函式與 `SCENE_CONFIG`（互動距離、玩家速度、擲物力道等泛用遊戲數值，實際上與「世界佈局」無關，約 13 個系統會讀取）。應再拆出 `shared/gameplay-config.ts`，但影響面廣，本輪未執行。
3. **`GameEventBus` 尚未全面取代既有回呼**：`core/game-events.ts` 已建立，但目前跨系統仍以建構子注入回呼溝通（原有寫法，行為不變）；改為 emit/on 是後續可做的漸進式遷移，非本輪必要項。
4. **`game-app.ts` 行數（487 行）未落在 200–350 目標區間**：系統建構/依賴注入本身即佔約 230 行，屬於 spec 明確允許保留在 game-app.ts 的內容；`interruptPlayerActions`/`setPaused`/`endStampMinigame`/`startEnvelopeMinigame` 等屬於跨系統協調的小方法目前仍留在 game-app.ts，未強行拆分以避免不必要的風險。
5. **部分系統資料檔案略超過 2–5 檔案原則**：`systems/cargo`（6 檔）、`systems/vehicle`（6 檔）。皆為既有小型 data 檔案直接搬移（如 `cargo-category-data.ts`/`cargo-region-data.ts`、`vehicle-dock-data.ts`/`vehicle-route-data.ts`/`vehicle-cargo-bounds-data.ts`），未合併以避免手動搬移內容出錯的風險。
