/**
 * 凱基 SUPER PY 即時行情 — 讀取本機 Python 橋接（bridge/kgi_bridge.py）的 HTTP 端點。
 *
 * 架構：bridge/kgi_bridge.py（Python，負責登入凱基 + 訂閱 + 暫存最新報價）
 *       → 本機 HTTP（預設 http://127.0.0.1:3010）
 *       → 本檔（Node，輪詢並轉成股流用得到的形狀）
 *
 * 為什麼用輪詢而不是 WebSocket：Python 端用 stdlib 即可，零額外相依；
 * 本機 1 秒輪詢對看盤儀表板等同即時。日後若要更低延遲，再換 WS。
 *
 * 啟用開關：必須設 KGI_LIVE_ENABLED=1，否則一律走原本的盤後資料（預設關閉，避免沒裝環境時報錯）。
 */
export interface LiveQuote {
  symbol: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  totalVolume?: number;
  priceChg?: number;
  pctChg?: number;
  bidPrices?: number[];
  bidVolumes?: number[];
  askPrices?: number[];
  askVolumes?: number[];
  /** 資料時間（凱基回傳 YYYYMMDDHHMMSS） */
  datetime?: string;
  /** 延遲秒數（凱基回報） */
  delayTime?: number;
  /** 本機收到時間（ISO） */
  receivedAt?: string;
}

const TTL_MS = 1000;

function baseUrl(): string {
  return process.env.KGI_BRIDGE_URL ?? `http://127.0.0.1:${process.env.KGI_BRIDGE_PORT ?? "3010"}`;
}

/** 是否啟用即時行情（預設關閉；由 .env 的 KGI_LIVE_ENABLED=1 開啟） */
export function isLiveEnabled(): boolean {
  return process.env.KGI_LIVE_ENABLED === "1";
}

let cache: { at: number; data: Map<string, LiveQuote> } | null = null;
let lastError: string | null = null;

function mapQuote(symbol: string, raw: Record<string, unknown>): LiveQuote {
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : Number.isFinite(Number(v)) && v != null && v !== "" ? Number(v) : undefined);
  const arr = (v: unknown): number[] | undefined => (Array.isArray(v) ? v.map((x) => Number(x)) : undefined);
  return {
    symbol,
    close: num(raw.close),
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    volume: num(raw.volume),
    totalVolume: num(raw.total_volume),
    priceChg: num(raw.price_chg),
    pctChg: num(raw.pct_chg),
    bidPrices: arr(raw.bid_prices),
    bidVolumes: arr(raw.bid_volumes),
    askPrices: arr(raw.ask_prices),
    askVolumes: arr(raw.ask_volumes),
    datetime: typeof raw.datetime === "string" ? raw.datetime : undefined,
    delayTime: num(raw.delay_time),
    receivedAt: typeof raw.received_at === "string" ? raw.received_at : undefined,
  };
}

/** 橋接是否活著（/health）。任何錯誤都回 false，不拋例外。 */
export async function isBridgeHealthy(): Promise<boolean> {
  if (!isLiveEnabled()) return false;
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { logged_in?: boolean };
    return body.logged_in === true;
  } catch {
    return false;
  }
}

/**
 * 取得指定代號的最新即時報價。取不到時回空 Map（呼叫端據此退回盤後資料）。
 * 1 秒內重複呼叫會用快取，避免對本機橋接產生無謂請求。
 */
export async function getLiveQuotes(symbols: string[]): Promise<Map<string, LiveQuote>> {
  const empty = new Map<string, LiveQuote>();
  if (!isLiveEnabled() || symbols.length === 0) return empty;

  if (cache && Date.now() - cache.at < TTL_MS) {
    const filtered = new Map<string, LiveQuote>();
    for (const s of symbols) {
      const q = cache.data.get(s);
      if (q) filtered.set(s, q);
    }
    return filtered;
  }

  try {
    const res = await fetch(`${baseUrl()}/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { quotes?: Record<string, Record<string, unknown>> };
    const data = new Map<string, LiveQuote>();
    for (const [sym, raw] of Object.entries(body.quotes ?? {})) {
      data.set(sym, mapQuote(sym, raw));
    }
    cache = { at: Date.now(), data };
    lastError = null;
    const filtered = new Map<string, LiveQuote>();
    for (const s of symbols) {
      const q = data.get(s);
      if (q) filtered.set(s, q);
    }
    return filtered;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return empty;
  }
}

/** 最近一次錯誤訊息（供 /api/live/status 除錯） */
export function getLiveLastError(): string | null {
  return lastError;
}
