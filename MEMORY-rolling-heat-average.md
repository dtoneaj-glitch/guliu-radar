---
name: rolling-heat-average
description: guliu-radar 近 5/20 日板塊熱度平均實作（接在 SQLite 遷移之後）
metadata:
  type: project
---

## 變更內容（2026-09-09）

`server/data/hotzones.ts` 原本有一個從沒被呼叫、且效能設計有問題的 `calculateRollingAvg(zoneId, days)`：每算一個 zone 就把近 N 天的 archive 全部重讀一次、重建一次 snapshot、重跑一次 `buildThemeZones()`。全部板塊一起算下去是 O(zones × days) 次歷史讀取。

改成 `buildRollingAverages()`：只掃描一次歷史（最多 20 天已存檔交易日），每天各重建一次 snapshot + 建一次 `buildThemeZones()`／`buildIndustryZones()`，把每個 zone 當天的分數塞進陣列，最後一次算完所有 zone 的 avg5d/avg20d。O(days) 次歷史讀取。

已接進 `getHotzones()`（`/api/hotzones` 的資料來源），回傳的 `zones`／`industryZones` 現在會帶真實的 `avg5d`／`avg20d`。前端 `Home.tsx`、`client/src/lib/export-html.ts` 本來就在讀這兩個欄位（只是之前永遠是 `undefined`），這次不用動前端。

## 順手修的兩個問題

`buildSnapshotFromArchive()`（從 archive 重建 Snapshot，rolling average 靠這個函式回算歷史）原本有兩個問題：
1. 用 `any` 型別，且把 `changePct` 用 `(close-open)/open` 重算——這是當日振幅，不是「今日 vs 昨收」的漲跌幅，算法本身是錯的。改成直接沿用存檔當下就算好的 `q.changePct`。
2. `institutional: new Map()`，忽略了 archive 裡其實有存的法人資料。改成直接用 `archive.institutional`。這次沒有實際影響到熱度分數（`scoreZones()` 用的是 `q.netBuyValue`，不是 `snapshot.institutional`），但修掉可以避免以後有人用到 `snapshot.institutional` 時踩到這個坑。

過程中也抓到一個型別錯誤：舊版用 `as unknown as Snapshot` 把 `MarketSummary` 的欄位名稱寫錯了（`totalValueYi`/`institutionalNetYi`，但正確欄位是 `totalValue`/`institutionalNet`，而且 `totalValue` 單位是億元）——因為有這個 cast，tsc 一直沒抓到。拿掉 cast 用回真實型別後 tsc 馬上抓出來，順手修正。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 19/19 全過
- 用沙盒裡已遷移的 7 天真實 SQLite 資料做黑盒模擬（不改原始碼、外部重跑一次同樣邏輯），確認 `buildThemeZones()` 對每個歷史日期都能正確重建、算出的每日分數會隨資料變動（非固定值），手算 avg5d 與邏輯預期一致
- 無法在沙盒內對 `getHotzones()` 做端對端測試，因為它需要即時打 TWSE/Yahoo（沙盒網路白名單不含這些網域）——本機跑 `pnpm dev` 後建議直接看 `/api/hotzones` 回應裡 `zones[].avg5d`/`avg20d` 是否為數字

## 已知限制

- 只算「已存檔」交易日，不含今日盤中即時分數
- 資料不足 5／20 天時，回傳「有幾天算幾天」的平均，不是嚴格 5 日／20 日均——目前只有 7 天存檔，20 日均要再等一段時間才有意義
