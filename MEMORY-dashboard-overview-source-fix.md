---
name: dashboard-overview-source-fix
description: guliu-radar 市場總覽資料來源修正：從Pantlas換成真的TWSE/TPEx管線，不是只改標籤文字
metadata:
  type: project
---

## 問題（2026-09-11）

使用者發現：我做的 `dashboard-full.html` 設計稿標「來源：TWSE OpenAPI · TPEx」，但真的整合進 `Dashboard.tsx` 時卻顯示「來源：Pantlas」——兩者對不上。

查證後發現這不是文字標錯，是**這個 App 裡真的有兩條平行、獨立的「市場總覽」資料管線**：

| 管線 | 真實來源 | 原本被誰用 |
|---|---|---|
| `/api/hotzones` 的 `summary`（`MarketSummary`） | 真的是 TWSE OpenAPI + TPEx（`getSnapshot()`，這整個對話裡做 SQLite 存檔／進場區掃描都是用這條） | 沒有被首頁市場總覽用到 |
| `/api/pantlas/overview`（`MarketOverview`） | 真的是 Pantlas 第三方 | `Dashboard.tsx` 的 `MarketOverviewCard` 原本呼叫的是這條 |

我做設計稿時研究的是第一條管線，沒有先查證 `Dashboard.tsx` 實際串的是哪一條，導致標籤文字（設計稿）跟真實資料來源（程式碼）不一致。

## 修正方式：換資料來源，不是換標籤文字

**刻意不做**「把 Pantlas 資料抓進來、畫面上只是不顯示 Pantlas 字樣」這種做法——底層資料還是 Pantlas、只是藏起來，等於騙使用者。

**實際做的**：把 `MarketOverviewCard` 改成吃 `/api/hotzones` 的 `summary`（`MarketSummary`：`advance`/`decline`/`totalValue`），不再呼叫 `fetchPantlasOverview()`。反正 `Dashboard.tsx` 本來就已經在呼叫 `fetchHotzones()`（給概念股熱度用），順便多拿一個欄位即可，沒有多一次 API 呼叫。

| 檔案 | 變更 |
|---|---|
| `client/src/pages/Dashboard.tsx` | 移除 `fetchPantlasOverview`／`overview`／`MarketOverview` 相關程式碼；新增 `summary: MarketSummary` state，從既有的 `fetchHotzones()` 呼叫一併取得；`MarketOverviewCard` 改吃 `summary`，標籤改成「來源：TWSE OpenAPI · TPEx」——這次是真的這樣抓的，不是掛假標籤 |

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過
- 沒有瀏覽器實測（沙盒無瀏覽器能力），使用者本機測試後才能肉眼確認畫面

## 教訓

之後設計稿標「來源：XXX」之前，要先查證**這個畫面實際串接的 API 到底是誰**，不能因為「App 裡某處有一條真實的 XXX 管線」就假設這個特定畫面用的也是那條——同一個 App 裡可能有好幾條平行、彼此獨立的資料管線做类似的事。
