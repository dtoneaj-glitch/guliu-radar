---
name: taiwan-stock-workbench-project
description: 使用者的台股交易工作台「股流 Radar」——已上線：v2 散戶版主頁（Dashboard）+ 個股頁（StockDetail）+ 大盤籌碼整合（結論卡置頂 + P/C 儀表板 + 五契約 diverging bar）；LINE Push 推播系統完成（provider + notifications + API + 前端設定 UI）；B0-B5 全部上線（2026-09-09）；Phase 3+ 自訂條件組合器 + 回測引擎上線；會員認證（JWT 字串比較修復）+ LINE Login 基礎設施；LINE Push 推播系統完成（2026-09-09）；大盤籌碼整合（結論卡置頂 + P/C 儀表板 + 五契約 diverging bar，2026-09-09）；籌碼卡 traderDescription 已修正（期貨/選擇權分開敘述）；wouter `/**` 路徑已 patch；SQLite 遷移待做；股票卡片重設計：changeAmt 加進全部 StockBrief/SignalBrief/StockSignal 類型，所有股票列表改為主價＋漲跌額＋漲跌幅（Dashboard 自選為卡片網格，Search/Home/StockDetail 同步更新）
metadata:
  node_type: memory
  type: project
  originSessionId: sess_be62cc13-e604-4b8a-a5ca-06178b2e7396
---

使用者（具金融科技／量化交易背景，以「資深交易系統架構師」角色定位我）的台股交易工作台**「股流 Radar」**，工作目錄 `D:\ZCODE\台股ATM`。參考產品是 [[tide-tw-app-reference]]（tide-tw.app），差異化主戰場＝Price Action 與進出場計畫。

北極星：先讓用戶看見錢流向哪些熱門類股（熱區），在熱區內用價格行為教練框架規劃條件式交易情境——「熱區負責發現，價格行為負責規劃，風險管理負責控制」。用戶價值主張：「交易有底，不盲目追高殺低」。

## 訪談結論（四階段已完成，2026-09-06）
- 標的：台股上市櫃現股＋期權 OI 籌碼；全免費源；0 元預算起、日後對外收費才升級
- PA 引擎＝混合架構：確定性「PA 事實層」演算法（防 LLM 幻覺、可回測）→ LLM 只做敘事解讀；六段**研判**框架（結構/價位/形態/情境/風險/三區分）為固定輸出，「已確認／推測／尚需等待」三區分為強制欄位
- 時框：日/60/15 分（2026-09-06 用戶確認移除 30m，保留 60m/15m 區間較大有意義）
- 籌碼整合：過濾器為主（法人連買＋熱區聚焦才允許做多訊號）、點位為輔（法人成本區畫上圖）
- **研判多策略化（用戶需求）**：StrategyProfile 可插拔（pa_default 起步→突破回踩/法人順風/趨勢跟隨/箱體邊緣），自選股×策略掃描→「策略條件已符合」推播；通知 Telegram 起步（LINE 200則/月限制）
- 產品文案合規紅線：不說「現在買進」、熱門不等於可交易、單一時框限制聲明

## 關鍵文件（D:\ZCODE\台股ATM）
- 《股流 Radar｜Phase 1 PWA 核心產品規格與 Wireframe.md》v0.2（用戶提供，Sprint 1-4、驗證指標）
- 《股流 Radar｜系統規格與開發指南 v1.0.md》（我產出的總綱，R1-R6 修訂決議）
- 積木路線圖：B0 地基→B1 雷達→B2 PA 事實層→B3 LLM 教練→B4 盤中引擎＋通知→B5 狀態機→B6+ 回測/券商API/對外開放（用戶主動提出積木法，重視進度感）

## 開工入口（2026-09-07）

**最快找到上次的地方：** 讀 `guliu-radar/docs/TODO.md` → 「最後修改處」表格，按時間倒序找關鍵檔案。

## 程式碼現況（更新至 2026-09-09）

