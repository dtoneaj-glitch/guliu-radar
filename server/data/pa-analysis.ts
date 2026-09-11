import type { Snapshot } from "./hotzones";
import { getCachedCandles } from "./providers/yahoo-cache";
import { fetchYahooCandles, ySymbolCandidates } from "./providers/yahoo";
import { buildMultiTimeframeFacts } from "../../shared/pa-facts";
import { evaluatePaDefault, type PaDefaultResult } from "../../shared/pa-default";
import type { Candle, Timeframe } from "../../shared/types";

const FETCH_MAP: Record<Timeframe, { range: string; interval: "1wk" | "1d" | "60m" | "15m" }> = {
  "1w": { range: "5y", interval: "1wk" },
  "1d": { range: "2y", interval: "1d" },
  "60m": { range: "2mo", interval: "60m" },
  "15m": { range: "60d", interval: "15m" },
};

export async function buildPaDefaultAnalysis(snapshot: Snapshot, symbol: string): Promise<PaDefaultResult> {
  const quote = snapshot.bySymbol.get(symbol);
  const candlesByTimeframe: Partial<Record<Timeframe, Candle[]>> = {};
  for (const timeframe of ["1w", "1d", "60m", "15m"] as Timeframe[]) {
    for (const ySymbol of ySymbolCandidates(symbol, quote?.market)) {
      try {
        const { candles } = await getCachedCandles(ySymbol, FETCH_MAP[timeframe].range, FETCH_MAP[timeframe].interval);
        candlesByTimeframe[timeframe] = candles;
        break;
      } catch {
        // 嘗試下一個市場後綴；所有來源失敗則保留 unavailable 狀態。
      }
    }
  }
  const bundle = buildMultiTimeframeFacts(symbol, candlesByTimeframe);
  return evaluatePaDefault({ symbol, name: quote?.name ?? symbol, bundle });
}
