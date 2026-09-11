import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

/**
 * 一次性資料搬遷：把舊版 archive/daily/YYYY-MM-DD/*.json 匯入 SQLite。
 *
 * 用法：
 *   npx tsx server/data/migrate-archive.ts        → 搬遷所有尚未匯入的日期
 *   npx tsx server/data/migrate-archive.ts --force → 強制覆蓋已匯入的日期
 *
 * 冪等：預設會跳過 SQLite 裡已存在的日期，重複執行安全。
 * 執行後舊的 JSON 檔案不會被刪除（留著當備份，之後確認無誤可手動清掉 archive/daily/）。
 */

const OLD_ARCHIVE_DIR = path.resolve(process.cwd(), "server", "data", "archive", "daily");
const FORCE = process.argv.includes("--force");

interface OldMeta {
  date: string;
  generatedAt: string;
  sources: string[];
}
interface OldSummary {
  advance: number;
  decline: number;
  flat: number;
  totalValueYi: number;
  institutionalNetYi: number;
  institutionalCoverage: string;
}
interface OldQuote {
  symbol: string;
  close: number;
  changePct: number | null;
  [key: string]: unknown;
}
type OldInstitutional = Record<string, { foreign: number; trust: number; dealer: number; total: number }>;

const upsertMeta = db.prepare(
  `INSERT INTO archive_meta (date, generated_at, sources) VALUES (@date, @generatedAt, @sources)
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
const deleteQuotes = db.prepare(`DELETE FROM archive_quotes WHERE date = ?`);
const insertQuote = db.prepare(
  `INSERT INTO archive_quotes (date, symbol, close, change_pct, data) VALUES (@date, @symbol, @close, @changePct, @data)`,
);
const deleteInst = db.prepare(`DELETE FROM archive_institutional WHERE date = ?`);
const insertInst = db.prepare(`INSERT INTO archive_institutional (date, symbol, data) VALUES (@date, @symbol, @data)`);
const dateExists = db.prepare(`SELECT 1 FROM archive_meta WHERE date = ?`);

function migrateDate(dateStr: string): "migrated" | "skipped" | "failed" {
  const dir = path.join(OLD_ARCHIVE_DIR, dateStr);
  try {
    if (!FORCE && dateExists.get(dateStr)) return "skipped";

    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8")) as OldMeta;
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf-8")) as OldSummary;
    const quotes = JSON.parse(fs.readFileSync(path.join(dir, "quotes.json"), "utf-8")) as OldQuote[];
    const institutional = JSON.parse(fs.readFileSync(path.join(dir, "institutional.json"), "utf-8")) as OldInstitutional;

    const run = db.transaction(() => {
      upsertMeta.run({ date: dateStr, generatedAt: meta.generatedAt, sources: JSON.stringify(meta.sources) });
      upsertSummary.run({
        date: dateStr,
        advance: summary.advance,
        decline: summary.decline,
        flat: summary.flat,
        totalValueYi: summary.totalValueYi,
        institutionalNetYi: summary.institutionalNetYi,
        institutionalCoverage: summary.institutionalCoverage,
      });

      deleteQuotes.run(dateStr);
      for (const q of quotes) {
        insertQuote.run({
          date: dateStr,
          symbol: q.symbol,
          close: q.close ?? null,
          changePct: q.changePct ?? null,
          data: JSON.stringify(q),
        });
      }

      deleteInst.run(dateStr);
      for (const [symbol, b] of Object.entries(institutional)) {
        insertInst.run({ date: dateStr, symbol, data: JSON.stringify(b) });
      }
    });
    run();
    return "migrated";
  } catch (err) {
    console.error(`[migrate] ${dateStr} 失敗:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}

function main() {
  if (!fs.existsSync(OLD_ARCHIVE_DIR)) {
    console.log(`[migrate] 找不到舊版存檔目錄 ${OLD_ARCHIVE_DIR}，無資料可搬遷。`);
    return;
  }
  const dates = fs
    .readdirSync(OLD_ARCHIVE_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (dates.length === 0) {
    console.log("[migrate] 舊版存檔目錄無日期資料夾，無資料可搬遷。");
    return;
  }

  const counts = { migrated: 0, skipped: 0, failed: 0 };
  for (const d of dates) {
    const result = migrateDate(d);
    counts[result]++;
    console.log(`[migrate] ${d} → ${result}`);
  }

  console.log(
    `[migrate] 完成：共 ${dates.length} 天，成功 ${counts.migrated}、略過（已存在）${counts.skipped}、失敗 ${counts.failed}`,
  );
  if (counts.failed === 0) {
    console.log("[migrate] 全部成功。確認 SQLite 資料無誤後，可手動刪除 server/data/archive/daily/ 舊檔。");
  }
}

main();
