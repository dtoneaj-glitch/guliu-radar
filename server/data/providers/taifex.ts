import { fetchJson, num } from "../cache";

/**
 * TAIFEX 供應商：台灣期貨交易所三大法人籌碼 API（完全免費，無需金鑰）
 *
 * 核心端點：
 *   /v1/MarketDataOfMajorInstitutionalTradersDividedByFuturesAndOptionsBytheDate
 *   /v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate
 *   /v1/PutCallRatio
 *
 * 資料每日盤後公布（約 16:00～20:00），快取 1 小時即可。
 */

// ── Raw types（欄位名稱含括號，必須用字串索引）─────────────────────────────────

interface DividedRow {
  Date: string;
  Item: string;
  "FuturesTradingVolume(Net)": string;
  "OptionsTradingVolume(Net)": string;
  "FuturesTradingValue(Net)(Thousands)": string;
  "OptionsTradingValue(Net)(Thousands)": string;
  "FuturesOpenInterest(Net)": string;
  "OptionsOpenInterest(Net)": string;
  "FuturesContractValueofOpenInterest(Net)(Thousands)": string;
  "OptionsContractValueofOpenInterest(Net)(Thousands)": string;
}

interface FuturesContractRow {
  Date: string;
  ContractCode: string;
  Item: string;
  "OpenInterest(Net)": string;
  "OpenInterest(Long)": string;
  "OpenInterest(Short)": string;
  "TradingVolume(Net)": string;
}

interface PutCallRow {
  Date: string;
  "PutCallVolumeRatio%": string;
  "PutCallOIRatio%": string;
}

/** 期貨每日行情（DailyMarketReportFut）單一列，欄位名稱未經真實 API 驗證，見 fetchRetailFuturesPosition 內的容錯處理 */
interface DailyFutRow {
  [key: string]: string | undefined;
}

// ── Public types ─────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const TRADER_ORDER: LargeTrader[] = ["外資及陸資", "自營商", "投信"];

function biasFromNet(n: number): "long" | "short" | "flat" {
  if (n > 5000) return "long";
  if (n < -5000) return "short";
  return "flat";
}

function traderDescription(t: TraderBias): string {
  const fAbs = Math.abs(t.futuresNetOI).toLocaleString();
  const fVal = t.futuresNetValueYi;
  const fValNote = fVal > 0 ? `（約值 ${fVal} 億）` : "";
  const fTradeNote =
    t.futuresNetTrade !== 0
      ? `今日${t.futuresNetTrade > 0 ? "回補" : "加码"}${Math.abs(t.futuresNetTrade).toLocaleString()} 口`
      : "";
  const oDir = t.optionsNetOI !== 0
    ? (t.optionsNetOI > 0 ? "押多" : "押空")
    : null;
  const oTradeNote =
    t.optionsNetTrade !== 0
      ? `今日${t.optionsNetTrade > 0 ? "回補" : "加码"}${Math.abs(t.optionsNetTrade).toLocaleString()} 口`
      : "";

  const fPart = `${t.trader}：期貨${t.futuresBias === "long" ? "押多" : t.futuresBias === "short" ? "押空" : "接近平衡"}${fValNote}（${fAbs} 口）${fTradeNote ? "。" + fTradeNote : ""}`;
  const parts = [fPart + (oDir || fTradeNote ? "。" : "")];
  if (oDir) {
    parts.push(`選擇權${oDir}（${Math.abs(t.optionsNetOI).toLocaleString()} 口）。`);
    if (oTradeNote) parts.push(oTradeNote + "。");
  }
  return parts.join("");
}

