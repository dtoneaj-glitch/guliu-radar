# 股流 Radar - 籌碼卡功能開發簡報

> 建立時間：2026-09-07
> 目標：將 FlowTreemap 替換為「籌碼卡」，用大白話 + 分歧堆疊圖呈現三大法人在期貨/選擇權的布局

---

## 一、已完成（後端）

### 1. TAIFEX 資料提供者
**檔案：** `server/data/providers/taifex.ts`（已存在，可運作）

- 已驗證 2026-09-04 真實資料
- 使用 TAIFEX 免費 API，無需金鑰
- 三個端點：
  - `MarketDataOfMajorInstitutionalTradersDividedByFuturesAndOptionsBytheDate` — 三大法人買賣超總覽
  - `MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate` — 各契約明細（22 種契約）
  - `PutCallRatio` — 台指選擇權 P/C 比

### 2. 真實資料驗證（2026-09-04）

**Divided 端點（買超/賣超）：**
| 法人 | 期貨買超 | 期貨賣超 | 期貨淨額 | 選擇權買超 | 選擇權賣超 | 選擇權淨額 |
|---|---|---|---|---|---|---|
| 外資及陸資 | 564,367 | 543,410 | +20,957 | 232,588 | 226,032 | +6,556 |
| 自營商 | 70,881 | 65,482 | +5,399 | 160,205 | 156,632 | +3,573 |
| 投信 | 1,834 | 209 | +1,625 | 0 | 2,290 | -2,290 |

**Futures Contracts 端點（22 種契約）：**
- 臺股期貨、股票期貨、半導體30期貨、電子期貨、金融期貨
- 小型臺指期貨、小型金融期貨、小型電子期貨
- 微型臺指期貨、ETF期貨、臺灣永續期貨、臺灣生技期貨
- 東證期貨、櫃買指數期貨、非金電期貨、航運期貨
- 美國標普500期貨、美國費城半導體期貨、美國道瓊期貨、美國那斯達100期貨
- 富櫃200期貨

**真實資料驗證（2026-09-04）：**
- 外資期貨未平倉：-486,659 口（押空）
- 外資期貨買賣超：買 564,367 口 / 賣 543,410 口 → 淨 +20,957
- P/C 比：98.45%（多空均衡）
- 外資最大部位契約：股票期貨 -447,410 口（押空）

### 3. 大白話翻譯規則（已定義）

| 原始欄位 | 大白話標籤 | 解讀 |
|---|---|---|
| 期貨買賣超（買超/賣超） | 「今天往哪邊用力」 | 買超 > 賣超 = 今天偏多 |
| 期貨未平倉淨額 | 「現在手上押注方向」 | 正值=偏多 / 負值=偏空 |
| 選擇權未平倉淨額 | 「選擇權市場押注」 | 同上 |
| 台指選擇權 P/C 比 | 「跌時保護意願」 | >120=偏空、<100=偏多 |

---

## 二、新增需求（用户確認）

### 1. 用戶提供的範例數字含義
```
225  外資   855   → 外資買超 225，賣超 855
105  投信   456   → 投信買超 105，賣超 456
400  自營商  109   → 自營商買超 400，賣超 109
```
**結論：** 籌碼卡的主圖表應使用「買超 vs 賣超」數據（而非未平倉），呈現為分歧堆疊圖。

### 2. 合約到期日考量
- **台股指期**：每月第三個禮拜三到期（需滾月）
- **台指選擇權**：每週三、五到期
- **技術現狀：** TAIFEX API 的 ContractCode 不含月份（如「臺股期貨」聚合了所有月份），到期日計算需在前端做（根據今日日期推算近月契約）
- **決策：** 先不做到期日標示，專注在買賣超數據呈現；後續如需可在 frontend 加計算邏輯

### 3. 每日 / 每周 切換
- **每日：** 今日買賣超（Divided 端點直接給）
- **每周：** 需調用 General 端點 × 5 天，累加各交易日
- **技術：** 新增 `fetchChipCardWeekly(date)` 函數，回推 5 個交易日後 sum

### 4. 滿版設計
- 籌碼卡元件需盡可能佔滿頁面寬度
- 橫條圖高度、字體大小需配合 viewport
- 建議：桌面端全寬，平板/手機適度縮放

---

## 三、待完成（需在新對話中執行）

### 1. 後端 API 路由
**檔案：** `server/api.ts`

需要新增：
```typescript
import { fetchChipCard } from "./data/providers/taifex";

api.get(
  "/chipcard",
  wrap(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    const data = await fetchChipCard(date);
    res.json(data);
  }),
);
```

### 2. 前端 API 呼叫
**檔案：** `client/src/lib/api.ts`

需要新增：
```typescript
import type { ChipCardData } from "../types/chipcard";

export function fetchChipCard(date?: string): Promise<ChipCardData> {
  const params = date ? `?date=${date}` : "";
  return getJson<ChipCardData>(`/api/chipcard${params}`);
}
```

### 3. 前端元件（核心）
**檔案：** `client/src/components/ChipCard.tsx`（新建）

**UI 設計規格：**

#### 主圖表：分歧堆疊橫條圖
```
          ← 賣超（空方）          |          買超（多方）→
外資及陸資   ████████ 543,410 口  |  ████████ 564,367 口
自營商       █████ 65,482 口      |  ███ 70,881 口
投信         ████ 209 口          |  █ 1,834 口
```
- 每列 = 一個法人
- 左半 = 賣超（紅色系）
- 右半 = 買超（綠色系）
- 每段 = 各契約（如 臺股期貨、股票期貨、半導體30...）
- 中段標註總買賣超數值
- 段長比例 = 該契約佔該法人總買賣超的比例

