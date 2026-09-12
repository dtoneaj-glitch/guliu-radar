---
name: trailing-stop-feature
description: guliu-radar 移動停利功能——把水池成本價跟PA結構性數字（失效位/最近HL）接起來
metadata:
  type: project
---

## 背景（2026-09-12）

盤點戰法停損缺口時發現：全系統只有「靜態的一次性停損」，沒有「隨獲利擴大動態上移停損」的移動停利。移動停利天然需要「進場價」當基準，而這剛好是「水池」（庫存股）分類已經做好的 `costPrice` 欄位——這次把兩者接起來。

## 設計

**核心邏輯**（`shared/trailing-stop.ts`，純函式）：
- 棘輪機制：停損只會往上移動（取「初始結構失效位」跟「最近一個已確認的 HL」兩者較高的一個），不會因為股價拉回就跟著下修
- 用「最近確認的 HL」當移動基準，不是固定百分比回檔——跟 `pa-default.ts`／潮流(trend-follow)戰法用同一套「HL 之上才算結構成立」的判斷邏輯一致，不是另外發明一套
- 三種階段：`initial`（還沒移動）／`breakeven`（移動到成本價，最差打平）／`locked-profit`（移動到成本價以上，已鎖住部分獲利，附帶算出鎖住的獲利百分比）
- 資料不足（兩個依據都是 null）時如實承認，不編造停損水位

## 串接的地方

| 檔案 | 變更 |
|---|---|
| `shared/trailing-stop.ts`（新） | `computeTrailingStop()` 純函式 |
| `client/src/lib/trailing-stop.test.ts`（新） | 9 個測試（資料不足／棘輪往上／不下修／HL已失效不採用／各階段獲利計算／決定性） |
| `shared/types.ts` | `StockSignal.pricePosition` 新增 `invalidation`／`recentSwingLow` 兩個欄位——這兩個數字其實 `server/api.ts` 早就用 `buildMarketFacts()` 算出來了，只是原本沒有透過 API 傳給前端 |
| `server/api.ts` | `StockSignal` 組裝時把這兩個欄位接上（`facts.invalidation`／`facts.swings.lastLow?.price`） |
| `client/src/pages/StockDetail.tsx` | 水池持股風險摘要裡，原本的靜態「支撐參考」文字，改成呼叫 `computeTrailingStop()` 算出真正的移動停利敘事 |

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 56/56 全過（新增 9 個）
- 沒有瀏覽器實測（沙盒無瀏覽器能力），需要使用者本機確認實際畫面顯示效果
