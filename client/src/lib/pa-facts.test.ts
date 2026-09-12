import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "@shared/types";
import { buildPAFacts, buildMultiTimeframeFacts, type PAFacts } from "@shared/pa-facts";
import { evaluatePaDefault } from "@shared/pa-default";

function candlesFrom(closes: number[], timeframe: Timeframe = "1d"): Candle[] {
  return closes.map((close, i) => ({
    time: timeframe === "1d" || timeframe === "1w" ? `2026-01-${String((i % 28) + 1).padStart(2, "0")}` : `2026-01-01 ${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000 + i * 10,
  }));
}

function uptrend(): Candle[] {
  const anchors = [100, 116, 110, 128, 121, 140];
  const closes: number[] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    for (let i = 1; i <= 7; i++) closes.push(anchors[a] + ((anchors[a + 1] - anchors[a]) * i) / 7);
  }
  return candlesFrom(closes);
}

function downtrend(): Candle[] {
  // uptrend() 的擺盪 anchors 反過來走，確保真的產生「下降」結構（LH/LL），
  // 不是單調遞減的假下降——單調遞減沒有高低點擺盪序列，會被判定成「震盪」而非「下降」
  const anchors = [140, 121, 128, 110, 116, 100];
  const closes: number[] = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    for (let i = 1; i <= 7; i++) closes.push(anchors[a] + ((anchors[a + 1] - anchors[a]) * i) / 7);
  }
  return candlesFrom(closes);
}

describe("PA Facts Layer", () => {
  it("builds a versioned, structured fact result from OHLCV", () => {
    const facts = buildPAFacts(uptrend(), "1d");
    expect(facts.version).toBe("pa-facts.v1");
    expect(facts.timeframe).toBe("1d");
    expect(facts.data.status).toBe("ready");
    expect(facts.structure.trend).toBe("上升");
    expect(facts.structure.sequence).toBe("HH、HL");
    expect(facts.keyLevels).toBeDefined();
    expect(facts.patterns).toBeInstanceOf(Array);
  });

  it("returns insufficient instead of inventing facts", () => {
    const facts = buildPAFacts(candlesFrom([100, 101, 102]), "15m");
    expect(facts.data.status).toBe("insufficient");
    expect(facts.structure.trend).toBeNull();
    expect(facts.keyLevels).toHaveLength(0);
  });

  it("keeps all four timeframe contracts in one deterministic bundle", () => {
    const input: Partial<Record<Timeframe, Candle[]>> = {
      "1w": candlesFrom(Array.from({ length: 35 }, (_, i) => 100 + i), "1w"),
      "1d": uptrend(),
      "60m": candlesFrom(Array.from({ length: 35 }, (_, i) => 100 + i), "60m"),
    };
    const bundle = buildMultiTimeframeFacts("2330", input);
    expect(Object.keys(bundle.timeframes)).toEqual(["1w", "1d", "60m", "15m"]);
    expect(bundle.timeframes["1w"].data.status).toBe("ready");
    expect(bundle.timeframes["15m"].data.status).toBe("unavailable");
    expect(bundle.alignment.status).toBe("insufficient");
  });
});

describe("pa_default analysis engine", () => {
  it("returns six sections and separates confirmed, inferred and waiting", () => {
    const daily = buildPAFacts(uptrend(), "1d");
    const bundle = buildMultiTimeframeFacts("2330", { "1d": uptrend() });
    const result = evaluatePaDefault({ symbol: "2330", name: "台積電", bundle, daily });
    expect(result.strategyId).toBe("pa_default");
    expect(result.sections).toHaveLength(6);
    expect(result.sections.map((s) => s.id)).toEqual(["structure", "levels", "patterns", "scenarios", "risk", "evidence"]);
    expect(result.evidence.confirmed.length).toBeGreaterThan(0);
    expect(result.disclaimer).toContain("不保證獲利");
  });

  it("只有日線資料時（單一時框），alignment score 反映該時框方向，不是null——用來確認觸發條件不會因score=null誤判", () => {
    const daily = buildPAFacts(uptrend(), "1d");
    const bundle = buildMultiTimeframeFacts("2330", { "1d": uptrend() });
    expect(bundle.alignment.score).not.toBeNull();
    expect(bundle.alignment.score!).toBeGreaterThan(0);
    const result = evaluatePaDefault({ symbol: "2330", name: "台積電", bundle, daily });
    // 分數是正的，不該是「因為分數不足」被擋——沒觸發的話，原因只會是其他條件
    // （靠近支撐／多頭形態／15分資料）未滿足，不是no-trade
    expect(result.status).not.toBe("no-trade");
  });

  it("多時框對齊分數為淨空方（score<0）時不觸發，即使日線本身是上升", () => {
    // 週線/60分/15分都是真正的下降結構（擺盪出LH/LL），日線是上升——
    // 加權後（週線佔比最重40%）score應偏空方
    const bundle = buildMultiTimeframeFacts("2330", {
      "1w": downtrend(),
      "1d": uptrend(),
      "60m": downtrend(),
      "15m": downtrend(),
    });
    expect(bundle.alignment.score).not.toBeNull();
    expect(bundle.alignment.score!).toBeLessThan(0);
    const daily = buildPAFacts(uptrend(), "1d");
    const result = evaluatePaDefault({ symbol: "2330", name: "台積電", bundle, daily });
    expect(result.status).not.toBe("triggered");
  });

});

export type { PAFacts };
