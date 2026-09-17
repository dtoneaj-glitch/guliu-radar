/**
 * TAIWAN VIX（臺指選擇權波動率指數）供應商 — TAIFEX 官方免費資料檔
 *
 * 來源：臺灣期貨交易所「統計資料 → 臺指選擇權波動率指數下載」頁的月檔純文字：
 *   https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/{YYYYMM}new.txt
 * 免登入、免費，每日一列（收盤 VIX 值 + 收盤前 1 分鐘平均）。
 *
 * 注意：該檔案以 Big5 編碼，但標題列以外的資料列全為 ASCII 數字；
 * 這裡直接以預設編碼讀取，只解析「8 位數日期開頭」的資料列，不需要處理中文標題。
 *
 * 2026-09-17 查證：付費 E-Data Shop 要 NT$3,000/半年，但這個官方月檔是免費的，
 * 內容即為每日收盤 VIX，足以餵 dashboard。
 */
import { classifyVix, type VixReading } from "../../../shared/vix";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36";
const BASE = "https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data";

export interface TaiwanVix {
  date: string;
  value: number;
  prevClose: number | null;
  change: number | null;
  reading: VixReading;
}

interface VixRow {
  date: string;
  value: number;
}

/** 依序嘗試當月、上月、前月（月初或跨月時當月檔可能還很空或不存在） */
function ymCandidates(now = new Date()): string[] {
  const out: string[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < 3; i++) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

async function fetchMonth(ym: string): Promise<VixRow[]> {
  const res = await fetch(`${BASE}/${ym}new.txt`, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const text = await res.text();
  const rows: VixRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && /^\d{8}$/.test(parts[0])) {
      const value = Number(parts[2]);
      if (Number.isFinite(value)) {
        rows.push({
          date: `${parts[0].slice(0, 4)}-${parts[0].slice(4, 6)}-${parts[0].slice(6, 8)}`,
          value,
        });
      }
    }
  }
  return rows;
}

let cache: { at: number; data: TaiwanVix | null } | null = null;
const TTL_MS = 30 * 60 * 1000; // VIX 一天才更新一次，30 分鐘快取足夠

/** 取得最新一個交易日的 TAIWAN VIX；取不到回傳 null（呼叫端自行處理） */
export async function fetchTaiwanVix(): Promise<TaiwanVix | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  let rows: VixRow[] = [];
  for (const ym of ymCandidates()) {
    rows = await fetchMonth(ym);
    if (rows.length > 0) break;
  }
  if (rows.length === 0) {
    cache = { at: Date.now(), data: null };
    return null;
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;
  const change = prev ? Number((last.value - prev.value).toFixed(2)) : null;

  const data: TaiwanVix = {
    date: last.date,
    value: last.value,
    prevClose: prev?.value ?? null,
    change,
    reading: classifyVix(last.value, change),
  };
  cache = { at: Date.now(), data };
  return data;
}
