/**
 * 股流 Radar｜API 契約型別
 * server 與 client 共用；欄位即產品承諾，改動需同步文件。
 */

export type Market = "twse" | "tpex";
export type Timeframe = "1w" | "1d" | "60m" | "15m";
export type ZoneStatus = "聚焦" | "升溫" | "分歧" | "觀望" | "退潮";

/** 個股日報價（盤後） */
export interface Quote {
  symbol: string;
  name: string;
  market: Market;
  industry: string | null;
  prevClose: number;
  close: number;
  open: number;
  high: number;
  low: number;
  /** 漲跌幅 %，除權等異常為 null */
  changePct: number | null;
  /** 成交股數 */
  volumeShares: number;
  /** 成交值（元） */
  value: number;
  /** 三大法人合計買賣超（股）；上櫃 v0 無資料為 null */
  netBuyShares: number | null;
  /** netBuyShares × close 估算金額（元） */
  netBuyValue: number | null;
}

export interface StockBrief {
  symbol: string;
  name: string;
  market: Market;
  industry: string | null;
  close: number;
  changePct: number | null;
  changeAmt: number | null;
  netBuyValue: number | null;
}

/** 熱度四成分（各 0–100），對應規格 35/25/20/20 */
export interface ZoneComponents {
  flow: number;
  price: number;
  volume: number;
  breadth: number;
}

export interface HotZone {
  id: string;
  name: string;
  count: number;
  /** 法人買賣超估算金額（億元；上市為限） */
  flowValue: number;
  /** 等權平均漲跌幅 % */
  changePct: number;
  /** 成交值占全市場比重（0–1） */
  turnoverShare: number;
  /** 類股成交值（億元） */
  turnoverValue: number;
  gainers: number;
  losers: number;
  flat: number;
  /** 上漲家數占比（0–100） */
  breadth: number;
  components: ZoneComponents;
  /** 熱度分數 0–100（排序用，非預測報酬） */
  score: number;
  /** 近 5 日平均熱度（0–100） */
  avg5d?: number;
  /** 近 20 日平均熱度（0–100） */
  avg20d?: number;
  status: ZoneStatus;
  topStocks: StockBrief[];
}

export interface MarketSummary {
  advance: number;
  decline: number;
  flat: number;
  /** 全市場成交值（億元） */
  totalValue: number;
  /** 三大法人合計買賣超（億元；上市） */
  institutionalNet: number;
  institutionalCoverage: string;
}

/** 今日重點（規則引擎生成，非新聞） */
export interface MarketHighlights {
  /** 廣度溫度計 0–100 與標籤 */
  sentiment: { value: number; label: string; advance: number; decline: number };
  /** 法人買超最多的板塊 Top 3 */
  topFlow: { id: string; name: string; status: ZoneStatus; flowValue: number; changePct: number }[];
  /** 大戶異常：單一個股法人買賣超金額突出者 */
  whales: { symbol: string; name: string; netBuyValue: number; changePct: number | null }[];
}

export interface HotzonesResponse {
  /** 交易資料日期，如 2026-09-04 */
  asOf: string;
  generatedAt: string;
  summary: MarketSummary;
  /** 主題板塊（策展，主要視角） */
  zones: HotZone[];
  /** 官方產業別（證交所/櫃買分類，次要視角） */
  industryZones: HotZone[];
  highlights: MarketHighlights;
  sources: string[];
  notes: string[];
}

