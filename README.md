# 股流 Radar

台股熱門類別探索與價格行為交易研判 PWA。

> 先找熱區，再讀結構。熱區負責發現，價格行為負責規劃，風險管理負責控制。

## 目前狀態

**Phase 1 原型（已串接免費真實資料源）**：

- 熱區：類股熱度分數（資金 35%／價格 25%／集中度 20%／廣度 20%）、聚焦／升溫／分歧／退潮分層、資金流向泡泡圖
- 掃描：熱區內法人買超前段候選股
- 研判：真實 K 線（週／日／60 分／15 分）、v0 規則版市場結構／關鍵價位／形態／條件式情境／倉位計算
- 自選：Local Storage 裝置端暫存
- PWA：manifest、icon、Service Worker（靜態快取；API 不離線快取以免誤導）

**資料源（全免費）**：

| 資料 | 來源 |
|---|---|
| 上市日行情 | TWSE OpenAPI（STOCK_DAY_ALL） |
| 三大法人買賣超 | TWSE rwd T86（僅上市；上櫃待 Phase 2） |
| 上櫃日行情 | TPEx 公開 JSON |
| 產業分類 | FinMind TaiwanStockInfo |
| 個股 K 線歷史 | Yahoo Finance（.TW／.TWO） |

> Google Finance 無公開 API，故以 TWSE/TPEx 官方開放資料為主、Yahoo 為圖表備援。
> Phase 1 為盤後資料（非即時）；近 5／20 日熱度需歷史累積管線（Phase 2）。

## 本機啟動

```bash
pnpm install
pnpm dev          # 同時啟動 API(3001) 與前端(3000)
```

單獨啟動：`pnpm dev:api`（API）／`pnpm dev:web`（前端，/api 代理至 3001）。

## 驗證

```bash
pnpm check        # TypeScript
pnpm test         # levels v0 fixtures（vitest）
pnpm build        # 前端 + server bundle
```

## 專案結構

```text
client/
  public/                 manifest、icon.svg、sw.js
  src/
    pages/Home.tsx        Phase 1 主要互動介面（熱區/掃描/研判/自選）
    lib/api.ts            API 客戶端
    lib/levels.ts         v0 價位與結構計算（Sprint 3 由 packages/facts 取代）
    lib/useAppData.ts     盤後資料流（含離線示範降級）
    lib/watchlist.ts      Local Storage 自選股
    index.css             設計 token 與響應式樣式
server/
  index.ts                Express（/api + 靜態）
  api.ts                  Phase 1 API 路由
  data/hotzones.ts        熱區引擎（聚合＋評分＋分層）
  data/providers/         twse / tpex / finmind / yahoo 供應商（可替換抽象）
shared/types.ts           API 契約型別
```

## 重要文件

- [產品與系統規格](docs/PHASE1_SPEC.md)
- [架構與資料流](docs/ARCHITECTURE.md)
- [策略規格](docs/STRATEGY_SPEC.md)
- [貢獻與 AI 修改規則](docs/CONTRIBUTING.md)
- [測試計畫](docs/TESTING.md)

## 產品與合規邊界

股流 Radar 提供公開資料整理、價格行為教學式解讀與條件式交易情境，不保證獲利、不提供無條件買賣指令，也不會把熱門類別直接當成買進建議。任何策略訊號都必須標示已確認資訊、推測情境、尚需等待條件與結構失效位。
