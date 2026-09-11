import type { Candle } from "./types";

/**
 * 純函式指標層（v0）：MA／量均線／BIAS——可重現、可單測，策略層唯一指標來源。
 * 與 levels.ts（PA 事實）同層：策略條件只能引用這裡與 PA 事實，不得自行發明數值。
 */

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

const MA_PERIODS = [5, 21, 25, 60, 200] as const;
const VOL_MA_PERIODS = [5, 60] as const;

export interface IndicatorFacts {
  candles: number;
  /** 各期均線（最新值）；資料不足該期為 null */
  ma: Record<number, number | null>;
  /** 前一日均線值（斜率用） */
  maPrev: Record<number, number | null>;
  /** MA200 與 5 日前比較（長期斜率向上？） */
  ma200Rising: boolean;
  volMa: Record<number, number | null>;
  volMaPrev: Record<number, number | null>;
  /** 乖離率 %（目前僅 BIAS(5)） */
  bias: Record<number, number | null>;
  /** 連續收盤站上均線的天數（自最後一日回數） */
  daysAboveMa: Record<number, number>;
  /** 今日量 ÷ 5 日均量 */
  volumeRatio5: number | null;
  /** 最後一根 K 的基本屬性 */
  lastVolume: number;
  lastLow: number;
  isBullCandle: boolean;
  isBearCandle: boolean;
  prevLow: number | null;
  prevHigh: number | null;
}

export function buildIndicatorFacts(candles: Candle[]): IndicatorFacts | null {
  if (candles.length < 6) return null;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const ma: Record<number, number | null> = {};
  const maPrev: Record<number, number | null> = {};
  const daysAboveMa: Record<number, number> = {};
  for (const p of MA_PERIODS) {
    const s = smaSeries(closes, p);
    ma[p] = s[s.length - 1] ?? null;
    maPrev[p] = s[s.length - 2] ?? null;
    if (ma[p] != null) {
      let n = 0;
      for (let i = candles.length - 1; i >= 0; i--) {
        const v = s[i];
        if (v != null && closes[i] > v) n += 1;
        else break;
      }
      daysAboveMa[p] = n;
    } else {
      daysAboveMa[p] = 0;
    }
  }
  const volMa: Record<number, number | null> = {};
  const volMaPrev: Record<number, number | null> = {};
  for (const p of VOL_MA_PERIODS) {
    const s = smaSeries(vols, p);
    volMa[p] = s[s.length - 1] ?? null;
    volMaPrev[p] = s[s.length - 2] ?? null;
  }
  const bias: Record<number, number | null> = {};
  for (const p of [5] as const) {
    const v = ma[p];
    bias[p] = v != null && v !== 0 ? ((last.close - v) / v) * 100 : null;
  }
  const v5 = volMa[5];
  const s200 = smaSeries(closes, 200);
  const ma200Cur = s200[s200.length - 1] ?? null;
  const ma200Back = s200[s200.length - 6] ?? null;
  return {
    candles: candles.length,
    ma,
    maPrev,
    ma200Rising: ma200Cur != null && ma200Back != null && ma200Cur > ma200Back,
    volMa,
    volMaPrev,
    bias,
    daysAboveMa,
    volumeRatio5: v5 != null && v5 > 0 ? last.volume / v5 : null,
    lastVolume: last.volume,
    lastLow: last.low,
    isBullCandle: last.close > last.open,
    isBearCandle: last.close < last.open,
    prevLow: candles.length >= 2 ? candles[candles.length - 2].low : null,
    prevHigh: candles.length >= 2 ? candles[candles.length - 2].high : null,
  };
}
