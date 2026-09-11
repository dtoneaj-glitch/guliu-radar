import { describe, expect, it } from "vitest";
import type { Candle, Quote } from "@shared/types";
import { buildIndicatorFacts, smaSeries } from "@shared/indicators";
import { buildMarketFacts } from "@shared/levels";
import { evaluateStrategy } from "../../../server/data/strategies";

/**
 * 指標層與指標型戰法的固定 fixtures（確定性生成，同輸入必同輸出）。
 */

function mkCandle(close: number, i: number, over?: Partial<Candle>): Candle {
  return {
    time: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
    ...over,
  };
}

const mkQuote = (over: Partial<Quote>): Quote => ({
  symbol: "1101",
  name: "測試股",
  market: "twse",
  industry: null,
  prevClose: 100,
  close: 100,
  open: 100,
  high: 100,
  low: 100,
  changePct: 0,
  volumeShares: 1000,
  value: 3e8,
  netBuyShares: null,
  netBuyValue: null,
  ...over,
});

describe("indicators v0", () => {
  it("smaSeries：基本均值與暖機期為 null", () => {
    const s = smaSeries([1, 2, 3, 4, 5], 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    expect(s[2]).toBe(2);
    expect(s[4]).toBe(4);
  });

  it("daysAboveMa：連續站上 MA21 天數", () => {
    const candles = Array.from({ length: 40 }, (_, i) => mkCandle(90 + i, i));
    const ind = buildIndicatorFacts(candles);
    expect(ind).not.toBeNull();
    expect(ind!.daysAboveMa[21]).toBeGreaterThanOrEqual(10);
    expect(ind!.isBullCandle).toBe(true);
  });

  it("bias：乖離率符號正確", () => {
    const closes = [120, 116, 112, 108, 104, 100];
    const candles = closes.map((c, i) => mkCandle(c, i));
    const ind = buildIndicatorFacts(candles);
    expect(ind!.bias[5]).toBeLessThan(-3);
  });
});

describe("指標型戰法 fixtures", () => {
  it("破堤 ma21-break：帶量突破 MA21 達 3% → triggered", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 90 + (i * 10) / 39);
    closes[39] = 101.5; // 突破日：收在 MA21×1.03 之上
    const vols = Array.from({ length: 40 }, () => 1000);
    vols[39] = 3000; // 帶量
    const candles = closes.map((c, i) => mkCandle(c, i, { volume: vols[i], open: c * 0.998 }));
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: 101.5, open: 99.2, high: 102, low: 98.9, volumeShares: 3000 });
    const r = evaluateStrategy("ma21-break", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("triggered");
    expect(r.met.some((m) => m.includes("MA21 走平或向上"))).toBe(true);
  });

  it("破堤 ma21-break：無量突破 → 不觸發（誘多觀察）", () => {
    // 長期貼在 MA21 下方，今日首度衝高 3% 但無量 → 時間條件為 0、空間缺量 → 不觸發
    const closes = Array.from({ length: 34 }, (_, i) => 94.5 + (i % 2) * 0.3);
    closes.push(101.5);
    const candles = closes.map((c, i) => mkCandle(c, i, { volume: 800, open: c * 0.998 }));
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: 101.5, open: 99.2, high: 102, low: 98.9, volumeShares: 800 });
    const r = evaluateStrategy("ma21-break", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).not.toBe("triggered");
  });

  it("鯨躍 deep-reversal：下跌趨勢＋開低收復昨低＋超跌 → triggered", () => {
    const anchors = [130, 118, 124, 112, 118, 106, 112, 100];
    const closes: number[] = [];
    for (let a = 0; a < anchors.length - 1; a++) {
      for (let k = 1; k <= 7; k++) closes.push(anchors[a] + ((anchors[a + 1] - anchors[a]) * k) / 7);
    }
    closes.push(94, 91); // 加速下跌，BIAS(5) < -3%
    const candles = closes.map((c, i) => mkCandle(c, i));
    // 關鍵反轉 K：開盤跌破昨日最低、收盤收復
    candles.push({ time: "2026-03-01", open: 89, high: 92.6, low: 88, close: 92, volume: 1500 });
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: 92, open: 89, high: 92.6, low: 88, volumeShares: 1500 });
    const r = evaluateStrategy("deep-reversal", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("triggered");
    expect(r.note).toContain("鯨躍");
  });

  it("鯨躍 deep-reversal：非下跌趨勢 → no-trade（不接刀）", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 90 + i);
    const candles = closes.map((c, i) => mkCandle(c, i));
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: 129, open: 126, high: 130, low: 125, volumeShares: 1200 });
    const r = evaluateStrategy("deep-reversal", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("no-trade");
  });

  it("回湧 volume-refill：站上 MA25＋地量粘合拐頭＋收陽 → triggered", () => {
    const closes = Array.from({ length: 65 }, (_, i) => 80 + i * 0.9);
    const vols = Array(65).fill(1000);
    [970, 960, 940, 920, 900, 980].forEach((v, k) => { vols[59 + k] = v; }); // 地量後拐頭
    const candles = closes.map((c, i) => mkCandle(c, i, { volume: vols[i] }));
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: closes[64], open: closes[64] * 0.995, high: closes[64] * 1.01, low: closes[64] * 0.99, volumeShares: vols[64] });
    const r = evaluateStrategy("volume-refill", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("triggered");
    expect(r.met.some((m) => m.includes("地量"))).toBe(true);
    expect(r.met.some((m) => m.includes("拐頭"))).toBe(true);
  });

  it("回湧 volume-refill：量能拐頭當日卻是放量陰線 → no-trade（假拐點避坑）", () => {
    const closes = Array.from({ length: 65 }, (_, i) => 80 + i * 0.9);
    const vols = Array(65).fill(1000);
    [970, 960, 940, 920, 900, 2800].forEach((v, k) => { vols[59 + k] = v; });
    const candles = closes.map((c, i) => mkCandle(c, i, { volume: vols[i] }));
    candles[64] = { ...candles[64], open: candles[64].close * 1.02 }; // 陰線：開高收低
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: closes[64], open: closes[64] * 1.02, high: closes[64] * 1.03, low: closes[64] * 0.99, volumeShares: 2800 });
    const r = evaluateStrategy("volume-refill", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("no-trade");
    expect(r.note).toContain("假拐點");
  });

  it("洋流 ma200-current：長線上升＋回調觸及 MA200 後收回 → triggered", () => {
    const up = Array.from({ length: 200 }, (_, i) => 100 + i * 0.3);
    const lastUp = up[up.length - 1];
    const pullback = Array.from({ length: 35 }, (_, i) => lastUp - (i + 1) * 0.62);
    const closes = [...up, ...pullback];
    const baseCandles = closes.map((c, i) => mkCandle(c, i));
    const baseInd = buildIndicatorFacts(baseCandles)!;
    const ma200Now = baseInd.ma[200] as number;
    const touchDay = mkCandle(ma200Now * 1.02, 235, {
      open: ma200Now * 1.006,
      high: ma200Now * 1.01,
      low: ma200Now * 0.998,
      volume: 1200,
    });
    const candles = [...baseCandles, touchDay];
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: touchDay.close, open: touchDay.open, high: touchDay.high, low: touchDay.low, volumeShares: 1200 });
    const r = evaluateStrategy("ma200-current", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("triggered");
    expect(r.met.some((m) => m.includes("MA200"))).toBe(true);
  });

  it("洋流 ma200-current：MA200 斜率向下 → no-trade（主洋流不做多）", () => {
    const closes = Array.from({ length: 210 }, (_, i) => 200 - i * 0.3);
    const candles = closes.map((c, i) => mkCandle(c, i));
    const facts = buildMarketFacts(candles);
    const ind = buildIndicatorFacts(candles);
    const quote = mkQuote({ close: closes[209], open: closes[209] * 1.01, high: closes[209] * 1.02, low: closes[209] * 0.99, volumeShares: 1000 });
    const r = evaluateStrategy("ma200-current", { facts, ind, quote, zoneStatus: null, flowYi: null }, "1101");
    expect(r.status).toBe("no-trade");
  });
});
