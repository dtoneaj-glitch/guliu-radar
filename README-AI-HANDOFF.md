# 股流 Radar — AI 接手指南

> 讀完本檔，另一位 AI（或未來的你）可在 5 分鐘內理解專案全貌並開始工作。
> 本檔最後一次全面重寫：2026-09-12。17 份 `MEMORY-*.md` 記錄了每個功能的詳細開發過程與踩過的坑，本檔是它們的統整版——先看這份，需要細節再翻對應的 MEMORY 檔。

---

## 1. 專案是什麼

**股流 Radar** 是一個台股「熱門類別探索 + 價格行為交易研判」PWA，目標使用者是「看不懂籌碼面資訊、需要大白話解讀」的股市新手。技術堆疊：

- **前端**：Vite + React 19 + Tailwind v4 + shadcn/ui + wouter（路由）
- **後端**：Express + TypeScript（同 repo 的 `server/`）
- **資料庫**：SQLite（`better-sqlite3`，`server/data/radar.db`）
- **資料源**：TWSE OpenAPI、TPEx、FinMind、Yahoo Finance、TAIFEX、Pantlas（全部免費，見第 3 節的驗證狀態）
- **本機開發**：`npm run dev` 同時啟動 API（3001）+ 前端（Vite，設定在 `vite.config.ts` 寫死 3000）

北極星：**「先找熱區，再讀結構。熱區負責發現，價格行為負責規劃，風險管理負責控制。」**

---

## 2. 已上線功能（完整清單）

### 核心研判引擎
| 功能 | 狀態 | 關鍵檔案 |
|---|---|---|
| 熱區引擎（資金/價格/集中度/廣度四成分評分） | ✅ | `server/data/hotzones.ts` |
| 近 5/20 日板塊熱度平均 | ✅ | `hotzones.ts` 的 `buildRollingAverages()`，一次掃描批次算完，見 `MEMORY-rolling-heat-average.md` |
| 主題板塊策展表（37 主題） | ✅ | `server/data/themes.ts` |
| PA 事實層（multi-timeframe swing/結構/關鍵位/形態） | ✅ | `shared/pa-facts.ts`, `shared/levels.ts`, `shared/pa-default.ts`，含頭肩頂/底、雙頂/雙底、量價背離、ATR 進場區，見 `MEMORY-pa-facts-a-b-status-check.md` |
| B3 策略層（聲納/破浪/順流/潮流/潮間帶 + 四大指標型戰法：回湧/破堤/鯨躍/洋流） | ✅ | `server/data/strategies.ts`, `shared/indicators.ts`，9 個戰法全部有單元測試 |
| 回測引擎 | ✅ | `server/data/backtest.ts` |
| 自訂條件組合器 | ✅ | `client/src/pages/StrategyBuilder.tsx` |
| **籌碼分歧規則引擎**（外資 vs 散戶自動判斷分歧） | ✅ | `shared/chip-divergence.ts`（純邏輯）+ `server/data/chip-divergence.ts`（組裝真實資料）+ `GET /api/chip-divergence`，見 `MEMORY-chip-divergence-engine.md`。**⚠️ 散戶多空比公式未經驗證，見第 3 節** |
| **VIX（台指選擇權波動率）白話判讀** | ✅ | `shared/vix.ts`，四級分類（情緒平穩/略微緊張/市場緊張/極度恐慌），**目前沒有真實資料源餵它**，純邏輯層已備妥 |

