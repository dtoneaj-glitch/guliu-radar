/**
 * 自選股異動稽核紀錄（append-only JSONL）。
 *
 * 背景：上線測試要求「自選股異動具後台紀錄可追蹤」——原本系統完全沒有這塊
 * （users.json 只存最終狀態，看不出誰在何時改了什麼）。
 *
 * 設計取捨：
 *  - 用 JSONL（一行一筆）append，不重寫整檔，避免併發寫入互相覆蓋。
 *  - 檔案放 server/data/audit-log.jsonl，已加入 .gitignore（屬執行期資料）。
 *  - 讀取：readAudit(limit) 取最後 N 筆（倒序），給管理端查詢用。
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "server", "data", "audit-log.jsonl");

export interface AuditEntry {
  /** ISO 時間 */
  at: string;
  userId: string;
  username: string;
  /** 動作類型，例如 watchlist.update */
  action: string;
  /** 本次新增的標的 */
  added?: string[];
  /** 本次移除的標的 */
  removed?: string[];
  /** 異動後清單長度 */
  count?: number;
  /** 來源 IP（便於追查） */
  ip?: string;
}

/** 追加一筆稽核紀錄。失敗不影響主流程（與其他資料層一致的靜默失敗）。 */
export function appendAudit(entry: AuditEntry): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    /* ignore */
  }
}

/** 取最後 limit 筆（倒序，最新在前）。檔案不存在時回空陣列。 */
export function readAudit(limit = 100): AuditEntry[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const lines = fs.readFileSync(FILE, "utf-8").split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEntry => x !== null)
      .reverse();
  } catch {
    return [];
  }
}
