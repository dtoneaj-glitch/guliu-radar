import type {
  HotZone,
  HotzonesResponse,
  InstitutionalBreakdown,
  MarketHighlights,
  MarketSummary,
  Quote,
  ScanResponse,
  ScanStock,
  StockBrief,
  ZoneStatus,
  SectorFlow,
} from "../../shared/types";
import { TtlCache } from "./cache";
import { saveSnapshot, listArchiveDates, loadArchiveDate } from "./archive";
import { fetchIndustryMap } from "./providers/finmind";
import { fetchTpexDaily, fetchTpexInstitutional } from "./providers/tpex";
import { fetchTwseDailyAll, fetchTwseInstitutional } from "./providers/twse";
import { THEMES, THEME_ID_PREFIX } from "./themes";

/**
 * 熱區引擎（v0）
 * 熱度＝資金流向 35% ＋ 價格強度 25% ＋ 成交值集中度 20% ＋ 上漲廣度 20%
 * 雙軌分類：主題板塊（策展，主要視角）＋官方產業別（證交所/櫃買，次要視角）。
 * v0 邊界：單日資料；資金成分僅涵蓋上市（T86）；量能成分為成交值集中度代理。
 * 分數為排序用內部指標，不代表預測報酬，也不是買賣建議。
 */

export interface Snapshot {
  asOf: string;
  generatedAt: string;
  quotes: Quote[];
  bySymbol: Map<string, Quote>;
  summary: MarketSummary;
  institutional: Map<string, InstitutionalBreakdown> | null;
}

const snapshotCache = new TtlCache<Snapshot>(10 * 60 * 1000);
const industryCache = new TtlCache<Map<string, { market: "twse" | "tpex"; industry: string; name: string }>>(24 * 60 * 60 * 1000);

export async function getSnapshot(): Promise<Snapshot> {
  const cached = snapshotCache.get("snapshot");
  if (cached) return cached;

  const twse = await fetchTwseDailyAll();
  const [tpex, industry, inst, tpexInst] = await Promise.all([
    fetchTpexDaily(twse.date).catch(() => null),
    industryCache.get("map") ?? fetchIndustryMap().then((m) => (industryCache.set("map", m), m)),
    fetchTwseInstitutional(twse.date).catch(() => null),
    fetchTpexInstitutional(twse.date).catch(() => null),
  ]);

  const quotes: Quote[] = [];
  for (const row of twse.rows) {
    const info = industry.get(row.symbol);
    const breakdown = inst?.get(row.symbol);
    const netShares = breakdown?.total ?? null;
    quotes.push({
      symbol: row.symbol,
      name: row.name || info?.name || row.symbol,
      market: "twse",
      industry: info?.industry || null,
      prevClose: row.close - row.change,
      close: row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      changePct: row.change !== 0 && Number.isFinite(row.change) ? (row.change / (row.close - row.change)) * 100 : 0,
      volumeShares: row.volumeShares,
      value: row.value,
      netBuyShares: netShares,
      netBuyValue: netShares != null ? netShares * row.close : null,
    });
  }
  if (tpex) {
    for (const row of tpex.rows) {
      const info = industry.get(row.symbol);
      const breakdown = tpexInst?.get(row.symbol);
      const netShares = breakdown?.total ?? null;
      quotes.push({
        symbol: row.symbol,
        name: row.name || info?.name || row.symbol,
        market: "tpex",
        industry: info?.industry || null,
        prevClose: row.change != null ? row.close - row.change : row.close,
        close: row.close,
        open: row.open,
        high: row.high,
        low: row.low,
        changePct: row.change != null && row.close - row.change !== 0 ? (row.change / (row.close - row.change)) * 100 : 0,
        volumeShares: row.volumeShares,
        value: row.value,
        netBuyShares: netShares,
        netBuyValue: netShares != null ? netShares * row.close : null,
      });
    }
  }

  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  let advance = 0;
  let decline = 0;
  let flat = 0;
  let totalValue = 0;
  let institutionalNet = 0;
  for (const q of quotes) {
    totalValue += q.value;
    if (q.changePct == null) flat += 1;
    else if (q.changePct > 0) advance += 1;
    else if (q.changePct < 0) decline += 1;
    else flat += 1;
    if (q.netBuyValue != null) institutionalNet += q.netBuyValue;
  }
  const combinedInstitutional: Map<string, InstitutionalBreakdown> | null =
    inst || tpexInst ? new Map([...(inst ?? new Map()), ...(tpexInst ?? new Map())]) : null;

  const coverageLabel = (() => {
    if (inst && tpexInst) return "上市（TWSE）＋上櫃（TPEx）法人買賣超";
    if (inst) return "僅上市（TWSE）法人買賣超；上櫃今日暫時無法取得";
    if (tpexInst) return "僅上櫃（TPEx）法人買賣超；上市今日暫時無法取得";
    return "法人資料暫時無法取得";
  })();

  const summary: MarketSummary = {
    advance,
    decline,
    flat,
    totalValue: totalValue / 1e8,
    institutionalNet: institutionalNet / 1e8,
    institutionalCoverage: coverageLabel,
  };

  const snapshot: Snapshot = {
    asOf: twse.date,
    generatedAt: new Date().toISOString(),
    quotes,
    bySymbol,
    summary,
    institutional: combinedInstitutional,
  };
  snapshotCache.set("snapshot", snapshot);
  // 每日快照寫入 archive，供 B0 歷史查詢用（寫入失敗不影響主流程）
  try { saveSnapshot(snapshot.asOf, snapshot, combinedInstitutional); } catch { /* ignore */ }
  return snapshot;
}

