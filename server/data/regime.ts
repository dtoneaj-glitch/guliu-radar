/**
 * B5 市場狀態機（Market Regime）
 *
 * 根據歷史存檔資料判斷市場狀態與熱區遷移：
 * 1. Market Regime：強多 / 偏多 / 震盪 / 偏空 / 強空
 *    - 基於漲跌幅廣度、法人流向、成交值趨勢
 *    - 支援 5 日 / 20 日兩個時間視窗
 */

import { loadArchiveDate, listArchiveDates } from "./archive";
import type { MarketRegime, RegimeLevel, RegimeHistoryEntry } from "../../shared/types";

/** 单日市場指標 */
interface DayMetrics {
  date: string;
  /** 漲幅家數比（0-100） */
  breadthPct: number;
  /** 法人合計淨流入（億元） */
  instNetYi: number;
  /** 總成交值（億元） */
  totalValueYi: number;
}

/** 計算单日指標 */
function calcDayMetrics(archive: NonNullable<ReturnType<typeof loadArchiveDate>>): DayMetrics {
  const { advance, decline, flat, totalValueYi, institutionalNetYi } = archive.summary;
  const total = advance + decline + flat;
  const breadthPct = total > 0 ? (advance / total) * 100 : 50;

  return {
    date: archive.meta.date,
    breadthPct,
    instNetYi: institutionalNetYi ?? 0,
    totalValueYi,
  };
}

/**
 * 計算市場狀態分數
 */
function calcRegimeScore(breadthPct: number, instNetYi: number): number {
  const breadthScore = (breadthPct - 50) / 50;
  const instScore = Math.max(-1, Math.min(1, instNetYi / 500));
  return breadthScore * 0.6 + instScore * 0.4;
}

/** 將分數轉換為狀態 */
function scoreToRegime(score: number): RegimeLevel {
  if (score >= 0.5) return "強多";
  if (score >= 0.15) return "偏多";
  if (score <= -0.5) return "強空";
  if (score <= -0.15) return "偏空";
  return "震盪";
}

/** 計算趨勢方向 */
function calcTrend(scores: number[]): "轉強" | "轉弱" | "穩定" {
  if (scores.length < 2) return "穩定";
  const recent = scores.slice(-2);
  if (recent[1] > recent[0] + 0.1) return "轉強";
  if (recent[1] < recent[0] - 0.1) return "轉弱";
  return "穩定";
}

/**
 * 取得市場狀態
 * @param lookbackDays 往前看幾天的資料（預設 5）
 */
export function getMarketRegime(lookbackDays = 5): MarketRegime {
  const dates = listArchiveDates();
  const recentDates = dates.slice(0, lookbackDays);

  if (recentDates.length === 0) {
    return {
      regime: "震盪",
      score: 0,
      lookbackDays: 0,
      dataPoints: 0,
      trend: "穩定",
      history: [],
      note: "尚無歷史資料",
    };
  }

  const metrics: DayMetrics[] = [];
  for (const date of recentDates) {
    const archive = loadArchiveDate(date);
    if (!archive) continue;
    metrics.push(calcDayMetrics(archive));
  }

  if (metrics.length === 0) {
    return {
      regime: "震盪",
      score: 0,
      lookbackDays,
      dataPoints: 0,
      trend: "穩定",
      history: [],
      note: "無法讀取歷史資料",
    };
  }

  const scores = metrics.map((m) => calcRegimeScore(m.breadthPct, m.instNetYi));
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const regime = scoreToRegime(avgScore);
  const trend = calcTrend(scores);

  const history: RegimeHistoryEntry[] = metrics.map((m, i) => ({
    date: m.date,
    breadthPct: Math.round(m.breadthPct * 10) / 10,
    instNetYi: Math.round(m.instNetYi * 100) / 100,
    totalValueYi: Math.round(m.totalValueYi * 100) / 100,
    score: Math.round(scores[i] * 100) / 100,
    regime: scoreToRegime(scores[i]),
  }));

  return {
    regime,
    score: Math.round(avgScore * 100) / 100,
    lookbackDays: metrics.length,
    dataPoints: metrics.length,
    trend,
    history,
    note: metrics.length >= 2 ? `基於 ${metrics.length} 日資料` : "單日資料，趨勢僅供參考",
  };
}

/**
 * 快速判斷今日市場情緒（單日版）
 */
export function getTodayRegime(summary: { advance: number; decline: number; flat: number; institutionalNet: number }): MarketRegime {
  const total = summary.advance + summary.decline + summary.flat;
  const breadthPct = total > 0 ? (summary.advance / total) * 100 : 50;
  const score = calcRegimeScore(breadthPct, summary.institutionalNet);
  const regime = scoreToRegime(score);

  return {
    regime,
    score: Math.round(score * 100) / 100,
    lookbackDays: 1,
    dataPoints: 1,
    trend: "穩定",
    history: [{
      // 使用台北時間，避免 UTC 偏移導致日期錯誤
      date: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).split(" ")[0],
      breadthPct: Math.round(breadthPct * 10) / 10,
      instNetYi: Math.round(summary.institutionalNet * 100) / 100,
      totalValueYi: 0,
      score: Math.round(score * 100) / 100,
      regime,
    }],
    note: "單日估算",
  };
}
