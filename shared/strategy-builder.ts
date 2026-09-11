/**
 * 自訂策略條件組合器（Phase 3+）
 *
 * 設計原則：
 * 1. 條件只能引用 PA 事實（levels.ts）與指標事實（indicators.ts）
 * 2. 所有計算為純函式，無副作用，可重現
 * 3. 不直接引用原始 K 線——策略層只讀 facts/ind，不碰資料源
 */

import type { Candle } from "./types";
import type { MarketFacts } from "./levels";
import type { IndicatorFacts } from "./indicators";

/* ---------- 條件型別 ---------- */

/** 運算子：and/or 用於多條件組合 */
export type LogicOp = "and" | "or";

/** 條件運算子型別 */
export type CondType =
  | "ma_cross_up"       // MA 短上穿長
  | "ma_cross_down"     // MA 短下穿長
  | "price_above_ma"    // 收盤 > MA
  | "price_below_ma"    // 收盤 < MA
  | "volume_spike"      // 成交量放大
  | "bias_extreme"      // BIAS 極值
  | "support_near"      // 距離支撐一定範圍內
  | "resistance_near"   // 距離壓力一定範圍內
  | "days_above_ma"     // 連續站在 MA 上方天數
  | "trend_up"          // 趨勢向上
  | "trend_down"        // 趨勢向下
  | "swing_high_near"   // 接近近期高點
  | "swing_low_near"    // 接近近期低點
  | "volume_ratio_gt"   // 量比 > N
  | "volume_ratio_lt"   // 量比 < N
  | "slope_positive"    // MA 斜率向上
  | "slope_negative"    // MA 斜率向下
  | "is_bull_candle"    // 收陽線
  | "is_bear_candle";   // 收陰線

/** 單筆條件定義 */
export interface Condition {
  id: string;
  type: CondType;
  params: Record<string, number | string | boolean>;
  /** 說明文字（供 UI 顯示） */
  label?: string;
}

/** 條件群組（filters / triggers / invalidations） */
export interface ConditionGroup {
  logic: LogicOp;
  conditions: Condition[];
}

/* ---------- 策略定義 ---------- */

export interface UserStrategyDef {
  id: string;
  userId: string;
  name: string;
  desc: string;
  filters: ConditionGroup;           // 前置過濾
  triggers: ConditionGroup;          // 進場觸發
  invalidations: ConditionGroup;     // 失效條件
  createdAt: string;
  updatedAt: string;
}

/* ---------- 條件評估引擎 ---------- */

interface EvalCtx {
  facts: MarketFacts | null;
  ind: IndicatorFacts | null;
  candles: Candle[];
  close: number | null;
  open: number | null;
  volume: number | null;
}

