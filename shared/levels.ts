import type { Candle } from "./types";

/**
 * v0 價位與結構計算（facts-lite）
 * 這是原型期的顯示層規則；Sprint 3 由 packages/facts（PA 事實層）取代並補齊完整 fixture。
 * 原則：純函式、同一輸入必產出同一輸出；證據不足一律回報「未確認」，不得強行辨識。
 */

export const LEVELS_VERSION = "v0.2";

export interface Pivot {
  index: number;
  time: string;
  price: number;
  kind: "H" | "L";
}

export interface KeyLevel {
  type: "支撐區" | "壓力區";
  low: number;
  high: number;
  touches: number;
  basis: string;
}

export interface PatternFinding {
  name: string;
  time: string;
  status: "已確認" | "未確認";
  note: string;
}

export interface MarketFacts {
  version: string;
  trend: "上升" | "下降" | "震盪";
  sequence: string;
  confidence: "高" | "中" | "低";
  support: KeyLevel | null;
  resistance: KeyLevel | null;
  /** 回踩觀察區（做多觀點，取支撐區） */
  entryZone: { low: number; high: number } | null;
  /** 結構失效位（做多觀點，支撐區下緣） */
  invalidation: number | null;
  /** 最後確認的轉折點（潮流策略：HL 之上回調） */
  swings: { lastHigh: Pivot | null; lastLow: Pivot | null };
  patterns: PatternFinding[];
  /** ATR(14)：用於進場區寬度與失效位緩衝，取代原本固定百分比（v0.2 新增） */
  atr: number | null;
}

const DEFAULT_LEFT = 3;
const DEFAULT_RIGHT = 3;

export function findPivots(candles: Candle[], left = DEFAULT_LEFT, right = DEFAULT_RIGHT): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: candles[i].time, price: candles[i].high, kind: "H" });
    if (isLow) pivots.push({ index: i, time: candles[i].time, price: candles[i].low, kind: "L" });
  }
  return pivots;
}

export function trendFromPivots(pivots: Pivot[]): { trend: MarketFacts["trend"]; sequence: string; confidence: MarketFacts["confidence"] } {
  const highs = pivots.filter((p) => p.kind === "H");
  const lows = pivots.filter((p) => p.kind === "L");
  if (highs.length >= 2 && lows.length >= 2) {
    const lastH = highs[highs.length - 1].price;
    const prevH = highs[highs.length - 2].price;
    const lastL = lows[lows.length - 1].price;
    const prevL = lows[lows.length - 2].price;
    const higherHigh = lastH > prevH;
    const higherLow = lastL > prevL;
    const lowerHigh = lastH < prevH;
    const lowerLow = lastL < prevL;
    if (higherHigh && higherLow) {
      return { trend: "上升", sequence: "HH、HL", confidence: pivots.length >= 6 ? "中" : "低" };
    }
    if (lowerHigh && lowerLow) {
      return { trend: "下降", sequence: "LH、LL", confidence: pivots.length >= 6 ? "中" : "低" };
    }
  }
  return { trend: "震盪", sequence: "高低點不明確", confidence: pivots.length >= 6 ? "中" : "低" };
}

export function clusterLevels(candles: Candle[], pivots: Pivot[]): KeyLevel[] {
  const last = candles[candles.length - 1];
  const close = last.close;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const tol = Math.max(close * 0.006, (maxHigh - minLow) * 0.01);

  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; low: number; high: number }[] = [];
  for (const p of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && p.price - cur.high <= tol) {
      cur.prices.push(p.price);
      cur.high = Math.max(cur.high, p.price);
    } else {
      clusters.push({ prices: [p.price], low: p.price, high: p.price });
    }
  }

  const levels: KeyLevel[] = [];
  for (const c of clusters) {
    const touches = c.prices.length;
    if (touches < 2) continue;
    const low = c.low;
    const high = c.high;
    if (low > close) {
      levels.push({ type: "壓力區", low, high, touches, basis: `前高密集區（${touches} 次觸及）` });
    } else if (high < close) {
      levels.push({ type: "支撐區", low, high, touches, basis: `前低密集區（${touches} 次觸及）` });
    }
  }
  // 證據不足時允許單點價位，但標示僅一次觸及
  if (levels.length === 0) {
    for (const c of clusters) {
      if (c.low > close) levels.push({ type: "壓力區", low: c.low, high: c.high, touches: 1, basis: "前高（僅 1 次觸及，證據弱）" });
      else if (c.high < close) levels.push({ type: "支撐區", low: c.low, high: c.high, touches: 1, basis: "前低（僅 1 次觸及，證據弱）" });
    }
  }
  return levels;
}

