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

  -- 大盤籌碼（三大法人期貨/選擇權未平倉）每日快照。
  -- 2026-09-12 新增：openapi.taifex.com.tw 只回傳「最新一個交易日」，沒有歷史查詢功能
  -- （見 MEMORY-external-api-verification.md），ChipCard.tsx 的「本週」模式原本想傳過去的
  -- 日期給那支 API 是行不通的——改成我們自己每天存一筆快照，「本週」查自己的資料庫，
  -- 不依賴外部 API 有沒有歷史功能。
  --
  -- 存量 vs 流量：net_oi 是「未平倉淨額」（某天收盤當下的部位存量），net_trade 是
  -- 「今日買賣超淨額」（真正的資金流量）。本週彙總只能加總 net_trade——把 net_oi
  -- 加總沒有意義（同一個部位放 5 天不動，加總會變成 5 倍大，誤以為狂加碼）。
  -- net_oi 只取最新一天的值當「目前部位」參考用，不做加總。
  CREATE TABLE IF NOT EXISTS archive_chipcard (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    foreign_futures_net_oi INTEGER,
    trust_futures_net_oi INTEGER,
    dealer_futures_net_oi INTEGER,
    put_call_ratio REAL
  );
`);

// 防禦性欄位遷移：如果 archive_chipcard 是舊 schema 建立的（沒有 net_trade 欄位），
// 補上去。SQLite 沒有 "ADD COLUMN IF NOT EXISTS"，用 try/catch 吃掉「欄位已存在」的錯誤。
for (const col of ["foreign_futures_net_trade", "trust_futures_net_trade", "dealer_futures_net_trade"]) {
  try {
    db.exec(`ALTER TABLE archive_chipcard ADD COLUMN ${col} INTEGER`);
  } catch {
    /* 欄位已存在，忽略 */
  }
}