/** 評估單筆條件，回傳 { met: boolean; reason: string } */
export function evalCondition(ctx: EvalCtx, cond: Condition): { met: boolean; reason: string } {
  const { facts, ind, candles, close, open, volume } = ctx;
  const p = cond.params;

  switch (cond.type) {
    case "ma_cross_up": {
      const maShort = Number(p.maShort ?? 5);
      const maLong = Number(p.maLong ?? 21);
      if (!ind?.ma[maShort] || !ind?.ma[maLong]) return { met: false, reason: `MA${maShort} 或 MA${maLong} 資料不足` };
      const prevShort = ind.maPrev?.[maShort] ?? ind.ma[maShort];
      const prevLong = ind.maPrev?.[maLong] ?? ind.ma[maLong];
      if (prevShort == null || prevLong == null) return { met: false, reason: "均線資料不足" };
      const met = prevShort <= prevLong && ind.ma[maShort]! > ind.ma[maLong]!;
      return { met, reason: met ? `MA${maShort} 上穿 MA${maLong}` : `MA${maShort} 尚未上穿 MA${maLong}` };
    }

    case "ma_cross_down": {
      const maShort = Number(p.maShort ?? 5);
      const maLong = Number(p.maLong ?? 21);
      if (!ind?.ma[maShort] || !ind?.ma[maLong]) return { met: false, reason: `MA${maShort} 或 MA${maLong} 資料不足` };
      const prevShort = ind.maPrev?.[maShort] ?? ind.ma[maShort];
      const prevLong = ind.maPrev?.[maLong] ?? ind.ma[maLong];
      if (prevShort == null || prevLong == null) return { met: false, reason: "均線資料不足" };
      const met = prevShort >= prevLong && ind.ma[maShort]! < ind.ma[maLong]!;
      return { met, reason: met ? `MA${maShort} 下穿 MA${maLong}` : `MA${maShort} 尚未下穿 MA${maLong}` };
    }

    case "price_above_ma": {
      const ma = Number(p.ma ?? 21);
      if (!ind?.ma[ma] || close == null) return { met: false, reason: "資料不足" };
      const met = close > ind.ma[ma]!;
      return { met, reason: met ? `收盤 ${close} > MA${ma} ${ind.ma[ma].toFixed(0)}` : `收盤 ${close} < MA${ma} ${ind.ma[ma].toFixed(0)}` };
    }

    case "price_below_ma": {
      const ma = Number(p.ma ?? 21);
      if (!ind?.ma[ma] || close == null) return { met: false, reason: "資料不足" };
      const met = close < ind.ma[ma]!;
      return { met, reason: met ? `收盤 ${close} < MA${ma} ${ind.ma[ma].toFixed(0)}` : `收盤 ${close} > MA${ma} ${ind.ma[ma].toFixed(0)}` };
    }

    case "volume_spike": {
      const ratio = Number(p.ratio ?? 1.5);
      if (ind?.volumeRatio5 == null) return { met: false, reason: "量比資料不足" };
      const met = ind.volumeRatio5 >= ratio;
      return { met, reason: met ? `量比 ${ind.volumeRatio5.toFixed(2)}× ≥ ${ratio}×` : `量比 ${ind.volumeRatio5.toFixed(2)}× < ${ratio}×` };
    }

    case "bias_extreme": {
      const threshold = Number(p.threshold ?? -3);
      if (ind?.bias[5] == null) return { met: false, reason: "BIAS 資料不足" };
      const met = ind.bias[5]! <= threshold;
      return { met, reason: met ? `BIAS(5) ${ind.bias[5].toFixed(2)}% ≤ ${threshold}%（超賣）` : `BIAS(5) ${ind.bias[5].toFixed(2)}% > ${threshold}%` };
    }

    case "support_near": {
      if (!facts?.support || close == null) return { met: false, reason: "支撐未確認" };
      const tolerancePct = Number(p.tolerance ?? 5);
      const dist = ((close - facts.support.low) / facts.support.low) * 100;
      const met = dist >= 0 && dist <= tolerancePct;
      return { met, reason: met ? `收盤距支撐 ${(dist).toFixed(1)}%（容差 ${tolerancePct}%）` : `收盤距支撐 ${dist.toFixed(1)}%` };
    }

    case "resistance_near": {
      if (!facts?.resistance || close == null) return { met: false, reason: "壓力未確認" };
      const tolerancePct = Number(p.tolerance ?? 3);
      const dist = ((facts.resistance.high - close) / facts.resistance.high) * 100;
      const met = dist >= 0 && dist <= tolerancePct;
      return { met, reason: met ? `收盤距壓力 ${(dist).toFixed(1)}%` : `收盤距壓力 ${dist.toFixed(1)}%` };
    }

    case "days_above_ma": {
      const ma = Number(p.ma ?? 21);
      const minDays = Number(p.minDays ?? 1);
      if (ind?.daysAboveMa[ma] == null) return { met: false, reason: `MA${ma} 資料不足` };
      const met = ind.daysAboveMa[ma] >= minDays;
      return { met, reason: met ? `連續 ${ind.daysAboveMa[ma]} 天站穩 MA${ma}` : `僅站穩 ${ind.daysAboveMa[ma]} 天（需 ≥ ${minDays}）` };
    }

    case "trend_up": {
      if (!facts) return { met: false, reason: "PA 事實資料不足" };
      const met = facts.trend === "上升";
      return { met, reason: met ? "趨勢向上" : `趨勢：${facts.trend}` };
    }

    case "trend_down": {
      if (!facts) return { met: false, reason: "PA 事實資料不足" };
      const met = facts.trend === "下降";
      return { met, reason: met ? "趨勢向下" : `趨勢：${facts.trend}` };
    }

    case "swing_high_near": {
      if (!facts?.swings?.lastHigh || close == null) return { met: false, reason: " Swing 資料不足" };
      const pct = ((close - facts.swings.lastHigh.price) / facts.swings.lastHigh.price) * 100;
      const tolerance = Number(p.tolerance ?? 3);
      const met = pct >= -tolerance && pct <= tolerance;
      return { met, reason: met ? `收盤距前高 ${(pct).toFixed(1)}%` : `收盤距前高 ${pct.toFixed(1)}%` };
    }

    case "swing_low_near": {
      if (!facts?.swings?.lastLow || close == null) return { met: false, reason: "Swing 資料不足" };
      const pct = ((close - facts.swings.lastLow.price) / facts.swings.lastLow.price) * 100;
      const tolerance = Number(p.tolerance ?? 3);
      const met = pct >= -tolerance && pct <= tolerance;
      return { met, reason: met ? `收盤距前低 ${(pct).toFixed(1)}%` : `收盤距前低 ${pct.toFixed(1)}%` };
    }

    case "volume_ratio_gt": {
      const threshold = Number(p.threshold ?? 1.5);
      if (ind?.volumeRatio5 == null) return { met: false, reason: "量比資料不足" };
      const met = ind.volumeRatio5 >= threshold;
      return { met, reason: met ? `量比 ${ind.volumeRatio5.toFixed(2)}× ≥ ${threshold}×` : `量比 ${ind.volumeRatio5.toFixed(2)}× < ${threshold}×` };
    }

    case "volume_ratio_lt": {
      const threshold = Number(p.threshold ?? 0.5);
      if (ind?.volumeRatio5 == null) return { met: false, reason: "量比資料不足" };
      const met = ind.volumeRatio5 <= threshold;
      return { met, reason: met ? `量比 ${ind.volumeRatio5.toFixed(2)}× ≤ ${threshold}×（地量）` : `量比 ${ind.volumeRatio5.toFixed(2)}× > ${threshold}×` };
    }

    case "slope_positive": {
      const ma = Number(p.ma ?? 21);
      if (ind?.ma[ma] == null || ind?.maPrev?.[ma] == null) return { met: false, reason: `MA${ma} 斜率資料不足` };
      const met = ind.ma[ma]! > ind.maPrev[ma]!;
      return { met, reason: met ? `MA${ma} 斜率向上` : `MA${ma} 斜率持平或向下` };
    }

    case "slope_negative": {
      const ma = Number(p.ma ?? 21);
      if (ind?.ma[ma] == null || ind?.maPrev?.[ma] == null) return { met: false, reason: `MA${ma} 斜率資料不足` };
      const met = ind.ma[ma]! < ind.maPrev[ma]!;
      return { met, reason: met ? `MA${ma} 斜率向下` : `MA${ma} 斜率持平或向上` };
    }

    case "is_bull_candle": {
      const met = ind?.isBullCandle ?? false;
      return { met, reason: met ? "收陽線" : "收陰線" };
    }

    case "is_bear_candle": {
      const met = ind?.isBearCandle ?? false;
      return { met, reason: met ? "收陰線" : "收陽線" };
    }

    default:
      return { met: false, reason: `未知條件型別：${cond.type}` };
  }
}