/** 大戶方向 headline — 用大白話說明外資＋自營商綜合多空 */
function marketBiasDescription(marketNet: number): string {
  const abs = Math.abs(marketNet).toLocaleString();
  const bias = biasFromNet(marketNet);
  if (bias === "short") {
    if (marketNet < -500_000)
      return `大戶集體看跌——外資跟自營商一起押了 ${abs} 口空單，短期壓力比較大。`;
    return `大戶偏空——外資跟自營商總共押空 ${abs} 口，短期不太樂觀。`;
  }
  if (bias === "long") {
    if (marketNet > 500_000)
      return `大戶集體看漲——外資跟自營商一起押了 ${abs} 口多單，多方力道頗強。`;
    return `大戶偏多——外資跟自營商總共押多 ${abs} 口，短期傾向看漲。`;
  }
  return `大戶看法分歧——外資跟自營商多空互相抵消，沒有明顯方向。`;
}

/** 選擇權情緒 headline — 把 P/C 比轉成「大家有沒有在怕」的大白話 */
function putCallDescription(ratio: number | null): string {
  if (ratio == null) return "P/C 比無資料。";
  if (ratio > 140)
    return `選擇權市場很謹慎——Put/Call 比 ${ratio.toFixed(1)}%，買保護的人很多，大戶正在防範風險。`;
  if (ratio > 120)
    return `選擇權市場偏保守——Put/Call 比 ${ratio.toFixed(1)}%，大家多買防護、少追高，短期偏防守。`;
  if (ratio > 100)
    return `選擇權市場偏謹慎——Put/Call 比 ${ratio.toFixed(1)}%，多空力道差不多，但稍微偏保守一點。`;
  if (ratio > 80)
    return `選擇權市場中性——Put/Call 比 ${ratio.toFixed(1)}%，多空大概持平，沒有特別偏向哪一邊。`;
  return `選擇權市場偏樂觀——Put/Call 比 ${ratio.toFixed(1)}%，買上漲的人比較多，情緒偏正面。`;
}

