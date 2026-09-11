# 股流 Radar｜待辦備註

> 給下一個接手的 AI／未來的我：以下是已知邊界與最近修改痕跡。
> **開工順序**：先讀「最後修改處」的檔案，再決定下一步。

---

## 最後修改處（2026-09-07 起）

### 最近變動檔案（按時間倒序）

| 時間 | 檔案 | 說明 |
|---|---|---|
| 09-08 22:40 | `server/data/providers/yahoo-cache.ts` | **新增** — Yahoo K 線共享快取（TTL 10 分鐘，server 層共用） |
| 09-08 22:40 | `server/data/archive.ts` | **新增** — B0 每日快照存檔模組（JSON 檔案，按日期分目錄） |
| 09-08 22:40 | `server/api.ts` | 所有 Yahoo fetch 改用 getCachedCandles；新增 `/historical/dates` + `/historical/:date` 端點；新增 `countConsecutiveDays()` 計算法人連買超天數 |
| 09-08 22:40 | `shared/types.ts` | StockSignal 加入 `consecutiveDays` 欄位（foreign/trust/dealer） |
| 09-08 23:25 | `client/src/pages/StockDetail.tsx` | 法人區塊加顯示「▲/▼ 連續 N 天」小標籤 |
| 09-08 22:40 | `server/data/strategies.ts` | getFacts 改用 getCachedCandles |
| 09-08 22:40 | `server/data/pa-analysis.ts` | buildPaDefaultAnalysis 改用 getCachedCandles |
| 09-08 22:40 | `server/data/hotzones.ts` | getSnapshot 內自動調用 saveSnapshot 寫入存檔 |
| 09-08 20:00 | `client/src/pages/Dashboard.tsx` | **新增** — 散戶版主頁（市場情緒 + TOP5 + 熱門話題 + 觀察名單狀態） |
| 09-08 20:00 | `client/src/pages/StockDetail.tsx` | **新增** — 散戶版個股頁（價格位置視覺化 + 四大戰法 + 大白話建議） |
| 09-08 20:00 | `shared/types.ts` | 新增 InstitutionalBreakdown、MarketMood、DashboardResponse、StockSignal 等 v2 型別 |
| 09-08 20:00 | `server/data/providers/twse.ts` | fetchTwseInstitutional 改為回傳分項（外資/投信/自營），不再只回傳合計 |
| 09-07 16:45 | `server/data/providers/taifex.ts` | 重寫 `traderDescription`：期貨/選擇權分開說明部位與今日交易，修正張冠李戴 |
| 09-07 16:02 | `client/src/components/ChipCard.tsx` | **新增** — 籌碼卡頁面（三大法人期貨/選擇權 diverging stacked bar chart，日/週切換） |
| 09-07 16:02 | `client/src/pages/Home.tsx` | 加入 `chipcard` tab 至 SideNav + BottomNav + 路由 |
| 09-07 11:19 | `client/src/pages/Home.tsx` | 串接 DigestBanner + GuideOverlay |
| 09-07 11:19 | `client/src/index.css` | 版面密度調整（縮減留白） |
| 09-07 11:19 | `client/src/lib/notify.ts` | **新增** — 通知權限 + 每日去重 |
| 09-07 11:19 | `client/src/components/DigestBanner.tsx` | **新增** — 每日回訪摘要橫幅 |
| 09-07 11:19 | `client/src/components/GuideOverlay.tsx` | **新增** — PA 六段框架引導頁 |

### 前一轮（09-06）關鍵檔案

| 檔案 | 說明 |
|---|---|
| `client/src/components/StockSearch.tsx` | 持久搜尋（header inline dropdown + drawer） |
| `client/src/components/ReviewOverlay.tsx` | 內嵌圖層註解（draw annotations on live pages） |
| `client/src/lib/api.ts` | API 客戶端 |
| `shared/pa-facts.ts` | PA 事實計算引擎 v0 |
| `shared/pa-default.ts` | 預設策略配置 |
| `shared/indicators.ts` | 四大指標（回湧/破堤/鯨躍/洋流） |
| `server/data/strategies.ts` | 策略路由 |
| `server/api.ts` | Express API 路由 |

