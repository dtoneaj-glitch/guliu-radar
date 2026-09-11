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
});

export type { PAFacts };