function topFutureDescription(name: string, netOI: number): string {
  const bias = netOI > 0 ? "押多" : netOI < 0 ? "押空" : "接近平衡";
  const abs = Math.abs(netOI).toLocaleString();
  return `${name}：外資${bias} ${abs} 口。`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** 取得指定日期的籌碼卡資料。date=null 時自動找最近交易日（今日往前倒推 3 日）。 */
export async function fetchChipCard(date: string | null = null): Promise<ChipCardData> {
  const targetDate = date ?? (await findLatestTradingDate());
  const [divided, futuresDetails, pcData] = await Promise.all([
    fetchJson<DividedRow[]>(
      `https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDividedByFuturesAndOptionsBytheDate?date=${targetDate}`,
    ),
    fetchJson<FuturesContractRow[]>(
      `https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate?date=${targetDate}`,
    ),
    fetchJson<PutCallRow[]>("https://openapi.taifex.com.tw/v1/PutCallRatio"),
  ]);

  // ── 三大法人分析 ───────────────────────────────────────────────────────────
  const traders: TraderBias[] = TRADER_ORDER.map((trader) => {
    const row = divided.find((r) => r.Item === trader);
    if (!row) {
      const base: TraderBias = {
        trader,
        futuresBias: "flat",
        futuresNetOI: 0,
        futuresNetTrade: 0,
        futuresNetValueYi: 0,
        optionsNetOI: 0,
        optionsNetTrade: 0,
        description: `${trader}：無資料。`,
      };
      return base;
    }
    const fNetOI = num(row["FuturesOpenInterest(Net)"]);
    const oNetOI = num(row["OptionsOpenInterest(Net)"]);
    const fNetTrade = num(row["FuturesTradingVolume(Net)"]);
    const oNetTrade = num(row["OptionsTradingVolume(Net)"]);
    // 未平倉契約金額（千元）→ 新台幣億元
    // (千元 → 元：×1000；元 → 億元：÷100,000,000 → 綜合 ÷100,000)
    const fValueYi = Math.round(num(row["FuturesContractValueofOpenInterest(Net)(Thousands)"]) / 100000 * 10) / 10;
    return {
      trader,
      futuresBias: biasFromNet(fNetOI),
      futuresNetOI: fNetOI,
      futuresNetTrade: fNetTrade,
      futuresNetValueYi: Number.isFinite(fValueYi) ? fValueYi : 0,
      optionsNetOI: oNetOI,
      optionsNetTrade: oNetTrade,
      description: "", // 後填
    };
  });
  traders.forEach((t) => { t.description = traderDescription(t); });

  // ── 市場整體方向（外資 + 自營商，排除投信）────────────────────────────────
  const marketNet = traders
    .filter((t) => t.trader !== "投信")
    .reduce((sum, t) => sum + t.futuresNetOI, 0);
  const marketBias = biasFromNet(marketNet);
  const marketDesc = marketBiasDescription(marketNet);

  // ── P/C 比 ─────────────────────────────────────────────────────────────────
  // TAIFEX P/C API 的 Date 欄位是 YYYYMMDD；若今日無資料則取最近一筆
  const targetYmd = targetDate.replace(/-/g, "");
  const todayPC = pcData.find((r) => r.Date === targetYmd)
    ?? pcData.find((r) => r.Date < targetYmd);
  const pcRatio = todayPC ? num(todayPC["PutCallVolumeRatio%"]) : null;
  const pcBias = pcRatio == null ? "flat" : pcRatio > 120 ? "short" : pcRatio < 100 ? "long" : "flat";
  const pcDesc = putCallDescription(pcRatio);
  const pcTrend = pcData.slice(0, 3).map((r) => num(r["PutCallVolumeRatio%"]));

  // ── 熱門期貨契約 TOP 5（外資未平倉絕對值）────────────────────────────────
  const foreignFuturesMap = new Map<string, number>();
  for (const row of futuresDetails) {
    if (row.Item === "外資及陸資") {
      const net = num(row["OpenInterest(Net)"]);
      if (Number.isFinite(net)) foreignFuturesMap.set(row.ContractCode, net);
    }
  }
  const topFutures = Array.from(foreignFuturesMap.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([name, net]) => ({
      name,
      foreignNetOI: net,
      bias: biasFromNet(net),
      description: topFutureDescription(name, net),
    }));

  return {
    asOf: targetDate,
    traders,
    marketBias,
    marketBiasDescription: marketDesc,
    putCallRatio: pcRatio,
    putCallBias: pcBias,
    putCallDescription: pcDesc,
    pcTrend,
    topFutures,
  };
}

/** 從今日往前倒推，找到最近有資料的交易日（最多找 5 天）。 */
async function findLatestTradingDate(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    try {
      const data = await fetchJson<{ Date: string }[]>(
        `https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersGeneralBytheDate?date=${ymd}`,
      );
      if (data.length > 0) return ymd;
    } catch {
      /* 繼續往前找 */
    }
  }
  throw new Error("TAIFEX 近 5 日皆無資料");
}

// ── 選擇權未平倉（大盤籌碼頁）────────────────────────────────────────────────

export interface OptionContractOI {
  contractCode: string;
  name: string;
  /** 外資未平倉淨額（口），正=多、負=空 */
  foreignNetOI: number;
  /** 自營商未平倉淨額（口） */
  dealerNetOI: number;
  /** 投信未平倉淨額（口） */
  trustNetOI: number;
  /** 多空方向 */
  bias: "long" | "short" | "flat";
}

export interface OptionsOISnapshot {
  asOf: string;
  /** 各契約外資未平倉（排序：按絕對值） */
  contracts: OptionContractOI[];
  /** P/C 比（今日） */
  putCallRatio: number | null;
  /** 近 5 日 P/C 比趨勢 */
  pcTrend: (number | null)[];
  /** 外資各契約合計淨額 */
  totalForeignNetOI: number;
  marketBias: "long" | "short" | "flat";
  marketBiasDescription: string;
}

