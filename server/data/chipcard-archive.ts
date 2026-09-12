import type { ChipCardData } from "../../shared/types";
import { db } from "./db";

/**
 * 大盤籌碼（三大法人期貨未平倉）每日快照存檔。
 *
 * 背景（2026-09-12）：查證發現 openapi.taifex.com.tw 所有端點都只回傳「最新一個交易日」，
 * 沒有歷史查詢功能（見 MEMORY-external-api-verification.md）。ChipCard.tsx 原本的
 * 「本週」模式想法是傳一個過去的日期給 fetchChipCard()，這條路走不通。
 *
 * 解法：跟 B0 每日快照存檔（archive.ts）同樣的模式——每天存一筆自己的資料，
 * 「本週」改成查自己資料庫裡本週已存的每一天加總，不依賴外部 API 的歷史查詢能力。
 *
 * 只彙總「期貨未平倉淨額」（有加總意義：看整週法人淨部位怎麼變化）；
 * P/C Ratio 不做加總，只取最新一天的值（這是即時狀態指標，加總沒有意義）。
 */

const upsertChipCard = db.prepare(`
  INSERT INTO archive_chipcard (date, data, foreign_futures_net_oi, trust_futures_net_oi, dealer_futures_net_oi,
    foreign_futures_net_trade, trust_futures_net_trade, dealer_futures_net_trade, put_call_ratio)
  VALUES (@date, @data, @foreignFuturesNetOI, @trustFuturesNetOI, @dealerFuturesNetOI,
    @foreignFuturesNetTrade, @trustFuturesNetTrade, @dealerFuturesNetTrade, @putCallRatio)
  ON CONFLICT(date) DO UPDATE SET
    data = excluded.data,
    foreign_futures_net_oi = excluded.foreign_futures_net_oi,
    trust_futures_net_oi = excluded.trust_futures_net_oi,
    dealer_futures_net_oi = excluded.dealer_futures_net_oi,
    foreign_futures_net_trade = excluded.foreign_futures_net_trade,
    trust_futures_net_trade = excluded.trust_futures_net_trade,
    dealer_futures_net_trade = excluded.dealer_futures_net_trade,
    put_call_ratio = excluded.put_call_ratio
`);

/** 存入（或覆蓋）某日的大盤籌碼快照。存檔失敗不影響主流程（維持跟 archive.ts 一致的靜默失敗行為）。 */
export function saveChipCardSnapshot(chipData: ChipCardData): void {
  try {
    const fx = chipData.traders.find((t) => t.trader === "外資及陸資");
    const ts = chipData.traders.find((t) => t.trader === "投信");
    const dl = chipData.traders.find((t) => t.trader === "自營商");
    upsertChipCard.run({
      date: chipData.asOf,
      data: JSON.stringify(chipData),
      foreignFuturesNetOI: fx?.futuresNetOI ?? null,
      trustFuturesNetOI: ts?.futuresNetOI ?? null,
      dealerFuturesNetOI: dl?.futuresNetOI ?? null,
      foreignFuturesNetTrade: fx?.futuresNetTrade ?? null,
      trustFuturesNetTrade: ts?.futuresNetTrade ?? null,
      dealerFuturesNetTrade: dl?.futuresNetTrade ?? null,
      putCallRatio: chipData.putCallRatio ?? null,
    });
  } catch {
    /* 存檔失敗不影響主流程 */
  }
}

/** 讀取指定日期的完整籌碼快照（回傳當時的 ChipCardData），該日無存檔回傳 null。 */
export function loadChipCardDate(ymd: string): ChipCardData | null {
  try {
    const row = db.prepare(`SELECT data FROM archive_chipcard WHERE date = ?`).get(ymd) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ChipCardData) : null;
  } catch {
    return null;
  }
}

export interface ChipCardWeeklyAggregate {
  weekStart: string;
  /** 實際彙總到的日期清單（可能少於 5 天——存檔才剛開始沒幾天，或中間有假日/沒開盤） */
  daysIncluded: string[];
  traders: {
    trader: string;
    /** 本週買賣超合計（真正的流量，可以加總） */
    netTradeSum: number;
    /** 最新一天的未平倉淨額（存量，只取最後一天的值，不做加總——見 db.ts 的說明） */
    latestNetOI: number | null;
  }[];
  latestPutCallRatio: number | null;
}

/**
 * 本週彙總：把 weekStartYmd（本週一）到今天，資料庫裡已存檔的每一天「買賣超」（流量）加總，
 * 另外附上最新一天的「未平倉淨額」（存量，當前部位參考，不加總）。
 * 沒有任何一天有存檔時回傳 null（例如這個功能剛上線，週一到現在都還沒存過檔）。
 */
export function getChipCardWeeklyAggregate(weekStartYmd: string): ChipCardWeeklyAggregate | null {
  try {
    const rows = db
      .prepare(
        `SELECT date, foreign_futures_net_oi, trust_futures_net_oi, dealer_futures_net_oi,
                foreign_futures_net_trade, trust_futures_net_trade, dealer_futures_net_trade, put_call_ratio
         FROM archive_chipcard WHERE date >= ? ORDER BY date ASC`,
      )
      .all(weekStartYmd) as {
      date: string;
      foreign_futures_net_oi: number | null;
      trust_futures_net_oi: number | null;
      dealer_futures_net_oi: number | null;
      foreign_futures_net_trade: number | null;
      trust_futures_net_trade: number | null;
      dealer_futures_net_trade: number | null;
      put_call_ratio: number | null;
    }[];
    if (rows.length === 0) return null;

    const sumTrade = (key: "foreign_futures_net_trade" | "trust_futures_net_trade" | "dealer_futures_net_trade") =>
      rows.reduce((s, r) => s + (r[key] ?? 0), 0);
    const latest = rows[rows.length - 1];

    return {
      weekStart: weekStartYmd,
      daysIncluded: rows.map((r) => r.date),
      traders: [
        { trader: "外資及陸資", netTradeSum: sumTrade("foreign_futures_net_trade"), latestNetOI: latest.foreign_futures_net_oi },
        { trader: "投信", netTradeSum: sumTrade("trust_futures_net_trade"), latestNetOI: latest.trust_futures_net_oi },
        { trader: "自營商", netTradeSum: sumTrade("dealer_futures_net_trade"), latestNetOI: latest.dealer_futures_net_oi },
      ],
      latestPutCallRatio: latest.put_call_ratio,
    };
  } catch {
    return null;
  }
}
