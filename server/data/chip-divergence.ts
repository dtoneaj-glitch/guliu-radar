import { evaluateChipDivergence, type ChipDivergenceResult } from "../../shared/chip-divergence";
import type { Snapshot } from "./hotzones";
import { fetchChipCard, fetchRetailFuturesPosition } from "./providers/taifex";

/**
 * 組裝真實資料、呼叫純邏輯的 evaluateChipDivergence()。
 * 本檔案只負責「去哪裡拿資料」，判斷邏輯完全在 shared/chip-divergence.ts，
 * 維持「事實先於判斷」的分層——跟 server/data/pa-analysis.ts 之於
 * shared/pa-facts.ts 是同一種分工。
 */
export async function getChipDivergence(snapshot: Snapshot): Promise<ChipDivergenceResult> {
  // 外資現貨買賣超（億元）：加總全市場每檔股票的外資買賣超金額
  // （snapshot.institutional 是逐股 {foreign,trust,dealer,total} 股數，要自己乘上收盤價才是金額）
  let foreignSpotRaw = 0;
  let hasSpotData = false;
  if (snapshot.institutional) {
    for (const quote of snapshot.quotes) {
      const breakdown = snapshot.institutional.get(quote.symbol);
      if (breakdown) {
        foreignSpotRaw += breakdown.foreign * quote.close;
        hasSpotData = true;
      }
    }
  }
  const foreignSpotNetYi = hasSpotData ? foreignSpotRaw / 1e8 : null;

  // 外資期貨未平倉淨口數：ChipCardData 已經算好，直接取「外資及陸資」那筆
  let foreignFuturesNetOI: number | null = null;
  try {
    const chipCard = await fetchChipCard();
    const foreignTrader = chipCard.traders.find((t) => t.trader === "外資及陸資");
    foreignFuturesNetOI = foreignTrader?.futuresNetOI ?? null;
  } catch {
    foreignFuturesNetOI = null;
  }

  // 散戶（微台）多方佔比：目前只有當日快照，沒有昨日基準可比對，
  // retailLongRatioChangePct 暫時給 null（如實承認缺這塊，不編造變動幅度）。
  // 之後要補上「當日增減」，需要把這份快照也存進 SQLite archive，用前一天的存檔比對。
  let retailLongRatioPct: number | null = null;
  try {
    const retail = await fetchRetailFuturesPosition("TMF");
    retailLongRatioPct = retail?.retailLongRatioPct ?? null;
  } catch {
    retailLongRatioPct = null;
  }

  return evaluateChipDivergence({
    foreignSpotNetYi,
    foreignFuturesNetOI,
    retailLongRatioPct,
    retailLongRatioChangePct: null,
  });
}