/**
 * ATR（Average True Range，簡化版：近 period 根 True Range 的簡單平均，非 Wilder 平滑）。
 * 用途：取代進場區寬度／失效位緩衝原本的固定百分比，讓寬度隨個股實際波動度調整。
 * 資料不足時回傳 null，不得用預設值假裝有效。
 */
export function calculateATR(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    trueRanges.push(tr);
  }
  const recent = trueRanges.slice(-period);
  return recent.reduce((sum, v) => sum + v, 0) / recent.length;
}

function bodyOf(c: Candle) {
  return { top: Math.max(c.open, c.close), bottom: Math.min(c.open, c.close), bull: c.close >= c.open };
}

export function detectCandlePatterns(candles: Candle[], lookback = 3): PatternFinding[] {
  const findings: PatternFinding[] = [];
  const start = Math.max(1, candles.length - lookback);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const { top, bottom, bull } = bodyOf(c);
    const body = top - bottom;
    const lowerWick = bottom - c.low;
    const upperWick = c.high - top;
    const isLast = i === candles.length - 1;
    const status: PatternFinding["status"] = isLast ? "未確認" : "已確認";
    const noteSuffix = isLast ? "（最後一根 K 尚未收確認，待下一根 K 驗證）" : "";

    if (bull && body > 0 && lowerWick >= 2 * body && lowerWick >= 0.5 * range) {
      findings.push({ name: "多頭 Pin Bar", time: c.time, status, note: `長下影線占全 K ${Math.round((lowerWick / range) * 100)}%，買方承接${noteSuffix}` });
    }
    if (!bull && body > 0 && upperWick >= 2 * body && upperWick >= 0.5 * range) {
      findings.push({ name: "空頭 Pin Bar", time: c.time, status, note: `長上影線占全 K ${Math.round((upperWick / range) * 100)}%，賣方壓制${noteSuffix}` });
    }
    const prevBody = bodyOf(prev);
    const prevRange = prev.high - prev.low;
    if (prevRange > 0 && body > prevBody.top - prevBody.bottom) {
      if (bull && !prevBody.bull && c.open <= prevBody.bottom && c.close >= prevBody.top) {
        findings.push({ name: "多頭吞沒", time: c.time, status, note: "實體完全包住前一根陰線，買方接管" + noteSuffix });
      }
      if (!bull && prevBody.bull && c.open >= prevBody.top && c.close <= prevBody.bottom) {
        findings.push({ name: "空頭吞沒", time: c.time, status, note: "實體完全包住前一根陽線，賣方接管" + noteSuffix });
      }
    }
  }
  return findings;
}

/**
 * 經典擺盪型態（雙頂/雙底、頭肩頂/底），純粹以已找到的轉折點（pivots）比對，不額外掃 K 線。
 * 「已確認」＝頸線已被最後收盤價跌破/突破；「未確認」＝型態雛形已現但頸線尚未確認。
 */