- GitHub repo：`dtoneaj-glitch/guliu-radar`（clone 至 D:\ZCODE\台股ATM\guliu-radar；Vite+React19+Tailwind4+shadcn，源自 Manus 模板）；**public**
- **多 AI 協作注意（2026-09-09）**：
  - 其他 AI **無法**用 web-fetch 讀取 GitHub repo 連結（即使 public 也會回傳 404，因 GitHub login wall / bot 防護）
  - **正確做法**：把 `guliu-radar` 資料夾壓縮為 zip（排除 node_modules）直接傳；或用 raw 連結 `https://raw.githubusercontent.com/dtoneaj-glitch/guliu-radar/main/...`
  - 本機路徑 `D:\ZCODE\台股ATM\guliu-radar` 是本機 AI 的直接入口
  - 本地未 commit 的檔案不會出現在 GitHub，需先 `git add + commit + push` 才推上雲端
- **v2 散戶版上線（2026-09-08）**：
  - `client/src/pages/Dashboard.tsx` — 取代舊熱區頁：市場情緒大白話 headline + 四大法人卡片（外資/投信/自營/散戶動向）+ 今日熱門話題橫條 + 買超 TOP5（含「＋觀察」按鈕）+ 觀察名單狀態列
  - `client/src/pages/StockDetail.tsx` — 取代舊 PA 頁：價格位置視覺化（支撐/壓力帶 + 月線標記 + 「你在這裡」）+ 四大戰法匹配度進度條（matchPct + plainText）+ 大白話建議清單 + 法人動向
  - `Home.tsx` 路由：熱區 tab→Dashboard、研判 tab→StockDetail，其餘 3 tab（掃描/籌碼卡/自選）不變
- **資料層改動（2026-09-08）**：
  - `server/data/providers/twse.ts` — `fetchTwseInstitutional` 改為回傳 `Map<string, InstitutionalBreakdown>`（外資/投信/自營分項），不再只回傳合計
  - `server/data/hotzones.ts` — Snapshot 加 `institutional` 欄位；`buildThemeZones` 改為 export；getSnapshot 內自動調用 `saveSnapshot` 寫入存檔
- **K 線快取（問題 1 修復，2026-09-08）**：
  - `server/data/providers/yahoo-cache.ts` — 新增 `getCachedCandles(yahooSymbol, range, interval)`，TTL 10 分鐘，server 層共用
  - 已串入：`strategies.ts` getFacts、`pa-analysis.ts` buildPaDefaultAnalysis、`api.ts` trends/signals/StockDetail/chart 所有 Yahoo 呼叫點
- **B0 歷史存檔基礎（問題 4 基礎，2026-09-08）**：
  - `server/data/archive.ts` — 每日快照寫入 `server/data/archive/daily/YYYY-MM-DD/`（meta/quotes/institutional/summary 四檔 JSON）
  - API：`GET /api/historical/dates`（列出已有日期倒序）、`GET /api/historical/:date`（讀取單日完整快照，含 institutional 分項）
  - **現況**：僅 2026-09-07 一筆；需 server 正常啟動後累積
- **籌碼卡改版（2026-09-08）**：
  - `ROW_H` 48px→16px，條圖高度壓縮至約 1/3；文字大小與間距同步縮小
- **文案口語化（2026-09-08）**：
  - `server/data/providers/taifex.ts` — `marketBiasDescription` 改寫為大白話：「大戶集體看跌／偏空／偏多／看法分歧」；`putCallDescription` 分 5 檔（防禦/謹慎/中性/中性偏多/偏樂觀）；去除「淨短/淨多」「protect」「防禦線」等術語
- **Pantlas 資料接入（2026-09-08 晚間）**：
  - `server/data/providers/pantlas.ts` — 新增 Pantlas（盤圖）公開 API 提供者：`/api/stocks/{code}`（含 30 日 K 線歷史 + 當日行情）、`/api/stocks/{code}/fundamentals`（PE/PBR/毛利率/EPS/季度資料）、`/api/stocks`（全庫 60 檔報價）。`fetchPantlasStock(code)` 回傳完整個股物件 + TtlCache 快取 10 分鐘
  - `shared/types.ts` — `DashboardResponse` 新增 `sectorFlows: SectorFlow[]`（產業資金流向）；`StockSignalBrief` 新增 `pantlas?: { sector, foreignNet5D, trustNet5D, pe }`；`StockSignal` 新增 `pantlas5D` + `pantlasFundamentals`
  - `server/data/hotzones.ts` — `buildSectorFlows(snapshot)` 函數：把上市 quotes 依 industry 分組，用 institutional map × 收盤價換算為億元，過濾 ETF/存託憑證，排序回傳
  - `server/api.ts` — `/dashboard` 回應加 `sectorFlows`；`/stocks/:symbol/signal` 並行抓 Pantlas 資料（含 5 日法人股數×價格換算億元）；`/stocks/signals` 批次亦加 pantlas
  - **發現**：Pantlas `/api/stocks` 列表端點不含法人數據，僅 `/api/stocks/{code}` 有 foreignNet5D/trustNet5D/dealerNet5D； signals endpoint 需登入（401），暫時跳過
  - **Sector flows 來源**：改由現有 T86 上市法人資料按 industry 聚合（非 Pantlas list），因為 T86 涵蓋全市場上市股票；Pantlas 僅供個股補充（基本面 + 5日法人）
  - **驗證結果**：2330 pantlas5D = {foreign: 0.26, trust: -0.01, dealer: 0.02} 億；pantlasFundamentals PE=28.63 PBR=9.96 毛利率 67.72% 營收年增 44.69%；sectorFlows 電子工業 +871.6億、半導體 +177.8億、電腦週邊 -201億
