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
  const findIdx = (keywords: string[]): number => {
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
  // 排除「外資自營商買賣超」（已計入自營商買賣金額，避免重複計算），採跟 TWSE T86 相同的口徑
  const foreignIdx = findIdx(["外陸資買賣超股數", "外陸資買賣超"]);
  const trustIdx = findIdx(["投信買賣超股數", "投信買賣超"]);
  const dealerIdx = findIdx(["自營商買賣超股數(合計)", "自營商買賣超股數", "自營商買賣超合計", "自營商買賣超"]);
  const netIdx = findIdx(["三大法人買賣超股數", "三大法人買賣超"]);

  if (codeIdx < 0) throw new Error("TPEx 三大法人欄位結構改變：找不到代號");

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
