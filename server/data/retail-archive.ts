/**
 * 散戶留倉（小台/微台）每日快照存檔。
 *
 * 目的：TAIFEX 的 DailyMarketReportFut 等端點只回「最新交易日」、沒有歷史查詢，
 * 所以「散戶淨多空比的單日變動」只能靠自己每天存一筆來比對。
 * 跟 chipcard-archive.ts 是同一套模式（每天存一筆自己的資料）。
 */
import { db } from "./db";
import type { RetailFuturesPosition } from "./providers/taifex";

const upsertRetail = db.prepare(`
  INSERT INTO archive_retail (date, contract, net_ratio_pct, market_oi, institutional_long, institutional_short, retail_long, retail_short, data)
  VALUES (@date, @contract, @netRatioPct, @marketOI, @institutionalLong, @institutionalShort, @retailLong, @retailShort, @data)
  ON CONFLICT(date, contract) DO UPDATE SET
    net_ratio_pct = excluded.net_ratio_pct,
    market_oi = excluded.market_oi,
    institutional_long = excluded.institutional_long,
    institutional_short = excluded.institutional_short,
    retail_long = excluded.retail_long,
    retail_short = excluded.retail_short,
    data = excluded.data
`);

/** 存入（或覆蓋）某日某契約的散戶留倉快照。存檔失敗不影響主流程。 */
export function saveRetailSnapshot(p: RetailFuturesPosition): void {
  try {
    upsertRetail.run({
      date: p.asOf,
      contract: p.contractCode,
      netRatioPct: p.retailNetRatioPct,
      marketOI: p.marketOI,
      institutionalLong: p.institutionalLong,
      institutionalShort: p.institutionalShort,
      retailLong: p.retailLong,
      retailShort: p.retailShort,
      data: JSON.stringify(p),
    });
  } catch {
    /* 靜默失敗，與 archive.ts / chipcard-archive.ts 一致 */
  }
}

/**
 * 取「嚴格早於 date」的最近一筆快照（用來算單日變動）。
 * 找不到回傳 null。
 */
export function latestRetailBefore(
  date: string,
  contract: "MTX" | "TMF",
): { date: string; netRatioPct: number | null } | null {
  try {
    const row = db
      .prepare(
        `SELECT date, net_ratio_pct FROM archive_retail
         WHERE contract = ? AND date < ? ORDER BY date DESC LIMIT 1`,
      )
      .get(contract, date) as { date: string; net_ratio_pct: number | null } | undefined;
    if (!row) return null;
    return { date: row.date, netRatioPct: row.net_ratio_pct };
  } catch {
    return null;
  }
}
