# 股流 Radar — AI 接手指南

> 讀完本檔，另一位 AI 可在 5 分鐘內理解專案全貌並開始工作。

---

## 1. 專案是什麼

**股流 Radar** 是一個台股「熱門類別探索 + 價格行為交易研判」PWA，技術堆疊：

- **前端**：Vite + React 19 + Tailwind v4 + shadcn/ui + wouter（路由）
- **後端**：Express + TypeScript（同 repo 的 `server/`）
- **資料源**：TWSE rwd API、TPEx、FinMind、Yahoo Finance、TAIFEX、Pantlas（全部免費）
- **部署**：本機開發 `pnpm dev` 同時啟動 API(3001) + 前端(3000)

北極星：**「先找熱區，再讀結構。熱區負責發現，價格行為負責規劃，風險管理負責控制。」**

---

## 2. 已上線功能（截至 2026-09-09）

| 功能 | 狀態 | 關鍵檔案 |
|---|---|---|
| 熱區引擎（資金/價格/集中度/廣度四成分評分） | ✅ | `server/data/hotzones.ts` |
| 主題板塊策展表（37 主題） | ✅ | `server/data/themes.ts` |
| 大盤籌碼卡（三大法人期貨/選擇權 diverging bar） | ✅ | `client/src/components/ChipCard.tsx`, `server/data/providers/taifex.ts` |
| v2 散戶版 Dashboard（情緒 + TOP5 + 熱門話題） | ✅ | `client/src/pages/Dashboard.tsx` |
| v2 個股頁（價格位置視覺化 + 四大戰法 + 大白話建議） | ✅ | `client/src/pages/StockDetail.tsx` |
| PA 事實層（multi-timeframe swing/結構/關鍵位/形態） | ✅ | `shared/pa-facts.ts`, `shared/pa-default.ts` |
| B3 策略層（聲納/破浪/順流/潮流/潮間帶 + 四指標） | ✅ | `server/data/strategies.ts`, `shared/indicators.ts` |
| 回測引擎 | ✅ | `server/data/backtest.ts` |
| 自訂條件組合器 | ✅ | `client/src/pages/StrategyBuilder.tsx` |
| LINE Login OAuth + JWT 會員系統 | ✅ | `server/data/providers/line.ts`, `server/data/users.ts` |
| LINE Push 推播（策略觸發） | ✅ | `server/data/providers/line-push.ts`, `server/data/notifications.ts` |
| Telegram Bot 推播（MVP 測試版） | ✅ | `server/data/providers/telegram-push.ts`, `server/data/telegram-notifications.ts` |
| 近進場區自動推播（排程） | ✅ | `server/data/entry-watch-scheduler.ts`，收盤後每日 13:40 自動掃過所有已綁定用戶 |
| B0 每日快照存檔（SQLite） | ✅ | `server/data/db.ts`, `server/data/archive.ts`, `server/data/migrate-archive.ts` |
| Yahoo K 線快取（server 層 TTL 10 分鐘） | ✅ | `server/data/providers/yahoo-cache.ts` |
| Pantlas 個股資料（5日法人 + 基本面） | ✅ | `server/data/providers/pantlas.ts` |
| 內嵌回饋註解系統 | ✅ | `client/src/components/ReviewOverlay.tsx` |

---

## 3. 待處理事項（已知缺口）

- **tsc 編譯錯誤**：`history.ts` / `export.ts` / `export-html.ts` / `Home.tsx` 四檔有 40+ 錯誤（2026-09-09 commit 501ffd3 已標記供 AI review，尚未修復）
- ~~**SQLite 遷移**：目前用 JSON 檔案存檔，正式化需換 SQLite~~ **已完成（2026-09-09）**：`server/data/archive.ts` 改用 `better-sqlite3`（`server/data/db.ts` 為 schema/連線），歷史 JSON 存檔已用 `npm run db:migrate` 搬遷（7 天全數成功）。舊 JSON 檔保留在 `server/data/archive/daily/` 備查，`server/data/radar.db` 已加入 `.gitignore`
- ~~**近 5/20 日熱度**：需要日曆累積多日熱度得分（B0 正式化後）~~ **已完成（2026-09-09）**：`server/data/hotzones.ts` 新增 `buildRollingAverages()`，一次掃描近 20 個已存檔交易日、批次算出所有板塊的 avg5d/avg20d（取代舊版對每個 zone 各自重跑歷史的低效寫法），已接進 `getHotzones()`。前端（`Home.tsx`／`export-html.ts`）原本就在讀這兩個欄位，不需改動
- ~~**上櫃法人買賣超**：目前僅上市有 T86 資料，上櫃待 Phase 2~~ **已接上（2026-09-09，未經真實 API 驗證）**：`server/data/providers/tpex.ts` 新增 `fetchTpexInstitutional()`，`hotzones.ts` 已合併進 `netBuyValue`／`snapshot.institutional`。**⚠️ 沙盒連不到 tpex.org.tw，端點網址與回傳欄位是根據網路上找到的舊版程式碼＋現有 `stk_quote_result.php`（同系統）回傳形狀推斷的，沒有實際打過一次真實 API**——本機部署後第一件事是驗證 `/api/hotzones` 回傳的上櫃股 `netBuyValue` 是否為非 null 的合理數字，若欄位名稱對不上會被 `.catch(() => null)` 接住（不會炸掉，但上櫃法人資料會靜默變回 null，需要用 log 或直接呼叫 `fetchTpexInstitutional()` 檢查）
- **LINE 推播額度**：basic account 每月 200 則限制（premium 無限制）
- **策略評估限流**：`getFacts` 逐檔打 Yahoo，掃描數十檔會撞限流（B0 正式化前限制掃描範圍）