export function detectSwingPatterns(candles: Candle[], pivots: Pivot[]): PatternFinding[] {
  const findings: PatternFinding[] = [];
  if (candles.length === 0) return findings;
  const lastClose = candles[candles.length - 1].close;
  const lastTime = candles[candles.length - 1].time;
  const highs = pivots.filter((p) => p.kind === "H");
  const lows = pivots.filter((p) => p.kind === "L");
  const TOL = 0.03; // 兩個高點/低點視為同一價位的容忍度（3%）

  // 雙頂：最後兩個高點價位相近，中間夾一個明顯較低的低點（頸線）
  if (highs.length >= 2) {
    const h2 = highs[highs.length - 1];
    const h1 = highs[highs.length - 2];
    if (Math.abs(h2.price - h1.price) / h1.price <= TOL) {
      const neckline = lows.filter((l) => l.index > h1.index && l.index < h2.index).sort((a, b) => a.price - b.price)[0];
      if (neckline && neckline.price < Math.min(h1.price, h2.price) * (1 - TOL)) {
        const confirmed = lastClose < neckline.price;
        findings.push({
          name: "雙頂",
          time: lastTime,
          status: confirmed ? "已確認" : "未確認",
          note: `兩次觸及約 ${h1.price.toFixed(0)} 附近高點，頸線 ${neckline.price.toFixed(0)}${confirmed ? "已跌破，型態確認" : "尚未跌破，型態未確認"}`,
        });
      }
    }
  }

  // 雙底：鏡像邏輯
  if (lows.length >= 2) {
    const l2 = lows[lows.length - 1];
    const l1 = lows[lows.length - 2];
    if (Math.abs(l2.price - l1.price) / l1.price <= TOL) {
      const neckline = highs.filter((h) => h.index > l1.index && h.index < l2.index).sort((a, b) => b.price - a.price)[0];
      if (neckline && neckline.price > Math.max(l1.price, l2.price) * (1 + TOL)) {
        const confirmed = lastClose > neckline.price;
        findings.push({
          name: "雙底",
          time: lastTime,
          status: confirmed ? "已確認" : "未確認",
          note: `兩次觸及約 ${l1.price.toFixed(0)} 附近低點，頸線 ${neckline.price.toFixed(0)}${confirmed ? "已突破，型態確認" : "尚未突破，型態未確認"}`,
        });
      }
    }
  }

  // 頭肩頂：連續三個高點，中間（頭）明顯高於左右兩肩，兩肩價位相近
  if (highs.length >= 3) {
    const [shoulder1, head, shoulder2] = highs.slice(-3);
    const headHigher = head.price > shoulder1.price * (1 + TOL) && head.price > shoulder2.price * (1 + TOL);
    const shouldersEven = Math.abs(shoulder1.price - shoulder2.price) / shoulder1.price <= TOL * 2;
    if (headHigher && shouldersEven) {
      const necklineLows = lows.filter((l) => l.index > shoulder1.index && l.index < shoulder2.index);
      const neckline = necklineLows.length ? Math.min(...necklineLows.map((l) => l.price)) : null;
      if (neckline != null) {
        const confirmed = lastClose < neckline;
        findings.push({
          name: "頭肩頂",
          time: lastTime,
          status: confirmed ? "已確認" : "未確認",
          note: `頭部 ${head.price.toFixed(0)} 明顯高於兩肩，頸線約 ${neckline.toFixed(0)}${confirmed ? "已跌破，型態確認" : "尚未跌破，型態未確認"}`,
        });
      }
    }
  }

  // 頭肩底：鏡像邏輯
  if (lows.length >= 3) {
    const [shoulder1, head, shoulder2] = lows.slice(-3);
    const headLower = head.price < shoulder1.price * (1 - TOL) && head.price < shoulder2.price * (1 - TOL);
    const shouldersEven = Math.abs(shoulder1.price - shoulder2.price) / shoulder1.price <= TOL * 2;
    if (headLower && shouldersEven) {
      const necklineHighs = highs.filter((h) => h.index > shoulder1.index && h.index < shoulder2.index);
      const neckline = necklineHighs.length ? Math.max(...necklineHighs.map((h) => h.price)) : null;
      if (neckline != null) {
        const confirmed = lastClose > neckline;
        findings.push({
          name: "頭肩底",
          time: lastTime,
          status: confirmed ? "已確認" : "未確認",
          note: `頭部 ${head.price.toFixed(0)} 明顯低於兩肩，頸線約 ${neckline.toFixed(0)}${confirmed ? "已突破，型態確認" : "尚未突破，型態未確認"}`,
        });
      }
    }
  }

  return findings;
}

/**
 * 量價背離：價格創高/低但成交量未同步放大，代表動能減弱（不代表立即反轉，僅列為觀察證據）。
 * 用轉折點當根 K 棒的成交量比較，維持與 findPivots 相同的單根判斷邏輯，確保決定性。
 */
