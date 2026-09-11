---
name: chipcard-redesign
description: guliu-radar 大盤籌碼頁（ChipCard.tsx）重新設計，含兩個之前設計但沒接上的真實功能
metadata:
  type: project
---

## 背景（2026-09-11）

使用者反映「大盤籌碼頁很醜」——查證後確認 `client/src/components/ChipCard.tsx` 這整個對話都沒碰過，用的是自製 SVG diverging bar chart（雙向長條圖），資訊密度高、需要一定財經素養才能讀懂，跟產品「大白話」定位不一致。

## 這次做的事

**保留**：所有真實資料抓取（`fetchChipCard`／`fetchOptionsOI`）、結論卡（`ConclusionCards`）、P/C 比儀表板（`PCDashboard`，這個本來就做得不錯，是儀表指針+5日趨勢，不是密集長條圖，沒有動）、今日/本週切換、按法人/按契約切換。

**換掉**：期貨未平倉、選擇權未平倉的呈現方式，從 `DivergingBar`（雙向 SVG 長條圖，含正負座標軸）換成跟首頁同一套語言——期貨用「標籤+徽章+大數字」統計卡（`.chip-stat-card`），選擇權用簡單清單（`.chip-opt-list`）。

**補上兩個之前設計過但從沒接上的真實功能**：

| 功能 | 之前的狀態 | 這次做的 |
|---|---|---|
| 籌碼分歧卡 | `shared/chip-divergence.ts` 規則引擎早就寫好、也已經接進 `Dashboard.tsx`，但 `ChipCard.tsx`（這個功能真正該待的地方）反而沒有 | `DivergenceCard` 元件，重用同一支 `fetchChipDivergence()` |
| 散戶留倉 | `server/data/providers/taifex.ts` 的 `fetchRetailFuturesPosition()` 只寫了資料抓取邏輯，**從來沒有接 API 路由、也沒有 client fetch 函式**——純粹是死的資料層程式碼 | 新增 `GET /api/retail-futures` 端點＋`fetchRetailFutures()` client 函式＋`RetailCard` 元件（小台/微台各一張），標籤照舊保留醒目的「公式待驗證」紅色警示（`.chip-retail-unverified`），不能拿掉 |

## 清理

移除了改版後不再使用的 `DivergingBar` 元件、`OPTION_COLOR`/`FOREIGN_COLOR`/`DEALER_COLOR`/`AXIS_COLOR`/`LABEL_COLOR` 色彩常數、`TRADER_COLOR`（改版後也沒用到了）、多餘的 `LargeTrader` 型別匯入——避免留下用不到的死碼。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過
- 沒有瀏覽器實測（沙盒無瀏覽器能力），需要使用者本機確認實際畫面效果
- `fetchRetailFutures`／`fetchChipDivergence` 這兩個真實 API 呼叫本身依賴的底層資料源，仍然是之前記錄過的「未經真實驗證」狀態（見 `MEMORY-chip-divergence-engine.md`），這次只是把接線接好，底層資料正確性問題還在
