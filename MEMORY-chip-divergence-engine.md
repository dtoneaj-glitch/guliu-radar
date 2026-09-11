---
name: chip-divergence-engine
description: guliu-radar 籌碼分歧規則引擎（外資 vs 散戶），含未驗證的多空比公式風險
metadata:
  type: project
---

## 做了什麼（2026-09-10）

把「外資看空、散戶看多」這類分歧判斷從人工每天寫結論，換成規則引擎自動產生，同一套哲學跟 `shared/pa-default.ts` 一樣（規則決定要不要說，模板決定怎麼說，資料不足就承認不足）。

| 檔案 | 內容 |
|---|---|
| `shared/chip-divergence.ts`（新） | 純函式 `evaluateChipDivergence()`，外資/散戶立場分類＋分歧判斷＋敘事模板 |
| `client/src/lib/chip-divergence.test.ts`（新） | 7 個測試：分歧/一致/死區/資料不足/決定性 |
| `server/data/providers/taifex.ts` | 新增 `fetchRetailFuturesPosition()`，散戶（小台/微台）多空比 = 全市場未平倉(`DailyMarketReportFut`) − 三大法人未平倉(既有的 `DetailsOfFuturesContractsBytheDate`) |
| `server/data/chip-divergence.ts`（新） | 伺服器端組裝層：抓外資現貨(TWSE)+外資期貨(TAIFEX)+散戶多空比，餵給純邏輯引擎 |
| `server/api.ts` | 新增 `GET /api/chip-divergence` |

## ⚠️ 最重要的未解問題：多空比公式語意不確定

用使用者提供的真實數字（多方佔比 35.68%、單日 +21.41 個百分點）回推，規則引擎判斷「散戶偏空」，但使用者自己讀凱基期貨快訊的結論是「散戶看多」——方向相反。

多空比常見至少三種算法，數字一樣但意思完全不同：
1. 多方未平倉 ÷ 全部未平倉（目前 `fetchRetailFuturesPosition()` 用的）
2. 多方口數 ÷ 空方口數
3. (多−空) ÷ (多+空) 淨偏移 ——**這個才符合使用者的解讀**

**部署後第一件事**：對照真實 API 回應跟凱基快訊的多空比數字，確認公式，不一致要修 `fetchRetailFuturesPosition()`。這個問題比 `DailyMarketReportFut` 端點欄位名稱對不對更關鍵——公式錯了會讓散戶方向系統性判斷相反，比沒有這功能更危險（提供錯誤的自信）。

## 其他已知限制

- `retailLongRatioChangePct`（散戶多空比當日增減）目前固定傳 `null`——只有當日快照，沒有昨日基準可比對。要補上需要把這份快照也存進 SQLite archive（跟 B0 每日存檔同一套機制），用前一天存檔比對。
- `DailyMarketReportFut` 端點在本專案第一次使用，欄位名稱靠推測＋容錯（`pickField()` 多候選），未經真實 API 驗證。
- VIX 尚未整合進規則引擎（使用者接下來要討論怎麼判斷 VIX，屬於這個引擎的下一步擴充方向）。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 33/33 全過（含新增 7 個）
- 用使用者提供的真實數字做過黑盒模擬，抓到上述公式語意問題（沒有被隱藏，主動回報）
- 沒有端對端測試過（`fetchChipCard`／`fetchRetailFuturesPosition`／`getSnapshot` 都需要真實網路，沙盒連不到）
