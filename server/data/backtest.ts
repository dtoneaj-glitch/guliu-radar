/**
 * 回測引擎（Phase 3+）
 *
 * 運作方式：
 * 1. 從 Yahoo Finance 或本地存檔取得歷史 K 線
 * 2. 逐根 K 線計算 PA 事實與指標
 * 3. 套用策略條件，記錄進場/出場訊號
 * 4. 計算勝率、平均報酬、最大回撤等指標
 *
 * 風險管理：
 * - 每次進場設定固定 R/R（例如 1:2）
 * - 停損 = 結構失效位（若有）或固定比例
 * - 止盈 = 目標價位或移動停利
 */

import type { Candle, BacktestResult, BacktestStats, BacktestSignal, BacktestParams as SharedBacktestParams } from "../../shared/types";
import type { MarketFacts } from "../../shared/levels";
import type { IndicatorFacts } from "../../shared/indicators";
import type { UserStrategyDef, ConditionGroup } from "../../shared/strategy-builder";
import { evaluateUserStrategy, evalCondition } from "../../shared/strategy-builder";
import { buildMarketFacts } from "../../shared/levels";
import { buildIndicatorFacts } from "../../shared/indicators";
import { getCachedCandles } from "./providers/yahoo-cache";
import { fetchYahooCandles, ySymbolCandidates } from "./providers/yahoo";

/** 內部回測參數（含 strategy 物件） */
export interface BacktestParams extends SharedBacktestParams {
  strategy: UserStrategyDef;
  initialCapital?: number;
  riskPctPerTrade?: number;
}

/* ---------- 回測核心 ---------- */

/** 執行單檔股回測 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const {
    symbol,
    strategy,
    rangeDays = 365,
    initialCapital = 1000000,
    riskPctPerTrade = 0.02,
    stopLossPct = 0.05,
    takeProfitRatio = 2,
    maxHoldDays = 20,
  } = params;

  // 取得歷史 K 線
  const candles = await fetchHistoricalCandles(symbol, rangeDays);
  if (candles.length < 60) {
    return buildEmptyResult(symbol, strategy, candles.length);
  }

  // 逐根 K 線模擬
  const signals: BacktestSignal[] = [];
  const equityCurve: number[] = [initialCapital];
  const dailyPnl: Array<{ date: string; pnl: number }> = [];

  let position: {
    entryIndex: number;
    entryDate: string;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    enteredAt: Date;
  } | null = null;

  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let wins = 0;
  let losses = 0;
  let totalReturn = 0;
  let winAmounts: number[] = [];
  let lossAmounts: number[] = [];
  let holdDaysList: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const currentCandle = candles[i];
    const prevCandle = candles[i - 1];

    // 計算事實
    const facts = buildMarketFacts(candles.slice(0, i + 1).slice(-130));
    const ind = buildIndicatorFacts(candles.slice(0, i + 1));

    if (!facts || !ind) continue;

    const ctx = {
      facts,
      ind,
      candles: candles.slice(0, i + 1),
      close: currentCandle.close ?? null,
      open: currentCandle.open ?? null,
      volume: currentCandle.volume ?? null,
    };

    // 評估策略
    const result = evaluateUserStrategy(strategy, ctx);

    // 出場邏輯（若已有部位）
    if (position) {
      const daysHeld = i - position.entryIndex;
      const currentPrice = currentCandle.close ?? currentCandle.high;

      // 停損觸發
      if (currentPrice <= position.stopPrice) {
        const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
        const pnlAmount = pnlPct * initialCapital * riskPctPerTrade / Math.abs(pnlPct) || pnlPct * position.entryPrice * (initialCapital * riskPctPerTrade / position.stopPrice);
        signals.push({
          index: i,
          date: currentCandle.time,
          type: "exit_loss",
          price: currentPrice,
          reason: `停損出場：${currentPrice.toFixed(0)}`,
          rr: pnlPct / stopLossPct,
        });
        losses++;
        lossAmounts.push(pnlPct);
        consecutiveLosses++;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        holdDaysList.push(daysHeld);
        position = null;
        continue;
      }

      // 止盈觸發
      if (currentPrice >= position.targetPrice) {
        const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
        signals.push({
          index: i,
          date: currentCandle.time,
          type: "exit_win",
          price: currentPrice,
          reason: `停利出場：${currentPrice.toFixed(0)}`,
          rr: pnlPct / stopLossPct,
        });
        wins++;
        winAmounts.push(pnlPct);
        consecutiveLosses = 0;
        holdDaysList.push(daysHeld);
        position = null;
        continue;
      }

      // 超時出場
      if (daysHeld >= maxHoldDays) {
        const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
        signals.push({
          index: i,
          date: currentCandle.time,
          type: "exit_timeout",
          price: currentPrice,
          reason: `持有 ${daysHeld} 天超時出場`,
          rr: pnlPct / stopLossPct,
        });
        if (pnlPct >= 0) wins++;
        else losses++;
        if (pnlPct >= 0) winAmounts.push(pnlPct);
        else lossAmounts.push(pnlPct);
        consecutiveLosses = pnlPct < 0 ? consecutiveLosses + 1 : 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        holdDaysList.push(daysHeld);
        position = null;
        continue;
      }
    }

    // 入場邏輯（無部位時）
    if (!position && result.status === "triggered") {
      const entryPrice = currentCandle.close ?? currentCandle.high;
      // 停損價 = 結構失效位或固定比例
      const stopPrice = facts.invalidation ?? entryPrice * (1 - stopLossPct);
      // 止盈價
      const risk = entryPrice - stopPrice;
      const targetPrice = entryPrice + risk * takeProfitRatio;

      position = {
        entryIndex: i,
        entryDate: currentCandle.time,
        entryPrice,
        stopPrice,
        targetPrice,
        enteredAt: new Date(currentCandle.time),
      };

      signals.push({
        index: i,
        date: currentCandle.time,
        type: "entry",
        price: entryPrice,
        reason: result.note,
      });
    }
  }

  // 若最後仍有部位，以最後一根 K 線收盤價平倉
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close ?? lastCandle.high;
    const daysHeld = candles.length - 1 - position.entryIndex;
    const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice;
    signals.push({
      index: candles.length - 1,
      date: lastCandle.time,
      type: "exit_timeout",
      price: exitPrice,
      reason: `測試結束平倉：持有 ${daysHeld} 天`,
      rr: pnlPct / stopLossPct,
    });
    if (pnlPct >= 0) wins++;
    else losses++;
    if (pnlPct >= 0) winAmounts.push(pnlPct);
    else lossAmounts.push(pnlPct);
  }

  // 計算統計
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWinPct = winAmounts.length > 0 ? winAmounts.reduce((a, b) => a + b, 0) / winAmounts.length : 0;
  const avgLossPct = lossAmounts.length > 0 ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0;
  const avgReturnPct = totalTrades > 0 ? (winAmounts.reduce((a, b) => a + b, 0) + lossAmounts.reduce((a, b) => a + b, 0)) / totalTrades : 0;
  const totalReturnPct = winAmounts.reduce((a, b) => a + b, 0) + lossAmounts.reduce((a, b) => a + b, 0);
  const maxLossPct = lossAmounts.length > 0 ? Math.min(...lossAmounts) : 0;
  const avgHoldDays = holdDaysList.length > 0 ? holdDaysList.reduce((a, b) => a + b, 0) / holdDaysList.length : 0;

  return {
    symbol,
    strategyId: strategy.id,
    strategyName: strategy.name,
    period: {
      start: candles[0]?.time ?? "",
      end: candles[candles.length - 1]?.time ?? "",
    },
    totalCandles: candles.length,
    signals,
    stats: {
      totalTrades,
      winCount: wins,
      lossCount: losses,
      winRate,
      avgReturnPct,
      avgWinPct: avgWinPct * 100,
      avgLossPct: avgLossPct * 100,
      totalReturnPct: totalReturnPct * 100,
      maxLossPct: maxLossPct * 100,
      maxConsecutiveLosses,
      maxDrawdownPct: maxDrawdown * 100,
      avgHoldDays,
    },
    equityCurve,
    dailyPnl,
  };
}

/** 批次回測多檔股 */
export async function runBatchBacktest(
  symbol: string,
  strategies: UserStrategyDef[],
  params: Pick<BacktestParams, "rangeDays" | "stopLossPct" | "takeProfitRatio" | "maxHoldDays">,
): Promise<Array<{ strategy: UserStrategyDef; result: BacktestResult }>> {
  const results = [];
  for (const strategy of strategies) {
    const result = await runBacktest({
      symbol,
      strategy,
      ...params,
    });
    results.push({ strategy, result });
  }
  return results;
}

