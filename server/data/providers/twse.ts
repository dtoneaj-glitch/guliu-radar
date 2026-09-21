import { fetchJson, num } from "../cache";
import type { InstitutionalBreakdown } from "../../../shared/types";

/**
 * TWSE 供應商：證交所 OpenAPI（上市）
 * - STOCK_DAY_ALL：全市場單日行情
 * - T86（rwd 介面）：三大法人個股買賣超
 */

export interface TwseDailyRow {
  symbol: string;
  name: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 漲跌價差（含正負號） */
  change: number;
  /** 成交股數 */
  volumeShares: number;
  /** 成交值（元） */
  value: number;
}

export interface TwseDailyResult {
  /** 交易日期 ISO（民國紀年已轉西元） */
  date: string;
  rows: TwseDailyRow[];
}

/** 民國日期 "1150904" → "2026-09-04" */
/** 通用日期解析：MI_INDEX 回西元 YYYYMMDD，openapi 回民國 YYYMMDD → 一律轉 ISO */
export function parseTwseDate(s: string): string {
  const t = String(s ?? "").replace(/[\/\-]/g, "");
  if (/^\d{8}$/.test(t) && Number(t.slice(0, 4)) > 1900) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return rocToIso(t);
}
export function rocToIso(roc: string): string {
  const y = Number(roc.slice(0, roc.length - 4)) + 1911;
  const m = roc.slice(-4, -2);
  const d = roc.slice(-2);
  return `${y}-${m}-${d}`;
}

const OPENAPI = "https://openapi.twse.com.tw/v1";
const RWD_MI_INDEX = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";

/** 由 rwd 的「漲跌(+/-)」欄（含 HTML 色碼）取出正負號 */
function signOfChange(raw: string): number {
  if (!raw) return 1;
  if (/color:red/.test(raw) || raw.includes("+")) return 1;
  if (/color:green/.test(raw) || raw.includes("-")) return -1;
  return 1;
}

/**
 * 取指定日期（YYYY-MM-DD）的每日收盤行情（全部）。
 *
 * 2026-09-21 修正：原本只用 openapi 的 STOCK_DAY_ALL，該端點**當天不會更新**
 * （09-21 晚上仍回 09-18），導致整個 App 慢一天。改走 rwd MI_INDEX，當日即可取得。
 */
async function fetchTwseDailyByDate(iso: string): Promise<TwseDailyResult | null> {
  const ymd = iso.replace(/-/g, "");
  const res = await fetchJson<{ stat: string; date?: string; tables?: { title?: string; fields: string[]; data: string[][] }[] }>(
    `${RWD_MI_INDEX}?date=${ymd}&type=ALL&response=json`,
  );
  if (res.stat !== "OK" || !Array.isArray(res.tables)) return null;
  const table = res.tables.find((t) => (t.title ?? "").includes("每日收盤行情"));
  if (!table || !Array.isArray(table.data) || table.data.length < 100) return null;
  const idx = (name: string) => table.fields.indexOf(name);
  const symIdx = idx("證券代號");
  const closeIdx = idx("收盤價");
  const signIdx = idx("漲跌(+/-)");
  const chgIdx = idx("漲跌價差");
  const volIdx = idx("成交股數");
  const valIdx = idx("成交金額");
  const openIdx = idx("開盤價");
  const highIdx = idx("最高價");
  const lowIdx = idx("最低價");
  const nameIdx = idx("證券名稱");
  if (symIdx < 0 || closeIdx < 0 || chgIdx < 0) return null;
  const rows: TwseDailyRow[] = [];
  for (const r of table.data) {
    const symbol = String(r[symIdx] ?? "").trim();
    if (!/^\d{4}[A-Z]?$/.test(symbol)) continue;
    const close = num(r[closeIdx]);
    const rawChg = num(r[chgIdx]); // 除權息當日此欄可能不是數字 → NaN（上層會標記 exDividend）
    const change = Number.isFinite(rawChg) ? rawChg * signOfChange(signIdx >= 0 ? r[signIdx] : "") : Number.NaN;
    const value = num(r[valIdx]);
    if (!Number.isFinite(close) || close <= 0 || !(value > 0)) continue;
    rows.push({
      symbol,
      name: String(r[nameIdx] ?? "").trim(),
      open: openIdx >= 0 ? num(r[openIdx]) : close,
      high: highIdx >= 0 ? num(r[highIdx]) : close,
      low: lowIdx >= 0 ? num(r[lowIdx]) : close,
      close,
      change,
      volumeShares: volIdx >= 0 ? num(r[volIdx]) : 0,
      value,
    });
  }
  if (rows.length < 100) return null;
  const date = res.date ? parseTwseDate(res.date) : iso;
  return { date, rows };
}