/* ---------- 板塊聚合（主題與產業共用評分） ---------- */

interface ZoneDraft {
  id: string;
  name: string;
  members: Quote[];
}

/** 百分位（0–100）：以所有板塊的相對位置計算 */
function percentile(values: number[], v: number): number {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  for (const x of sorted) {
    if (x < v) below += 1;
    else break;
  }
  return (below / (sorted.length - 1)) * 100;
}

/** 四象限＋中性：資金與漲幅皆近於 0 時為「觀望」，不誤判為退潮 */
function classifyStatus(flowValue: number, changePct: number, breadth: number): ZoneStatus {
  const neutralFlow = Math.abs(flowValue) < 0.5; // 億
  const neutralPct = Math.abs(changePct) < 0.2; // %
  if (neutralFlow && neutralPct) return "觀望";
  const flowSign = Math.sign(flowValue);
  const priceSign = Math.sign(changePct);
  if (flowSign > 0 && priceSign > 0) return breadth >= 50 ? "聚焦" : "升溫";
  if (flowSign < 0 && priceSign < 0) return "退潮";
  if (flowSign !== priceSign) return "分歧";
  return flowSign > 0 ? "升溫" : "退潮";
}

function scoreZones(drafts: ZoneDraft[], totalMarketValue: number): HotZone[] {
  const usable = drafts.filter((d) => d.members.length >= 3);
  const flowValues = usable.map((d) => d.members.reduce((s, q) => s + (q.netBuyValue ?? 0), 0) / 1e8);
  const pctValues = usable.map((d) => {
    const withPct = d.members.filter((q) => q.changePct != null);
    return withPct.length > 0 ? withPct.reduce((s, q) => s + (q.changePct ?? 0), 0) / withPct.length : 0;
  });
  const shareValues = usable.map((d) => d.members.reduce((s, q) => s + q.value, 0) / (totalMarketValue * 1e8 || 1));

  return usable
    .map((d, i) => {
      const members = d.members;
      const flowValue = flowValues[i];
      const changePct = pctValues[i];
      const turnoverValue = members.reduce((s, q) => s + q.value, 0) / 1e8;
      const gainers = members.filter((q) => (q.changePct ?? 0) > 0).length;
      const losers = members.filter((q) => (q.changePct ?? 0) < 0).length;
      const flat = members.length - gainers - losers;
      const breadth = (gainers / members.length) * 100;
      const flowScore = percentile(flowValues, flowValue);
      const priceScore = percentile(pctValues, changePct);
      const volumeScore = percentile(shareValues, shareValues[i]);
      const breadthScore = breadth;
      const score = 0.35 * flowScore + 0.25 * priceScore + 0.2 * volumeScore + 0.2 * breadthScore;
      const topStocks = [...members]
        .sort((a, b) => (b.netBuyValue ?? b.value * 0) - (a.netBuyValue ?? a.value * 0))
        .slice(0, 5)
        .map(briefOf);
      return {
        id: d.id,
        name: d.name,
        count: members.length,
        flowValue,
        changePct,
        turnoverShare: shareValues[i],
        turnoverValue,
        gainers,
        losers,
        flat,
        breadth,
        components: { flow: flowScore, price: priceScore, volume: volumeScore, breadth: breadthScore },
        score: Math.round(score * 10) / 10,
        status: classifyStatus(flowValue, changePct, breadth),
        topStocks,
      } satisfies HotZone;
    })
    .sort((a, b) => b.score - a.score);
}