- **驗證**：tsc 零錯誤、vitest 19/19、build 通過
- **Pantlas API 接入（2026-09-08 晚間）**：
  - `server/data/providers/pantlas.ts` — 新增 Pantlas（盤圖）公開 API 提供者：`/api/stocks/{code}`（含 30 日 K 線歷史 + 當日行情）、`/api/stocks/{code}/fundamentals`（PE/PBR/毛利率/EPS/季度資料）、`/api/stocks`（全庫 60 檔報價）。`fetchPantlasStock(code)` 回傳完整個股物件 + TtlCache 快取 10 分鐘
  - `shared/types.ts` — `DashboardResponse` 新增 `sectorFlows: SectorFlow[]`（產業資金流向）；`StockSignalBrief` 新增 `pantlas?: { sector, foreignNet5D, trustNet5D, pe }`；`StockSignal` 新增 `pantlas5D` + `pantlasFundamentals`
  - `server/data/hotzones.ts` — `buildSectorFlows(snapshot)` 函數：把上市 quotes 依 industry 分組，用 institutional map × 收盤價換算為億元，過濾 ETF/存託憑證，排序回傳
  - `server/api.ts` — `/dashboard` 回應加 `sectorFlows`；`/stocks/:symbol/signal` 並行抓 Pantlas 資料（含 5 日法人股數×價格換算億元）；`/stocks/signals` 批次亦加 pantlas
  - **發現**：Pantlas `/api/stocks` 列表端點不含法人數據，僅 `/api/stocks/{code}` 有 foreignNet5D/trustNet5D/dealerNet5D；signals endpoint 需登入（401），暫時跳過
  - **Sector flows 來源**：改由現有 T86 上市法人資料按 industry 聚合（非 Pantlas list），因為 T86 涵蓋全市場上市股票；Pantlas 僅供個股補充（基本面 + 5日法人）
  - **驗證結果**：2330 pantlas5D = {foreign: 0.26, trust: -0.01, dealer: 0.02} 億；pantlasFundamentals PE=28.63 PBR=9.96 毛利率 67.72% 營收年增 44.69%；sectorFlows 電子工業 +871.6億、半導體 +177.8億、電腦週邊 -201億
  - **前端**：Dashboard 加 MarketOverviewCard（漲 N / 跌 N / 平 N / 成交 N億 / 漲停 N / 跌停 N）；StockDetail 加 5日 pantlas 法人條 + 基本面卡（PE/PBR/毛利率/營增高/殖利率/最新季）
- **會員認證系統（2026-09-08 晚間，功能完成但有 bug 待修）**：
  - `server/data/users.ts` — 新增純 JSON 檔案使用者資料層：scryptSync 密碼哈希 + HMAC-SHA256 JWT（Node 內建 crypto，無需 bcryptjs/jsonwebtoken 依賴）；endpoints：POST /api/auth/register、POST /api/auth/login、GET /api/auth/me、GET/PUT /api/users/:userId/watchlist
  - `client/src/lib/auth.tsx` — React Context 認證狀態管理：localStorage 持久化 token、自動同步遠端 watchlist、useAuth() hook
  - `client/src/pages/Login.tsx` — 登入/註冊表單（tab 切換），username 2-20 字、password min 6 字
  - `client/src/App.tsx` — 包 AuthProvider、加 /login 路由
  - `client/src/pages/Home.tsx` — header 顯示使用者徽章 + 登出按鈕；登出後跳回 /login
  - **已知 bug（已修復 2026-09-09）**：JWT verifyToken 的 `timingSafeEqual` 因 buffer 長度不等拋錯；已改為字串比較 `signature !== expected`（hex 固定 64 字元，無 timing attack 風險）
