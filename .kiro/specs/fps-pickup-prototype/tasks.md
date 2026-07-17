# Implementation Plan:

## Overview

分類箱改為真正開口容器：5 面壁 Mesh + 5 個 Collider，上方完全開放。

## Tasks

- [x] 1. 重寫 sorting-box-system.ts 使用 5 面獨立 Mesh（底+4壁）
- [x] 2. 移除舊的單一實心 BoxGeometry 視覺
- [x] 3. 分類箱 Collider 改為底板+4壁（無頂部）
- [x] 4. 動態 Body 只用於 pickup，collider 限於底板厚度不擋內部
- [x] 5. 加入 interiorPlacementPlane（不可見、供 Raycaster 命中）
- [x] 6. 更新 sorting-box-data.ts 尺寸為 0.9×0.7×0.75
- [x] 7. interaction-system.ts：手持信封 E 鍵先檢查 interiorPlane 直接放入
- [x] 8. pickup-system.ts：加入 placeIntoContainer() 方法
- [x] 9. 移除靠近分類箱的額外投入 UI
- [x] 10. npm run typecheck 通過
- [x] 11. npm run build 通過
- [ ] 12. 人工瀏覽器測試

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9],
    [10, 11],
    [12]
  ]
}
```

## Notes

- 原因：舊系統使用單一 BoxGeometry Mesh + 全體積 Dynamic Collider，信封無法進入
- 修正：5 面獨立 Mesh + 5 個 static 壁面 Collider + 底板薄 dynamic body for pickup
- 上方完全無 Collider/Mesh
- interiorPlacementPlane 位於底板上方 0.04m 供 E 鍵直接放入
- 搬動分類箱時信封跟隨為已知限制（static walls 不跟隨 dynamic body 移動）
