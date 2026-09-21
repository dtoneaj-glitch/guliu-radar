/**
 * 自選股儲存層（SQLite）
 *
 * 為什麼要遷：原本自選股存在 users.json 這顆大 JSON 裡，缺點是
 *   1) 任何異動都要整檔重寫（併發寫入會互相覆蓋）
 *   2) 查詢/稽核不易、無法部分更新
 * 遷到 SQLite 後：每檔一列、以 (user_id, symbol) 為主鍵，寫入具原子性。
 *
 * 帳號密碼仍留在 users.json（本模組只負責自選股）。
 *
 * 設計：以「工廠 + 預設實例」提供，方便測試用 in-memory DB 驗證，不污染正式資料。
 */
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import { db } from "./db";

export interface WatchlistItem {
  symbol: string;
  groups: string[];
  costPrice?: number;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id    TEXT    NOT NULL,
    symbol     TEXT    NOT NULL,
    groups     TEXT    NOT NULL,          -- JSON 陣列，例如 ["main","ride"]
    cost_price REAL,                      -- 可為 NULL（未設定成本價）
    sort_order INTEGER NOT NULL,          -- 清單順序（0 起）
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );
  CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, sort_order);
  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

interface Row {
  symbol: string;
  groups: string;
  cost_price: number | null;
  sort_order: number;
}

export interface WatchlistStore {
  get(userId: string): WatchlistItem[];
  replace(userId: string, items: WatchlistItem[]): void;
  count(userId: string): number;
  hasAny(userId: string): boolean;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
}

/** 建立（或取得）一個綁定指定 SQLite 連線的自選股儲存層 */
export function createWatchlistStore(database: Database): WatchlistStore {
  database.exec(DDL);

  const selectStmt = database.prepare(
    "SELECT symbol, groups, cost_price, sort_order FROM watchlist WHERE user_id = ? ORDER BY sort_order ASC",
  );
  const countStmt = database.prepare("SELECT COUNT(*) AS c FROM watchlist WHERE user_id = ?");
  const deleteStmt = database.prepare("DELETE FROM watchlist WHERE user_id = ?");
  const insertStmt = database.prepare(
    `INSERT INTO watchlist (user_id, symbol, groups, cost_price, sort_order, updated_at)
     VALUES (@user_id, @symbol, @groups, @cost_price, @sort_order, @updated_at)`,
  );
  const getMetaStmt = database.prepare("SELECT value FROM app_meta WHERE key = ?");
  const setMetaStmt = database.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const replaceTx = database.transaction((userId: string, items: WatchlistItem[]) => {
    deleteStmt.run(userId);
    const now = new Date().toISOString();
    items.forEach((item, idx) => {
      insertStmt.run({
        user_id: userId,
        symbol: item.symbol,
        groups: JSON.stringify(item.groups ?? []),
        cost_price: typeof item.costPrice === "number" && Number.isFinite(item.costPrice) ? item.costPrice : null,
        sort_order: idx,
        updated_at: now,
      });
    });
  });

  function get(userId: string): WatchlistItem[] {
    const rows = selectStmt.all(userId) as Row[];
    return rows.map((r) => {
      let groups: string[] = [];
      try {
        const parsed = JSON.parse(r.groups);
        if (Array.isArray(parsed)) groups = parsed.filter((g: unknown): g is string => typeof g === "string");
      } catch {
        /* 壞資料當成無標籤 */
      }
      const item: WatchlistItem = { symbol: r.symbol, groups };
      if (typeof r.cost_price === "number") item.costPrice = r.cost_price;
      return item;
    });
  }

  function replace(userId: string, items: WatchlistItem[]): void {
    replaceTx(userId, items);
  }

  return {
    get,
    replace,
    count: (userId: string) => (countStmt.get(userId) as { c: number }).c,
    hasAny: (userId: string) => (countStmt.get(userId) as { c: number }).c > 0,
    getMeta: (key: string) => {
      const row = getMetaStmt.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    setMeta: (key: string, value: string) => setMetaStmt.run(key, value),
  };
}

/** 正式資料庫的預設實例 */
export const watchlistStore: WatchlistStore = createWatchlistStore(db);

const MIGRATION_FLAG = "watchlist_migrated_from_json_v1";

/**
 * 一次性遷移：把 users.json 內既有的自選股搬進 SQLite。
 * 只做一次（以 app_meta 標記），且不刪除 users.json 的內容（保留可回溯）。
 */
export function migrateWatchlistsFromJson(usersFile = path.resolve(process.cwd(), "server", "data", "users.json")): number {
  if (watchlistStore.getMeta(MIGRATION_FLAG)) return 0;
  let moved = 0;
  try {
    if (fs.existsSync(usersFile)) {
      const parsed = JSON.parse(fs.readFileSync(usersFile, "utf-8")) as {
        users?: { id: string; watchlist?: WatchlistItem[] }[];
      };
      for (const user of parsed.users ?? []) {
        if (!user?.id) continue;
        const list = Array.isArray(user.watchlist) ? user.watchlist : [];
        if (list.length === 0) continue;
        if (watchlistStore.hasAny(user.id)) continue; // 已有資料則不覆蓋
        watchlistStore.replace(user.id, list);
        moved += list.length;
      }
    }
    watchlistStore.setMeta(MIGRATION_FLAG, new Date().toISOString());
  } catch {
    /* 遷移失敗不影響啟動；下次啟動會再試 */
  }
  return moved;
}
