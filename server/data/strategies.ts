import type { MarketFacts } from "../../shared/levels";
import type { Quote, StrategyDef, StrategyEval, StrategyStatus, ZoneStatus } from "../../shared/types";
import { buildMarketFacts } from "../../shared/levels";
import { buildIndicatorFacts, type IndicatorFacts } from "../../shared/indicators";
import { getCachedCandles } from "./providers/yahoo-cache";
import { fetchYahooCandles, ySymbolCandidates } from "./providers/yahoo";
import { TtlCache } from "./cache";
import type { Snapshot } from "./hotzones";
import { buildIndustryZones } from "./hotzones";

/**
 * B3 策略層（v2）
 * 九個內建策略（命名＝股流水流宇宙）：
 *  - 聲納 pa_default：條件式 PA 基礎雷達
 *  - 破浪 breakout-pullback：前高突破 → 回踩不破 → 止跌 K
 *  - 順流 institution-tailwind：當日法人明顯買超＋支撐回踩（B0 後升級「連買 3 日」）
 *  - 潮流 trend-follow：上升結構中的回調，跌破前 HL 失效
 *  - 潮間帶 range-fade：震盪箱體邊緣反轉；區間中間不交易
 *  - 回湧 volume-refill：MA25 上方地量回檔，量能拐頭＋陽線（2560 戰法）
 *  - 破堤 ma21-break：MA21 走平向上，3% 帶量突破或連 3 天站穩（2133 戰法）
 *  - 鯨躍 deep-reversal：下跌趨勢中開低收復昨低的關鍵反轉 K＋超跌（123 法）
 *  - 洋流 ma200-current：MA200 斜率向上的回調買點，MA21 聯動出場（200 生命線）
 * 規則只引用 PA 事實（shared/levels）、指標事實（shared/indicators）與籌碼欄位，
 * 同一輸入必同一輸出；觸發語句一律為條件式，不構成下單指令。
 */

export const STRATEGIES: StrategyDef[] = [
  { id: "pa_default", name: "聲納", desc: "條件式 PA 基礎雷達：支撐區附近＋反轉 K 即響" },
  { id: "breakout-pullback", name: "破浪", desc: "前高突破 → 回踩不破支撐 → 止跌 K 確認" },
  { id: "institution-tailwind", name: "順流", desc: "當日法人買超 ≥ 1 億＋板塊升溫＋回踩確認（B0 後升級連買 3 日）" },
  { id: "trend-follow", name: "潮流", desc: "上升結構中自前高回調、HL 之上等反轉 K" },
  { id: "range-fade", name: "潮間帶", desc: "震盪箱體下緣反轉；區間中間不交易" },
  { id: "volume-refill", name: "回湧", desc: "MA25 上方地量回檔，量能拐頭＋陽線確認（2560 戰法）" },
  { id: "ma21-break", name: "破堤", desc: "MA21 走平向上，3% 帶量突破或連 3 天站穩（2133 戰法）" },
  { id: "deep-reversal", name: "鯨躍", desc: "下跌趨勢中開低收復昨低的關鍵反轉 K＋超跌確認（123 法）" },
  { id: "ma200-current", name: "洋流", desc: "MA200 斜率向上的回調買點，MA21 聯動減碼出場（200 生命線）" },
];

export interface SymbolFacts {
  facts: MarketFacts | null;
  ind: IndicatorFacts | null;
  candles: number;
}

const factsCache = new TtlCache<SymbolFacts>(10 * 60 * 1000);

/** 取個股日線事實（Yahoo 2y：MA200 需要；PA 事實固定用近 130 根，維持既有行為） */
export async function getFacts(snapshot: Snapshot, symbol: string): Promise<SymbolFacts> {
  const key = `${snapshot.asOf}:${symbol}`;
  const cached = factsCache.get(key);
  if (cached) return cached;
  const quote = snapshot.bySymbol.get(symbol);
  let result: SymbolFacts = { facts: null, ind: null, candles: 0 };
  for (const ySymbol of ySymbolCandidates(symbol, quote?.market)) {
    try {
      const { candles } = await getCachedCandles(ySymbol, "2y", "1d");
      result = {
        facts: buildMarketFacts(candles.slice(-130)),
        ind: buildIndicatorFacts(candles),
        candles: candles.length,
      };
      break;
    } catch {
      /* 換下一個候選代號 */
    }
  }
  factsCache.set(key, result);
  return result;
}