### 頁面（對照真實路由，不是設計稿）
| 頁面 | 真實元件 | 狀態 |
|---|---|---|
| 熱區首頁（底部導覽「熱區」） | `Dashboard.tsx` | ✅ 2026-09-11 全面整合：市場總覽 3 欄（來源 TWSE OpenAPI+TPEx，不是 Pantlas）、籌碼分歧卡、概念股熱度收合清單（重用真實 36 主題資料）；修了兩個既有 bug（漲停跌停顏色反了、box-shadow 用 gradient 無效），見 `MEMORY-dashboard-real-integration.md`／`MEMORY-dashboard-overview-source-fix.md` |
| 個股研判頁（底部導覽「研判」） | `StockDetail.tsx` | ✅ 用 `StockSignal`（含全部戰法匹配度清單），**不是**那個從沒被渲染過的死碼 `PA` function（在 `Home.tsx` 裡，找不到任何地方 render 它，可以直接刪）。2026-09-11 加了「水池」（持有中）優先顯示風險摘要（成本價/浮盈虧/移動停利），戰法清單改排到建議後面。**2026-09-12 重大修正**：「戰法匹配度」原本接的是 `api.ts` 裡另一套跟九戰法對不上名字的簡化版（4個假戰法），已改成真的呼叫 `server/data/strategies.ts` 的九戰法，副作用是修好了之前一直沒真的生效的「掃描頁選戰法→自動捲動強調」功能；「價格位置」卡片補上直白的支撐/壓力白話說明。見 `MEMORY-stockdetail-holding-priority.md`／`MEMORY-scan-to-pa-strategy-highlight.md`／`MEMORY-strategy-unification.md`／`MEMORY-trailing-stop-feature.md` |
| 大盤籌碼頁（底部導覽「大盤籌碼」） | `client/src/components/ChipCard.tsx` | ✅ 2026-09-11 從自製 SVG diverging bar 長條圖全面換成「標籤+徽章+大數字」統計卡（跟其他頁同一套視覺語言），新增籌碼分歧卡、散戶留倉卡（小台/微台，**帶紅色「公式待驗證」警示**）。見 `MEMORY-chipcard-redesign.md` |
| 掃描頁（底部導覽「掃描」） | `Home.tsx` 內的 `Scan` 元件 | ✅ 5 種模式：熱區候選/法人買超Top20/法人賣超Top20/策略掃描（自選）/戰法×法人Top100 |
| 自選股（底部導覽「自選」） | `Home.tsx` 內的 `Watchlist` 元件 | ✅ 分類改名「觀察股／蓄勢／**水池**／靜流」（原「主流／乘流」不夠白話），**水池**分類可設定買入成本價、顯示浮盈虧（如實顯示虧損，不美化），見 `MEMORY-watchlist-group-naming.md`／`MEMORY-watchlist-cost-price.md` |
| 策略（底部導覽「策略」） | `StrategyBuilder.tsx` | ✅ 自訂條件組合＋回測，跟「掃描」的差別：掃描是套用既有 9 個戰法，策略是自己拼裝全新規則 |

### 會員與推播
| 功能 | 狀態 | 關鍵檔案 |
|---|---|---|
| LINE Login OAuth + JWT 會員系統 | ✅ | `server/data/providers/line.ts`, `server/data/users.ts` |
| LINE Push 推播（策略觸發） | ✅ | `server/data/providers/line-push.ts`, `server/data/notifications.ts`。Basic 帳號每月 200 則限制 |
| **Telegram Bot 推播（MVP 測試版）** | ✅ | `server/data/providers/telegram-push.ts`, `server/data/telegram-notifications.ts`。免額度限制，用驗證碼配對（無 webhook，只適合少量使用者），見 `MEMORY-telegram-push-mvp.md` |
| **近進場區自動推播（排程）** | ✅ | `server/data/entry-watch-scheduler.ts`，收盤後每日 13:40 自動掃過所有已綁定 Telegram 的用戶。依賴自選股同步（見下） |
| **自選股背景同步到伺服器** | ✅ | `client/src/lib/watchlist.ts` 的 `syncToServer()`——**發現過的關鍵缺口**：伺服器端 `updateWatchlist()` 本來就寫好了但從沒被呼叫過，排程抓到的自選股永遠是空的，這次補上背景同步，見 `MEMORY-entry-watch-push-automation.md` |

### 資料層
| 功能 | 狀態 | 關鍵檔案 |
|---|---|---|
| B0 每日快照存檔（SQLite） | ✅ | `server/data/db.ts`（schema/連線）, `server/data/archive.ts`, `server/data/migrate-archive.ts`（一次性搬遷腳本），見 `MEMORY-sqlite-archive-migration.md` |
| 上櫃三大法人買賣超 | ✅（**未經真實 API 驗證**） | `server/data/providers/tpex.ts` 的 `fetchTpexInstitutional()`，見 `MEMORY-tpex-institutional-data.md` |
| 散戶（小台/微台）留倉推算 | ✅（**公式未經真實驗證**） | `server/data/providers/taifex.ts` 的 `fetchRetailFuturesPosition()` + `GET /api/retail-futures`，見 `MEMORY-chip-divergence-engine.md` |
| Yahoo K 線快取 | ✅ | `server/data/providers/yahoo-cache.ts` |
| Pantlas 個股資料（5日法人+基本面） | ✅ | `server/data/providers/pantlas.ts` |
| 內嵌回饋註解系統 | ✅ | `client/src/components/ReviewOverlay.tsx` |

---

## 3. ⚠️ 已知未驗證事項（部署後第一優先要查的）

沙盒環境的 `bash_tool` 連不到 TWSE/TAIFEX/Yahoo，但 2026-09-12 用 `web_search`/`web_fetch` 交叉查證過真實社群案例（見 `MEMORY-external-api-verification.md`），找到不少間接證據，**但沒有一項能升級為「已驗證」**——都只是提高信心，真正驗證要等部署到有網路的環境：

