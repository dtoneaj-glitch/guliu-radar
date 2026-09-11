import { fetchJson } from "../cache";

/**
 * FinMind 供應商：產業分類對照（上市＋上櫃一次取齊）
 * dataset=TaiwanStockInfo 免金鑰；分類異動頻率低，快取 24 小時。
 */

export interface IndustryEntry {
  symbol: string;
  name: string;
  market: "twse" | "tpex";
  industry: string;
}

interface FinMindRow {
  industry_category: string;
  stock_id: string;
  stock_name: string;
  type: string;
}

export async function fetchIndustryMap(): Promise<Map<string, IndustryEntry>> {
  const res = await fetchJson<{ msg: string; status: number; data: FinMindRow[] }>(
    "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo",
  );
  if (res.status !== 200 || !Array.isArray(res.data)) throw new Error("FinMind TaiwanStockInfo 回傳異常");
  const map = new Map<string, IndustryEntry>();
  for (const row of res.data) {
    if (!/^\d{4}[A-Z]?$/.test(row.stock_id)) continue;
    map.set(row.stock_id, {
      symbol: row.stock_id,
      name: row.stock_name.trim(),
      market: row.type === "tpex" ? "tpex" : "twse",
      industry: row.industry_category?.trim() || "",
    });
  }
  return map;
}