interface EvalContext {
  facts: MarketFacts | null;
  ind: IndicatorFacts | null;
  quote: Quote | null;
  zoneStatus: ZoneStatus | null;
  /** 當日法人買超（億；上市為限） */
  flowYi: number | null;
}

const ev = (status: StrategyStatus, met: string[], missing: string[], note: string): { status: StrategyStatus; met: string[]; missing: string[]; note: string } => ({ status, met, missing, note });

const nearSupport = (f: MarketFacts, close: number) => {
  if (!f.support) return false;
  const width = Math.max(f.support.high - f.support.low, f.support.high * 0.01);
  return close <= f.support.high + width * 0.75 && close >= f.support.low - width * 0.5;
};

const hasBullPattern = (f: MarketFacts, confirmedOnly: boolean) =>
  f.patterns.some((p) => p.name.startsWith("多頭") && (confirmedOnly ? p.status === "已確認" : true));

/** 各策略條件評估（做多觀點；做空情境由研判六段框架另行呈現） */
function evaluateOne(id: string, ctx: EvalContext): { status: StrategyStatus; met: string[]; missing: string[]; note: string } {
  const { facts, ind, quote, zoneStatus, flowYi } = ctx;
  if (!facts || !quote || !Number.isFinite(quote.close)) {
    return ev("insufficient", [], ["日線資料不足 30 根或查無行情"], "無法評估，不勉強給訊號");
  }
  const close = quote.close;
  const f = facts;

  if (id === "pa_default") {
    const met: string[] = [];
    const missing: string[] = [];
    if (f.support) {
      if (nearSupport(f, close)) met.push(`價格在支撐區 ${f.support.low.toFixed(0)}–${f.support.high.toFixed(0)} 附近`);
      else missing.push(`回到支撐區 ${f.support.low.toFixed(0)}–${f.support.high.toFixed(0)} 附近`);
    } else missing.push("尚無可確認的支撐區");
    const bull = hasBullPattern(f, false);
    if (bull) met.push("出現多頭反轉 K（Pin Bar／吞沒）");
    else missing.push("等待多頭反轉 K（含未確認）");
    if (f.trend === "上升") met.push("日線結構上升");
    else if (f.trend === "震盪") missing.push("結構震盪，偏好等待方向");
    else missing.push("結構下降，做多條件弱");
    const triggered = f.support && nearSupport(f, close) && bull && f.trend !== "下降";
    return ev(
      triggered ? "triggered" : "waiting",
      met,
      missing,
      triggered ? "聲納響了：條件齊備，進研判頁核對六段框架與失效位" : "聲納掃描中：條件未齊，先等待",
    );
  }

  if (id === "breakout-pullback") {
    if (!f.support || !f.resistance) return ev("waiting", [], ["尚未形成支撐＋壓力雙重結構"], "破浪需要明確的結構");
    const met: string[] = [];
    const missing: string[] = [];
    const brokeOut = f.resistance && close >= f.support.high && (f.resistance.touches >= 1);
    if (brokeOut) met.push(`前高壓力區 ${f.resistance.low.toFixed(0)}–${f.resistance.high.toFixed(0)} 已被站上`);
    else missing.push("尚未有效站上前高壓力區");
    const pullback = close <= (f.entryZone?.high ?? f.support.high * 1.02);
    if (pullback) met.push("自高點回踩至進場觀察區");
    else missing.push("尚未回踩至進場觀察區");
    const holding = close > (f.invalidation ?? f.support.low);
    if (holding) met.push(`未跌破結構失效位 ${f.invalidation?.toFixed(0)}`);
    else return ev("no-trade", met, ["已跌破結構失效位"], "結構破壞，破浪失效");
    const bull = hasBullPattern(f, false);
    if (bull) met.push("回踩後出現多頭反轉 K");
    else missing.push("等待回踩止跌 K（Pin Bar／吞沒）");
    const triggered = brokeOut && pullback && holding && bull;
    return ev(triggered ? "triggered" : "waiting", met, missing, triggered ? "破浪成型：突破後回踩有撐，核對 R:R 再說" : "破浪等待中");
  }

  if (id === "institution-tailwind") {
    const met: string[] = [];
    const missing: string[] = [];
    if (flowYi == null) return ev("insufficient", [], ["無法人買賣超資料（上櫃或來源異常）"], "順流需要法人資料");
    if (flowYi >= 1) met.push(`當日法人買超 ${flowYi.toFixed(1)} 億（≥ 1 億）`);
    else if (flowYi < 0) return ev("no-trade", [`當日法人賣超 ${Math.abs(flowYi).toFixed(1)} 億`], [], "法人站在賣方，順流不逆風");
    else missing.push(`當日法人買超僅 ${flowYi.toFixed(1)} 億（未達 1 億門檻）`);
    if (zoneStatus === "聚焦" || zoneStatus === "升溫") met.push(`所屬板塊${zoneStatus}`);
    else missing.push(`所屬板塊尚未升溫（${zoneStatus ?? "未知"}）`);
    if (f.support && nearSupport(f, close)) met.push("回踩支撐區附近");
    else missing.push("尚未回踩支撐區");
    const bullConfirmed = hasBullPattern(f, true);
    const bullAny = hasBullPattern(f, false);
    if (bullConfirmed) met.push("多頭反轉 K 已確認");
    else if (bullAny) missing.push("反轉 K 尚未收確認");
    else missing.push("等待支撐區的多頭吞沒／Pin Bar");
    const triggered = flowYi >= 1 && (zoneStatus === "聚焦" || zoneStatus === "升溫") && f.support && nearSupport(f, close) && bullConfirmed;
    return ev(triggered ? "triggered" : "waiting", met, missing, triggered ? "順流成型：法人、板塊、結構三方共振" : "順流等待中");
  }

  if (id === "trend-follow") {
    if (f.trend !== "上升") {
      return ev("no-trade", [`日線結構：${f.trend}`], [], "潮流只做上升結構；非上升不看多");
    }
    const met: string[] = ["日線結構上升（HH、HL）"];
    const missing: string[] = [];
    const lastLow = f.swings.lastLow?.price ?? f.invalidation;
    const lastHigh = f.swings.lastHigh?.price;
    const hlIntact = lastLow != null && close > lastLow;
    if (hlIntact) met.push(`站上最後 HL（${lastLow.toFixed(0)}）`);
    else return ev("no-trade", [], [`已跌破前 HL ${lastLow?.toFixed(0)}`], "結構失效，潮流轉向");
    const pullback = lastHigh != null && close < lastHigh;
    if (pullback) met.push("自前高回調中（非追高位置）");
    else missing.push("仍在高位，未出現回調");
    const bull = hasBullPattern(f, false);
    if (bull) met.push("回調中出現多頭 K");
    else missing.push("等待回調止跌 K");
    const triggered = hlIntact && pullback && bull;
    return ev(triggered ? "triggered" : "waiting", met, missing, triggered ? "潮流可乘：回調有撐，順勢條件成立" : "潮流觀察中：等回調與止跌");
  }

  if (id === "range-fade") {
    if (f.trend !== "震盪" || !f.support || !f.resistance) {
      return ev("waiting", [], ["需要震盪結構＋上下緣支撐壓力"], "潮間帶只做明確箱體");
    }
    const rangeLow = f.support.low;
    const rangeHigh = f.resistance.high;
    const pos = (close - rangeLow) / Math.max(1e-9, rangeHigh - rangeLow);
    if (pos > 0.33 && pos < 0.67) {
      return ev("no-trade", [`位於箱體 ${(pos * 100).toFixed(0)}%`], [], "區間中間不交易——潮間帶的鐵律");
    }
    const met: string[] = [`箱體位置 ${(pos * 100).toFixed(0)}%`];
    const missing: string[] = [];
    if (pos <= 0.33) {
      met.push("位於箱體下緣 1/3");
      const bull = hasBullPattern(f, false);
      if (bull) met.push("下緣出現反轉 K");
      else missing.push("等待下緣反轉 K");
      const triggered = bull;
      return ev(triggered ? "triggered" : "waiting", met, missing, triggered ? "潮間帶下緣反轉：條件成立" : "潮間帶下緣觀察中");
    }
    return ev("waiting", [...met, "位於箱體上緣（做多條件不成立）"], ["除非有效突破，上緣只做空方條件"], "上緣非做多位置");
  }

  /* ---------- 指標型四戰法（v2） ---------- */

  if (id === "volume-refill") {
    if (!ind || ind.ma[25] == null || ind.volMa[60] == null || ind.volMa[5] == null) {
      return ev("insufficient", [], ["歷史資料不足（需至少 25 根日 K＋量）"], "回湧需要均線與量能資料");
    }
    const ma25 = ind.ma[25] as number;
    const volMa60 = ind.volMa[60] as number;
    const volMa5 = ind.volMa[5] as number;
    const met: string[] = [];
    const missing: string[] = [];
    const c1 = close > ma25;
    if (c1) met.push(`收盤站上 MA25（${ma25.toFixed(1)}）`);
    else missing.push(`收盤未站上 MA25（${ma25.toFixed(1)}）`);
    const c2 = ind.lastVolume < volMa60;
    if (c2) met.push("成交量低於 60 日均量（地量，拋壓竭盡）");
    else missing.push("成交量尚未縮至 60 日均量之下");
    const ratio = volMa60 !== 0 ? Math.abs(volMa5 / volMa60 - 1) : null;
    const stick = ratio != null && ratio <= 0.15;
    if (stick) met.push(`5 日／60 日均量粘合（差 ${((ratio ?? 0) * 100).toFixed(1)}%）`);
    else missing.push(`5 日／60 日均量未粘合（差 ${ratio != null ? (ratio * 100).toFixed(1) : "?"}%，門檻 15%）`);
    const turn = ind.volMaPrev[5] != null && volMa5 > (ind.volMaPrev[5] as number);
    if (turn) met.push("5 日均量拐頭向上");
    else missing.push("5 日均量尚未拐頭");
    if (ind.isBullCandle) met.push("當日收陽（紅 K 確認）");
    else missing.push("等待收陽確認");
    if (ind.isBearCandle && (ind.volumeRatio5 ?? 0) >= 1.5) {
      return ev("no-trade", ["放量陰線：空頭發力"], [], "假拐點避坑——量能拐頭當日若為放量陰線，訊號失效");
    }
    const triggered = c1 && c2 && stick && turn && ind.isBullCandle;
    return ev(
      triggered ? "triggered" : "waiting",
      met,
      missing,
      triggered ? "回湧成型：地量之後量能拐頭，陽線確認。失效：收盤跌破 MA25 或再現放量陰線" : "回湧觀察中：等地量＋拐頭＋陽線三件事",
    );
  }

  if (id === "ma21-break") {
    if (!ind || ind.ma[21] == null || ind.maPrev[21] == null) {
      return ev("insufficient", [], ["歷史資料不足 21 根"], "破堤需要 MA21");
    }
    const ma21 = ind.ma[21] as number;
    const ma21Prev = ind.maPrev[21] as number;
    if (!(ma21 >= ma21Prev)) {
      return ev("no-trade", [`MA21 下彎（${ma21.toFixed(1)} < 前一日 ${ma21Prev.toFixed(1)}）`], [], "堤防下移，破堤不看");
    }
    const met: string[] = ["MA21 走平或向上"];
    const missing: string[] = [];
    const space = close >= ma21 * 1.03;
    const volOk = (ind.volumeRatio5 ?? 0) >= 1.5;
    if (space) {
      if (volOk) met.push(`收盤超越 MA21 達 3% 以上（量能 ${(ind.volumeRatio5 ?? 0).toFixed(1)}× 於 5 日均量）`);
      else missing.push(`空間已達 3%，但量能僅 ${(ind.volumeRatio5 ?? 0).toFixed(1)}×——無量突破視為誘多觀察`);
    } else {
      missing.push(`收盤未達 MA21×1.03（門檻 ${(ma21 * 1.03).toFixed(1)}）`);
    }
    const time = ind.daysAboveMa[21] >= 3 && close > ma21;
    if (time) met.push(`連續 ${ind.daysAboveMa[21]} 天站上 MA21（時間確認）`);
    else if (!space) missing.push(`連續站上 MA21 天數 ${ind.daysAboveMa[21]}/3`);
    const triggered = (space && volOk) || time;
    return ev(
      triggered ? "triggered" : "waiting",
      met,
      missing,
      triggered ? "破堤成功：空間（3% 帶量）或時間（3 天站穩）擇一確認。失效：收盤跌破 MA21 3% 或連 3 天收不回，全面出場" : "破堤等待中：空間與時間擇一即響",
    );
  }

  if (id === "deep-reversal") {
    if (!ind || ind.bias[5] == null || ind.prevLow == null) {
      return ev("insufficient", [], ["歷史資料不足"], "鯨躍需要昨日低點與 BIAS(5)");
    }
    if (f.trend !== "下降") {
      return ev("no-trade", [`日線結構：${f.trend}`], [], "鯨躍只做下跌趨勢中的反擊；非下跌不接刀");
    }
    const prevLow = ind.prevLow;
    const met: string[] = ["處於下跌趨勢（拒絕追高的前提成立）"];
    const missing: string[] = [];
    const c2 = quote.open < prevLow;
    if (c2) met.push(`開盤跌破昨日最低（${prevLow.toFixed(1)}）`);
    else missing.push(`開盤未跌破昨日最低（${prevLow.toFixed(1)}）`);
    const c3 = close > prevLow;
    if (c3) met.push("收盤收復昨日最低（關鍵反轉 K）");
    else missing.push("收盤未收復昨日最低");
    const b = ind.bias[5] as number;
    const c4 = b < -3;
    if (c4) met.push(`BIAS(5) = ${b.toFixed(1)}%（< -3%，超跌確認）`);
    else missing.push(`BIAS(5) = ${b.toFixed(1)}%，未達 -3%`);
    const triggered = c2 && c3 && c4;
    return ev(
      triggered ? "triggered" : "waiting",
      met,
      missing,
      triggered
        ? `鯨躍：深水翻身成立。此型屬逆勢接刀、勝率天然較低，實務上常以較小風險試單；停損＝訊號 K 最低 ${ind.lastLow.toFixed(1)}，跌破即離場`
        : "鯨躍觀察中：等深水裡的關鍵反轉 K。失效：收盤跌破訊號 K 最低點",
    );
  }

  if (id === "ma200-current") {
    if (!ind || ind.ma[200] == null || ind.ma[21] == null) {
      return ev("insufficient", [], ["歷史資料不足 200 根（需 2 年日線）"], "洋流需要 MA200");
    }
    const ma200 = ind.ma[200] as number;
    const ma21 = ind.ma[21] as number;
    if (!ind.ma200Rising) {
      return ev("no-trade", ["MA200 斜率向下"], [], "長期洋流向下，主洋流不做多");
    }
    const met: string[] = ["MA200 斜率向上（長期趨勢向上）"];
    const missing: string[] = [];
    const touch = quote.low <= ma200 && close > ma200;
    const nearby = close > ma200 && close <= ma200 * 1.02;
    if (touch) met.push(`回調觸碰 MA200（${ma200.toFixed(0)}）後收回——主力洗盤低風險點`);
    else if (nearby) met.push(`貼近 MA200 上方（2% 內）尚未破——買盤強勢`);
    else missing.push(`尚未回到 MA200（${ma200.toFixed(0)}）附近`);
    const ma21Prev = ind.maPrev[21];
    const ma21Flat = ma21Prev != null && ma21Prev !== 0 && Math.abs(ma21 - ma21Prev) / ma21Prev <= 0.002;
    if (ma21Flat) met.push("MA21 走平（法則：小趨勢轉弱，先行減碼 50%）");
    if (close < ma21 * 0.97) {
      return ev("no-trade", ["收盤跌破 MA21 達 3%"], [], "生命線法則：MA21 聯動，全面出場");
    }
    const triggered = touch || nearby;
    return ev(
      triggered ? "triggered" : "waiting",
      met,
      missing,
      triggered
        ? "主洋流買點：長線趨勢上的低風險回調區。出場節奏：MA21 走平減碼 50%；跌破 MA21 3% 或連 3 天收不回，全面出場"
        : "洋流觀察中：等回調至 MA200 附近的低風險買點",
    );
  }

  return ev("insufficient", [], ["未知策略 id"], "");
}

