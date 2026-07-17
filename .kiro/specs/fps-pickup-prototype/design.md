# Technical Design Document

## Overview

本文件描述《冥界郵局》第一階段原型的技術設計。目標是以最小架構實現第一人稱拾取與放下物件的互動原型，使用 Three.js + TypeScript + Vite，不引入任何框架、物理引擎或過度抽象。

## Architecture

### System Components

```
┌─────────────────────────────────────────────────┐
│                    Game                          │
│  (場景、攝影機、Renderer、遊戲迴圈)              │
├─────────────────────────────────────────────────┤
│  PlayerController  │ InteractionSystem │ HUD    │
│  (移動、視角)       │ (射線、高亮、提示) │ (UI)   │
├─────────────────────────────────────────────────┤
│              PickupSystem                        │
│  (拾取、放下、holdPoint 管理)                    │
├─────────────────────────────────────────────────┤
│         InteractableObject (資料結構)             │
│         SceneManager (場景建構)                   │
└─────────────────────────────────────────────────┘
```

### Project File Structure

```
project-root/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
└── src/
    ├── main.ts                      # 進入點，初始化 Game
    ├── style.css                    # 全域樣式與 HUD 樣式
    └── game/
        ├── game.ts                  # Game 類別：場景、攝影機、Renderer、主迴圈
        ├── scene-manager.ts         # 建構測試場景（房間、燈光、物件）
        ├── player-controller.ts     # PointerLockControls、WASD 移動、座標夾限
        ├── interaction-system.ts    # Raycaster、高亮、互動判定
        ├── pickup-system.ts         # 拾取、放下、holdPoint 管理
        ├── interactable-object.ts   # InteractableObject 介面與工廠函式
        └── hud.ts                   # DOM 操作：準心、提示、指示面板
```

## Data Models

### InteractableObject

```typescript
interface InteractableObject {
  id: string;                    // 唯一識別碼，例如 "parcel-small"
  displayName: string;           // 顯示名稱，例如 "小型包裹"
  mesh: THREE.Mesh;              // Three.js Mesh 參照
  canPickUp: boolean;            // 是否可拾取（預設 true）
  isHeld: boolean;               // 是否正被玩家持有
  originalParent: THREE.Object3D | null;  // 拾取前的父節點（Scene）
  originalMaterial: THREE.Material;       // 原始材質（高亮恢復用）
}
```

### PlayerInteractionData

```typescript
type PlayerInteractionState = "empty-handed" | "holding-item";

interface PlayerInteractionData {
  state: PlayerInteractionState;
  heldObjectId: string | null;
  targetedObjectId: string | null;
}
```

### Scene Configuration Constants

```typescript
const SCENE_CONFIG = {
  roomWidth: 10,
  roomDepth: 10,
  wallHeight: 3,
  groundY: 0,
  playerEyeHeight: 1.6,
  playerSpeed: 7,               // 單位/秒
  interactionDistance: 3,        // 公尺
  holdPointOffset: new THREE.Vector3(0, -0.3, -1.5),
  dropDistance: 2,               // 放下時距離玩家的距離
  boundaryMin: { x: -4.8, z: -4.8 },
  boundaryMax: { x: 4.8, z: 4.8 },
  deltaTimeMax: 0.1,            // deltaTime 鉗制上限（秒）
};
```

## Components and Interfaces

### Component Overview

| 元件 | 檔案 | 責任 |
|------|------|------|
| Game | game.ts | 場景初始化、遊戲主迴圈、子系統協調 |
| SceneManager | scene-manager.ts | 建構測試場景（房間、燈光、物件） |
| PlayerController | player-controller.ts | PointerLock、WASD 移動、座標夾限 |
| InteractionSystem | interaction-system.ts | Raycaster、高亮、E 鍵互動判定 |
| PickupSystem | pickup-system.ts | 拾取、放下、holdPoint 管理 |
| HUD | hud.ts | DOM 操作：準心、提示、指示面板 |

### Interfaces

```typescript
// interactable-object.ts
interface InteractableObject {
  id: string;
  displayName: string;
  mesh: THREE.Mesh;
  canPickUp: boolean;
  isHeld: boolean;
  originalParent: THREE.Object3D | null;
  originalMaterial: THREE.Material;
}

type PlayerInteractionState = "empty-handed" | "holding-item";

interface PlayerInteractionData {
  state: PlayerInteractionState;
  heldObjectId: string | null;
  targetedObjectId: string | null;
}
```

## Component Details

### 1. main.ts — 進入點