#### 視角切換（兩種）
1. **法人視角**：每列 = 一個法人，各契約分段
2. **契約視角**：每列 = 一個契約，各法人分段

#### 時間切換（每日 / 每周）
- 每日：今日買賣超
- 每周：近 5 個交易日累加

#### 輔助資訊區
- **市場研判**：一句大白話結論
  - 例：「外資買超 vs 賣超接近，自營商略偏多，投信買超少 — 整體偏多但力道不強」
- **P/C 比**：台指選擇權多空情緒
- **近月契約提醒**：到期日近（3 天內）的契約標示

### 4. 整合到 Home.tsx
**檔案：** `client/src/pages/Home.tsx`

需要修改：
1. 在 `Tab` 類型中加入 `"chipcard"`
2. 在 `Sidebar` 的 `navItems` 中加入籌碼卡 Tab
3. 在 `BottomNav` 中加入籌碼卡 Tab
4. 在 main 內容區的 tab 切換中新增 chipcard 分支
5. 引入 `fetchChipCard` 和 `ChipCard` 元件

**建議 Tab 順序：** hotzones | chipcard | scan | pa | watchlist
**圖標建議：** `BarChart3`（堆疊圖表）

### 5. 新增 shared types
**檔案：** `shared/types/chipcard.ts`

```typescript
export type LargeTrader = "外資及陸資" | "自營商" | "投信";
export type DateType = "daily" | "weekly";
export type ViewMode = "by-trader" | "by-contract";

export interface TradeSegment {
  name: string;           // 契約名稱（如「臺股期貨」）
  volume: number;         // 買賣超口數（正值=買超、負值=賣超）
  valueYi: number;        // 買賣超金額（新台幣億元）
  pct: number;            // 佔該法人總買賣超的比例（0-100）
}

export interface TraderRow {
  trader: LargeTrader;
  futuresBuy: number;         // 期貨買超
  futuresSell: number;        // 期貨賣超
  futuresNet: number;         // 期貨淨額
  optionsBuy: number;         // 選擇權買超
  optionsSell: number;        // 選擇權賣超
  optionsNet: number;         // 選擇權淨額
  segments: TradeSegment[];   // 各契約分段
  description: string;        // 大白話描述
}

export interface ContractRow {
  contract: string;
  traders: {
    trader: LargeTrader;
    buy: number;
    sell: number;
    net: number;
  }[];
  description: string;
}

export interface ChipCardData {
  asOf: string;
  dateType: DateType;
  viewMode: ViewMode;
  traderRows: TraderRow[];      // 法人視角
  contractRows: ContractRow[];  // 契約視角
  marketBias: "long" | "short" | "flat";
  marketBiasDescription: string;
  putCallRatio: number | null;
  putCallBias: "long" | "short" | "flat";
  putCallDescription: string;
  pcTrend: (number | null)[];
  nearExpiryContracts: string[];  // 近到期契約（3天內）
}
```

---

## 四、網站結構變更

### 當前頁面結構
```
Tab: hotzones | scan | pa | watchlist
```

### 變更後
```
Tab: hotzones | chipcard | scan | pa | watchlist
```

### 各 Tab 內容

| Tab | 內容 |
|---|---|
| hotzones | 現有熱區頁（不變） |
| chipcard | **新增**：籌碼卡（分歧堆疊圖 + 每日/每周切換 + 法人/契約視角切換） |
| scan | 現有掃描頁（不變） |
| pa | 現有研判頁（不變） |
| watchlist | 現有自選頁（不變） |

---

## 五、啟動指令

在新對話框中，請執行以下步驟：

1. 先執行以下指令確認後端正常：
   ```bash
   cd D:/ZCODE/台股ATM/guliu-radar
   npx tsx -e "const m=require('./server/data/providers/taifex'); m.fetchChipCard().then(d=>console.log(JSON.stringify(d)).substring(0,1000)).catch(e=>console.error(e.message))"
   ```

2. 依序執行：
   - 加 API 路由（server/api.ts）
   - 加前端 fetcher（client/src/lib/api.ts）
   - 建 shared types（shared/types/chipcard.ts）
   - 建 UI 元件（client/src/components/ChipCard.tsx）
   - 整合到 Home.tsx
   - 加 CSS（client/src/app/globals.css）

3. 啟動開發伺服器測試：
   ```bash
   pnpm dev
   ```

4. 確認籌碼卡 Tab 可正常顯示分歧堆疊圖，滿版渲染

---

## 六、待處理的技術細節

### 1. 每周資料計算
需調用 TAIFEX General 端點，回推 5 個交易日：
```typescript
async function fetchChipCardWeekly(date: string): Promise<ChipCardData> {
  const dates = await getTradingDates(date, 5); // 回推 5 個交易日
  const results = await Promise.all(dates.map(d => fetchChipCard(d)));
  return aggregateWeekly(results);
}
```

### 2. 每周資料計算
需調用 TAIFEX 端點，回推 5 個交易日累加：
- 每日資料：Divided 端點直接給（今日買超/賣超）
- 每周資料：調用 `MarketDataOfMajorInstitutionalTradersGeneralBytheDate` 回推 5 天後 sum
- 已驗證：2026-09-03 資料可正常回傳，週 aggregation 可行

### 3. 滿版 CSS
建議在 globals.css 中加入：
```css
.chipcard-container {
  width: 100%;
  min-height: 100vh;
  padding: 0;
}

.chipcard-bar {
  width: 100%;
  height: 48px; /* 每列高度 */
}

.chipcard-label {
  width: 120px;
  font-size: 14px;
}

.chipcard-segment {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
}
```
