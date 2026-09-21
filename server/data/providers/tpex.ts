import { fetchJson, num } from "../cache";
import type { InstitutionalBreakdown } from "../../../shared/types";

/**
 * TPEx 供應商：櫃買中心公開 JSON（上櫃）
 * stk_quote_result.php 為官方網站資料端點（非正式 OpenAPI，原型用）。
 */

export interface TpexDailyRow {
  symbol: string;
  name: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 漲跌（含正負號；除權 "X" 為 null） */
  change: number | null;
  volumeShares: number;
  /** 成交值（元） */
  value: number;
}

export interface TpexDailyResult {
  date: string;
  rows: TpexDailyRow[];
}

export async function fetchTpexDaily(dateAd: string): Promise<TpexDailyResult> {
  const ymd = dateAd.replace(/-/g, "");
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${ymd}&se=AL`;
  const raw = await fetchJson<{
    date: string;
    tables: { fields: string[]; data: string[][] | null }[];
  }>(url);
  const table = raw.tables?.[0];
  if (!table || !Array.isArray(table.data) || table.data.length === 0) {
    throw new Error("TPEx 回傳空資料");
  }
  const idx = (label: string) => table.fields.findIndex((f) => f.replace(/\s/g, "").includes(label));
  const iCode = idx("代號");
  const iName = idx("名稱");
  const iClose = idx("收盤");
  const iChange = idx("漲跌");
  const iOpen = idx("開盤");
  const iHigh = idx("最高");
  const iLow = idx("最低");
  const iVol = idx("成交股數");
  const iVal = idx("成交金額");

  const rows: TpexDailyRow[] = table.data
    .filter((r) => /^\d{4}[A-Z]?$/.test((r[iCode] ?? "").trim()))
    .map((r) => {
      const close = num(r[iClose]);
      const rawChange = (r[iChange] ?? "").trim();
      const change = rawChange === "X" ? null : num(rawChange);
      return {
        symbol: (r[iCode] ?? "").trim(),
        name: (r[iName] ?? "").trim(),
        open: num(r[iOpen]),
        high: num(r[iHigh]),
        low: num(r[iLow]),
        close,
        change,
        volumeShares: num(r[iVol]),
        value: num(r[iVal]),
      };
    })
    .filter((r) => Number.isFinite(r.close) && r.close > 0 && r.value > 0);

  return { date: raw.date, rows };
}

/**
 * TPEx 三大法人買賣超（日報，仿 TWSE T86 的欄位容錯比對邏輯）
 *
 * 端點與 stk_quote_result.php 同一套 2024 年 10 月改版後的網站系統（同樣是 `{date, tables:[{fields,data}]}` 形狀），
 * 但這支端點本身沒有在這次開發中實際打過（沙盒連不到 tpex.org.tw）——
 * 部署後第一次跑務必檢查回傳形狀是否符合預期，若形狀不符，parse 會拋錯，
 * 呼叫端（hotzones.ts）已用 `.catch(() => null)` 接住，不會讓上市資料跟著掛掉。
 */
export async function fetchTpexInstitutional(dateAd: string): Promise<Map<string, InstitutionalBreakdown>> {
  const [y, m, d] = dateAd.split("-").map(Number);
  const rocDate = `${y - 1911}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=AL&t=D&d=${rocDate}`;

  const raw = await fetchJson<{
    date: string;
    tables: { fields: string[]; data: string[][] | null }[];
  }>(url);
  const table = raw.tables?.[0];
  if (!table || !Array.isArray(table.data) || table.data.length === 0) {
    throw new Error("TPEx 三大法人回傳空資料");
  }

  const fields = table.fields;
  const codeIdx = fields.findIndex((f) => f.replace(/\s/g, "").includes("代號"));
  if (codeIdx < 0) throw new Error("TPEx 三大法人欄位結構改變：找不到代號");

  // 2026-09-21 對照真實 API 修正：這支端點的欄位是一堆重複的通用標籤
  // （買進股數/賣出股數/買賣超股數 × 7 組），沒有「外陸資買賣超股數」這種名稱，
  // 所以只能用「位置」對應。已用 6488 驗證：idx4 + idx13 + idx22 = idx23。
  //   0 代號 / 1 名稱 /
  //   2-4   外資及陸資(不含外資自營商) 買進/賣出/買賣超
  //   5-7   外資自營商
  //   8-10  外資及陸資合計
  //   11-13 投信
  //   14-16 自營商(自行買賣)
  //   17-19 自營商(避險)
  //   20-22 自營商合計
  //   23    三大法人買賣超股數合計
  const totalIdx = fields.findIndex((f) => f.includes("三大法人買賣超股數合計"));
  if (totalIdx < 0 || fields.length < 24) {
    throw new Error("TPEx 三大法人欄位結構改變：找不到合計欄或欄位數不足");
  }
  const foreignIdx = 4; // 外資及陸資(不含外資自營商) 買賣超
  const trustIdx = 13; // 投信 買賣超
  const dealerIdx = 22; // 自營商合計 買賣超
  const netIdx = totalIdx; // 三大法人買賣超股數合計
  const map = new Map<string, InstitutionalBreakdown>();
  for (const row of table.data) {
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
