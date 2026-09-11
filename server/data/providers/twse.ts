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
export function rocToIso(roc: string): string {
  const y = Number(roc.slice(0, roc.length - 4)) + 1911;
  const m = roc.slice(-4, -2);
  const d = roc.slice(-2);
  return `${y}-${m}-${d}`;
}

const OPENAPI = "https://openapi.twse.com.tw/v1";

export async function fetchTwseDailyAll(): Promise<TwseDailyResult> {
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