```typescript
// 責任：
// - 匯入 style.css
// - 檢查 WebGL 支援
// - 建立 Game 實例並啟動
// - 捕獲初始化錯誤並顯示至頁面

import { Game } from './game/game';
import './style.css';

function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

// 若不支援 WebGL，顯示錯誤訊息並中止
// 否則 new Game() 並呼叫 game.start()
```

### 2. Game — 主迴圈（game.ts）

```typescript
class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private playerController: PlayerController;
  private interactionSystem: InteractionSystem;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private clock: THREE.Clock;
  private interactables: Map<string, InteractableObject>;

  constructor() {
    // 建立 Scene、Camera、Renderer
    // 建立子系統
    // 呼叫 SceneManager 建構場景
    // 綁定 resize 事件
  }

  start(): void {
    // 啟動 requestAnimationFrame 迴圈
  }

  private loop(): void {
    // 1. deltaTime = clock.getDelta()，鉗制至 SCENE_CONFIG.deltaTimeMax
    // 2. playerController.update(deltaTime)
    // 3. interactionSystem.update()
    // 4. hud.update()
    // 5. renderer.render(scene, camera)
    requestAnimationFrame(() => this.loop());
  }
}
```

**遊戲迴圈每幀順序：**
1. 計算 deltaTime（鉗制 ≤ 100ms）
2. PlayerController.update(deltaTime) — 處理 WASD 移動與座標夾限
3. InteractionSystem.update() — 射線偵測、高亮更新、互動判定
4. HUD.update() — 更新 UI 文字與準心狀態
5. renderer.render() — 繪製場景

### 3. PlayerController（player-controller.ts）

```typescript
class PlayerController {
  private controls: PointerLockControls;
  private camera: THREE.PerspectiveCamera;
  private moveForward: boolean;
  private moveBackward: boolean;
  private moveLeft: boolean;
  private moveRight: boolean;
  private isLocked: boolean;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    // 建立 PointerLockControls
    // 綁定 keydown/keyup 事件
    // 綁定 lock/unlock 事件
    // 綁定 click → requestPointerLock
  }

  update(deltaTime: number): void {
    // IF !isLocked → 不處理移動，直接 return
    // 計算移動方向向量（基於攝影機面向方向）
    // velocity = direction * playerSpeed * deltaTime
    // 僅修改 X、Z（不改變 Y）
    // 座標夾限：clamp(position.x, boundaryMin.x, boundaryMax.x)
    // 座標夾限：clamp(position.z, boundaryMin.z, boundaryMax.z)
    // 強制 camera.position.y = playerEyeHeight
  }
}
```

**移動計算：**
- 使用 `THREE.Vector3` 作為方向向量
- W/S 對應 `controls.moveForward(distance)` 或手動計算前後向量
- A/D 對應左右向量（攝影機右方）
- 移動後立即夾限座標
- Y 軸每幀強制設定，不受任何計算影響

**Pointer Lock 狀態：**
- `lock` 事件 → isLocked = true，通知 HUD 隱藏指示面板
- `unlock` 事件 → isLocked = false，通知 HUD 顯示指示面板
- 未鎖定時忽略所有鍵盤輸入

### 4. InteractionSystem（interaction-system.ts）

```typescript
class InteractionSystem {
  private raycaster: THREE.Raycaster;
  private camera: THREE.PerspectiveCamera;
  private interactables: Map<string, InteractableObject>;
  private playerData: PlayerInteractionData;
  private pickupSystem: PickupSystem;
  private hud: HUD;
  private currentTarget: InteractableObject | null;

  constructor(camera, interactables, playerData, pickupSystem, hud) {
    // 初始化 Raycaster
    // 綁定 E 鍵事件
  }

  update(): void {
    // 1. 設定 raycaster：origin = camera.position, direction = camera forward
    //    camera.getWorldDirection(direction)
    // 2. raycaster.intersectObjects(場景中所有 interactable mesh)
    // 3. 篩選第一個命中且 isHeld === false 的物件
    // 4. 若命中物件距離 ≤ interactionDistance：
    //    - 設為 currentTarget
    //    - 高亮該物件（設定 emissive）
    //    - 通知 HUD 顯示物件名稱 + 「按 E 拿起」
    // 5. 若無命中或距離過遠：
    //    - 清除 currentTarget 高亮
    //    - 通知 HUD 隱藏提示
  }

  private onInteractKeyPressed(): void {
    // IF playerData.state === "holding-item":
    //   → pickupSystem.putDown()
    // ELSE IF currentTarget !== null && distance ≤ interactionDistance:
    //   → pickupSystem.pickUp(currentTarget)
    // ELSE:
    //   → 不做任何事（或顯示「距離太遠」）
  }
}
```