/** 評估一組條件（and/or 邏輯） */
function evalGroup(ctx: EvalCtx, group: ConditionGroup): { met: boolean; details: Array<{ type: string; met: boolean; reason: string }> } {
  const results = group.conditions.map((cond) => ({
    type: cond.type,
    ...evalCondition(ctx, cond),
  }));
  const met = group.logic === "and"
    ? results.every((r) => r.met)
    : results.some((r) => r.met);
  return { met, details: results };
}

/** 評估用戶策略，回傳評估結果 */
export function evaluateUserStrategy(
  strategy: UserStrategyDef,
  ctx: EvalCtx,
): {
  status: "triggered" | "waiting" | "no-trade" | "insufficient";
  metFilters: string[];
  missingFilters: string[];
  metTriggers: string[];
  missingTriggers: string[];
  metInvalidations: string[];
  note: string;
} {
  // 前置檢查
  if (!ctx.facts || !ctx.ind || ctx.candles.length < 30) {
    return {
      status: "insufficient",
      metFilters: [],
      missingFilters: ["PA 事實或指標資料不足（需 ≥30 根 K 線）"],
      metTriggers: [],
      missingTriggers: [],
      metInvalidations: [],
      note: "資料不足，無法評估此策略",
    };
  }

  // 1. 過濾條件（所有 met = 才通過）
  const filterResult = evalGroup(ctx, strategy.filters);
  if (!filterResult.met) {
    return {
      status: "no-trade",
      metFilters: filterResult.details.filter((d) => d.met).map((d) => d.reason),
      missingFilters: filterResult.details.filter((d) => !d.met).map((d) => d.reason),
      metTriggers: [],
      missingTriggers: [],
      metInvalidations: [],
      note: filterResult.details.filter((d) => !d.met).map((d) => d.reason).join("；"),
    };
  }

  // 2. 失效條件（任一 met = 不交易）
  const invalidResult = evalGroup(ctx, strategy.invalidations);
  if (invalidResult.met) {
    return {
      status: "no-trade",
      metFilters: filterResult.details.map((d) => d.reason),
      missingFilters: [],
      metTriggers: [],
      missingTriggers: [],
      metInvalidations: invalidResult.details.map((d) => d.reason),
      note: `失效條件觸發：${invalidResult.details.filter((d) => d.met).map((d) => d.reason).join("、")}`,
    };
  }

  // 3. 觸發條件（and = 全部 met，or = 任一 met）
  const triggerResult = evalGroup(ctx, strategy.triggers);
  if (triggerResult.met) {
    return {
      status: "triggered",
      metFilters: filterResult.details.map((d) => d.reason),
      missingFilters: [],
      metTriggers: triggerResult.details.filter((d) => d.met).map((d) => d.reason),
      missingTriggers: triggerResult.details.filter((d) => !d.met).map((d) => d.reason),
      metInvalidations: [],
      note: triggerResult.details.filter((d) => d.met).map((d) => d.reason).join("；"),
    };
  }

  return {
    status: "waiting",
    metFilters: filterResult.details.filter((d) => d.met).map((d) => d.reason),
    missingFilters: filterResult.details.filter((d) => !d.met).map((d) => d.reason),
    metTriggers: triggerResult.details.filter((d) => d.met).map((d) => d.reason),
    missingTriggers: triggerResult.details.filter((d) => !d.met).map((d) => d.reason),
    metInvalidations: [],
    note: `條件未齊：${triggerResult.details.filter((d) => !d.met).map((d) => d.reason).join("、")}`,
  };
}