---

## 4. 專案結構速查

```
guliu-radar/
├── client/src/
│   ├── pages/              # 頁面元件
│   │   ├── Home.tsx        # 主頁（熱區/Dashboard/研判/籌碼卡/自選）
│   │   ├── Dashboard.tsx   # v2 散戶版大盤儀表板
│   │   ├── StockDetail.tsx # v2 個股研判頁
│   │   ├── StrategyBuilder.tsx  # 自訂策略組合器
│   │   └── Login.tsx       # 會員登入/註冊
│   ├── components/
│   │   ├── ChipCard.tsx    # 籌碼卡（TAIFEX diverging bar）
│   │   ├── DigestBanner.tsx       # 每日回訪摘要
│   │   ├── GuideOverlay.tsx       # PA 六段框架引導
│   │   └── ReviewOverlay.tsx      # 內嵌回饋註解
│   └── lib/
│       ├── api.ts          # API 客戶端
│       ├── auth.tsx        # 會員認證 Context
│       ├── useAppData.ts   # 盤後資料流
│       └── pa-facts.ts     # （shared 也有）
│
├── server/
│   ├── index.ts            # Express 入口
│   ├── api.ts              # 全部 API 路由（~40 端點）
│   └── data/
│       ├── hotzones.ts     # 熱區引擎（評分 + 分層）
│       ├── strategies.ts   # 策略評估 + 掃描
│       ├── pa-analysis.ts  # PA 六段分析
│       ├── backtest.ts     # 回測引擎
│       ├── archive.ts      # 每日快照存檔（SQLite，見 db.ts）
│       ├── db.ts           # SQLite 連線與 schema（server/data/radar.db）
│       ├── migrate-archive.ts # 一次性搬遷：舊版 JSON 存檔 → SQLite（npm run db:migrate）
│       ├── notifications.ts # 推播通知管理
│       ├── users.ts        # 會員資料（JSON 檔）
│       ├── themes.ts       # 37 個主題板塊
│       └── providers/      # 資料提供者
│           ├── twse.ts     # TWSE 上市行情 + 法人
│           ├── tpex.ts     # TPEx 上櫃行情
│           ├── finmind.ts  # FinMind 產業分類
│           ├── yahoo.ts    # Yahoo K 線
│           ├── yahoo-cache.ts  # K 線快取
│           ├── taifex.ts   # TAIFEX 期貨/選擇權籌碼
│           ├── line.ts     # LINE Login OAuth
│           ├── line-push.ts # LINE Push
│           └── pantlas.ts  # Pantlas 個股 + 基本面
│
├── shared/
│   ├── types.ts            # 全部 API 型別（約 50 個 interface）
│   ├── pa-facts.ts         # PA 事實計算
│   ├── pa-default.ts       # 預設策略配置
│   ├── indicators.ts       # 四指標（回湧/破堤/鯨躍/洋流）
│   └── strategy-builder.ts # 策略組合器型別
│
├── docs/
│   ├── PHASE1_SPEC.md      # 產品規格（最完整）
│   ├── ARCHITECTURE.md     # 架構交接
│   ├── PA_FACTS_ENGINE.md  # PA 引擎規格
│   ├── STRATEGY_SPEC.md    # 策略規格
│   ├── TESTING.md          # 測試計畫
│   ├── CONTRIBUTING.md     # AI 修改規則
│   └── TODO.md             # 待辦與已知邊界（接手優先讀）
│
├── patches/                # wouter patch（修復 /** 路徑問題）
├── README.md               # 官方 README
└── package.json
```

---

## 5. 快速上手

```bash
cd D:/ZCODE/台股ATM/guliu-radar
pnpm install
pnpm dev   # API 跑 3001，前端跑 3000
```

驗證：
```bash
pnpm check   # TypeScript 檢查
pnpm test    # vitest（19 tests）
pnpm build   # 前端 + server bundle
```

---

## 6. 重要設計原則

1. **PA 事實先於研判**：模型只能解釋 Facts Layer 結果，不可自行計算價位或發明形態
2. **條件式輸出**：每次研判輸出區分「已確認 / 推測 / 尚需等待」三區
3. **合規紅線**：不說「現在買進」、熱門不等於可交易、單一時框限制聲明
4. **資料可替換**：所有資料源封裝在 `server/data/providers/` 抽象層
5. **單向依賴**：呈現 → 研判 → 事實層 → 資料源

---

## 7. GitHub 協作注意

- Repo：`dtoneaj-glitch/guliu-radar`（public）
- **其他 AI 無法用 web-fetch 讀 GitHub**（會 404），請直接給本 zip 或 raw 連結
- 本機路徑 `D:\ZCODE\台股ATM\guliu-radar` 是本機 AI 的直接入口
- 本地未 commit 的檔案不會出現在 GitHub，需先 `git add + commit + push`
- branch 策略：一個功能一個 branch，不要 force push main

---

## 8. 下一步建議

從 `docs/TODO.md` 的「待處理事項」開始，或從修復 tsc 40+ 編譯錯誤開始（四個檔案）。
