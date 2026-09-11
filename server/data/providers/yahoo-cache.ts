import type { Candle } from "../../../shared/types";
import { TtlCache } from "../cache";
import { fetchYahooCandles } from "./yahoo";

/**
 * Yahoo K 線共享快取（server 層共用）
 * 同一 symbol+range+interval 在 TTL 內只請求 Yahoo 一次，
 * 避免 Dashboard / StockDetail / strategies / trends 重複 fetch。
 *
 * 快取鍵格式："{symbol}:{range}:{interval}"
 * TTL：10 分鐘（日線資料在盤後不變，分線資料變化較快）
 */

const CANDLE_TTL_MS = 10 * 60 * 1000;
const cache = new TtlCache<Candle[]>(CANDLE_TTL_MS);

export interface CachedCandles {
  candles: Candle[];
  asOf: string;
}

/**
 * 先查快取，未命中再抓 Yahoo。
 * symbol 使用 Yahoo 格式（如 "2330.TW"）；range/interval 與 fetchYahooCandles 相同。
 */
export async function getCachedCandles(
  yahooSymbol: string,
  range: string,
  interval: "1wk" | "1d" | "60m" | "15m",
): Promise<CachedCandles> {
  const key = `${yahooSymbol}:${range}:${interval}`;
  const hit = cache.get(key);
  if (hit) return { candles: hit, asOf: key }; // asOf 僅用於除錯，實際值由 fetchYahooCandles 回傳

  const result = await fetchYahooCandles(yahooSymbol, { range, interval });
  cache.set(key, result.candles);
  return result;
}
