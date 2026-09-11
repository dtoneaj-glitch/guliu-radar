import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite 資料庫（取代原本 archive/daily/YYYY-MM-DD/*.json 的檔案存檔）
 *
 * 設計取捨：
 *  - Quote / InstitutionalBreakdown 的完整內容仍以 JSON 欄位存放（data 欄），
 *    避免把型別裡每個欄位都拆成 SQL 欄位、日後型別一改就要跟著改 schema；
 *  - 但把常用查詢欄位（close、changePct）額外拆出來做索引，
 *    讓「近 N 日某代號收盤價」這類查詢不必解析 JSON。
 *  - 這個取捨之後如果查詢需求變複雜（例如要對 close 做範圍篩選排序），
 *    可以再把對應欄位拆出來，不影響現有 API。
 */

const DB_PATH = path.resolve(process.cwd(), "server", "data", "radar.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS archive_meta (
    date TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    sources TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS archive_summary (
    date TEXT PRIMARY KEY REFERENCES archive_meta(date) ON DELETE CASCADE,
    advance INTEGER NOT NULL,
    decline INTEGER NOT NULL,
    flat INTEGER NOT NULL,
    total_value_yi REAL NOT NULL,
    institutional_net_yi REAL NOT NULL,
    institutional_coverage TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS archive_quotes (
    date TEXT NOT NULL REFERENCES archive_meta(date) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    close REAL,
    change_pct REAL,
    data TEXT NOT NULL,
    PRIMARY KEY (date, symbol)
  );

  CREATE TABLE IF NOT EXISTS archive_institutional (
    date TEXT NOT NULL REFERENCES archive_meta(date) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (date, symbol)
  );

  CREATE INDEX IF NOT EXISTS idx_archive_quotes_date ON archive_quotes(date);
  CREATE INDEX IF NOT EXISTS idx_archive_quotes_symbol ON archive_quotes(symbol);
  CREATE INDEX IF NOT EXISTS idx_archive_inst_date ON archive_institutional(date);
  CREATE INDEX IF NOT EXISTS idx_archive_inst_symbol ON archive_institutional(symbol);
`);