/** 取得指定日期各契約的外資未平倉淨額（口） */
export async function fetchOptionsOI(date: string): Promise<OptionContractOI[]> {
  const data = await fetchJson<Record<string, unknown>[]>(
    `https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfOptionsContractsBytheDate?date=${date}`,
  );

  // 只取外資及陸資 + 自營商的資料
  const itemFilter = ["外資及陸資", "自營商"];
  const map = new Map<string, { foreign: number; dealer: number }>();

  for (const row of data) {
    const code = row["ContractCode"] as string;
    const item = row["Item"] as string;
    const netOI = num(row["OpenInterest(Net)"]);
    if (!itemFilter.includes(item) || !Number.isFinite(netOI)) continue;
    const entry = map.get(code) ?? { foreign: 0, dealer: 0 };
    if (item === "外資及陸資") entry.foreign = netOI;
    else entry.dealer = netOI;
    map.set(code, entry);
  }

  // 名稱對照表
  const NAME_MAP: Record<string, string> = {
    "臺指選擇權": "台指選擇權",
    "電子選擇權": "電子選擇權",
    "金融選擇權": "金融選擇權",
    "台指選擇權": "台指選擇權",
    "ETF選擇權": "ETF選擇權",
    "股票選擇權": "個股選擇權",
  };

  return Array.from(map.entries())
    .map(([code, { foreign, dealer }]) => ({
      contractCode: code,
      name: NAME_MAP[code] ?? code,
      foreignNetOI: foreign,
      dealerNetOI: dealer,
      trustNetOI: 0,
      bias: biasFromNet(foreign),
    }))
    .sort((a, b) => Math.abs(b.foreignNetOI) - Math.abs(a.foreignNetOI));
}

/** 取得近 N 日的 P/C 比歷史 */
export async function fetchPCTrend(days = 5): Promise<(number | null)[]> {
  const data = await fetchJson<PutCallRow[]>("https://openapi.taifex.com.tw/v1/PutCallRatio");
  return data.slice(0, days).map((r) => num(r["PutCallVolumeRatio%"]));
}

/**
 * 取得大盤籌碼頁完整資料（選擇權 OI + P/C 趨勢）
 * date=null 時自動找最近交易日
 */
export async function fetchOptionsOISnapshot(date: string | null = null): Promise<OptionsOISnapshot> {
  const targetDate = date ?? (await findLatestTradingDate());
  const [contracts, pcTrend] = await Promise.all([
    fetchOptionsOI(targetDate),
    fetchPCTrend(5),
  ]);

  const totalForeignNetOI = contracts.reduce((s, c) => s + c.foreignNetOI, 0);
  const bias = biasFromNet(totalForeignNetOI);
  const todayPC = pcTrend[0];

  return {
    asOf: targetDate,
    contracts,
    putCallRatio: todayPC,
    pcTrend,
    totalForeignNetOI,
    marketBias: bias,
    marketBiasDescription: marketBiasDescription(totalForeignNetOI),
  };
}

// ── 散戶（小台/微台）多空比 ──────────────────────────────────────────────────
//
// TAIFEX 沒有直接公布「散戶多空比」這個欄位——業界（期貨商籌碼快訊、玩股網等）
// 的標準算法是：散戶（其他）未平倉 = 全市場未平倉 − 三大法人未平倉合計。
// 多空比＝散戶多方未平倉 ÷（散戶多方＋散戶空方）× 100%。
//
// 需要兩份資料：
//   1. DailyMarketReportFut（期貨每日行情）→ 全市場未平倉口數，本檔案先前未使用過，
//      實際回傳欄位名稱沒有機會實測驗證，用 pickField() 做多候選容錯。
//   2. MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate
//      （三大法人逐契約未平倉）→ fetchChipCard() 已經在用同一份資料算「熱門期貨契約」，
//      這裡重新抓一次並依三大法人加總。
//
// 常用契約代碼：MTX＝小型臺指期貨、TMF＝微型臺指期貨。

