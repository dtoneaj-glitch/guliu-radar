import fs from "node:fs";
import path from "node:path";
import type { Candle } from "../../shared/types";
import type { InstitutionalBreakdown } from "../../shared/types";
import type { Snapshot } from "./hotzones";

/**
 * B0 每日快照存檔
 *
 * 資料結構（按日期分檔，便於日後查詢與擴展）：
 *   archive/daily/YYYY-MM-DD/
 *     ├── meta.json          date, sources, note
 *     ├── quotes.json        Quote[]（上市 + 上櫃行情）
 *     ├── institutional.json Map<string, InstitutionalBreakdown>（外資/投信/自營分項）
 *     └── summary.json       MarketSummary（漲跌家數、總成交值、法人合計）
 *
 * API：
 *   - saveSnapshot(asOf, snapshot, instMap)  → 寫入当日檔案
 *   - listDates()                           → 已有歷史的日期清單（倒序）
 *   - loadDate(ymd)                         → 讀取指定日期完整快照（含 institutional）
 */

const ARCHIVE_DIR = path.resolve(process.cwd(), "server", "data", "archive", "daily");

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

interface ArchiveFile {
  meta: ArchiveMeta;
  quotes: import("../../shared/types").Quote[];
  institutional: Record<string, InstitutionalBreakdown>;
  summary: ArchiveSummary;
}

/** 寫入当日快照到 archive/daily/YYYY-MM-DD/ */
export function saveSnapshot(
  asOf: string,
  snapshot: Snapshot,
  institutional: Map<string, InstitutionalBreakdown> | null,
): void {
  const dir = path.join(ARCHIVE_DIR, asOf);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        date: asOf,
        generatedAt: snapshot.generatedAt,
        sources: ["TWSE OpenAPI", "TWSE T86", "TPEx", "FinMind"],
      } satisfies ArchiveMeta),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, "quotes.json"),
      JSON.stringify(snapshot.quotes, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, "institutional.json"),
      JSON.stringify(
        institutional
          ? Object.fromEntries(institutional.entries())
          : {},
        null, 2,
      ),
      "utf-8",
    );
    const { summary } = snapshot;
    fs.writeFileSync(
      path.join(dir, "summary.json"),
      JSON.stringify({
        advance: summary.advance,
        decline: summary.decline,
        flat: summary.flat,
        totalValueYi: summary.totalValue,
        institutionalNetYi: summary.institutionalNet,
        institutionalCoverage: summary.institutionalCoverage,
      } satisfies ArchiveSummary),
      "utf-8",
    );
  } catch {
    /* 存檔失敗不影響主流程 */
  }
}

/** 已有歷史的日期清單，倒序（最新在前） */
export function listArchiveDates(): string[] {
  try {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];
    return fs
      .readdirSync(ARCHIVE_DIR)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
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
  const dir = path.join(ARCHIVE_DIR, ymd);
  try {
    if (!fs.existsSync(dir)) return null;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8")) as ArchiveMeta;
    const quotes = JSON.parse(fs.readFileSync(path.join(dir, "quotes.json"), "utf-8")) as import("../../shared/types").Quote[];
    const instRaw = JSON.parse(fs.readFileSync(path.join(dir, "institutional.json"), "utf-8")) as Record<string, InstitutionalBreakdown>;
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf-8")) as ArchiveSummary;
    return {
      meta,
      quotes,
      institutional: new Map(Object.entries(instRaw)),
      summary,
    };
  } catch {
    return null;
  }
}