**Raycaster 偵測方式：**
- 每幀重新設定 raycaster 的 origin 與 direction
- `raycaster.set(camera.position, camera.getWorldDirection(new Vector3()))`
- `intersectObjects()` 傳入所有可互動物件的 mesh 陣列
- 只取第一個交點（最近的）
- 檢查交點距離是否 ≤ 3 公尺
- 被持有中的物件（isHeld === true）排除於偵測清單外

**高亮效果：**
- 使用 `MeshStandardMaterial` 的 `emissive` 屬性
- 瞄準時：`mesh.material.emissive.setHex(0x444444)`
- 取消瞄準時：`mesh.material.emissive.setHex(0x000000)`
- 保存原始 emissive 值以便恢復

### 5. PickupSystem（pickup-system.ts）

```typescript
class PickupSystem {
  private holdPoint: THREE.Object3D;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private playerData: PlayerInteractionData;
  private interactables: Map<string, InteractableObject>;

  constructor(camera, scene, playerData, interactables) {
    // 建立 holdPoint 作為 camera 的子物件
    this.holdPoint = new THREE.Object3D();
    this.holdPoint.position.copy(SCENE_CONFIG.holdPointOffset);
    camera.add(this.holdPoint);
  }

  pickUp(obj: InteractableObject): void {
    // 1. 記錄 obj.originalParent = obj.mesh.parent
    // 2. 從原始父節點移除：obj.mesh.parent.remove(obj.mesh)
    // 3. 掛載到 holdPoint：this.holdPoint.add(obj.mesh)
    // 4. 重設物件本地位置與旋轉：
    //    obj.mesh.position.set(0, 0, 0)
    //    obj.mesh.rotation.set(0, 0, 0)
    // 5. 更新狀態：
    //    obj.isHeld = true
    //    playerData.state = "holding-item"
    //    playerData.heldObjectId = obj.id
  }

  putDown(): void {
    // 1. 找到被持有的物件
    const obj = this.interactables.get(playerData.heldObjectId);
    // 2. 從 holdPoint 移除
    this.holdPoint.remove(obj.mesh);
    // 3. 計算放下世界座標（見下方詳述）
    const dropPosition = this.calculateDropPosition(obj);
    // 4. 加回 scene
    this.scene.add(obj.mesh);
    obj.mesh.position.copy(dropPosition);
    obj.mesh.rotation.set(0, 0, 0);
    // 5. 更新狀態：
    //    obj.isHeld = false
    //    playerData.state = "empty-handed"
    //    playerData.heldObjectId = null
  }

  private calculateDropPosition(obj: InteractableObject): THREE.Vector3 {
    // 取得攝影機前方方向（僅 XZ 平面，忽略 Y）
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // 放下位置 = 攝影機位置 + forward * dropDistance
    const dropPos = this.camera.position.clone().add(
      forward.multiplyScalar(SCENE_CONFIG.dropDistance)
    );

    // 計算物件高度，使底部貼地
    const box = new THREE.Box3().setFromObject(obj.mesh);
    const objectHeight = box.max.y - box.min.y;
    dropPos.y = SCENE_CONFIG.groundY + objectHeight / 2;

    return dropPos;
  }
}
```

### holdPoint 父子關係

```
Scene
├── Camera (PerspectiveCamera)
│   └── holdPoint (Object3D, position: 0, -0.3, -1.5)
│       └── [被持有的物件 Mesh]  ← 拾取時附加於此
├── Floor
├── Walls
├── [場景中未被持有的物件]  ← 放下時回到此層級
└── Lights
```

**關鍵點：**
- holdPoint 是 Camera 的子物件，因此自動跟隨攝影機的位置與旋轉
- 被持有物件作為 holdPoint 的子物件，無需每幀手動更新世界座標
- 物件掛載到 holdPoint 後，其本地座標設為 (0,0,0)，實際顯示位置由 holdPoint 的偏移決定
- 放下時必須先從 holdPoint 移除，再加回 Scene，並設定正確的世界座標

### 拾取狀態流程

