import type {
  BriefsResponse,
  ChartResponse,
  ChipCardData,
  DashboardResponse,
  EntryWatchResponse,
  HotzonesResponse,
  MarketOverview,
  MarketStrategyScanResponse,
  OptionsOIData,
  RankingResponse,
  ScanResponse,
  SearchResponse,
  StockBrief,
  StockSignal,
  StockSignalsResponse,
  StrategyEval,
  StrategyScanResponse,
  Timeframe,
  TrendsResponse,
  BacktestResult,
  BacktestParams,
} from "@shared/types";
import type { ChipDivergenceResult } from "@shared/chip-divergence";
import type { RetailFuturesPosition } from "../../../server/data/providers/taifex";
import type {
  UserStrategyDef,
  Condition,
  ConditionGroup,
  CondType,
} from "@shared/strategy-builder";
import type { PaDefaultResult } from "@shared/pa-default";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* ignore body parse errors */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchHotzones(): Promise<HotzonesResponse> {
  return getJson<HotzonesResponse>("/api/hotzones");
}

export function fetchScan(zone: string | null, limit = 20): Promise<ScanResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (zone) params.set("zone", zone);
  return getJson<ScanResponse>(`/api/scan?${params}`);
}

export function fetchRanking(limit = 20): Promise<RankingResponse> {
  return getJson<RankingResponse>(`/api/ranking?limit=${limit}`);
}

export function fetchChart(symbol: string, timeframe: Timeframe): Promise<ChartResponse> {
  return getJson<ChartResponse>(`/api/stocks/${encodeURIComponent(symbol)}/chart?timeframe=${timeframe}`);
}

export function fetchPaDefaultAnalysis(symbol: string): Promise<PaDefaultResult> {
  return getJson<PaDefaultResult>(`/api/stocks/${encodeURIComponent(symbol)}/pa-analysis`);
}

export function fetchSearch(q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(`/api/stocks/search?q=${encodeURIComponent(q)}`);
}

export function fetchBriefs(symbols: string[]): Promise<BriefsResponse> {
  return getJson<BriefsResponse>(`/api/stocks/briefs?symbols=${encodeURIComponent(symbols.join(","))}`);
}

export function fetchTrends(symbols: string[]): Promise<TrendsResponse> {
  return getJson<TrendsResponse>(`/api/stocks/trends?symbols=${encodeURIComponent(symbols.join(","))}`);
}

export function fetchStrategyEval(symbol: string, strategyId: string): Promise<StrategyEval> {
  return getJson<StrategyEval>(`/api/strategy/evaluate?symbol=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}`);
}

export function fetchStrategyScan(symbols: string[], strategyId: string): Promise<StrategyScanResponse> {
  return getJson<StrategyScanResponse>(`/api/strategy/scan?symbols=${encodeURIComponent(symbols.join(","))}&strategyId=${encodeURIComponent(strategyId)}`);
}

export function fetchMarketStrategyScan(strategyId: string): Promise<MarketStrategyScanResponse> {
  return getJson<MarketStrategyScanResponse>(`/api/strategy/market-scan?strategyId=${encodeURIComponent(strategyId)}`);
}

export function fetchEntryWatch(symbols: string[]): Promise<EntryWatchResponse> {
  return getJson<EntryWatchResponse>(`/api/entry-watch?symbols=${encodeURIComponent(symbols.join(","))}`);
}

export function fetchChipCard(date?: string): Promise<ChipCardData> {
  const params = date ? `?date=${encodeURIComponent(date)}` : "";
  return getJson<ChipCardData>(`/api/chipcard${params}`);
}

export function fetchOptionsOI(date?: string): Promise<{ data: OptionsOIData | null; error: string | null }> {
  const params = date ? `?date=${encodeURIComponent(date)}` : "";
  return getJson<{ data: OptionsOIData | null; error: string | null }>(`/api/options/oi${params}`);
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return getJson<DashboardResponse>("/api/dashboard");
}

export function fetchPantlasOverview(): Promise<MarketOverview> {
  return getJson<MarketOverview>("/api/pantlas/overview");
}

export function fetchStockSignals(symbols: string[]): Promise<StockSignalsResponse> {
  const list = symbols.filter(Boolean).slice(0, 50);
  if (list.length === 0) return Promise.resolve({ asOf: "", signals: [] });
  return getJson<StockSignalsResponse>(`/api/stocks/signals?symbols=${encodeURIComponent(list.join(","))}`);
}

export function fetchStockSignal(symbol: string): Promise<StockSignal> {
  return getJson<StockSignal>(`/api/stocks/${encodeURIComponent(symbol)}/signal`);
}

import type { MarketRegime } from "@shared/types";
export type { StockBrief };

export async function fetchRegime(lookback?: number): Promise<MarketRegime> {
  const params = lookback ? `?lookback=${lookback}` : "";
  return getJson<MarketRegime>(`/api/regime${params}`);
}

export async function fetchTodayRegime(): Promise<MarketRegime> {
  return getJson<MarketRegime>("/api/regime/today");
}

/** 籌碼分歧（外資 vs 散戶）：規則引擎自動判斷，見 shared/chip-divergence.ts */
export async function fetchChipDivergence(): Promise<ChipDivergenceResult> {
  return getJson<ChipDivergenceResult>("/api/chip-divergence");
}

/** 散戶（小台/微台）留倉：全市場未平倉 − 三大法人未平倉推算，公式未經真實資料驗證，見 MEMORY-chip-divergence-engine.md */
export async function fetchRetailFutures(contract: "MTX" | "TMF" = "TMF"): Promise<RetailFuturesPosition> {
  return getJson<RetailFuturesPosition>(`/api/retail-futures?contract=${contract}`);
}

/* ---------- Phase 3+ 自訂策略 API ---------- */

export async function fetchUserStrategies(userId: string): Promise<{ strategies: UserStrategyDef[]; count: number }> {
  return getJson<{ strategies: UserStrategyDef[]; count: number }>(`/api/users/${encodeURIComponent(userId)}/strategies`);
}

export async function createUserStrategy(
  userId: string,
  payload: { name: string; desc: string; filters: ConditionGroup; triggers: ConditionGroup; invalidations?: ConditionGroup },
): Promise<UserStrategyDef> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/strategies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<UserStrategyDef>;
}

export async function updateUserStrategy(
  userId: string,
  strategyId: string,
  payload: { name?: string; desc?: string; filters?: ConditionGroup; triggers?: ConditionGroup; invalidations?: ConditionGroup },
): Promise<UserStrategyDef | null> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/strategies/${encodeURIComponent(strategyId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<UserStrategyDef>;
}

export async function deleteUserStrategy(userId: string, strategyId: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/strategies/${encodeURIComponent(strategyId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

/* ---------- 回測 API ---------- */

export async function runBacktestApi(params: BacktestParams & { userId?: string }): Promise<BacktestResult> {
  const query = params.userId ? `?userId=${encodeURIComponent(params.userId)}` : "";
  const { userId, ...body } = params;
  const res = await fetch(`/api/backtest${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyData = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(bodyData.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<BacktestResult>;
}