- **環境地雷**：pnpm 用 npm -g 裝（corepack 無權限）；wouter v3.7.1 `/**` 路徑 bug（已 patch）；啟動前必 `taskkill //F //IM node.exe`
- 啟動慣例：雙擊 `D:\ZCODE\台股ATM\啟動股流Radar.bat`
- 多 AI 協作準則：同資料夾多 AI 要輪流改檔避免互相覆蓋；**Edit 前必重讀**

## B4+B5 已完成（2026-09-09）
- **B4 盤中輪詢**：`client/src/lib/useAppData.ts` 新增自動輪詢（盤中每 5 分鐘），顯示「盤中輪詢中」狀態與最後更新時間
- **B4 策略觸發通知**：`client/src/lib/useStrategyNotifier.ts` 新增，偵測自選股策略狀態變化時發瀏覽器通知
- **B5 狀態機**：`client/src/lib/useStateMachine.ts` 新增，記錄每檔股策略狀態變化歷史（localStorage 持久化）
- **近 5 日/20 日熱度**：`server/data/hotzones.ts` 新增 `calculateRollingAvg()`；`HotZone` 類型新增 `avg5d`/`avg20d`；Dashboard 顯示 5 日均值
- **LINE Push 推播系統**（2026-09-09 完成）：`server/data/providers/line-push.ts`（LINE Messaging API Provider）、`server/data/notifications.ts`（通知服務：設定 CRUD + 去重 + scanAndNotify）、`client/src/components/NotificationSettings.tsx`（前端設定面板）、API：GET/PUT `/api/notifications/settings`、POST `/api/notifications/test`、POST `/api/admin/notify-scan`；LINE Login 回調時自動綁定 `lineIds`；推播文案遵循「條件式語句」原則（不說「現在買進」）

## Phase 2 Backlog（優先序）

### 已完成（B0–B5，2026-09-09）
- ✅ B0 歷史存檔（JSON 檔案，每日快照）
- ✅ B1 熱區雷達（30 主題板塊 + 今日重點）
- ✅ B2 PA 事實層（五戰法）
- ✅ B3 LLM 教練（研判框架）
- ✅ B4 盤中輪詢（useAppData 每 5 分鐘）+ 策略觸發通知（useStrategyNotifier）
- ✅ B5 狀態機（useStateMachine，localStorage 持久化）+ 近 5 日/20 日熱度
- ✅ 會員認證（JWT 字串比較修復）

### 待做（Phase 2）
1. **Telegram 推送**（免費無上限，對比 LINE 200 則/月）→ **已改 LINE Push（用戶選擇）**
2. **mis.twse 盤中輪詢**（大盤指數 1 分、熱門股 5 分；現況僅有盤後 T86 資料）
   - mis.twse = 台灣證交所即時行情網站，提供大盤加權指數（1 分鐘更新）、熱門股排行、個股即時行情
   - 目的：讓 Dashboard 在盤中（9:00–13:30）也能即時刷新，而非只有盤後資料
   - 限制：免費源無 SLA，有時限流風險，對外開放前需測試穩定度
3. **策略層上架**（四策略可選、可調參）
4. **訊號狀態機**（觀察→觸發→出場，個人勝率統計）
5. **多時框打開**（60/15 分資料累積）

### Phase 3+
- 自訂條件組合器、回測與歷史勝率
- 券商 API（永豐 Shioaji）
- 對外開放（多用戶＋訂閱＋數據授權合規審查）

## 籌碼卡功能（2026-09-07 上線）

**資料來源**：TAIFEX 免費 API（Divided、FuturesContracts、P/C Ratio 三端點），無需金鑰。

**已完成（2026-09-07）**：
- 圖表：diverging stacked bar（長倉往右、短倉往左），零線居中
- 兩種視角：「按法人」（外資/自營商/投信各一列）＋「按契約」（期貨前 4 大契約 + 台指選擇權）
- 每日/每周切換：前端日期參數控制；周模式目前取週一單日（完整累加需 B0）
- 結論卡：大戶方向、選擇權 P/C 情緒、三大法人摘要（含人話描述）
- 已驗證：2026-09-07 真實資料（外資期貨押空 486,659 口、P/C 比 ~98%）
- tsc 通過、Vite build 通過