export function evaluateStrategy(id: string, ctx: EvalContext, symbol: string): StrategyEval {
  const def = STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
  const r = evaluateOne(id, ctx);
  return {
    strategyId: def.id,
    strategyName: def.name,
    symbol,
    name: ctx.quote?.name ?? symbol,
    status: r.status,
    met: r.met,
    missing: r.missing,
    note: r.note,
    close: ctx.quote?.close ?? null,
    changeAmt: ctx.quote ? ctx.quote.close - ctx.quote.prevClose : null,
    changePct: ctx.quote?.changePct ?? null,
  };
}

/* ---------- 戰法×法人買超 Top 100（全市場掃描的資金流短名單版） ---------- */

const marketScanCache = new TtlCache<{ rows: StrategyEval[]; scanned: number; scopeNote: string }>(30 * 60 * 1000);

export async function scanMarketStrategy(
  strategyId: string,
  snapshot: Snapshot,
  limit = 100,
): Promise<{ asOf: string; strategyId: string; scanned: number; scopeNote: string; rows: StrategyEval[] }> {
  if (!STRATEGIES.some((s) => s.id === strategyId)) throw new Error("未知策略 id");
  const key = `${strategyId}:${snapshot.asOf}`;
  const cached = marketScanCache.get(key);
  if (cached) {
    return { asOf: snapshot.asOf, strategyId, scanned: cached.scanned, scopeNote: cached.scopeNote, rows: cached.rows };
  }
  const pool = snapshot.quotes
    .filter((q) => q.netBuyValue != null)
    .sort((a, b) => (b.netBuyValue ?? 0) - (a.netBuyValue ?? 0))
    .slice(0, limit);
  const zones = buildIndustryZones(snapshot);
  const queue = pool.map((q) => q.symbol);
  const rows: StrategyEval[] = [];
  const evalOne = async (symbol: string) => {
    const quote = snapshot.bySymbol.get(symbol);
    if (!quote) return;
    const { facts, ind } = await getFacts(snapshot, symbol);
    const zoneStatus = zones.find((z) => z.id === quote.industry)?.status ?? null;
    const flowYi = quote.netBuyValue != null ? quote.netBuyValue / 1e8 : null;
    rows.push(evaluateStrategy(strategyId, { facts, ind, quote, zoneStatus, flowYi }, symbol));
  };
  const worker = async () => {
    while (queue.length > 0) {
      const s = queue.shift();
      if (s != null) await evalOne(s);
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  const order: Record<StrategyStatus, number> = { triggered: 0, waiting: 1, "no-trade": 2, insufficient: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status]);
  const scopeNote = `掃描範圍：法人買超前 ${pool.length} 名（上市，B0 歷史管線後擴及全市場）`;
  marketScanCache.set(key, { rows, scanned: pool.length, scopeNote });
  return { asOf: snapshot.asOf, strategyId, scanned: pool.length, scopeNote, rows };
}