export async function fetchTwseDailyAll(): Promise<TwseDailyResult> {
  // 1) 先試最近 5 天（含今日）的 rwd 行情：當日即可取得
  for (let back = 0; back <= 4; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const res = await fetchTwseDailyByDate(iso).catch(() => null);
    if (res) return res;
  }
  // 2) 後備：openapi STOCK_DAY_ALL（可能延遲一天）
  const raw = await fetchJson<Record<string, string>[]>(`${OPENAPI}/exchangeReport/STOCK_DAY_ALL`);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("STOCK_DAY_ALL 回傳空資料");
  const rows: TwseDailyRow[] = raw
    .filter((r) => /^\d{4}[A-Z]?$/.test(r.Code ?? ""))
    .map((r) => {
      const close = num(r.ClosingPrice);
      const change = num(r.Change);
      return {
        symbol: r.Code,
        name: (r.Name ?? "").trim(),
        open: num(r.OpeningPrice),
        high: num(r.HighestPrice),
        low: num(r.LowestPrice),
        close,
        change,
        volumeShares: num(r.TradeVolume),
        value: num(r.TradeValue),
      };
    })
    .filter((r) => Number.isFinite(r.close) && r.close > 0 && r.value > 0);
  const date = rocToIso(raw[0].Date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("STOCK_DAY_ALL 日期格式異常");
  return { date, rows };
}

/** 三大法人買賣超（股）→ Map<symbol, 各別細項>。僅涵蓋上市。 */
export async function fetchTwseInstitutional(dateAd: string): Promise<Map<string, InstitutionalBreakdown>> {
  const ymd = dateAd.replace(/-/g, "");
  const res = await fetchJson<{ stat: string; fields: string[]; data: string[][] }>(
    `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALL&response=json`,
  );
  if (res.stat !== "OK" || !Array.isArray(res.data)) throw new Error("T86 回傳非 OK");
  const fields = res.fields;
  const codeIdx = fields.indexOf("證券代號");
  // 找各別買賣超欄位的索引（用名稱比對，避免位置變動）
  const findIdx = (keywords: string[]): number => {
    // 先嘗試精確匹配，再嘗試包含匹配（避免「外資自營商」誤命中「自營商」）
    for (const kw of keywords) {
      const exact = fields.indexOf(kw);
      if (exact >= 0) return exact;
    }
    for (const kw of keywords) {
      const idx = fields.findIndex((f) => f.includes(kw));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const foreignIdx = findIdx(["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數"]); // 外資及陸資買賣超（不含自營商）
  const trustIdx = findIdx(["投信買賣超股數"]);                                             // 投信買賣超
  const dealerIdx = findIdx(["自營商買賣超股數", "自營商買賣超股數(自行買賣)"]);            // 自營商總買賣超（含自行+避險）
  const netIdx = findIdx(["三大法人買賣超股數"]);                                           // 合計
  if (codeIdx < 0) throw new Error("T86 欄位結構改變：找不到證券代號");
  const map = new Map<string, InstitutionalBreakdown>();
  for (const row of res.data) {
    const code = (row[codeIdx] ?? "").trim();
    if (!/^\d{4}[A-Z]?$/.test(code)) continue;
    map.set(code, {
      foreign: foreignIdx >= 0 ? num(row[foreignIdx]) : 0,
      trust: trustIdx >= 0 ? num(row[trustIdx]) : 0,
      dealer: dealerIdx >= 0 ? num(row[dealerIdx]) : 0,
      total: netIdx >= 0 ? num(row[netIdx]) : 0,
    });
  }
  return map;
}