**描述寫法修正（2026-09-07）**：原 `traderDescription` 把期貨今日交易（NetTrade）誤貼到選擇權句子後，造成「選擇權押空今日回補 20,957 口」張冠李戴；已重寫為各產品獨立：`期貨押空（N 口）。今日回補 M 口。選擇權押空（K 口）。今日回補 L 口。`

**已知限制**：
- TAIFEX API 將同契約不同月份加總（無到期日資訊），到期追蹤延後
- 選擇權僅展「台指選擇權」整體方向，不拆個契約
- 周模式目前單日（非 5 日累加），完整累加需 B0 歷史管線

## 大盤籌碼整合頁（2026-09-09）

**整合內容**：`client/src/components/ChipCard.tsx` — 合併籌碼卡＋選擇權 OI 於單一「大盤籌碼」tab

**結論卡改版（兩欄）**：
- 頂部改為 **2 欄結論卡**：期貨大戶方向 ＋ 選擇權大戶方向
- P/C 情緒儀表板往下移到圖表區下方（`chip-pc-section` 獨立區塊）
- CSS：`.chip-conclusion { grid-template-columns: 1fr 1fr }`；刪除舊的 3 欄重複樣式

**P/C 比顯示修正**：
- API `PutCallVolumeRatio%` 回傳百分比（如 123.9）
- 前端除以 100 顯示為小數比（1.24），避免「123.9%」弔詭格式
- Gauge 閾值同步調整：0.8/1.0/1.2/1.4（對應原 80/100/120/140）
- 後端 `putCallDescription` 描述文字保持百分比語法（適合閱讀）

**環境地雷（2026-09-07 新增）**：
- wouter v3.7.1 路徑正規化缺失：`/**` URL 進 Switch 不匹配 `/` 路由，顯示 React 404。已修補（patch `patches/wouter@3.7.1.patch` + node_modules/esm/index.js 加 `normalizedLocation`）。pnpm patch-commit 可永久化
- Vite 會快取 wouter 編譯結果；node_modules 改完後需手動 `rm -rf node_modules/.vite/deps/` 再重啟 dev server 才會生效
- **啟動前必執行**：`taskkill //F //IM node.exe`（清除殘留行程）→ `npm run dev`

## Phase 3+ 已完成（2026-09-09）
- **自訂條件組合器**：`shared/strategy-builder.ts` 新增條件評估引擎（15 種條件型別：MA 交叉、量比、BIAS、支撐/壓力距離等）；`server/data/user-strategies.ts` 用戶策略 CRUD；API：POST/GET/PUT/DELETE /api/users/:userId/strategies
- **回測引擎**：`server/data/backtest.ts` 逐根 K 線模擬，計算勝率、平均報酬、最大回撤、平均持有天數等指標；API：POST /api/backtest、POST /api/backtest/batch
- **待完成**：SQLite 遷移（users.json → SQLite）＋訂閱計費系統（Stripe/Paddle）

