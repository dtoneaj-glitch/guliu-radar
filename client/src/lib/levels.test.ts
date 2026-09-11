import { describe, expect, it } from "vitest";
import type { Candle } from "@shared/types";
import { buildMarketFacts, calculateATR, detectCandlePatterns, detectSwingPatterns, detectVolumeDivergence, findPivots, trendFromPivots } from "@shared/levels";

/**
 * v0 levels 的固定 fixtures（對應 docs/TESTING.md 的必測案例精神）。
 * 產生器必須確定性（同輸入同輸出），不得引入隨機。
 */

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  }));
}

/** 在錨點間線性插值，產生確定性的鋸齒走勢（每段固定 7 根，保證 Swing 轉折可被左右 3 根確認） */
function zigzag(anchors: number[], barsPerLeg = 7): Candle[] {
  const closes: number[] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    const from = anchors[a];
    const to = anchors[a + 1];
    for (let i = 1; i <= barsPerLeg; i++) {
      closes.push(from + ((to - from) * i) / barsPerLeg);
    }
  }
  return makeCandles(closes);
}

/** uptrend-hh-hl：上升 → 回調不破前低 → 再上升 */
function uptrendCandles(): Candle[] {
  return zigzag([100, 116, 110, 128, 121, 140]);
}

/** downtrend-lh-ll：下降 → 反彈不破前高 → 再下降 */
function downtrendCandles(): Candle[] {
  return zigzag([180, 160, 168, 148, 156, 136]);
}

/** range-double-top：兩次觸頂的箱型 */
function doubleTopCandles(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 40; i++) {
    const wave = Math.sin((i / 40) * Math.PI * 2);
    closes.push(110 + wave * 8);
  }
  closes[10] = 118;
  closes[30] = 118.2;
  return makeCandles(closes);
}

/** breakout-pullback：突破前高後回踩不破 */
function breakoutPullbackCandles(): Candle[] {
  return zigzag([95, 105, 102, 106, 113, 108, 110]);
}

/** false-breakout：衝破前高後收回區間內 */
function falseBreakoutCandles(): Candle[] {
  return zigzag([95, 105, 100, 105, 108, 100.5, 101]);
}

/** insufficient-data：少於 30 根 */
function shortCandles(): Candle[] {
  return makeCandles([100, 101, 102, 103, 104]);
}

/** double-top：兩次觸頂價位相近，中間頸線明顯較低，最後跌破頸線確認 */
function doubleTopConfirmedCandles(): Candle[] {
  return zigzag([100, 120, 100, 121, 85], 8);
}

/** double-bottom：兩次觸底價位相近，中間頸線明顯較高，最後突破頸線確認 */
function doubleBottomConfirmedCandles(): Candle[] {
  return zigzag([120, 100, 120, 99, 140], 8);
}

/** 頭肩頂：左肩→頭（明顯較高）→右肩（與左肩相近），最後跌破頸線確認 */
function headAndShouldersTopCandles(): Candle[] {
  return zigzag([100, 115, 105, 125, 108, 116, 90], 8);
}

/** 頭肩底：鏡像邏輯，左肩→頭（明顯較低）→右肩，最後突破頸線確認 */
function headAndShouldersBottomCandles(): Candle[] {
  return zigzag([120, 105, 115, 95, 112, 104, 130], 8);
}

/** 頂背離：兩個高點依序墊高，但後一個高點當根成交量明顯低於前一個 */
function topDivergenceCandles(): Candle[] {
  const candles = zigzag([100, 115, 108, 122, 118], 8);
  const pivots = findPivots(candles);
  const highs = pivots.filter((p) => p.kind === "H");
  // 把兩個高點分別改成「量縮」與「量增」，確保背離判斷有明確訊號可抓
  if (highs.length >= 2) {
    candles[highs[highs.length - 2].index].volume = 5000; // 前一個高點：量大
    candles[highs[highs.length - 1].index].volume = 2000; // 最新高點（價格更高）：量縮
  }
  return candles;
}

