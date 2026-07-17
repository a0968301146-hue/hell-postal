# Requirements Document

## Introduction

《冥界郵局》遊戲原型：在瀏覽器中使用 Three.js + TypeScript + Vite 建構第一人稱拾取與放置物件的互動原型。第二階段新增放置預覽系統、透明投影合法性檢查、Shift 奔跑、擴大場景與額外測試物件。

## Glossary

- **Game_System**：整體遊戲應用程式，負責初始化、遊戲迴圈與渲染
- **Player_Controller**：處理第一人稱移動與相機控制的模組
- **Interaction_System**：處理射線偵測、物件高亮與互動提示的模組
- **Pickup_System**：處理物件拾取與放下邏輯的模組
- **HUD**：螢幕上的使用者介面元素（準心、互動提示、指示面板）
- **Interactable_Object**：場景中可被玩家互動的物件，具有唯一 ID、顯示名稱、網格與狀態旗標
- **Hold_Point**：相機的子物件，作為持有物件的掛載點，建議偏移量為 (0, -0.3, -1.5)
- **Crosshair**：畫面正中央的十字準心 UI 元素
- **Raycaster**：從相機中心發射射線以偵測瞄準目標的 Three.js 元件
- **PointerLockControls**：Three.js 提供的滑鼠鎖定視角控制器
- **Test_Scene**：灰盒測試場景，包含地板、四面牆壁、燈光與測試物件
- **Interaction_Distance**：玩家與物件之間允許互動的最大距離，為 3 公尺
- **Player_State**：玩家當前互動狀態，分為「空手」與「持有物件」兩種

## Requirements

### Requirement 1: 專案建置與開發環境

**User Story:** 身為開發者，我希望專案可透過標準 npm 指令建置與執行，以便快速開發與驗證原型。

#### Acceptance Criteria

1. THE Game_System SHALL 使用 TypeScript、Three.js 與 Vite 作為技術堆疊，不依賴 React、Vue、Angular、物理引擎或後端服務
2. THE Game_System SHALL 於 package.json 中指定相容的 Node.js 版本範圍（最低 18.x），並於 README 中記載所需之 Node.js 與 npm 最低版本
3. WHEN 開發者執行 `npm install` 指令時，THE Game_System SHALL 以結束碼 0 完成安裝，且終端輸出中無 `npm ERR!` 錯誤訊息
4. WHEN 開發者執行 `npm run dev` 指令時，THE Game_System SHALL 於 30 秒內啟動本地開發伺服器，並於瀏覽器中呈現 Three.js 渲染的 canvas 元素且瀏覽器主控台無錯誤訊息
5. WHEN 開發者執行 `npm run build` 指令時，THE Game_System SHALL 以結束碼 0 完成編譯，產出可部署的靜態檔案至 `dist` 目錄，且過程中無 TypeScript 編譯錯誤
6. IF 瀏覽器不支援 WebGL，THEN THE Game_System SHALL 於頁面可視區域內顯示文字訊息，說明需要支援 WebGL 的瀏覽器才能執行遊戲，且不渲染 Three.js canvas 元素

### Requirement 2: 測試場景

**User Story:** 身為開發者，我希望有一個簡易的室內灰盒場景，以便測試第一人稱互動功能。

#### Acceptance Criteria

1. THE Test_Scene SHALL 包含一個地板平面（Y=0）與四面牆壁圍成的封閉室內空間，房間尺寸為寬度 10 單位 × 深度 10 單位 × 牆壁高度 3 單位
2. THE Test_Scene SHALL 包含一盞 AmbientLight 與一盞 DirectionalLight 或 HemisphereLight，使場景內所有物件在預設攝影機視角下皆可目視辨識
3. THE Test_Scene SHALL 放置 3 個可互動測試物件於地板上（物件底部接觸 Y=0 平面），各物件使用 BoxGeometry 且彼此包圍盒不重疊，尺寸定義如下：小包裹 0.3×0.3×0.3 單位、長型包裝 0.2×0.2×0.8 單位、中型郵箱 0.5×0.5×0.4 單位
4. THE Interactable_Object SHALL 具有以下屬性：唯一字串 ID（場景內不重複）、顯示名稱（非空字串）、interactable 旗標（預設值為 true）、Three.js Mesh 參照、初始位置（Vector3）與初始旋轉（Euler）
5. WHEN Test_Scene 載入完成, THE Test_Scene SHALL 將 3 個可互動物件的 interactable 旗標皆設為 true，且各物件位於房間地板範圍內（X、Z 座標絕對值小於 4.5 單位）

