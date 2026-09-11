import type { Candle, Timeframe } from "./types";
import { buildMarketFacts, type KeyLevel, type MarketFacts, type PatternFinding } from "./levels";

export const PA_FACTS_VERSION = "pa-facts.v1";
export const PA_TIMEFRAMES: Timeframe[] = ["1w", "1d", "60m", "15m"];

export type FactDataStatus = "ready" | "insufficient" | "unavailable";
export type Trend = "上升" | "下降" | "震盪";

export interface PAFacts {
  version: typeof PA_FACTS_VERSION;
  timeframe: Timeframe;
  data: {
    status: FactDataStatus;
    candleCount: number;
    minimumCandles: number;
    firstTime: string | null;
    lastTime: string | null;
    reason: string | null;
  };
  structure: {
    trend: Trend | null;
    sequence: string | null;
    confidence: "高" | "中" | "低" | null;
    lastHigh: number | null;
    lastLow: number | null;
  };
  keyLevels: Array<KeyLevel & { role: "support" | "resistance" }>;
  patterns: PatternFinding[];
  price: {
    close: number | null;
    changeFromPreviousPct: number | null;
    volume: number | null;
    averageVolume20: number | null;
    /** ATR(14)，用於進場區寬度與失效位緩衝的計算基準（v2 新增） */
    atr14: number | null;
  };
  entryZone: { low: number; high: number } | null;
  invalidation: number | null;
}

export interface MultiTimeframeFacts {
  version: typeof PA_FACTS_VERSION;
  symbol: string;
  timeframes: Record<Timeframe, PAFacts>;
  alignment: {
    status: "aligned" | "mixed" | "insufficient";
    direction: "多方" | "空方" | "中性" | null;
    /**
     * 加權一致性分數，-100（全時框空方）～+100（全時框多方）。
     * 權重：週線 40%／日線 30%／60分 20%／15分 10%（越高時框權重越重，符合「週線定方向、低時框找進場」的判讀原則）。
     * 只在有 ready 的時框間依權重正規化，缺資料的時框不拖累分數，但也不會被當作方向證據。
     * 資料不足（沒有任何 ready 時框）時回傳 null，不得編造分數。
     */
    score: number | null;
    confirmed: string[];
    waiting: string[];
  };
}

const MINIMUM_CANDLES = 30;