/* ---------- 條件模板 ---------- */

/** 預設條件模板，供 UI 快速建立 */
export const CONDITION_TEMPLATES: Array<{
  type: CondType;
  label: string;
  defaultParams: Record<string, number | string>;
  description: string;
}> = [
  { type: "ma_cross_up", label: "MA 上穿", defaultParams: { maShort: 5, maLong: 21 }, description: "短期均線上穿長期均线" },
  { type: "price_above_ma", label: "收盤 > MA", defaultParams: { ma: 21 }, description: "收盤價高於指定均線" },
  { type: "volume_spike", label: "量能放大", defaultParams: { ratio: 1.5 }, description: "今日量 ≥ N 日均量" },
  { type: "bias_extreme", label: "BIAS 超賣", defaultParams: { threshold: -3 }, description: "BIAS(5) ≤ 閾值" },
  { type: "support_near", label: "接近支撐", defaultParams: { tolerance: 5 }, description: "收盤距支撐區一定範圍內" },
  { type: "days_above_ma", label: "站上 MA", defaultParams: { ma: 21, minDays: 1 }, description: "連續站在 MA 上方天數" },
  { type: "trend_up", label: "趨勢向上", defaultParams: {}, description: "PA 結構判定為上升趨勢" },
  { type: "is_bull_candle", label: "收陽線", defaultParams: {}, description: "今日收盤 > 開盤" },
  { type: "slope_positive", label: "MA 斜率向上", defaultParams: { ma: 21 }, description: "今日 MA > 昨日 MA" },
  { type: "swing_low_near", label: "接近前低", defaultParams: { tolerance: 3 }, description: "收盤距最近 Swing Low 一定範圍內" },
];