```
[empty-handed] ──── 按 E + 瞄準物件 + 距離 ≤ 3m ────→ [holding-item]
     ↑                                                        │
     │                                                        │
     └──────────────── 按 E（任何時候）─────────────────────────┘

拾取流程：
1. 驗證條件：state === "empty-handed" && target !== null && distance ≤ 3
2. mesh 從 Scene 移除
3. mesh 掛載到 holdPoint
4. mesh.position 設為 (0, 0, 0)
5. mesh.rotation 設為 (0, 0, 0)
6. obj.isHeld = true
7. playerData.state = "holding-item"
8. playerData.heldObjectId = obj.id
9. 清除高亮
10. HUD 更新為「按 E 放下」

放下流程：
1. 驗證條件：state === "holding-item" && heldObjectId !== null
2. mesh 從 holdPoint 移除
3. 計算放下世界座標（攝影機前方 2m，Y 根據物件高度貼地）
4. mesh 加回 Scene
5. mesh.position 設為計算結果
6. mesh.rotation 設為 (0, 0, 0)
7. obj.isHeld = false
8. playerData.state = "empty-handed"
9. playerData.heldObjectId = null
10. HUD 更新（清除放下提示）
```

### 6. 放下物件時的世界座標計算

```
步驟：
1. 取得攝影機世界方向 → forward = camera.getWorldDirection()
2. 投影到 XZ 平面 → forward.y = 0; forward.normalize()
3. 計算目標 XZ → dropXZ = camera.position + forward * dropDistance
4. 計算 bounding box → box = new Box3().setFromObject(mesh)
   注意：此時 mesh 已從 holdPoint 移除，需要暫時設定 position 後計算
   或使用物件的幾何 boundingBox（geometry.boundingBox）
5. objectHeight = geometry.parameters.height（BoxGeometry）
   或 objectHeight = box.max.y - box.min.y
6. dropY = groundY + objectHeight / 2
7. 最終位置 = (dropXZ.x, dropY, dropXZ.z)
```

**注意事項：**
- 使用 `geometry.parameters` 取得 BoxGeometry 的原始尺寸更為可靠
- 放下後 mesh.rotation 重設為 (0,0,0)，確保 bounding box 計算一致
- 不需要檢查放下位置是否在房間範圍內（已知限制）

### 7. HUD（hud.ts）

```typescript
class HUD {
  private crosshairEl: HTMLElement;
  private promptEl: HTMLElement;
  private instructionEl: HTMLElement;
  private tooFarEl: HTMLElement;

  constructor() {
    // 從 DOM 取得或動態建立 HUD 元素
    // 準心：固定在 viewport 正中央的 div（CSS position: fixed）
    // 提示：顯示物件名稱與操作文字
    // 指示面板：PointerLock 操作說明
    // 距離太遠提示：帶自動消失計時器
  }

  showInteractionPrompt(name: string, action: string): void {
    // 顯示 "[name]\n[action]"
  }

  hideInteractionPrompt(): void { }

  showInstructions(): void { }
  hideInstructions(): void { }

  setCrosshairActive(active: boolean): void {
    // active → 準心變色（例如變為綠色）
    // inactive → 準心恢復白色
  }

  showTooFar(): void {
    // 顯示「距離太遠」，2 秒後自動隱藏
  }

  update(): void {
    // 由 Game loop 呼叫
    // 根據目前 playerData 狀態更新 UI
  }
}
```

**HUD 使用純 HTML/CSS DOM 元素，不使用任何 UI 框架。**

HTML 結構（於 index.html 或由 JS 動態建立）：

```html
<div id="hud">
  <div id="crosshair">+</div>
  <div id="interaction-prompt"></div>
  <div id="instructions-panel">
    <p>點擊畫面開始</p>
    <p>WASD 移動</p>
    <p>滑鼠控制視角</p>
    <p>E 拿起或放下物件</p>
    <p>Esc 解除滑鼠鎖定</p>
  </div>
  <div id="too-far-prompt"></div>
</div>
```

### 8. SceneManager（scene-manager.ts）

```typescript
function createTestScene(scene: THREE.Scene): Map<string, InteractableObject> {
  // 1. 建立地板：PlaneGeometry(10, 10)，旋轉 -90° 使其水平
  // 2. 建立四面牆壁：PlaneGeometry 或 BoxGeometry
  // 3. 建立燈光：AmbientLight + DirectionalLight
  // 4. 建立 3 個測試物件：
  //    - "parcel-small": BoxGeometry(0.3, 0.3, 0.3), 顯示名稱 "小型包裹"
  //    - "parcel-long": BoxGeometry(0.2, 0.2, 0.8), 顯示名稱 "長型包裹"
  //    - "mailbox-medium": BoxGeometry(0.5, 0.5, 0.4), 顯示名稱 "中型郵件箱"
  // 5. 各物件放置於地板上（Y = height/2），分散於房間內不同位置
  // 6. 返回 interactables Map
}
```



## Error Handling