export function buildIndustryZones(snapshot: Snapshot): HotZone[] {
  const groups = new Map<string, Quote[]>();
  for (const q of snapshot.quotes) {
    if (!q.industry) continue;
    const list = groups.get(q.industry);
    if (list) list.push(q);
    else groups.set(q.industry, [q]);
  }
  const drafts: ZoneDraft[] = [];
  for (const [name, members] of groups) {
    if (name === "ETF" || name === "存託憑證" || name === "受益證券") continue; // 非類股，排除
    drafts.push({ id: name, name, members });
  }
  return scoreZones(drafts, snapshot.summary.totalValue);
}

export function buildThemeZones(snapshot: Snapshot): HotZone[] {
  const drafts: ZoneDraft[] = THEMES.map((t) => ({
    id: THEME_ID_PREFIX + t.id,
    name: t.name,
    members: t.symbols.map((s) => snapshot.bySymbol.get(s)).filter((q): q is Quote => q != null),
  }));
  return scoreZones(drafts, snapshot.summary.totalValue);
}

function briefOf(q: Quote): StockBrief {
  return {
    symbol: q.symbol,
    name: q.name,
    market: q.market,
    industry: q.industry,
    close: q.close,
    changePct: q.changePct,
    changeAmt: q.close - q.prevClose,
    netBuyValue: q.netBuyValue,
  };
}

const notes = [
  "熱度分數為內部排序指標，不代表預測報酬，也不是買賣建議。",
  "v0 熱度：單日資料；資金成分僅涵蓋上市法人（T86）；量能成分為成交值集中度代理。",
  "主題板塊為人工策展（一檔股票可屬多主題），成員名單由產品維護，非官方分類。",
];

/** 今日重點（規則引擎生成；昨日回顧需歷史管線，Phase 2） */
function buildHighlights(snapshot: Snapshot, themes: HotZone[]): MarketHighlights {
  const { summary } = snapshot;
  const denom = summary.advance + summary.decline;
  const value = denom > 0 ? Math.round((summary.advance / denom) * 100) : 50;
  const label = value >= 70 ? "樂觀" : value >= 60 ? "偏多" : value >= 45 ? "中性" : value >= 35 ? "偏空" : "恐慌";
  const topFlow = themes
    .filter((z) => z.flowValue > 0)
    .sort((a, b) => b.flowValue - a.flowValue)
    .slice(0, 3)
    .map((z) => ({ id: z.id, name: z.name, status: z.status, flowValue: z.flowValue, changePct: z.changePct }));
  const withFlow = snapshot.quotes.filter((q) => q.netBuyValue != null);
  const buyWhales = [...withFlow]
    .sort((a, b) => (b.netBuyValue ?? 0) - (a.netBuyValue ?? 0))
    .slice(0, 4)
    .filter((q) => (q.netBuyValue ?? 0) >= 1e9);
  const sellWhales = [...withFlow]
    .sort((a, b) => (a.netBuyValue ?? 0) - (b.netBuyValue ?? 0))
    .slice(0, 2)
    .filter((q) => (q.netBuyValue ?? 0) <= -1e9);
  const whales = [...buyWhales, ...sellWhales].map((q) => ({
    symbol: q.symbol,
    name: q.name,
    netBuyValue: q.netBuyValue ?? 0,
    changePct: q.changePct,
  }));
  return { sentiment: { value, label, advance: summary.advance, decline: summary.decline }, topFlow, whales };
}

export async function getHotzones(): Promise<HotzonesResponse> {
  const snapshot = await getSnapshot();
  const themes = buildThemeZones(snapshot);
  const industries = buildIndustryZones(snapshot);
  const rolling = buildRollingAverages();
  return {
    asOf: snapshot.asOf,
    generatedAt: snapshot.generatedAt,
    summary: snapshot.summary,
    zones: withRollingAverages(themes, rolling.theme),
    industryZones: withRollingAverages(industries, rolling.industry),
    highlights: buildHighlights(snapshot, themes),
    sources: ["TWSE OpenAPI（上市行情）", "TWSE T86（三大法人）", "TPEx 公開資料（上櫃行情）", "FinMind（產業分類）", "主題板塊：人工策展表"],
    notes,
  };
}

/** 解析板塊成員（主題或官方產業別） */
function membersOfZone(snapshot: Snapshot, zoneId: string): Quote[] | null {
  if (zoneId.startsWith(THEME_ID_PREFIX)) {
    const theme = THEMES.find((t) => THEME_ID_PREFIX + t.id === zoneId);
    if (!theme) return null;
    return theme.symbols.map((s) => snapshot.bySymbol.get(s)).filter((q): q is Quote => q != null);
  }
  return snapshot.quotes.filter((q) => q.industry === zoneId);
}