### Requirement 3: 第一人稱移動控制

**User Story:** 身為玩家，我希望使用鍵盤與滑鼠控制角色移動與視角，以便在場景中自由探索。

#### Acceptance Criteria

1. WHEN 玩家點擊遊戲畫面時，THE Player_Controller SHALL 透過 PointerLockControls 啟動滑鼠鎖定，並開始接收滑鼠移動作為視角控制輸入，其中垂直視角（俯仰角）SHALL 限制在 -90 度至 90 度之間
2. WHILE 滑鼠鎖定啟用中，WHEN 玩家按下 W、A、S、D 鍵時，THE Player_Controller SHALL 以與幀率無關的方式（使用 deltaTime）沿攝影機面向方向移動玩家位置，移動速度為每秒 5 至 10 單位（含）之間的固定值
3. THE Player_Controller SHALL 將玩家攝影機高度固定於場景定義之眼睛高度值，不允許垂直位移（飛行或下沉）
4. THE Player_Controller SHALL 在每幀更新後將玩家座標夾限於房間邊界矩形範圍內（由場景配置定義之最小與最大 X、Z 座標），無需實體牆壁碰撞偵測
5. WHEN 玩家按下 Esc 鍵時，THE Player_Controller SHALL 解除滑鼠鎖定並暫停所有移動與視角輸入處理
6. WHILE 滑鼠鎖定未啟用，IF 玩家按下 W、A、S、D 鍵或移動滑鼠，THEN THE Player_Controller SHALL 忽略該輸入，不改變玩家位置或視角

### Requirement 4: 準心與射線偵測

**User Story:** 身為玩家，我希望螢幕中央有一個準心，並能偵測瞄準的物件，以便知道可以與哪些物件互動。

#### Acceptance Criteria

1. THE HUD SHALL 在螢幕視窗正中央持續顯示一個十字準心，準心尺寸不超過 32×32 像素，顏色為白色，且不遮擋玩家對場景的視野
2. THE Interaction_System SHALL 每幀從相機位置沿相機正前方方向發射一條 Raycaster 進行射線偵測
3. WHEN Raycaster 命中一個 Interactable_Object 且命中距離小於或等於 3 公尺時，THE Interaction_System SHALL 高亮顯示該物件（透過增加材質自發光值或改變材質顏色，不使用後處理效果）、在準心附近顯示該物件名稱、並顯示「按 E 拿起」互動提示文字
4. WHEN Raycaster 命中一個 Interactable_Object 且命中距離小於或等於 3 公尺時，THE HUD SHALL 改變準心外觀（例如變色或變形）以指示當前瞄準物件可互動
5. WHEN Raycaster 未命中任何 Interactable_Object 或命中物件距離超過 3 公尺時，THE Interaction_System SHALL 移除所有物件高亮效果、隱藏互動提示文字、並將準心恢復為預設外觀
6. IF 一個 Interactable_Object 的高亮效果被啟用後玩家將準心移開該物件，THEN THE Interaction_System SHALL 在 1 幀內將該物件材質恢復為高亮前的原始狀態

### Requirement 5: 物件拾取

**User Story:** 身為玩家，我希望按下 E 鍵拾取瞄準的物件，以便將物件帶在身上移動。

#### Acceptance Criteria

