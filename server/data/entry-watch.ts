import type { EntryWatchItem, EntryWatchStatus } from "../../shared/types";
import { getFacts } from "./strategies";
import type { Snapshot } from "./hotzones";

/**
 * 近進場區批次掃描（盤後用途：讓使用者前一天收盤後就知道「明天哪些股票可能接近 PA 進場區」）
 *
 * 重用 strategies.ts 的 getFacts（已有 10 分鐘快取 + getCachedCandles 的 Yahoo 快取），
 * 不重新打 API，符合現有的限流保護策略。
 *
 * 判斷邏輯（做多觀點，進場區＝支撐回踩區）：
 *  - 收盤價落在 entryZone 區間內 → in-zone（已進場觀察範圍）
 *  - 收盤價在 entryZone 上緣之上、距離 ≤ NEAR_THRESHOLD_PCT → approaching（明日觀察名單）
 *  - 收盤價在 entryZone 上緣之上但距離較遠，或已跌破下緣 → far
 *  - 無 entryZone 資料（結構不明或資料不足）→ no-zone / insufficient
 */

const NEAR_THRESHOLD_PCT = 2;
const CONCURRENCY = 5;

export async function scanEntryZoneProximity(snapshot: Snapshot, symbols: string[]): Promise<EntryWatchItem[]> {
  const queue = [...symbols];
  const items: EntryWatchItem[] = [];

  const evalOne = async (symbol: string) => {
    const quote = snapshot.bySymbol.get(symbol);
    if (!quote) {
      items.push({
        symbol, name: symbol, close: null, changePct: null, entryZone: null,
        distancePct: null, status: "insufficient",
      });
      return;
    }
    const { facts } = await getFacts(snapshot, symbol);
    if (!facts || !facts.entryZone) {
      items.push({
        symbol, name: quote.name, close: quote.close, changePct: quote.changePct,
        entryZone: null, distancePct: null, status: facts ? "no-zone" : "insufficient",
      });
      return;
    }

    const { low, high } = facts.entryZone;
    const close = quote.close;
    let status: EntryWatchStatus;
    let distancePct: number;

    if (close <= high && close >= low) {
      status = "in-zone";
      distancePct = 0;
    } else if (close > high) {
      distancePct = ((close - high) / close) * 100;
      status = distancePct <= NEAR_THRESHOLD_PCT ? "approaching" : "far";
    } else {
      // 已跌破進場區下緣：通常代表結構轉弱或已深跌，歸類為 far 而非「接近」
      distancePct = ((low - close) / close) * 100;
      status = "far";
    }

    items.push({
      symbol, name: quote.name, close, changePct: quote.changePct,
      entryZone: { low, high }, distancePct, status,
    });
  };

  const worker = async () => {
    while (queue.length > 0) {
      const s = queue.shift();
      if (s != null) await evalOne(s);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, worker));

  const order: Record<EntryWatchStatus, number> = { "in-zone": 0, approaching: 1, far: 2, "no-zone": 3, insufficient: 4 };
  items.sort((a, b) => order[a.status] - order[b.status] || (a.distancePct ?? 999) - (b.distancePct ?? 999));
  return items;
}