/** 批次回測多個策略 × 多個股票 */
export async function runMultiBacktest(
  symbols: string[],
  strategies: UserStrategyDef[],
  params: Pick<BacktestParams, "rangeDays" | "stopLossPct" | "takeProfitRatio" | "maxHoldDays">,
): Promise<Map<string, Array<{ strategy: UserStrategyDef; result: BacktestResult }>>> {
  const resultMap = new Map<string, Array<{ strategy: UserStrategyDef; result: BacktestResult }>>();
  for (const symbol of symbols) {
    const results = await runBatchBacktest(symbol, strategies, params);
    resultMap.set(symbol, results);
  }
  return resultMap;
}

/* ---------- 輔助函數 ---------- */

async function fetchHistoricalCandles(symbol: string, rangeDays: number): Promise<Candle[]> {
  // 先嘗試 Yahoo Finance
  for (const ySymbol of ySymbolCandidates(symbol, "twse")) {
    try {
      const { candles } = await getCachedCandles(ySymbol, `${Math.ceil(rangeDays / 30)}mo`, "1d");
      if (candles.length >= 60) return candles;
    } catch {
      continue;
    }
  }
  // 若沒有緩存資料，嘗試直接抓取
  for (const ySymbol of ySymbolCandidates(symbol, "twse")) {
    try {
      const { candles } = await fetchYahooCandles(ySymbol, { range: `${Math.ceil(rangeDays / 30)}mo`, interval: "1d" });
      return candles;
    } catch {
      continue;
    }
  }
  return [];
}

function buildEmptyResult(symbol: string, strategy: UserStrategyDef, candlesCount: number): BacktestResult {
  return {
    symbol,
    strategyId: strategy.id,
    strategyName: strategy.name,
    period: { start: "", end: "" },
    totalCandles: candlesCount,
    signals: [],
    stats: {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      avgReturnPct: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      totalReturnPct: 0,
      maxLossPct: 0,
      maxConsecutiveLosses: 0,
      maxDrawdownPct: 0,
      avgHoldDays: 0,
    },
    equityCurve: [],
    dailyPnl: [],
  };
}