describe("levels v0 fixtures", () => {
  it("uptrend-hh-hl：判定上升與 HH、HL", () => {
    const candles = uptrendCandles();
    const pivots = findPivots(candles);
    const { trend, sequence } = trendFromPivots(pivots);
    expect(trend).toBe("上升");
    expect(sequence).toBe("HH、HL");
  });

  it("downtrend-lh-ll：判定下降與 LH、LL", () => {
    const candles = downtrendCandles();
    const pivots = findPivots(candles);
    const { trend, sequence } = trendFromPivots(pivots);
    expect(trend).toBe("下降");
    expect(sequence).toBe("LH、LL");
  });

  it("range-double-top：判定震盪且前高密集區成為壓力", () => {
    const candles = doubleTopCandles();
    const facts = buildMarketFacts(candles);
    expect(facts).not.toBeNull();
    expect(facts!.trend).toBe("震盪");
    expect(facts!.resistance).not.toBeNull();
    expect(facts!.resistance!.touches).toBeGreaterThanOrEqual(2);
    expect(facts!.resistance!.low).toBeGreaterThan(candles[candles.length - 1].close);
  });

  it("breakout-pullback：突破後仍有支撐與失效位", () => {
    const facts = buildMarketFacts(breakoutPullbackCandles());
    expect(facts).not.toBeNull();
    expect(facts!.invalidation).not.toBeNull();
    expect(facts!.invalidation!).toBeLessThan(110);
  });

  it("false-breakout：衝高收回後，前高轉為壓力或失效位下方", () => {
    const facts = buildMarketFacts(falseBreakoutCandles());
    expect(facts).not.toBeNull();
    const close = 100;
    if (facts!.resistance) expect(facts!.resistance.low).toBeGreaterThan(close);
  });

  it("insufficient-data：少於 30 根回傳 null，不得編造", () => {
    expect(buildMarketFacts(shortCandles())).toBeNull();
  });

  it("決定性：同一輸入兩次計算結果完全相同", () => {
    const a = buildMarketFacts(breakoutPullbackCandles());
    const b = buildMarketFacts(breakoutPullbackCandles());
    expect(a).toEqual(b);
  });

  it("Pin Bar：長下影線偵測且最後一根標示未確認", () => {
    const base = makeCandles(Array.from({ length: 32 }, (_, i) => 100 + i * 0.1));
    const pin: Candle = { time: "2026-02-01", open: 104, high: 104.4, low: 100.2, close: 104.2, volume: 1000 };
    const candles = [...base.slice(0, 31), pin];
    const findings = detectCandlePatterns(candles);
    const bullPin = findings.find((f) => f.name === "多頭 Pin Bar");
    expect(bullPin).toBeDefined();
    expect(bullPin!.status).toBe("未確認");
  });

  it("ATR：資料不足回傳 null，資料足夠回傳正數", () => {
    expect(calculateATR(shortCandles(), 14)).toBeNull();
    const atr = calculateATR(uptrendCandles(), 14);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0);
  });

  it("雙頂：兩次觸頂價位相近、跌破頸線後型態確認", () => {
    const candles = doubleTopConfirmedCandles();
    const pivots = findPivots(candles);
    const findings = detectSwingPatterns(candles, pivots);
    const doubleTop = findings.find((f) => f.name === "雙頂");
    expect(doubleTop).toBeDefined();
    expect(doubleTop!.status).toBe("已確認");
  });

  it("雙底：兩次觸底價位相近、突破頸線後型態確認", () => {
    const candles = doubleBottomConfirmedCandles();
    const pivots = findPivots(candles);
    const findings = detectSwingPatterns(candles, pivots);
    const doubleBottom = findings.find((f) => f.name === "雙底");
    expect(doubleBottom).toBeDefined();
    expect(doubleBottom!.status).toBe("已確認");
  });

  it("頭肩頂：頭部明顯高於兩肩、跌破頸線後型態確認", () => {
    const candles = headAndShouldersTopCandles();
    const pivots = findPivots(candles);
    const findings = detectSwingPatterns(candles, pivots);
    const hs = findings.find((f) => f.name === "頭肩頂");
    expect(hs).toBeDefined();
    expect(hs!.status).toBe("已確認");
  });

  it("頭肩底：頭部明顯低於兩肩、突破頸線後型態確認", () => {
    const candles = headAndShouldersBottomCandles();
    const pivots = findPivots(candles);
    const findings = detectSwingPatterns(candles, pivots);
    const hs = findings.find((f) => f.name === "頭肩底");
    expect(hs).toBeDefined();
    expect(hs!.status).toBe("已確認");
  });

  it("頂背離：價格創高但成交量量縮，判定為已確認的背離證據", () => {
    const candles = topDivergenceCandles();
    const pivots = findPivots(candles);
    const findings = detectVolumeDivergence(candles, pivots);
    const topDivergence = findings.find((f) => f.name === "頂背離");
    expect(topDivergence).toBeDefined();
    expect(topDivergence!.status).toBe("已確認");
  });

  it("決定性：新型態偵測同一輸入兩次計算結果完全相同", () => {
    const candles = doubleTopConfirmedCandles();
    const pivots = findPivots(candles);
    expect(detectSwingPatterns(candles, pivots)).toEqual(detectSwingPatterns(candles, pivots));
  });
});