export async function getZoneStocks(zoneId: string): Promise<{ asOf: string; zone: string; stocks: ScanStock[] } | null> {
  const snapshot = await getSnapshot();
  const zones = [...buildThemeZones(snapshot), ...buildIndustryZones(snapshot)];
  const zone = zones.find((z) => z.id === zoneId || z.name === zoneId);
  if (!zone) return null;
  const members = [...(membersOfZone(snapshot, zone.id) ?? [])]
    .sort((a, b) => (b.netBuyValue ?? -1) - (a.netBuyValue ?? -1))
    .slice(0, 40);
  return {
    asOf: snapshot.asOf,
    zone: zone.name,
    stocks: members.map((q) => ({ ...briefOf(q), zone: zone.name, zoneScore: zone.score, value: q.value / 1e8 })),
  };
}

export async function getScan(zoneId: string | null, limit = 20): Promise<ScanResponse> {
  const snapshot = await getSnapshot();
  const zones = buildThemeZones(snapshot);
  const rows: ScanStock[] = [];
  const seen = new Set<string>(); // 一檔股票可屬多主題，掃描結果需去重
  const selected = zoneId ? zones.filter((z) => z.id === zoneId || z.name === zoneId) : zones.slice(0, 12);
  for (const zone of selected) {
    const members = [...(membersOfZone(snapshot, zone.id) ?? [])]
      .sort((a, b) => (b.netBuyValue ?? -1) - (a.netBuyValue ?? -1))
      .slice(0, 4);
    for (const q of members) {
      if (seen.has(q.symbol)) continue;
      seen.add(q.symbol);
      rows.push({ ...briefOf(q), zone: zone.name, zoneScore: zone.score, value: q.value / 1e8 });
    }
  }
  rows.sort((a, b) => (b.netBuyValue ?? -1e9) - (a.netBuyValue ?? -1e9));
  return { asOf: snapshot.asOf, zone: zoneId, stocks: rows.slice(0, limit) };
}

export function searchStocks(snapshot: Snapshot, query: string, limit = 12): StockBrief[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...snapshot.quotes]
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map(briefOf);
  }
  const hits: Quote[] = [];
  for (const quote of snapshot.quotes) {
    if (quote.symbol.includes(q) || quote.name.toLowerCase().includes(q)) hits.push(quote);
    if (hits.length >= limit) break;
  }
  return hits.map(briefOf);
}

export function getBriefs(snapshot: Snapshot, symbols: string[]): { found: StockBrief[]; notFound: string[] } {
  const found: StockBrief[] = [];
  const notFound: string[] = [];
  for (const s of symbols) {
    const q = snapshot.bySymbol.get(s.trim());
    if (q) found.push(briefOf(q));
    else notFound.push(s.trim());
  }
  return { found, notFound };
}

/** 全市場法人買賣超排名（上市為限，金額＝股數×收盤估算） */
export function getRanking(snapshot: Snapshot, limit = 20): { asOf: string; buy: StockBrief[]; sell: StockBrief[] } {
  const withFlow = snapshot.quotes.filter((q) => q.netBuyValue != null);
  const buy = [...withFlow].sort((a, b) => (b.netBuyValue ?? 0) - (a.netBuyValue ?? 0)).slice(0, limit).map(briefOf);
  const sell = [...withFlow].sort((a, b) => (a.netBuyValue ?? 0) - (b.netBuyValue ?? 0)).slice(0, limit).map(briefOf);
  return { asOf: snapshot.asOf, buy, sell };
}

/* ---------- 產業動能條（由上市 T86 法人資料按 industry 聚合） ---------- */

/**
 * 把 snapshot 中的上市quotes依 industry 分組，
 * 從 institutional map 取出每日法人股數 × 收盤價，換算為億元。
 */
export function buildSectorFlows(snapshot: Snapshot): SectorFlow[] {
  const groups = new Map<string, { foreign: number; trust: number; dealer: number; count: number }>();
  if (!snapshot.institutional) return [];
  for (const q of snapshot.quotes) {
    if (!q.industry || q.market !== "twse") continue;
    const inst = snapshot.institutional.get(q.symbol);
    if (!inst) continue;
    const key = q.industry;
    if (!groups.has(key)) groups.set(key, { foreign: 0, trust: 0, dealer: 0, count: 0 });
    const g = groups.get(key)!;
    g.foreign += (inst.foreign ?? 0) * q.close;
    g.trust  += (inst.trust  ?? 0) * q.close;
    g.dealer += (inst.dealer ?? 0) * q.close;
    g.count += 1;
  }
  return [...groups.entries()]
    .filter(([sec]) => !["ETF", "存託憑證", "受益證券"].includes(sec))
    .map(([sector, g]) => ({
      sector,
      foreign5D: Math.round(g.foreign / 1e8 * 10) / 10,
      trust5D:   Math.round(g.trust  / 1e8 * 10) / 10,
      dealer5D:  Math.round(g.dealer / 1e8 * 10) / 10,
      total5D:   Math.round((g.foreign + g.trust + g.dealer) / 1e8 * 10) / 10,
      stockCount: g.count,
    }))
    .sort((a, b) => b.total5D - a.total5D);
}