export interface RetailFuturesPosition {
  asOf: string;
  contractCode: string;
  /** 全市場未平倉（多方／空方，口數） */
  marketLong: number;
  marketShort: number;
  /** 三大法人合計未平倉（多方／空方，口數） */
  institutionalLong: number;
  institutionalShort: number;
  /** 散戶（其他）未平倉＝全市場－三大法人 */
  retailLong: number;
  retailShort: number;
  /** 散戶多方佔比 0–100（= retailLong / (retailLong + retailShort) × 100） */
  retailLongRatioPct: number | null;
}

/** 從一列 DailyFutRow 裡，依候選欄位名稱陣列找第一個有值的欄位（容錯：實際欄位名稱未經真實 API 驗證） */
function pickField(row: DailyFutRow, candidates: string[]): number {
  for (const key of candidates) {
    if (row[key] != null && row[key] !== "") return num(row[key]);
  }
  return 0;
}

/**
 * 計算指定契約（預設微型臺指 TMF）的散戶多空比。
 * date=null 時自動找最近交易日。
 *
 * ⚠️ DailyMarketReportFut 這份端點在本專案是第一次使用，欄位名稱是依 TAIFEX
 * 其他端點的命名慣例＋公開文件描述推測的，部署後第一次呼叫務必實際檢查
 * marketLong/marketShort 是否為合理非零數字，不是的話代表欄位名稱猜錯了，
 * 需要對照真實回應調整 pickField() 的候選清單。
 */
export async function fetchRetailFuturesPosition(
  contractCode: "MTX" | "TMF" = "TMF",
  date: string | null = null,
): Promise<RetailFuturesPosition | null> {
  const targetDate = date ?? (await findLatestTradingDate());

  try {
    const [dailyRows, institutionalRows] = await Promise.all([
      fetchJson<DailyFutRow[]>(`https://openapi.taifex.com.tw/v1/DailyMarketReportFut?date=${targetDate}`),
      fetchJson<FuturesContractRow[]>(
        `https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate?date=${targetDate}`,
      ),
    ]);

    // 全市場未平倉：加總該契約代碼底下所有到期月份的行（近月+遠月合計，避免月份判斷出錯）
    let marketLong = 0;
    let marketShort = 0;
    for (const row of dailyRows) {
      const code = row["ContractCode"] ?? row["Contract"] ?? row["契約代號"] ?? "";
      if (!code.startsWith(contractCode)) continue;
      marketLong += pickField(row, ["OpenInterest(Long)", "OpenInterestLong", "未沖銷契約數(多方)"]);
      marketShort += pickField(row, ["OpenInterest(Short)", "OpenInterestShort", "未沖銷契約數(空方)"]);
    }

    // 三大法人合計未平倉（外資及陸資＋投信＋自營商）
    let institutionalLong = 0;
    let institutionalShort = 0;
    for (const row of institutionalRows) {
      if (row.ContractCode !== contractCode) continue;
      institutionalLong += num(row["OpenInterest(Long)"]);
      institutionalShort += num(row["OpenInterest(Short)"]);
    }

    if (marketLong === 0 && marketShort === 0) {
      // DailyMarketReportFut 抓不到資料（欄位名稱可能猜錯，或當日無此契約資料），失敗安全回傳 null
      return null;
    }

    const retailLong = Math.max(0, marketLong - institutionalLong);
    const retailShort = Math.max(0, marketShort - institutionalShort);
    const retailTotal = retailLong + retailShort;

    return {
      asOf: targetDate,
      contractCode,
      marketLong,
      marketShort,
      institutionalLong,
      institutionalShort,
      retailLong,
      retailShort,
      retailLongRatioPct: retailTotal > 0 ? Math.round((retailLong / retailTotal) * 1000) / 10 : null,
    };
  } catch {
    return null;
  }
}
