# 冥界郵局 — 第一階段原型

第一人稱拿起與放下物件互動原型。

## 系統需求

- Node.js >= 18.0.0
- npm >= 9.0.0
- 支援 WebGL 的現代瀏覽器

## 安裝與啟動

```bash
npm install
npm run dev
```

開發伺服器啟動後，於瀏覽器開啟顯示的 URL（預設 http://localhost:5173）。

## 建置

```bash
npm run build
```

產出檔案位於 `dist/` 目錄。

## 類型檢查

```bash
npm run typecheck
```

## 操作說明

- **點擊畫面**：進入第一人稱模式（鎖定滑鼠）
- **WASD**：移動
- **滑鼠**：控制視角
- **E**：拿起 / 放下物件
- **Esc**：解除滑鼠鎖定

## 技術堆疊

- TypeScript
- Three.js
- Vite