export function detectVolumeDivergence(candles: Candle[], pivots: Pivot[]): PatternFinding[] {
  const findings: PatternFinding[] = [];
  if (candles.length === 0) return findings;
  const lastTime = candles[candles.length - 1].time;
  const volumeAt = (index: number) => candles[index]?.volume ?? 0;
  const highs = pivots.filter((p) => p.kind === "H");
  const lows = pivots.filter((p) => p.kind === "L");

  if (highs.length >= 2) {
    const h2 = highs[highs.length - 1];
    const h1 = highs[highs.length - 2];
    if (h2.price > h1.price && volumeAt(h2.index) < volumeAt(h1.index)) {
      findings.push({
        name: "頂背離",
        time: lastTime,
        status: "已確認",
        note: `價格創高（${h1.price.toFixed(0)} → ${h2.price.toFixed(0)}）但成交量未跟上，動能可能減弱`,
      });
    }
  }

  if (lows.length >= 2) {
    const l2 = lows[lows.length - 1];
    const l1 = lows[lows.length - 2];
    if (l2.price < l1.price && volumeAt(l2.index) < volumeAt(l1.index)) {
      findings.push({
        name: "底背離",
        time: lastTime,
        status: "已確認",
        note: `價格創低（${l1.price.toFixed(0)} → ${l2.price.toFixed(0)}）但成交量未跟上，賣壓可能衰竭`,
      });
    }
  }

  return findings;
}

/** 主入口：K 線 → 市場事實。資料不足回傳 null，不得編造。 */
export function buildMarketFacts(candles: Candle[]): MarketFacts | null {
  if (!candles || candles.length < 30) return null;
  const pivots = findPivots(candles);
  const { trend, sequence, confidence } = trendFromPivots(pivots);
  const levels = clusterLevels(candles, pivots);
  const close = candles[candles.length - 1].close;
  const supports = levels.filter((l) => l.type === "支撐區").sort((a, b) => b.low - a.low);
  const resistances = levels.filter((l) => l.type === "壓力區").sort((a, b) => a.low - b.low);
  const support = supports[0] ?? null;
  const resistance = resistances[0] ?? null;
  const atr = calculateATR(candles, 14);
  const patterns = [
    ...detectCandlePatterns(candles),
    ...detectSwingPatterns(candles, pivots),
    ...detectVolumeDivergence(candles, pivots),
  ];
  // 回踩觀察區位於支撐區上方。寬度改用 ATR 為主（隨個股實際波動度調整），
  // 資料不足以算出 ATR 時退回原本的支撐區寬度百分比，不讓功能整組失效。
  const zoneWidth = atr ?? (support ? (support.high - support.low) * 0.75 : 0);
  const entryZone = support ? { low: support.high, high: support.high + zoneWidth } : null;
  // 失效位在支撐區下緣再扣一小段 ATR 緩衝，避免正常雜訊震盪就被誤判為「結構已破」。
  const invalidation = support ? support.low - (atr ?? 0) * 0.25 : null;
  const lastHigh = [...pivots].reverse().find((p) => p.kind === "H") ?? null;
  const lastLow = [...pivots].reverse().find((p) => p.kind === "L") ?? null;
  return {
    version: LEVELS_VERSION,
    trend,
    sequence,
    confidence,
    support,
    resistance,
    entryZone,
    invalidation,
    swings: { lastHigh, lastLow },
    patterns,
    atr,
  };
}

/** 由事實推導 R:R（做多條件式情境用）；證據不足回傳 null */
export function estimateRiskReward(facts: MarketFacts, close: number): { entry: [number, number]; stop: number; target1: number; target2: number; rr1: number | null } | null {
  if (!facts.entryZone || facts.invalidation == null) return null;
  const entryLow = facts.entryZone.low;
  const entryHigh = facts.entryZone.high;
  const entryMid = (entryLow + entryHigh) / 2;
  const stop = facts.invalidation;
  const risk = entryMid - stop;
  if (risk <= 0) return null;
  const target1 = facts.resistance ? facts.resistance.low : close + risk * 2;
  const target2 = facts.resistance ? facts.resistance.high + risk : close + risk * 4;
  return { entry: [entryLow, entryHigh], stop, target1, target2, rr1: (target1 - entryMid) / risk };
}
