---
name: watchlist-cost-price
description: guliu-radar 水池（庫存股）成本價與浮盈虧功能；順帶記錄研判頁的死碼發現
metadata:
  type: project
---

## 水池成本價功能（2026-09-10）

使用者提醒：水池（庫存股）不一定是賺錢部位，可能是捨不得停損的虧損單——成本價功能要如實顯示浮虧，不能只做賺錢時的漂亮數字。

| 檔案 | 變更 |
|---|---|
| `client/src/lib/watchlist.ts` | `WatchItem` 新增選填 `costPrice?: number`；新增 `setCostPrice(symbol, price)`，price 為 null/非正數時清掉欄位，不存假成本 |
| `client/src/pages/Home.tsx` | 新增 `CostBlock` 元件：未設定時顯示「＋設定成本價」；已設定顯示「成本 XX・浮盈/浮虧 ±XX（±XX%）」，賺虧都用同一套紅漲綠跌顏色語意（`--primary`珊瑚橘=浮盈、`--accent`薄荷綠=浮虧），插入「水池」分類的自選股列（一般跟靜流收合區都有） |
| `client/src/index.css` | `.saved-row` 加 `flex-wrap`，成本價區塊用 `flex-basis:100%` 自動換到下一行——沒設定成本價的一般自選股列版面完全不受影響 |

同時把「水池」分類旁加上小字「（庫存）」——分類篩選按鈕列跟標籤選單 checkbox 都加了，避免使用者看到「水池」不知道是什麼意思。

## 研判頁死碼發現（同次對話）

`client/src/pages/Home.tsx` 裡定義了一個 `function PA(...)`（含 `strategyId` 選擇、戰法狀態卡、六段 PA 分析），**但從未被任何地方渲染**——「研判」分頁實際渲染的是 `StockDetail.tsx`，走完全不同的 `StockSignal` 資料結構（`strategies: StrategyMatch[]`，一次列出全部戰法的匹配度＋進度條＋白話說明，不是選一個看一個）。

這個死碼本身不影響任何功能（沒人走得到），但如果之後要重構研判頁，要注意這段 `PA` function 是否還有參考價值或該直接刪除，避免下次又有人（包括我自己）誤把它當成正在運作的程式碼去分析。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過（不受影響，watchlist.ts 目前無專屬測試）
- P&L 公式（`diff = close - costPrice`, `pct = diff/costPrice*100`）純數學，未寫專屬單元測試，之後若要提高信心可補
