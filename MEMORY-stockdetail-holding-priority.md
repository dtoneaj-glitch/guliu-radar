---
name: stockdetail-holding-priority
description: guliu-radar StockDetail研判頁：水池（庫存股）改為風險優先的主從順序
metadata:
  type: project
---

## 做了什麼（2026-09-10）

延續之前的討論：持有中的股票，使用者第一眼該看到「該不該擔心」，不是「新的進場訊號」。`StockDetail.tsx` 依 `isHolding`（該股票是否標了「水池」分類）改變區塊順序：

| | 一般（非持有） | 水池（持有中） |
|---|---|---|
| 順序 | Header → 價格位置圖 → **戰法匹配度** → 建議 → 法人動向 → 基本面 | Header → **持股風險摘要** → 價格位置圖 → 建議 → **戰法匹配度** → 法人動向 → 基本面 |

新增的「持股風險摘要」區塊（只有水池分類才顯示）：
- 成本價 + 浮盈/浮虧（沒設定成本價則提示去自選股頁設定，不是編一個假數字）
- 支撐參考位當停損提示的白話說明；沒有明確支撐位時，如實說「結構偏不確定」

戰法匹配度沒有拿掉，只是挪到後面（標題旁加了小字說明「已持有中，找加碼/新進場點才需要看這個」），因為持有中還是可能要判斷加碼時機。

## 實作方式

用同一份 `strategySection` JSX 變數，依 `isHolding` 條件式放到不同位置，不是複製兩份 markup——維持單一事實來源，之後戰法清單樣式要改，不用改兩個地方。`riskSection` 只有 `isHolding` 為真才建立/顯示。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過
- 檢查過條件式渲染邏輯：`isHolding && riskSection`／`!isHolding && strategySection`／`isHolding && strategySection` 三處互斥不重複，用 grep 對照行號確認順序跟設計一致
- 沒有寫端對端測試（React 元件的條件渲染排版，目前專案的 vitest 測試都是純函式邏輯測試，沒有 UI 渲染測試框架）