1. WHEN 玩家按下 E 鍵且 Player_State 為空手且 Raycaster 命中一個 canPickUp 屬性為 true 的 Interactable_Object 且距離小於或等於 3 公尺時，THE Pickup_System SHALL 將該物件標記為已持有、儲存原始父節點、將物件重新掛載至 Hold_Point、並設定物件本地位置至 Hold_Point 偏移量（X:0, Y:-0.3, Z:-1.5）
2. WHILE Player_State 為持有物件時，THE Pickup_System SHALL 使被持有物件每幀同步跟隨相機的位置與旋轉，物件與 Hold_Point 之間的位置誤差不得超過 0.001 單位
3. WHILE Player_State 為持有物件時，THE HUD SHALL 顯示「按 E 放下」提示
4. THE Pickup_System SHALL 同一時間只允許持有一個物件
5. WHEN 物件被拾取時，THE Interaction_System SHALL 清除該物件的高亮效果
6. IF 玩家按下 E 鍵且 Player_State 為持有物件時，THE Pickup_System SHALL 僅觸發放下流程，不得拾取新的物件
7. WHILE Player_State 為持有物件時，THE Pickup_System SHALL 確保被持有物件不遮擋超過畫面面積的 50%

### Requirement 6: 物件放下

**User Story:** 身為玩家，我希望按下 E 鍵放下手中物件，以便將物件放回場景中。

#### Acceptance Criteria

1. WHILE Player_State 為持有物件，WHEN 玩家按下 E 鍵，THE Pickup_System SHALL 立即將物件從相機分離，並沿相機正前方方向放置於距玩家 1.5 至 2 公尺處，且放置位置不得與玩家碰撞體重疊；物件底部貼齊地面（物件中心 Y = 0 + 物件高度的一半）
2. WHEN 物件被放下後，THE Pickup_System SHALL 使物件停止跟隨相機、恢復物件的可互動狀態、恢復物件的顯示名稱及可互動提示文字至拾取前狀態
3. WHEN 物件被放下後，THE Interaction_System SHALL 立即允許玩家再次瞄準並拾取該物件（無需等待冷卻時間）
4. THE Pickup_System SHALL 支援對同一物件反覆執行拾取與放下操作至少 10 次，且每次放下後物件位置、互動狀態與顯示名稱皆與首次放下時行為一致，不產生位置偏移、狀態遺失或系統例外
5. IF 玩家按下 E 鍵時 Player_State 不為持有物件，THEN THE Pickup_System SHALL 不執行任何放下動作且不改變場景狀態

### Requirement 7: 玩家狀態管理

**User Story:** 身為開發者，我希望有清晰的玩家狀態管理，以便系統正確判斷當前可執行的動作。

#### Acceptance Criteria

1. THE Player_State SHALL 具有且僅有兩種狀態：「empty-handed」（空手）與「holding-item」（持有物件），且初始狀態為「empty-handed」
2. THE Game_System SHALL 維護 PlayerInteractionData 資料結構，包含當前狀態（state）、已持有物件 ID（heldObjectId，型別為 string | null）、當前瞄準物件 ID（targetedObjectId，型別為 string | null）
3. THE Game_System SHALL 維護每個 Interactable_Object 的資料結構，包含 id（string）、displayName（string）、mesh（THREE.Object3D）、canPickUp（boolean）與 isHeld（boolean）屬性
4. WHEN 玩家拾取一個 canPickUp 為 true 且 isHeld 為 false 的物件時，THE Game_System SHALL 將 Player_State 從「empty-handed」轉換為「holding-item」，將 heldObjectId 設為該物件之 id，並將該物件的 isHeld 設為 true
5. WHEN 玩家放下當前持有物件時，THE Game_System SHALL 將 Player_State 從「holding-item」轉換為「empty-handed」，將 heldObjectId 設為 null，並將該物件的 isHeld 設為 false
6. THE Game_System SHALL 維持以下資料一致性：當 state 為「empty-handed」時，heldObjectId 必須為 null 且無任何 Interactable_Object 的 isHeld 因該玩家而為 true；當 state 為「holding-item」時，heldObjectId 必須對應一個存在且 isHeld 為 true 的 Interactable_Object

### Requirement 8: 錯誤處理