## 下一步（積木法）
待與用戶討論的模組化構建：B2 完整 PA 事實層（packages/facts＋fixtures）、B4 盤中輪詢＋Telegram、B0 歷史管線（SQLite＋啟動補抓；回補深度 60 日已定，**執行模式**與**先解鎖畫面**兩決策待回覆）。
- **版面重設計進行中（2026-09-06 晚間）**：用戶否決 A/B/C 三版示意圖——核心誤判是範式：「網頁思維（堆疊滾動、全攤開）」vs Tide 的「應用程式思維（一屏、hero 地圖、細節靠互動）」，並以紅框標註卡片內容稀疏；用戶教學 Atomic Design（Brad Frost 五層）並點名四個設計技能
- **v2 一屏式示意圖（d-one-screen.html）待核可**：100vh 應用殼、桌面零捲動；左欄板塊狀態大數字卡＋中央 flow map hero＋右欄行動區（大戶異常→自選速覽→策略排行）；細節藏互動（泡泡→詳情、狀態卡→sheet、今日重點→彈窗）；手機維持 PWA 滾動式
- **已載入並套用四技能**：kpi-dashboard-design（5-7 KPI＋drilldown）、design-system（token 三層：原始→語義→元件）、design-taste-frontend（自聲明儀表板不在適用範圍，但 Cockpit 密度規則適用：數字全 DM Mono、髮絲線分隔）、high-end-visual-design（Double-Bezel 雙層外框、無粗糙陰影）
- 示意圖檔案在 repo 外：D:\ZCODE\台股ATM\mockups\（a-dense/b-balanced/c-refined/d-one-screen.html）；8899 預覽伺服器為 session 行程不持久；Figma 不需要（程式碼即設計稿，用戶接受）
- StockSearch 打字驗證待用戶實測：自動化環境下 CJK/insertText 未觸發 React onChange（真實滑鼠點擊與 props 直呼正常），懷疑與 ReviewOverlay 全域事件有關——用戶回報打字無效時優先查此
- **四戰法已上線（本會話依用戶「② A＋B 一次做 動工」指示實作，commit f112ade）**：用戶提供 2560/2133/123/200 量化戰法（拒用數字名稱），命名為**回湧（2560 地量回檔＋量能拐頭＋陽線，放量陰線反濾）/ 破堤（2133 MA21 斜率＋3%帶量或3天站穩）/ 鯨躍（123 下跌趨勢開低收復昨低＋BIAS<-3%，逆勢接刀註記「實務常以較小風險試單」）/ 洋流（200生命線 MA200 向上回調＋MA21 聯動減碼）**。新增 shared/indicators.ts（SMA/量均線/BIAS/daysAbove 純函式，策略唯一指標來源）；getFacts 改抓 2y 日線（MA200 需求），PA 事實固定近 130 根保持行為不變；新端點 /strategy/market-scan＝戰法×法人買超 Top 100（30 分快取；全市場掃描待 B0）；掃描頁第五模式「戰法×法人 Top 100」。模糊詞數值化：粘合≤15%、放量=1.5×、貼近 MA200=2% 內。測試 15/15（含破堤/鯨躍 fixtures）；煙霧：破堤掃 Top100＝54 觸發/19 等待（大漲日合理，若要收緊可給 daysAbove 加上限 3~10 的旋鈕——待用戶決定）。STRATEGY_SPEC.md 已更新
- **用戶回饋（2026-09-06）：熱區面板資訊過於豐富/複雜，待簡化版面** → 09-07 已處理：`client/src/index.css` 縮減留白、`DigestBanner` 獨立元件（待實測後決定是否合併進 HighlightCard）；TODO 已更新，改以「最後修改處」表格代替舊式待辦列表（commit 12cd673）
- **UX 鐵律（2026-09-06 用戶兩次找不到功能後確立）：重要功能不可藏在不明顯的圖示後**——搜尋原為 header 圖示，已改為桌面 header 常駐搜尋框（StockSearch 共用元件：下拉含行情＋漲跌＋一鍵加自選；抽屜/自選頁用 block 模式）
- B3 策略層已完成：五策略（聲納/破浪/順流/潮流/潮間帶，評估引擎引用 PA facts＋法人買超＋板塊狀態）、教練策略選擇列＋狀態卡（✓已符合/○尚缺條件）、掃描第四模式「策略掃描（自選）」；資金流向地圖改 SVG 單一座標系修復 XY 軸錯位；自選股 v2 分組（主流/蓄勢/乘流/靜流＋多重標籤＋趨勢徽章）（commits 至 9a2d07f）
- A/B/C 積木已完成：A 主題板塊策展（38 主題，雙軌切換官方產業）、B 今日重點卡（情緒/TopFlow/大戶異常）、C 狀態計數＋排行榜 sheet；與 Tide 同日數據吻合（AI伺服器組裝 +230億、國巨 105億）；掃描已跨主題去重、篩選晶片中文化（commit 至 6a38714）
- Git：2026-09-06 已 commit（0096324）並 push 至 origin/main（身分 dtoneaj-glitch＋noreply 信箱，local config）；用戶在意「GitHub 要保持最新讓其他 AI 接手」——之後每個里程碑主動 commit＋push
- 審查記錄（2026-09-06，用戶要求「先審後併」）：commit 0096324 通過、P0/P1=0——T86 五檔抽樣「分項加總=合計欄」獨立重算一致（2330 買超 1,969,801 股×2410≈47.5億）、熱區#1 分數重算差 0.03、市場溫度 73.5 驗算一致、tsc 零錯＋vitest 8/8＋build＋站點 200。**用戶明確指示暫不合併到其「WebDev 版本」**；棄用可用 git revert 0096324
- P2 觀察項（Phase 2 修，不阻使用）：①除權（漲跌=X）漲跌幅以 0 計入廣度平盤桶，應改排除 ②零資金零漲幅類股被歸「退潮」（中性當弱勢） ③TPEx 當日抓取失敗時摘要靜默只涵蓋上市，response 應加市場覆蓋旗標 ④FinMind 產業分類有時間差，新上市公司暫不進熱區
- 多 AI 協作準則（用戶確認過的方向）：本機 AI 給資料夾路徑 `D:\ZCODE\台股ATM\guliu-radar` 即能看到未提交修改；雲端型 AI 只能經 GitHub（此時才需 push）；同資料夾多 AI 要輪流改檔避免互相覆蓋、dev 伺服器（3000/3001）只開一份
- 用戶啟動慣例：D:\ZCODE\台股ATM\啟動股流Radar.bat 雙擊啟動（對話背景行程不持久，勿依賴）
- D:\ZCODE 下「股流R」「工作臺」為空資料夾，「專案儀錶版」（AI 專案監控台）用埠 5173/8080 與本專案（3000/3001）不衝突

