import { fetchJson } from "../cache";
import type { Candle } from "../../../shared/types";

/**
 * Yahoo Finance 供應商（K 線歷史備援源）
 * - 上市代號後綴 .TW、上櫃 .TWO
 * - 非官方端點：僅個人原型使用，正式化時換券商 API 或自建累積
 */

export type YahooTimeframe = {
  range: string;
  interval: "1wk" | "1d" | "60m" | "15m";
};

const TAIPEI_TZ = "Asia/Taipei";

function formatTime(epochSec: number, intraday: boolean): string {
  const d = new Date(epochSec * 1000);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TAIPEI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: intraday ? "2-digit" : undefined,
    minute: intraday ? "2-digit" : undefined,
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (!intraday) return date;
  return `${date} ${get("hour")}:${get("minute")}`;
}

export async function fetchYahooCandles(
  ySymbol: string,
  opts: YahooTimeframe,
): Promise<{ candles: Candle[]; asOf: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ySymbol,
  )}?range=${opts.range}&interval=${opts.interval}`;
  const raw = await fetchJson<{
    chart: {
      error: { code: string; description: string } | null;
      result: {
        meta: { regularMarketTime?: number };
        timestamp: number[];
        indicators: {
          quote: {
            open: (number | null)[];
            high: (number | null)[];
            low: (number | null)[];
            close: (number | null)[];
            volume: (number | null)[];
          }[];
        };
      }[];
    };
  }>(url);

  const result = raw.chart?.result?.[0];
  if (!result || raw.chart.error) throw new Error(`Yahoo 無資料：${ySymbol}`);
  const q = result.indicators?.quote?.[0];
  if (!q || !Array.isArray(result.timestamp)) throw new Error(`Yahoo 資料結構異常：${ySymbol}`);

  const intraday = opts.interval === "60m" || opts.interval === "15m";
  const candles: Candle[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    candles.push({
      time: formatTime(result.timestamp[i], intraday),
      open,
      high,
      low,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  if (candles.length === 0) throw new Error(`Yahoo 全為空值：${ySymbol}`);
  const asOf = result.meta?.regularMarketTime
    ? formatTime(result.meta.regularMarketTime, false)
    : candles[candles.length - 1].time;
  return { candles, asOf };
}

/** 未知市場別時的代號候選順序 */
export function ySymbolCandidates(symbol: string, market?: "twse" | "tpex"): string[] {
  if (market === "tpex") return [`${symbol}.TWO`, `${symbol}.TW`];
  if (market === "twse") return [`${symbol}.TW`, `${symbol}.TWO`];
  return [`${symbol}.TW`, `${symbol}.TWO`];
}
