import { TtlCache } from "../cache";
import type { Candle } from "../../../shared/types";

/**
 * Pantlas（盤圖）資料提供者
 * - 公開 API：https://pantlas.com/api/ 文件
 * - 免登入可用：/api/stocks/{code}、/api/stocks（全庫）、/api/market/overview
 * - 需登入：/api/signals（暫時不抓）
 *
 * 資料價值：
 *   • 當日 / 5日法人淨額（foreignNet、trustNet、dealerNet）直接以「股」為單位，含上市＋上櫃
 *   • 30 日 K 線歷史（含 ma5/ma20）
 *   • 基本面：PE、PBR、股息率、季度 EPS/毛利率/營收年增率
 *   • 產業分類（sector）
 */

export interface PantlasStock {
  code: string;
  name: string;
  market: string; // "上市" | "上櫃"
  sector: string | null; // 產業別
  price: number;
  previousClose: number;
  change: number;
  changePercent: number | null;
  open: number;
  high: number;
  low: number;
  volume: number; // 股數
  ma5: number | null;
  ma20: number | null;
  // 法人買賣超（股）
  foreignNet: number | null;
  trustNet: number | null;
  dealerNet: number | null;
  foreignNet5D: number | null;
  trustNet5D: number | null;
  dealerNet5D: number | null;
  // 基本面
  pe: number | null;
  pbr: number | null;
  dividendYield: number | null;
  revenueYearOverYear: number | null;
  latestEps: number | null;
  grossMarginPercent: number | null;
  operatingMarginPercent: number | null;
  netMarginPercent: number | null;
  latestQuarter: string | null;
  history: PantlasCandle[];
  dataAsOf: string;
}

interface PantlasCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number;
  ma20: number;
}

interface PantlasFundamentals {
  pe: number;
  pbr: number;
  dividendYield: number;
  revenueYearOverYear: number;
  latestEps: number;
  grossMarginPercent: number;
  operatingMarginPercent: number;
  netMarginPercent: number;
  latestQuarter: string;
  quarters: { period: string; eps: number; grossMarginPercent: number }[];
}

const pantlasCache = new TtlCache<PantlasStock>(10 * 60 * 1000);
const pantlasListCache = new TtlCache<PantlasStock[]>(30 * 60 * 1000);