export interface Candle {
  /** 1w/1d：YYYY-MM-DD；分K：YYYY-MM-DD HH:mm（台北時間） */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartResponse {
  symbol: string;
  name: string;
  industry: string | null;
  timeframe: Timeframe;
  prevClose: number;
  candles: Candle[];
  source: string;
  asOf: string;
}

export interface ScanStock extends StockBrief {
  zone: string | null;
  /** 所屬熱區熱度分數 */
  zoneScore: number | null;
  /** 成交值（億元） */
  value: number;
}

export interface ScanResponse {
  asOf: string;
  zone: string | null;
  stocks: ScanStock[];
}

/** 全市場法人買賣超排名（上市為限） */
export interface RankingResponse {
  asOf: string;
  buy: StockBrief[];
  sell: StockBrief[];
}

export interface SearchResponse {
  asOf: string;
  results: StockBrief[];
}

export interface BriefsResponse {
  asOf: string;
  found: StockBrief[];
  notFound: string[];
}

/** 自選股批次趨勢標籤（v0 規則，日線） */
export interface TrendEntry {
  symbol: string;
  trend: "上升" | "下降" | "震盪" | null;
  confidence: "高" | "中" | "低" | null;
  close: number | null;
  changePct: number | null;
}

export interface TrendsResponse {
  asOf: string;
  trends: TrendEntry[];
}

/* ---------- B3 策略層 ---------- */

export type StrategyStatus = "triggered" | "waiting" | "no-trade" | "insufficient";

export interface StrategyDef {
  id: string;
  name: string;
  desc: string;
}

/** 策略條件評估結果：只引用 PA 事實與籌碼欄位，可重現、可測試 */
export interface StrategyEval {
  strategyId: string;
  strategyName: string;
  symbol: string;
  name: string;
  status: StrategyStatus;
  /** 已確認符合的條件 */
  met: string[];
  /** 尚缺的條件 */
  missing: string[];
  note: string;
  close: number | null;
  changeAmt: number | null;
  changePct: number | null;
}

export interface StrategyScanResponse {
  asOf: string;
  strategyId: string;
  rows: StrategyEval[];
}

/** 戰法×法人買超 Top 100（資金流短名單版的全市場掃描） */
export interface MarketStrategyScanResponse {
  asOf: string;
  strategyId: string;
  scanned: number;
  scopeNote: string;
  rows: StrategyEval[];
}

/** 近進場區批次掃描：判斷收盤價與 PA 進場區（支撐回踩區）的距離 */
export type EntryWatchStatus = "in-zone" | "approaching" | "far" | "no-zone" | "insufficient";

export interface EntryWatchItem {
  symbol: string;
  name: string;
  close: number | null;
  changePct: number | null;
  entryZone: { low: number; high: number } | null;
  /** 距進場區上緣的百分比距離；已在區內為 0，跌破下緣為距下緣距離 */
  distancePct: number | null;
  status: EntryWatchStatus;
}

export interface EntryWatchResponse {
  asOf: string;
  items: EntryWatchItem[];
}

export interface MetaResponse {
  service: string;
  asOf: string | null;
  generatedAt: string;
  sources: string[];
  notes: string[];
}

/* ---------- 籌碼卡（TAIFEX 三大法人期貨/選擇權）---------- */

/** 三大法人單一身份 */
export type LargeTrader = "外資及陸資" | "自營商" | "投信";

export interface TraderBias {
  trader: LargeTrader;
  /** 多空方向：多 / 空 / 接近平衡 */
  futuresBias: "long" | "short" | "flat";
  /** 期貨未平倉淨額（口） */
  futuresNetOI: number;
  /** 期貨今日買賣超淨額（口） */
  futuresNetTrade: number;
  /** 期貨未平倉淨額近似新台幣億元（粗略估） */
  futuresNetValueYi: number;
  /** 選擇權未平倉淨額（口） */
  optionsNetOI: number;
  /** 選擇權今日買賣超淨額（口） */
  optionsNetTrade: number;
  /** 人話描述 */
  description: string;
}

export interface TopFutureContract {
  /** 契約名稱，例：「臺股期貨」 */
  name: string;
  /** 外資未平倉淨額（口），正=多、負=空 */
  foreignNetOI: number;
  /** 方向標籤 */
  bias: "long" | "short" | "flat";
  /** 人話簡述 */
  description: string;
}

export interface ChipCardData {
  asOf: string;
  /** 三大法人各別分析 */
  traders: TraderBias[];
  /** 整體市場方向（外資 + 自營商 加權） */
  marketBias: "long" | "short" | "flat";
  marketBiasDescription: string;
  /** 台指選擇權 P/C 比（今日） */
  putCallRatio: number | null;
  putCallBias: "long" | "short" | "flat";
  putCallDescription: string;
  /** 近 3 日 P/C 趨勢 */
  pcTrend: (number | null)[];
  /** 熱門期貨契約 TOP 5（外資未平倉絕對值排序） */
  topFutures: TopFutureContract[];
}

export interface OptionContractOI {
  contractCode: string;
  name: string;
  /** 外資未平倉淨額（口），正=多、負=空 */
  foreignNetOI: number;
  /** 自營商未平倉淨額（口） */
  dealerNetOI: number;
  /** 多空方向 */
  bias: "long" | "short" | "flat";
}

export interface OptionsOIData {
  asOf: string;
  /** 各契約外資未平倉（排序：按絕對值） */
  contracts: OptionContractOI[];
  /** 今日 P/C 比 */
  putCallRatio: number | null;
  /** 近 5 日 P/C 比趨勢 */
  pcTrend: (number | null)[];
  /** 外資各契約合計淨額（口） */
  totalForeignNetOI: number;
  marketBias: "long" | "short" | "flat";
  marketBiasDescription: string;
}

export interface OptionsOISnapshotResponse {
  data: OptionsOIData | null;
  error: string | null;
}

/* ---------- v2 散戶版 Dashboard & Signal 型別 ---------- */

export interface InstitutionalBreakdown {
  foreign: number; // 外資及陸資買賣超股數
  trust: number;   // 投信買賣超股數
  dealer: number;  // 自營商買賣超股數
  total: number;   // 三大法人合計買賣超股數
}

export interface MarketMood {
  date: string;
  summaryText: string;
  sentiment: "樂觀" | "偏多" | "中性" | "偏空" | "恐慌";
  foreignFlow: number; // 億元
  trustFlow: number;   // 億元
  dealerFlow: number;  // 億元
  retailMood: "追漲" | "殺跌" | "觀望" | "猶豫" | "偏多" | "偏空";
}

export interface TopFiveEntry {
  symbol: string;
  name: string;
  flow: number; // 億元
}

export interface TopFiveGroup {
  foreign: TopFiveEntry[];
  trust: TopFiveEntry[];
  dealer: TopFiveEntry[];
}

export interface TopicBoard {
  id: string;
  name: string;
  changePct: number;
  flowValue: number;
  tag: string;
  topStocks: StockBrief[];
}

export interface DashboardResponse {
  asOf: string;
  mood: MarketMood;
  topics: TopicBoard[];
  topBuys: TopFiveGroup;
  topSells: TopFiveGroup;
  /** 來自 Pantlas 的產業資金流向（±億元） */
  sectorFlows: SectorFlow[];
}

export interface SectorFlow {
  sector: string;
  foreign5D: number; // 億元
  trust5D: number;   // 億元
  dealer5D: number;  // 億元
  total5D: number;   // 億元
  stockCount: number;
}

export interface MarketOverview {
  dataAsOf: string;
  advancers: number;
  decliners: number;
  unchanged: number;
  turnoverBillion: number; // 億
  estimatedLimitUp: number;
  estimatedLimitDown: number;
}

export interface StockSignalBrief {
  symbol: string;
  name: string;
  close: number;
  changePct: number | null;
  changeAmt: number | null;
  status: "觀察中" | "可留意" | "不建議" | "條件符合";
  statusReason: string;
  ma20: number | null;
  industry: string | null;
  /** Pantlas 補充欄位 */
  pantlas?: {
    sector: string | null;
    foreignNet5D: number | null; // 億元
    trustNet5D: number | null;   // 億元
    pe: number | null;
  };
}

export interface StockSignalsResponse {
  asOf: string;
  signals: StockSignalBrief[];
}

export interface StrategyMatch {
  name: string;
  matchPct: number; // 0–100
  status: "符合" | "等待中" | "不適用";
  plainText: string;
}

export interface StockSignal {
  symbol: string;
  name: string;
  industry: string | null;
  close: number;
  changePct: number | null;
  changeAmt: number | null;
  status: "觀察中" | "可留意" | "不建議" | "條件符合";
  statusReason: string;
  pricePosition: {
    current: number;
    ma20: number | null;
    ma60: number | null;
    support: [number, number] | null;
    resistance: [number, number] | null;
    /** 結構失效位（PA事實層 f.invalidation），移動停利的初始基準，見 shared/trailing-stop.ts */
    invalidation: number | null;
    /** 最近一個已確認的 HL（f.swings.lastLow?.price），移動停利棘輪往上移動的依據 */
    recentSwingLow: number | null;
  };
  strategies: StrategyMatch[];
  advice: string[];
  institutional: {
    foreign: number | null; // 億元
    trust: number | null;
    dealer: number | null;
  };
  /** 各法人連買超天數（正=連續買超，負=連續賣超，0=無歷史或今日無買賣） */
  consecutiveDays: {
    foreign: number;
    trust: number;
    dealer: number;
  };
  /** Pantlas 補充：5 日法人累積（億元）*/
  pantlas5D: {
    foreign: number | null;
    trust: number | null;
    dealer: number | null;
  } | null;
  /** Pantlas 補充：估值 */
  pantlasFundamentals: {
    pe: number | null;
    pbr: number | null;
    dividendYield: number | null;
    grossMarginPercent: number | null;
    revenueYoY: number | null;
    latestQuarter: string | null;
  } | null;
  asOf: string;
}

/* ---------- 會員系統 ---------- */

export interface WatchlistEntry {
  symbol: string;
  groups: string[];
}

export interface AuthUser {
  id: string;
  username: string;
  createdAt: string;
  watchlist: WatchlistEntry[];
}

export interface LoginResponse {
  user: AuthUser;
  token: string;
}

export interface AuthError {
  error: string;
}

/* ---------- B5 狀態機 ---------- */

/** 市場狀態等級 */
export type RegimeLevel = "強多" | "偏多" | "震盪" | "偏空" | "強空";

/** 市場狀態回應 */
export interface MarketRegime {
  /** 當前市場狀態 */
  regime: RegimeLevel;
  /** 綜合分數（-1 到 1） */
  score: number;
  /** 使用的歷史天數 */
  lookbackDays: number;
  /** 實際有資料的天數 */
  dataPoints: number;
  /** 趨勢方向 */
  trend: "轉強" | "轉弱" | "穩定";
  /** 歷史記錄 */
  history: RegimeHistoryEntry[];
  /** 備註 */
  note: string;
}

/** 單日狀態歷史 */
export interface RegimeHistoryEntry {
  date: string;
  breadthPct: number; // 漲幅家數比
  instNetYi: number; // 法人淨流入（億元）
  totalValueYi: number; // 總成交值（億元）
  score: number; // -1 to 1
  regime: RegimeLevel;
}

/* ---------- Phase 3+ 回測型別 ---------- */

export interface BacktestSignal {
  index: number;
  date: string;
  type: "entry" | "exit_win" | "exit_loss" | "exit_timeout";
  price: number;
  reason: string;
  rr?: number;
}

export interface BacktestStats {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  totalReturnPct: number;
  maxLossPct: number;
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  avgHoldDays: number;
}

export interface BacktestResult {
  symbol: string;
  strategyId: string;
  strategyName: string;
  period: { start: string; end: string };
  totalCandles: number;
  signals: BacktestSignal[];
  stats: BacktestStats;
  equityCurve: number[];
  dailyPnl: Array<{ date: string; pnl: number }>;
}

export interface BacktestParams {
  symbol: string;
  /** 策略 ID（前端調用時必填） */
  strategyId?: string;
  /** 全策略物件（伺服器內部使用） */
  strategy?: any;
  rangeDays?: number;
  stopLossPct?: number;
  takeProfitRatio?: number;
  maxHoldDays?: number;
}

export interface BatchBacktestResult {
  symbol: string;
  results: Array<{ strategyId: string; strategyName: string; result: BacktestResult }>;
}


