---
name: scan-to-pa-strategy-highlight
description: guliu-radar 掃描頁選中的戰法串接到研判頁，自動捲到並強調對應那一列
metadata:
  type: project
---

## 做了什麼（2026-09-10）

從掃描頁「策略掃描（自選）」或「戰法×法人 Top 100」點一檔候選股，之前會跳到研判頁但完全看不出「我是為了哪個戰法點進來的」——`StockDetail.tsx` 的「戰法匹配度」清單一次列出全部戰法，你要自己找。現在點進去會自動捲到那一列並加外框強調。

| 檔案 | 變更 |
|---|---|
| `client/src/pages/Home.tsx` | `goPA` 多一個選填參數 `highlightStrategy?: string`；新增 `paHighlightStrategy` state；`Scan` 元件的 `goPA` prop 型別跟著放寬；候選股列點擊時傳入 `strategyName`（戰法「名稱」不是 id，因為 `StockDetail` 用名稱比對） |
| `client/src/pages/StockDetail.tsx` | 新增 `highlightStrategy` prop；`useRef` + `scrollIntoView({behavior:"smooth",block:"center"})` 自動捲到對應戰法列；該列加珊瑚橘底色＋左側強調線＋粗體＋「← 你從掃描點進來看的」小字 |

## 沒有動到的地方

只有從「策略掃描／戰法×法人 Top 100」點進來才會帶 `highlightStrategy`；從熱區、Top5、自選股列點進研判頁（`goPA(symbol)` 沒帶第二參數）維持原樣，不會突然多一個強調框，因為那些情境沒有「為了哪個戰法點進來」這個脈絡。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過（不受影響）
- 沒有寫端對端測試（涉及 `scrollIntoView` 這種瀏覽器行為，vitest 預設環境不易驗證捲動效果本身，只確認型別與邏輯正確）