function emptyFacts(timeframe: Timeframe, candles: Candle[], status: FactDataStatus, reason: string): PAFacts {
  return {
    version: PA_FACTS_VERSION,
    timeframe,
    data: {
      status,
      candleCount: candles.length,
      minimumCandles: MINIMUM_CANDLES,
      firstTime: candles[0]?.time ?? null,
      lastTime: candles[candles.length - 1]?.time ?? null,
      reason,
    },
    structure: { trend: null, sequence: null, confidence: null, lastHigh: null, lastLow: null },
    keyLevels: [],
    patterns: [],
    price: { close: null, changeFromPreviousPct: null, volume: null, averageVolume20: null, atr14: null },
    entryZone: null,
    invalidation: null,
  };
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fromMarketFacts(timeframe: Timeframe, candles: Candle[], facts: MarketFacts): PAFacts {
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const averageVolume20 = avg(candles.slice(-20).map((c) => c.volume));
  const keyLevels: PAFacts["keyLevels"] = [];
  if (facts.support) keyLevels.push({ ...facts.support, role: "support" });
  if (facts.resistance) keyLevels.push({ ...facts.resistance, role: "resistance" });
  return {
    version: PA_FACTS_VERSION,
    timeframe,
    data: {
      status: "ready",
      candleCount: candles.length,
      minimumCandles: MINIMUM_CANDLES,
      firstTime: candles[0].time,
      lastTime: last.time,
      reason: null,
    },
    structure: {
      trend: facts.trend,
      sequence: facts.sequence,
      confidence: facts.confidence,
      lastHigh: facts.swings.lastHigh?.price ?? null,
      lastLow: facts.swings.lastLow?.price ?? null,
    },
    keyLevels,
    patterns: facts.patterns,
    price: {
      close: last.close,
      changeFromPreviousPct: previous ? ((last.close - previous.close) / previous.close) * 100 : null,
      volume: last.volume,
      averageVolume20,
      atr14: facts.atr,
    },
    entryZone: facts.entryZone,
    invalidation: facts.invalidation,
  };
}

export function buildPAFacts(candles: Candle[] | undefined, timeframe: Timeframe): PAFacts {
  const safeCandles = Array.isArray(candles) ? candles : [];
  if (safeCandles.length < MINIMUM_CANDLES) {
    return emptyFacts(timeframe, safeCandles, "insufficient", `至少需要 ${MINIMUM_CANDLES} 根 K 線`);
  }
  const facts = buildMarketFacts(safeCandles);
  return facts ? fromMarketFacts(timeframe, safeCandles, facts) : emptyFacts(timeframe, safeCandles, "insufficient", "無法建立價格行為事實");
}

function unavailableFacts(timeframe: Timeframe): PAFacts {
  return emptyFacts(timeframe, [], "unavailable", "尚未取得此時間框架資料");
}

export function buildMultiTimeframeFacts(symbol: string, candlesByTimeframe: Partial<Record<Timeframe, Candle[]>>): MultiTimeframeFacts {
  const timeframes = Object.fromEntries(
    PA_TIMEFRAMES.map((timeframe) => [
      timeframe,
      candlesByTimeframe[timeframe] ? buildPAFacts(candlesByTimeframe[timeframe], timeframe) : unavailableFacts(timeframe),
    ]),
  ) as Record<Timeframe, PAFacts>;
  const ready = PA_TIMEFRAMES.map((timeframe) => timeframes[timeframe]).filter((facts) => facts.data.status === "ready");
  const directional = ready.map((facts) => facts.structure.trend).filter((trend): trend is Trend => trend != null);
  const bullish = directional.filter((trend) => trend === "上升").length;
  const bearish = directional.filter((trend) => trend === "下降").length;
  const confirmed: string[] = [];
  const waiting: string[] = [];
  if (timeframes["1w"].structure.trend === "上升") confirmed.push("週線結構上升");
  if (timeframes["1d"].structure.trend === "上升") confirmed.push("日線結構上升");
  if (timeframes["1w"].data.status !== "ready") waiting.push("等待週線資料確認大方向");
  if (timeframes["1d"].data.status !== "ready") waiting.push("等待日線資料確認主要結構");
  if (timeframes["60m"].data.status !== "ready") waiting.push("等待 60 分資料尋找進場區");
  if (timeframes["15m"].data.status !== "ready") waiting.push("等待 15 分資料確認觸發 K");
  const allReady = ready.length === PA_TIMEFRAMES.length;
  const direction = bullish > bearish ? "多方" : bearish > bullish ? "空方" : directional.length ? "中性" : null;
  const alignment = !directional.length || ready.length < 2 || !allReady
    ? "insufficient"
    : allReady && (bullish === directional.length || bearish === directional.length)
      ? "aligned"
      : "mixed";
  const score = computeAlignmentScore(timeframes);
  return { version: PA_FACTS_VERSION, symbol, timeframes, alignment: { status: alignment, direction, score, confirmed, waiting } };
}

/**
 * 加權一致性分數：週線 40%／日線 30%／60分 20%／15分 10%。
 * 上升 = +1、下降 = -1、震盪 = 0，依權重加總後除以「有資料時框」的權重總和（正規化），
 * 缺資料時框不計入分母，避免資料不齊時分數被稀釋到看起來比實際更中性。
 */
const ALIGNMENT_WEIGHTS: Record<Timeframe, number> = { "1w": 0.4, "1d": 0.3, "60m": 0.2, "15m": 0.1 };

function trendScore(trend: Trend | null): number {
  if (trend === "上升") return 1;
  if (trend === "下降") return -1;
  return 0;
}

function computeAlignmentScore(timeframes: Record<Timeframe, PAFacts>): number | null {
  let weightSum = 0;
  let scoreSum = 0;
  for (const timeframe of PA_TIMEFRAMES) {
    const facts = timeframes[timeframe];
    if (facts.data.status !== "ready") continue;
    const weight = ALIGNMENT_WEIGHTS[timeframe];
    weightSum += weight;
    scoreSum += weight * trendScore(facts.structure.trend);
  }
  if (weightSum === 0) return null;
  return Math.round((scoreSum / weightSum) * 100);
}