| 項目 | 查證結果 | 怎麼查 |
|---|---|---|
| **散戶多空比公式** | 未查到新資訊。用使用者提供的真實數字回推，規則引擎判斷「散戶偏空」，但使用者自己讀原始資料的結論是「散戶看多」——方向可能整個反了 | 對照真實 API 回應與其他籌碼快訊來源的數字，確認公式，見 `MEMORY-chip-divergence-engine.md` |
| `fetchTpexInstitutional()`（上櫃法人） | 端點網址與欄位排除邏輯找到強力間接證據支持是對的（見 `MEMORY-external-api-verification.md`）。**但新發現 TPEx 網站有 bot 偵測，直接 fetch 可能被擋**——這比欄位名稱錯更根本 | 部署後檢查回應是不是驗證頁面而不是 JSON，不只是看欄位對不對 |
| `fetchRetailFuturesPosition()`（`DailyMarketReportFut`） | 端點名稱、契約代碼（MTX/TMF）找到強力間接證據支持是對的。**但新發現 openapi.taifex.com.tw 完全沒有歷史查詢功能，只回傳最新交易日**——這點已經處理：大盤籌碼頁的「本週」功能改成查自己的 SQLite 存檔（`server/data/chipcard-archive.ts`），不再依賴 TAIFEX 的歷史查詢，見 `MEMORY-external-api-verification.md` 的後續更新 | 部署後每天造訪大盤籌碼頁讓存檔累積，幾天後確認「本週」彙總數字正確 |
| VIX 資料源 | 確認 TAIWAN VIX 是真實官方指數，但**很可能沒有免費 API**——查到官方是透過付費資料商店販售，另一個實測過全部 135 個 openapi 端點的專案裡完全沒有相關端點 | 要嘛付費訂閱 TAIFEX 資料商店，要嘛評估爬第三方網站（不穩定） |

---

## 4. 待處理事項（真正還沒做的）

- **策略評估限流**：`getFacts` 逐檔打 Yahoo，全市場掃描會撞限流，目前限定 top 100
- **主題板塊維護**：37 個主題是人工策展 v0，持續會漏股，屬於日常維運不是一次性任務
- **LINE 推播額度**：Basic 帳號每月 200 則，量大要考慮 Premium
- **散戶多空比公式驗證**（見第 3 節，優先度最高）
- **VIX 真實資料源**：需要先確認台指選擇權波動率指數是否有公開 API

---

## 5. 專案結構速查

```
guliu-radar/
├── client/src/
│   ├── pages/
│   │   ├── Home.tsx          # 主頁框架（底部導覽切換：熱區/掃描/研判/大盤籌碼/自選/策略）
│   │   ├── Dashboard.tsx     # 熱區首頁真實內容（2026-09-11 全面整合，見第 2 節）
│   │   ├── StockDetail.tsx   # 個股研判頁真實內容
│   │   ├── StrategyBuilder.tsx
│   │   └── Login.tsx
│   ├── components/
│   │   ├── ChipCard.tsx      # 大盤籌碼頁（2026-09-11 重新設計，見第 2 節）
│   │   ├── DigestBanner.tsx
│   │   └── ReviewOverlay.tsx
│   └── lib/
│       ├── api.ts            # API 客戶端（含 fetchChipDivergence/fetchRetailFutures 等新函式）
│       ├── auth.tsx
│       └── watchlist.ts      # 自選股（觀察股/蓄勢/水池/靜流分類 + 成本價 + 背景同步）
│
├── server/
│   ├── index.ts              # Express 入口 + 排程（B0 存檔 13:35、進場區推播 13:40）
│   ├── api.ts                # 全部 API 路由
│   └── data/
│       ├── hotzones.ts       # 熱區引擎 + 近5/20日均值
│       ├── strategies.ts     # 9 個戰法評估
│       ├── entry-watch.ts    # 近進場區掃描
│       ├── entry-watch-scheduler.ts  # 排程：收盤後自動推播
│       ├── chip-divergence.ts # 籌碼分歧：組裝真實資料
│       ├── archive.ts / db.ts / migrate-archive.ts  # SQLite 存檔
│       ├── telegram-notifications.ts # Telegram 綁定管理
│       ├── users.ts / notifications.ts
│       ├── themes.ts
│       └── providers/
│           ├── twse.ts / tpex.ts / finmind.ts / yahoo.ts / yahoo-cache.ts
│           ├── taifex.ts     # 含 fetchRetailFuturesPosition（未驗證）
│           ├── line.ts / line-push.ts / telegram-push.ts
│           └── pantlas.ts
│
├── shared/
│   ├── types.ts              # 全部 API 型別
│   ├── pa-facts.ts / levels.ts / pa-default.ts / indicators.ts
│   ├── chip-divergence.ts    # 純邏輯：外資vs散戶分歧判斷
│   ├── vix.ts                # 純邏輯：VIX 白話分類（無資料源）
│   └── strategy-builder.ts
│
├── docs/                     # 產品規格文件（PHASE1_SPEC/ARCHITECTURE/PA_FACTS_ENGINE/STRATEGY_SPEC/TODO 等）
├── MEMORY-*.md                # 17 份逐功能開發記錄，本檔是它們的統整版
├── README-AI-HANDOFF.md      # 本檔
└── package.json
```