### 下一步（未排程）

- **B0 歷史管線已完成基礎**：每日快照已自動存檔至 `server/data/archive/daily/YYYY-MM-DD/`（meta/quotes/institutional/summary 四檔 JSON）；查詢端點 `/api/historical/dates` 與 `/api/historical/:date` 已上線
- **法人連買超天數**：✅ 已實作 — StockDetail 法人區塊顯示「▲/▼ 連續 N 天」標籤，最多往前查 30 天歷史存檔
- **近 5 日／20 日熱度**：待做（需日曆累積多日熱度得分）

---

## 已知邊界（有意識的取捨，非 bug）

- 熱度已支援近 5／20 日平均（`buildRollingAverages()`，2026-09-09）；受限於目前存檔只有 7 個交易日，20 日均值要再累積一段時間才會是真正的 20 日；資金停留天數、買超加速仍待後續。
- 法人連買超天數：目前最多往前查 30 天歷史存檔；單一日期無足夠資料時顯示 0。
- 三大法人買賣超已接上上市＋上櫃（`fetchTpexInstitutional`，2026-09-09），但上櫃端點未經真實 API 驗證，部署後需確認。
- 主題板塊策展表（server/data/themes.ts）成員為 v0 人工名單，可能漏欄，持續維護。
- 研判引擎已補強（2026-09-09）：`shared/levels.ts` 已有頭肩頂/底、雙頂/雙底、量價背離、ATR 基準進場區/失效位；`shared/pa-facts.ts` 的多時框一致性已從粗略三分類加上加權分數（週 40%／日 30%／60分 20%／15分 10%）；`shared/pa-default.ts` 六段輸出已完整呈現以上內容。獨立 `packages/facts` 套件化重構暫不評估，目前架構已能滿足功能需求。
- **籌碼卡（ChipCard）**：契約層級資料來自 TAIFEX `DetailsOfFuturesContractsBytheDate`，API 已將同契約不同月份加總（無月份資訊），所以到期日追蹤延後；選擇權部分僅展示「台指選擇權」整體方向，不拆個契約。每日/週切換由前端日期參數控制，週資料為連續交易日加總。
- **籌碼分歧規則引擎（`shared/chip-divergence.ts`，2026-09-10）**：外資 vs 散戶立場判斷＋敘事產生已完成、7 個測試全過。但 `taifex.ts` 的 `fetchRetailFuturesPosition()` 算出的「散戶多方佔比」語意未經驗證——用真實數字（多方佔比 35.68%、單日+21.41 個百分點）回推，跟使用者自己判讀「散戶看多」的結論方向相反。可能原因：多空比至少有三種常見算法（多方佔全部／多方÷空方／(多−空)÷(多+空) 淨偏移），目前實作用的是第一種，但凱基期貨快訊實際用的可能是第三種。**部署後第一件事**：對照真實 API 回應與凱基快訊的多空比數字，確認公式一致，不一致要修正 `fetchRetailFuturesPosition()` 的計算方式，這個問題比 `DailyMarketReportFut` 端點欄位名稱是否正確更關鍵——公式錯了會讓散戶方向系統性判斷相反，比沒有這功能更糟。
- **四大戰法測試覆蓋（2026-09-10 補齊）**：`shared/indicators.ts` 的四大指標型戰法（回湧/破堤/鯨躍/洋流）原本只有破堤跟鯨躍有單元測試，回湧跟洋流完全沒有測試覆蓋——已補上各 2 個測試（triggered + no-trade），共 4 個新測試，見 `client/src/lib/indicators.test.ts`。順手把「洋流」戰法等待文案裡殘留的「乘流位置」改成「低風險買點」，跟自選股分類命名（乘流→水池）維持一致的白話原則。