**User Story:** 身為玩家，我希望遊戲在異常情況下能優雅處理，不會崩潰或無預警中斷。

#### Acceptance Criteria

1. WHEN 玩家按下 E 鍵且未瞄準任何物件時，THE Game_System SHALL 不執行任何動作，且不在瀏覽器主控台產生未處理的錯誤訊息
2. WHEN 玩家瞄準一個超過 Interaction_Distance 的物件時，THE HUD SHALL 顯示「距離太遠」提示，該提示於顯示 2 秒後自動消失
3. WHILE Player_State 為持有物件時，WHEN 玩家按下 E 鍵，THE Pickup_System SHALL 僅執行放下動作，不嘗試拾取新物件
4. IF Interactable_Object 的資料缺失或無效，THEN THE Game_System SHALL 跳過該物件的互動處理，遊戲繼續運行且不在瀏覽器主控台產生未處理的錯誤訊息
5. IF 玩家的瀏覽器或裝置不支援 WebGL，THEN THE Game_System SHALL 顯示「目前瀏覽器或裝置不支援WebGL，無法啟動遊戲。」訊息，且不載入遊戲場景

### Requirement 9: 使用者介面

**User Story:** 身為玩家，我希望螢幕上有清楚的提示資訊，以便了解當前可執行的操作。

#### Acceptance Criteria

1. THE HUD SHALL 於畫面中央持續顯示十字準心
2. WHILE 滑鼠未鎖定, THE HUD SHALL 顯示指示面板，內容包含「點擊畫面開始」、移動與視角操作說明、互動按鍵說明及解除鎖定方式
3. WHILE 滑鼠已鎖定, THE HUD SHALL 隱藏指示面板
4. WHEN 玩家準心瞄準互動範圍內的可互動物件且未持有物件時, THE HUD SHALL 於畫面顯示該物件的顯示名稱及「按 E 拿起」操作提示
5. WHILE 玩家持有物件, THE HUD SHALL 持續顯示所持物件的顯示名稱及「按 E 放下」操作提示
6. IF 玩家準心未瞄準任何可互動物件且未持有物件, THEN THE HUD SHALL 隱藏互動操作提示
7. THE HUD SHALL 以不遮擋主要遊戲視野的方式呈現所有介面元素，且所有文字以繁體中文顯示

### Requirement 10: 遊戲迴圈

**User Story:** 身為開發者，我希望遊戲迴圈有明確的執行順序，以便確保各系統正確協作。

#### Acceptance Criteria

1. THE Game_System SHALL 在每幀依照以下固定順序執行子系統：計算 deltaTime（當前幀時間戳減去前一幀時間戳，單位為秒）→ 玩家移動 → 相機更新 → 射線偵測 → 高亮更新 → HUD 更新 → 渲染，且不得更改此順序
2. THE Game_System SHALL 使用 requestAnimationFrame 驅動遊戲迴圈，以 requestAnimationFrame 回呼提供的時間戳作為 deltaTime 計算來源，確保每次迴圈迭代不阻塞主執行緒
3. IF deltaTime 超過 100 毫秒（例如瀏覽器分頁切換回來後），THEN THE Game_System SHALL 將該幀的 deltaTime 鉗制為 100 毫秒，以防止物理與移動計算產生過大位移
4. THE Game_System SHALL 不對被持有物件（Hold_Point 的子物件）執行手動世界座標更新，被持有物件的位置由場景圖層級結構自動繼承相機變換

## Exclusions

以下功能明確不包含在此階段：

- 多人連線、後端服務、帳號系統、存檔系統
- 郵局工作流程、郵票、秤重、包裝
- 日夜系統、NPC、任務、金錢、物品欄
- 物理引擎、重力、投擲、破壞
- 複雜動畫、敵人、戰鬥

## Known Acceptable Limitations

- 無實體牆壁碰撞（僅座標夾限）
- 物件無重力效果
- 物件可能穿透牆壁
- 放置時無重疊檢查
- 無投擲功能、無旋轉持有物件
- 無手部模型或拾取動畫