/** 從 archive 重建 Snapshot（用於歷史回算，例如近 N 日熱度平均） */
function buildSnapshotFromArchive(archive: ReturnType<typeof loadArchiveDate>): Snapshot | null {
  if (!archive) return null;

  // changePct 直接沿用存檔當下算好的值（close vs prevClose），不要用 close/open 重算
  // ——那是當日振幅不是漲跌幅，重算會是錯的。
  const quotes: Quote[] = archive.quotes;
  const bySymbol = new Map<string, Quote>(quotes.map((q) => [q.symbol, q]));

  const totalValueRaw = quotes.reduce((sum, q) => sum + (q.value ?? 0), 0);
  const advance = quotes.filter((q) => (q.changePct ?? 0) > 0).length;
  const decline = quotes.filter((q) => (q.changePct ?? 0) < 0).length;
  const flat = quotes.length - advance - decline;

  return {
    asOf: archive.meta.date,
    generatedAt: archive.meta.generatedAt,
    quotes,
    bySymbol,
    institutional: archive.institutional,
    summary: {
      advance,
      decline,
      flat,
      totalValue: totalValueRaw / 1e8,
      institutionalNet: archive.summary.institutionalNetYi,
      institutionalCoverage: archive.summary.institutionalCoverage,
    },
  };
}

interface ZoneRollingAvg {
  avg5d: number | null;
  avg20d: number | null;
}

function averageOf(scoresNewToOld: number[], n: number): number | null {
  const slice = scoresNewToOld.slice(0, n);
  if (slice.length === 0) return null;
  return Math.round((slice.reduce((s, v) => s + v, 0) / slice.length) * 10) / 10;
}

/**
 * 一次計算「主題」與「產業」兩種板塊在近 20 個已存檔交易日的平均熱度分數。
 *
 * 效率設計：只掃描一次歷史存檔（最多 20 天），每天各重建一次 snapshot + 各板塊分數，
 * 取代舊版 calculateRollingAvg() 對「每一個 zone」各自重跑一次歷史的寫法
 * （O(zones × days) 次 archive 讀取 → O(days) 次）。
 *
 * 已知限制：只算「已存檔」的交易日，不含今日盤中即時分數（今日收盤後存檔才會計入）；
 * 資料未滿 5／20 天時，回傳的是「有幾天算幾天」的平均，不是嚴格 5 日／20 日均。
 */
function buildRollingAverages(): { theme: Map<string, ZoneRollingAvg>; industry: Map<string, ZoneRollingAvg> } {
  const dates = listArchiveDates().slice(0, 20); // 已是倒序（最新在前）
  const themeScores = new Map<string, number[]>();
  const industryScores = new Map<string, number[]>();

  const pushScore = (map: Map<string, number[]>, id: string, score: number) => {
    const arr = map.get(id);
    if (arr) arr.push(score);
    else map.set(id, [score]);
  };

  for (const date of dates) {
    const snapshot = buildSnapshotFromArchive(loadArchiveDate(date));
    if (!snapshot) continue;
    for (const z of buildThemeZones(snapshot)) pushScore(themeScores, z.id, z.score);
    for (const z of buildIndustryZones(snapshot)) pushScore(industryScores, z.id, z.score);
  }

  const toAvgMap = (scores: Map<string, number[]>): Map<string, ZoneRollingAvg> =>
    new Map([...scores.entries()].map(([id, arr]) => [id, { avg5d: averageOf(arr, 5), avg20d: averageOf(arr, 20) }]));

  return { theme: toAvgMap(themeScores), industry: toAvgMap(industryScores) };
}

/** 把近 5／20 日平均熱度併回 zone 清單（找不到歷史資料的 zone 保持 undefined） */
function withRollingAverages(zones: HotZone[], avgMap: Map<string, ZoneRollingAvg>): HotZone[] {
  return zones.map((z) => {
    const avg = avgMap.get(z.id);
    return avg ? { ...z, avg5d: avg.avg5d ?? undefined, avg20d: avg.avg20d ?? undefined } : z;
  });
}
