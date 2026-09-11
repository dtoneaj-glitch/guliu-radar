---
name: dashboard-real-integration
description: guliu-radar Dashboard.tsx 真實整合設計稿內容，含發現並修正的既有bug
metadata:
  type: project
---

## 背景（2026-09-11）

使用者本機跑起來後發現「熱區」首頁畫面是舊的——查證後發現 `Dashboard.tsx` 是一個原本就存在、我整個對話期間從沒碰過的真實元件（跟之前誤把死碼 `PA` 當真的那次不同，這次反過來：`Dashboard.tsx` 是真的在跑，只是我做的一大堆設計稿從沒真的寫進去）。

查了才發現這個既有元件其實已經相當完整，用的都是真實資料（`fetchDashboard`／`fetchPantlasOverview`／`fetchRegime`），不是從零重寫，是有針對性地修正＋補齊。

## 順手抓到的既有 bug（不是我這次造成的，是本來就在的）

| Bug | 位置 | 說明 |
|---|---|---|
| 漲停/跌停顏色相反 | `MarketOverviewCard` | 漲停用了 `--destructive`（危險紅）、跌停用了 `--primary`（珊瑚橘=漲），語意對調——這次隨著「拿掉漲停/跌停欄位」一起解決，不用另外修色碼 |
| 無效的 CSS：gradient 當 boxShadow 用 | `MoodHeader` | 「偏多」情緒的 `dotColor` 是一個 `linear-gradient(...)` 字串，被拿去當 `box-shadow` 的顏色值——box-shadow 不接受漸層，這個發光效果原本悄悄失效。改成跟「樂觀」同一個實色 `--primary` |

## 這次真的做的整合

| 項目 | 做法 |
|---|---|
| 市場總覽 | 拿掉平盤/漲停/跌停，只留上漲/下跌/成交，3 欄置中（對應之前設計稿定案的版本） |
| **籌碼分歧卡（新）** | 新增 `ChipDivergenceCard`，呼叫新增的 `fetchChipDivergence()`（打 `/api/chip-divergence`，用的是之前做的 `shared/chip-divergence.ts` 規則引擎），分歧時有醒目標籤，資料不足時如實顯示「⚠ 缺什麼」，不隱藏 |
| **概念股熱度（新）** | 新增 `ThemeZoneAccordion`，重用真實 `fetchHotzones()` 的 36 個主題資料，取分數前 12 名，收合成一條橫幅＋展開清單，跟之前設計稿的互動模式一致 |
| VIX | **沒有加**——這個 App 目前沒有真實的 VIX/台指選擇權波動率資料源，之前做的 `classifyVix()` 只是分類邏輯，沒有資料可以餵，硬加會是假資料，所以不做 |

## 刻意沒動的地方（現有實作已經夠好，重寫是浪費）

`FlowCards`、`TopicStrip`、`TopFiveSection`、`WatchlistSection`、`SectorFlowBar` 這幾個元件本來就用真實資料、邏輯正確，只是視覺風格跟我做的獨立 HTML 設計稿不完全一樣（例如數字對齊方式），沒有動——這些不是"錯的"，只是"風格不同"，屬於錦上添花而非必要修正，時間有限下優先做真正補資料/修 bug 的部分。

`Dashboard.tsx` 自己的 `WatchlistSection`（跟 `Home.tsx` 裡 `Watchlist` 元件是兩個獨立實作）也還沒有水池成本價功能——那個功能目前只接在 `Home.tsx` 的自選頁，這裡的首頁預覽卡片還沒有，是之後可以做的延伸。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過（不受影響）
- 沒有在瀏覽器裡實際渲染驗證過畫面（沙盒沒有瀏覽器測試能力），型別檢查通過代表資料流串接正確，但實際版面效果需要使用者本機肉眼確認