async function fetchPantlasJson<T>(path: string): Promise<T> {
  const res = await fetch(`https://pantlas.com${path}`, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Pantlas ${path} 回傳 ${res.status}`);
  return res.json() as Promise<T>;
}

export interface PantlasOverview {
  status: string;
  source: string;
  isRealtime: boolean;
  dataAsOf: string;
  advancers: number;
  decliners: number;
  unchanged: number;
  estimatedLimitUp: number;
  estimatedLimitDown: number;
  turnoverBillion: number;
  activeStocks: Array<{ code: string; name: string; market: string; sector: string; price: number; changePercent: number; volume: number }>;
}

export async function fetchPantlasOverview(): Promise<PantlasOverview | null> {
  try {
    return await fetchPantlasJson<PantlasOverview>("/api/market/overview");
  } catch {
    return null;
  }
}

export async function fetchPantlasStock(code: string): Promise<PantlasStock | null> {
  const key = code.toUpperCase();
  const list = await fetchPantlasList();
  const cached = pantlasCache.get(key);
  if (cached) return cached;
  try {
    const raw = await fetchPantlasJson<{
      status: string;
      source: string;
      isRealtime: boolean;
      dataAsOf: string;
      quoteAsOf: string;
      code: string;
      name: string;
      market: string;
      sector: string;
      price: number;
      previousClose: number;
      change: number;
      changePercent: number;
      open: number;
      high: number;
      low: number;
      volume: number;
      support: number;
      resistance: number;
      ma5: number;
      ma20: number;
      foreignNet: number;
      trustNet: number;
      dealerNet: number;
      foreignNet5D: number;
      trustNet5D: number;
      dealerNet5D: number;
      marginChange: number;
      pe: number;
      pbr: number;
      dividendYield: number;
      valuationAsOf: string;
      revenueYearOverYear: number;
      revenueMonth: string;
      history: PantlasCandle[];
    }>(`/api/stocks/${key}`);
    const stock: PantlasStock = {
      code: raw.code,
      name: raw.name,
      market: raw.market,
      sector: raw.sector || null,
      price: raw.price,
      previousClose: raw.previousClose,
      change: raw.change,
      changePercent: raw.changePercent,
      open: raw.open,
      high: raw.high,
      low: raw.low,
      volume: raw.volume,
      ma5: raw.ma5,
      ma20: raw.ma20,
      foreignNet: raw.foreignNet,
      trustNet: raw.trustNet,
      dealerNet: raw.dealerNet,
      foreignNet5D: raw.foreignNet5D,
      trustNet5D: raw.trustNet5D,
      dealerNet5D: raw.dealerNet5D,
      pe: raw.pe,
      pbr: raw.pbr,
      dividendYield: raw.dividendYield,
      revenueYearOverYear: raw.revenueYearOverYear,
      latestEps: null, // 從 fundamentals endpoint 取
      grossMarginPercent: null,
      operatingMarginPercent: null,
      netMarginPercent: null,
      latestQuarter: null,
      history: raw.history,
      dataAsOf: raw.dataAsOf,
    };
    // 併入 fundamentals（如有）
    try {
      const fund = await fetchPantlasJson<PantlasFundamentals>(`/api/stocks/${key}/fundamentals`);
      stock.latestEps = fund.latestEps ?? null;
      stock.grossMarginPercent = fund.grossMarginPercent ?? null;
      stock.operatingMarginPercent = fund.operatingMarginPercent ?? null;
      stock.netMarginPercent = fund.netMarginPercent ?? null;
      stock.latestQuarter = fund.latestQuarter ?? null;
      if (fund.quarters?.length) stock.latestQuarter = fund.quarters[0]?.period ?? null;
    } catch { /* fundamentals 非必填 */ }
    pantlasCache.set(key, stock);
    return stock;
  } catch {
    return null;
  }
}

export async function fetchPantlasList(): Promise<PantlasStock[]> {
  const cached = pantlasListCache.get("list");
  if (cached) return cached;
  try {
    const raw = await fetchPantlasJson<
      Array<{
        code: string; name: string; market: string; sector: string;
        price: number; change: number; changePercent: number; volume: number;
        dataAsOf: string;
      }>
    >("/api/stocks");
    const stocks: PantlasStock[] = raw.map((r) => ({
      code: r.code,
      name: r.name,
      market: r.market,
      sector: r.sector || null,
      price: r.price,
      previousClose: r.price - r.change,
      change: r.change,
      changePercent: r.changePercent,
      open: r.price,
      high: r.price,
      low: r.price,
      volume: r.volume,
      ma5: null,
      ma20: null,
      foreignNet: null,
      trustNet: null,
      dealerNet: null,
      foreignNet5D: null,
      trustNet5D: null,
      dealerNet5D: null,
      pe: null,
      pbr: null,
      dividendYield: null,
      revenueYearOverYear: null,
      latestEps: null,
      grossMarginPercent: null,
      operatingMarginPercent: null,
      netMarginPercent: null,
      latestQuarter: null,
      history: [],
      dataAsOf: r.dataAsOf,
    }));
    pantlasListCache.set("list", stocks);
    return stocks;
  } catch {
    return [];
  }
}

/** 將 Pantlas K 線歷史轉換為 Candle[]（最近 30 日） */
export function pantlasCandlesToCandle(history: PantlasCandle[]): Candle[] {
  return history.map((h) => ({
    time: h.date,
    open: h.open,
    high: h.high,
    low: h.low,
    close: h.close,
    volume: h.volume,
  }));
}