| 情境 | 處理方式 |
|------|---------|
| 按 E 無目標物件 | 不執行任何操作，不拋出錯誤 |
| 物件距離超過 3m | HUD 顯示「距離太遠」，2 秒後消失 |
| 已持有物件按 E | 僅觸發放下，不嘗試拾取 |
| InteractableObject 資料無效 | `if (!obj) return`，跳過處理 |
| WebGL 不支援 | 初始化前檢查，顯示錯誤訊息，不建立 Renderer |
| holdPoint 找不到持有物件 | 防禦性檢查 `if (!heldObj) return` |
| interactables Map 查詢失敗 | 使用 `.get()` 並檢查 undefined |

所有公開方法入口加入防禦性檢查，確保遊戲不會因任何單一互動操作而崩潰。

## Testing Strategy

本階段採用手動測試方式驗證功能正確性。

**測試一：基本移動**
1. 開啟遊戲 → 看到指示面板
2. 點擊畫面 → 指示面板消失、滑鼠鎖定
3. WASD 移動 → 確認移動平穩、不會飛行
4. 移動到房間邊界 → 確認被擋住
5. 按 Esc → 確認滑鼠解鎖、指示面板重新出現

**測試二：準心與射線偵測**
1. 走近物件（3m 內）→ 準心變色、顯示物件名稱 + 「按 E 拿起」
2. 移開視線 → 準心恢復、提示消失
3. 站在 3m 外瞄準物件 → 不顯示互動提示

**測試三：拾取物件**
1. 瞄準物件按 E → 物件出現在攝影機前方
2. 移動與旋轉 → 物件穩定跟隨
3. 再次瞄準另一物件按 E → 不應拾取（先放下）
4. 確認畫面顯示「按 E 放下」

**測試四：放下物件**
1. 持有物件按 E → 物件出現在前方地面
2. 確認物件底部貼地
3. 確認準心再次瞄準該物件可以看到拾取提示
4. 確認可以再次拾取

**測試五：重複互動**
1. 對同一物件重複拾取與放下 10 次以上
2. 確認無重複物件產生
3. 確認無物件消失
4. 確認瀏覽器 Console 無錯誤

**測試六：錯誤情境**
1. 對空氣按 E → 無反應
2. 在 3m 外按 E → 無反應或顯示「距離太遠」
3. 持有物件時瞄準另一物件按 E → 僅放下當前物件

## Correctness Properties

### Property 1: 狀態一致性

`playerData.state === "holding-item"` 時，必定有且只有一個 InteractableObject 的 `isHeld === true`，且其 mesh 為 holdPoint 的子物件。

**Validates: Requirements 7.4, 7.6**

### Property 2: 物件唯一性

任何 InteractableObject 的 mesh 在場景圖中只存在一個位置（Scene 下或 holdPoint 下，不會同時存在於兩處）。

**Validates: Requirements 5.1, 6.1**

### Property 3: 可逆性

拾取後放下的物件必須與拾取前具有相同的互動能力，無論重複多少次。

**Validates: Requirements 6.3, 6.4**

### Property 4: Y 軸不可變

玩家攝影機 Y 座標在任何操作後都必須等於 playerEyeHeight。

**Validates: Requirements 3.3**

### Property 5: 無累積誤差

被持有物件的本地座標為 (0,0,0)，不會因每幀更新而產生浮點數累積。

**Validates: Requirements 5.2**

### Property 6: 無孤兒物件

放下時物件必定被加回 Scene；拾取時物件必定被加入 holdPoint。

**Validates: Requirements 5.1, 6.2**

## Dependencies

```json
{
  "dependencies": {
    "three": "^0.164.0"
  },
  "devDependencies": {
    "@types/three": "^0.164.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0"
  }
}
```

不使用其他第三方函式庫。PointerLockControls 從 `three/addons/controls/PointerLockControls.js` 匯入。

## Key Design Decisions

1. **不使用 ECS 或狀態管理框架**：直接使用類別與介面，狀態透過簡單物件追蹤
2. **holdPoint 使用場景圖父子關係**：避免每幀手動計算世界座標，利用 Three.js 內建的矩陣繼承
3. **座標夾限取代碰撞偵測**：第一階段不需要精確碰撞，簡單 clamp 即可
4. **HUD 使用 DOM 覆蓋層**：CSS position: fixed 覆蓋在 canvas 上方，避免引入 UI 框架
5. **高亮使用 emissive**：最簡單的視覺回饋，不需要後處理 pass
6. **放下位置計算忽略 Y 方向**：forward 投影到 XZ 平面後才計算距離，避免看天花板時物件飛到空中
7. **Three.Clock 管理 deltaTime**：內建功能，自動處理時間差，搭配手動鉗制即可
