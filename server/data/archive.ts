import type { Candle } from "../../shared/types";
import type { InstitutionalBreakdown } from "../../shared/types";
import type { Snapshot } from "./hotzones";
import { db } from "./db";

/**
 * B0 每日快照存檔（SQLite 版，取代原本的 archive/daily/YYYY-MM-DD/*.json）
 *
 * 對外 API 與回傳形狀刻意維持跟舊版 JSON 檔案版完全一致，
 * 呼叫端（hotzones.ts / history.ts / regime.ts / api.ts）不需要改一行：
 *   - saveSnapshot(asOf, snapshot, instMap)  → 寫入当日資料（存在則覆蓋）
 *   - listArchiveDates()                     → 已有歷史的日期清單（倒序）
 *   - loadArchiveDate(ymd)                   → 讀取指定日期完整快照（含 institutional）
 *
 * 舊版 JSON 檔案邏輯保留在 _migration-backup/archive.legacy-json.ts，
 * 一次性資料搬遷腳本見 server/data/migrate-archive.ts。
 */

interface ArchiveMeta {
  date: string;
  generatedAt: string;
  sources: string[];
}

interface ArchiveSummary {
  advance: number;
  decline: number;
  flat: number;
  totalValueYi: number;
  institutionalNetYi: number;
  institutionalCoverage: string;
}

const upsertMeta = db.prepare(
  `INSERT INTO archive_meta (date, generated_at, sources)
   VALUES (@date, @generatedAt, @sources)
   ON CONFLICT(date) DO UPDATE SET generated_at = excluded.generated_at, sources = excluded.sources`,
);

const upsertSummary = db.prepare(
  `INSERT INTO archive_summary (date, advance, decline, flat, total_value_yi, institutional_net_yi, institutional_coverage)
   VALUES (@date, @advance, @decline, @flat, @totalValueYi, @institutionalNetYi, @institutionalCoverage)
   ON CONFLICT(date) DO UPDATE SET
     advance = excluded.advance, decline = excluded.decline, flat = excluded.flat,
     total_value_yi = excluded.total_value_yi, institutional_net_yi = excluded.institutional_net_yi,
     institutional_coverage = excluded.institutional_coverage`,
);

const deleteQuotesForDate = db.prepare(`DELETE FROM archive_quotes WHERE date = ?`);
const insertQuote = db.prepare(
  `INSERT INTO archive_quotes (date, symbol, close, change_pct, data) VALUES (@date, @symbol, @close, @changePct, @data)`,
);

const deleteInstForDate = db.prepare(`DELETE FROM archive_institutional WHERE date = ?`);
const insertInst = db.prepare(
  `INSERT INTO archive_institutional (date, symbol, data) VALUES (@date, @symbol, @data)`,
);

/** 寫入当日快照（交易式：全部成功或全部回滾，避免半寫入的髒資料） */
export function saveSnapshot(
  asOf: string,
  snapshot: Snapshot,
  institutional: Map<string, InstitutionalBreakdown> | null,
): void {
  const run = db.transaction(() => {
    upsertMeta.run({
      date: asOf,
      generatedAt: snapshot.generatedAt,
      sources: JSON.stringify(["TWSE OpenAPI", "TWSE T86", "TPEx", "FinMind"]),
    });

    const { summary } = snapshot;
    upsertSummary.run({
      date: asOf,
      advance: summary.advance,
      decline: summary.decline,
      flat: summary.flat,
      totalValueYi: summary.totalValue,
      institutionalNetYi: summary.institutionalNet,
      institutionalCoverage: summary.institutionalCoverage,
    });

    deleteQuotesForDate.run(asOf);
    for (const q of snapshot.quotes) {
      insertQuote.run({
        date: asOf,
        symbol: q.symbol,
        close: q.close,
        changePct: q.changePct,
        data: JSON.stringify(q),
      });
    }

    deleteInstForDate.run(asOf);
    if (institutional) {
      for (const [symbol, b] of institutional.entries()) {
        insertInst.run({ date: asOf, symbol, data: JSON.stringify(b) });
      }
    }
  });

  try {
    run();
  } catch {
    /* 存檔失敗不影響主流程（維持與舊版相同的靜默失敗行為） */
  }
}

/** 已有歷史的日期清單，倒序（最新在前） */
export function listArchiveDates(): string[] {
  try {
    const rows = db.prepare(`SELECT date FROM archive_meta ORDER BY date DESC`).all() as { date: string }[];
    return rows.map((r) => r.date);
  } catch {
    return [];
  }
}

/**
 * 讀取指定日期的歷史快照。
 * 回傳 null 表示該日無存檔。
 */
export function loadArchiveDate(
  ymd: string,
): {
  meta: ArchiveMeta;
  quotes: import("../../shared/types").Quote[];
  institutional: Map<string, InstitutionalBreakdown>;
  summary: ArchiveSummary;
} | null {
  try {
    const metaRow = db.prepare(`SELECT date, generated_at, sources FROM archive_meta WHERE date = ?`).get(ymd) as
      | { date: string; generated_at: string; sources: string }
      | undefined;
    if (!metaRow) return null;

    const summaryRow = db
      .prepare(
        `SELECT advance, decline, flat, total_value_yi, institutional_net_yi, institutional_coverage
         FROM archive_summary WHERE date = ?`,
      )
      .get(ymd) as
      | {
          advance: number;
          decline: number;
          flat: number;
          total_value_yi: number;
          institutional_net_yi: number;
          institutional_coverage: string;
        }
      | undefined;

    const quoteRows = db.prepare(`SELECT data FROM archive_quotes WHERE date = ?`).all(ymd) as { data: string }[];
    const instRows = db.prepare(`SELECT symbol, data FROM archive_institutional WHERE date = ?`).all(ymd) as {
      symbol: string;
      data: string;
    }[];

    return {
      meta: {
        date: metaRow.date,
        generatedAt: metaRow.generated_at,
        sources: JSON.parse(metaRow.sources) as string[],
      },
      quotes: quoteRows.map((r) => JSON.parse(r.data) as import("../../shared/types").Quote),
      institutional: new Map(instRows.map((r) => [r.symbol, JSON.parse(r.data) as InstitutionalBreakdown])),
      summary: summaryRow
        ? {
            advance: summaryRow.advance,
            decline: summaryRow.decline,
            flat: summaryRow.flat,
            totalValueYi: summaryRow.total_value_yi,
            institutionalNetYi: summaryRow.institutional_net_yi,
            institutionalCoverage: summaryRow.institutional_coverage,
          }
        : { advance: 0, decline: 0, flat: 0, totalValueYi: 0, institutionalNetYi: 0, institutionalCoverage: "" },
    };
  } catch {
    return null;
  }
}