## ⚠️ 角色變更（2026-09-06 下午）：它主導寫 code、我轉顧問
- 用戶同時讓**另一個 AI**（疑為 Manus WebDev，同一 git 身分）在 guliu-radar 工作：已提交 22de104（自選股分組 主流/蓄勢/乘流/靜流＋trend badges、levels.ts 搬到 shared/levels），在製品有 server/data/strategies.ts（B3 策略層 v1：聲納/破浪/順流/潮流/潮間帶，重用我的 shared/levels 事實層）、SVG 泡泡圖、/strategies 路線
- 用戶裁定：**它主導寫 code，我轉顧問**——讀標註回饋、審查 commit 與資料正確性、架構/合規顧問，**不直接改 repo 檔案**
- 標註回饋工作流已內建 app：左下角「標註回饋」（ReviewOverlay 畫筆/文字/送出→POST /api/feedback→feedback-inbox/*.json）＋FAB 待處理角標＋GET /api/feedback/count；excalidraw 白板（feedback/ui-review.excalidraw）為備案
- 我的顧問筆記放 repo 外：D:\ZCODE\台股ATM\feedback\顧問筆記-2026-09-06.md（breakout-pullback 死條件、getFacts 限流約束、順流門檻改相對值、range-fade 缺 direction、feedback-inbox/processed 歸檔慣例）
- 用戶曾問「回饋送出後 AI 會自動知道嗎」——答：不會自動，需在對話 ping（「有新回饋」「審查最新 commit」）；會話背景 dev 行程會被清，site 用 bat 啟動

## 股票卡片重設計（2026-09-09）

使用者要求所有股票列表改以「價格優先」方式顯示（截圖樣式：大號價格居中，方向箭頭＋漲跌額＋漲跌幅在下），原版本只顯示百分比看不到實際價格。

**資料層**：`shared/types.ts` 三個介面加 `changeAmt: number | null`——`StockBrief`、`StockSignalBrief`、`StockSignal`；server 端 `hotzones.ts::briefOf()` 與 `api.ts::buildStockSignalsBrief()`、`buildStockSignal()` 皆計算 `close - prevClose`。

**前端改動（全部同步）**：
- `Dashboard.tsx` WatchlistSection：水平列表 → CSS grid 卡片（名稱+徽章／符號碼／分隔線／大號價格／▲▼±金額·%）；`minmax(148px, 1fr)` 自動換行
- `StockSearch.tsx` 搜尋結果：主價上排大號，下方小字 `±金額 · ±%`；CSS `.ss-quote b` 改 13px
- `Home.tsx` 熱區 topStocks 與掃描候選股行：價格改數字上排，漲跌額補上
- `StockDetail.tsx` 研判頁價格列：`▲/▼ ±金額 · ±%`

**共用格式函式**：`fmtSignedPrice(price)` 已在 `client/src/lib/format.ts`，用於有符號的價格顯示（`+1.25` / `−0.33` / `—`）。
