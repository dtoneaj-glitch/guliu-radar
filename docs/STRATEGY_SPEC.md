# 股流 Radar｜策略規格

## Phase 1

唯一內建策略：`pa_default`。

用途：依價格行為六段框架輸出教學式、條件式分析，不直接下單。

## Phase 2 預計策略

| id | 名稱 | 核心條件 |
|---|---|---|
| `breakout-pullback` | 突破回踩 | 前高突破確認 → 回踩不破 → 信號 K → 進場區 |
| `institution-tailwind` | 法人順風 | 法人連買至少 3 日＋熱區聚焦/升溫＋支撐回踩與吞沒 |
| `trend-follow` | 趨勢跟隨 | HH/HL 結構中的回調，失效為跌破前 HL |
| `range-fade` | 箱體邊緣 | 震盪結構＋邊緣反轉 K；區間中間不交易 |

## StrategyProfile

```ts
interface StrategyProfile {
  id: string;
  name: string;
  scope: "builtin" | "user";
  timeframes: ("1w" | "1d" | "60m" | "15m")[];
  filters: Condition[];
  triggers: Condition[];
  invalidations: Condition[];
  riskTemplate: {
    stopRule: string;
    target1: string;
    target2: string;
    rrMin: number;
  };
  notifyCopy: string;
}
```

`Condition` 只能引用 PA Facts Layer 與 marketContext 欄位。策略結果必須能重現、可測試、有版本號。

## v2 指標型戰法（2026-09-06 上架）

資料需求升級：`getFacts` 改抓 Yahoo **2 年日線**（MA200 需要）；PA 事實固定取近 130 根維持既有行為。指標由 `shared/indicators.ts`（純函式：SMA／量均線／BIAS／連續站上天數）統一供給，策略條件不得自行發明數值。

| id | 名稱 | 過濾 | 觸發 | 失效／出場 |
|---|---|---|---|---|
| `volume-refill` | 回湧（2560） | 收盤 > MA25 | 量 < 60 日均量（地量）＋5/60 日均量粘合 ≤15% 且拐頭＋收陽 | 放量陰線（≥1.5×）＝空頭發力，訊號失效；跌破 MA25 |
| `ma21-break` | 破堤（2133） | MA21 斜率 ≥ 0 | 收盤 ≥ MA21×1.03 且量 ≥ 1.5×，**或**連 3 天站上 MA21 | 收盤跌破 MA21 3% 或連 3 天收不回，全面出場 |
| `deep-reversal` | 鯨躍（123） | 日線結構＝下降 | 開盤 < 昨低且收盤 > 昨低＋BIAS(5) < −3% | 停損＝訊號 K 最低；MA5 拐頭止盈。風險註記：逆勢接刀型，實務常以較小風險試單 |
| `ma200-current` | 洋流（200） | MA200 斜率向上（5 日比較） | 回調觸碰 MA200 後收回，或貼近其上方 2% 內止跌 | MA21 走平減碼 50%；跌破 MA21 3% 或連 3 天收不回，全面出場 |

模糊詞的數值化（可調參預設）：粘合＝|VolMA5/VolMA60−1| ≤ 15%；放量＝今日量 ≥ 5 日均量 1.5 倍；「明顯下跌」＝PA 事實 trend=下降；「貼近 MA200」＝上方 2% 內。掃描範圍：戰法×法人買超前 100 名（全市場掃描待 B0 歷史管線）。

## 推播文案

使用：「策略條件已符合，請查看完整分析。」

不可使用：「現在買進」、「保證上漲」、「明牌」。訊息必須附已確認條件、等待條件、結構失效位、風險提醒與完整分析連結。