---

## 6. 快速上手

```bash
npm install --legacy-peer-deps   # 注意：一定要加 --legacy-peer-deps，vite 版本衝突
npm run dev                      # API 跑 3001，前端跑 3000（vite.config.ts 寫死）
```

**Windows 常見卡關**（一次性排查，排除過一輪了）：
- `better-sqlite3` 需要編譯，Node 版本太新（如 v24）可能找不到預編譯版 → 建議用 **Node 22 LTS**（不是 20，那個已 EOL）
- 就算用對的 Node 版本，編譯仍可能失敗 → 需要裝 **Visual Studio Build Tools**，且要在「個別元件」裡明確勾選 **MSVC v143 - VS 2022 C++ 建置工具**，只裝「Desktop development with C++」大類不夠
- 專案資料夾**不要放在 OneDrive 同步範圍內**，同步機制可能造成檔案更新延遲/衝突
- 開發時如果畫面一直顯示舊內容，先檢查是不是有**舊的 `npm run dev` 程序沒關掉還佔著 port**（`netstat -ano | findstr :3000` 查 PID，`taskkill /PID xxx /F` 關掉），比瀏覽器快取更常是元凶

驗證：
```bash
npx tsc --noEmit   # TypeScript 檢查，目前 0 錯誤
npx vitest run     # 45 個測試全過
```

---

## 7. 重要設計原則

1. **PA 事實先於研判**：模型只能解釋 Facts Layer 結果，不可自行計算價位或發明形態
2. **條件式輸出**：每次研判輸出區分「已確認 / 推測 / 尚需等待」三區，資料不足就承認不足，不編造
3. **合規紅線**：不說「現在買進」、熱門不等於可交易、單一時框限制聲明
4. **資料可替換**：所有資料源封裝在 `server/data/providers/` 抽象層
5. **單向依賴**：呈現 → 研判 → 事實層 → 資料源
6. **大白話原則**（2026-09-10 起明確化）：使用者是「看不懂籌碼面資訊」的新手，命名跟文案要直接講意思，不要用「乘流」這種詩意水流隱喻（改叫「水池」都還要加註解），VIX 的「偏高」要改成「市場緊張」——同一語境下已經講過的分類不要重複講（例如「今日概念股熱度」底下的每一列不用再寫「概念股」三個字）
7. **規則引擎優於人工判讀**：像「外資看空、散戶看多」這種洞察，要做成規則+句型模板自動產生（`shared/chip-divergence.ts` 是範例），不要每天找人工寫，否則等於還是需要一個懂籌碼的人幫使用者翻譯，沒有解決問題

---

## 8. GitHub 協作注意

- Repo：`https://github.com/dtoneaj-glitch/guliu-radar`（public）
- **AI 無法用 web search/fetch 直接讀取這個 repo**——太新或私有內容不會被搜尋引擎索引，`web_fetch` 工具限制只能開已出現在搜尋結果裡的網址。需要看內容時，請使用者貼檔案內容或截圖，不要假設能直接瀏覽
- 推送方式：使用者提供 GitHub Fine-grained Personal Access Token（Repository access 選這個 repo、Contents 權限設 **Read and write**），AI 在 sandbox 內用 `git remote add` + token 內嵌網址推送，**推送完立刻移除本機端含 token 的 remote 設定**，並提醒使用者回 GitHub 撤銷該 token（一次性用途）
- 2026-09-11 曾發生「推送的其實是舊版本」的狀況，原因是使用者一開始是手動上傳、AI 後來才接手用 git push -f 覆蓋——**如果 GitHub 上內容跟本機認知的最新狀態對不上，先懷疑是推送流程本身的問題，不要只往「快取」方向排查**

---

## 9. 下一步建議

優先順序（依風險/價值排序）：
1. **驗證散戶多空比公式**（第 3 節）——這個錯了會讓籌碼分歧引擎系統性判斷相反方向，比沒有這功能更危險
2. **驗證上櫃法人資料端點**是否真的抓得到資料
3. 找 VIX 真實資料源，把 `shared/vix.ts` 接上真實數字
4. 其餘功能性擴充（例如水池成本價要不要加持有股數/買入日期，見 `MEMORY-watchlist-cost-price.md` 裡記錄的使用者原話）
