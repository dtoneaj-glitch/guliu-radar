import { describe, expect, it } from "vitest";
import { evaluateChipDivergence, type ChipDivergenceInput } from "@shared/chip-divergence";

const full = (overrides: Partial<ChipDivergenceInput> = {}): ChipDivergenceInput => ({
  foreignSpotNetYi: null,
  foreignFuturesNetOI: null,
  retailNetRatioPct: null,
  retailNetRatioChangePct: null,
  ...overrides,
});

describe("chip-divergence", () => {
  it("外資賣超＋期貨空單、散戶淨多空比偏多 → 判定分歧", () => {
    const r = evaluateChipDivergence(
      full({ foreignSpotNetYi: -383.34, foreignFuturesNetOI: -83918, retailNetRatioPct: 28.4 }),
    );
    expect(r.foreignStance).toBe("偏空");
    expect(r.retailStance).toBe("偏多");
    expect(r.diverged).toBe(true);
    expect(r.narrative).toContain("分歧");
    expect(r.narrative).toContain("淨多空比");
  });

  it("外資現貨、期貨方向一致時才判定外資立場；方向打架時回退中性", () => {
    const r = evaluateChipDivergence(full({ foreignSpotNetYi: 100, foreignFuturesNetOI: -20000 }));
    expect(r.foreignStance).toBe("中性");
  });

  it("外資與散戶方向相同 → 不分歧", () => {
    const r = evaluateChipDivergence(full({ foreignSpotNetYi: 200, foreignFuturesNetOI: 30000, retailNetRatioPct: 22 }));
    expect(r.foreignStance).toBe("偏多");
    expect(r.retailStance).toBe("偏多");
    expect(r.diverged).toBe(false);
    expect(r.narrative).toContain("無分歧");
  });

  it("死區內的金額／口數／淨多空比視為中性，不強行判定方向", () => {
    const r = evaluateChipDivergence(full({ foreignSpotNetYi: 10, foreignFuturesNetOI: 1000, retailNetRatioPct: 5 }));
    expect(r.foreignStance).toBe("中性");
    expect(r.retailStance).toBe("中性");
    expect(r.diverged).toBe(false);
  });

  it("淨多空比剛好超過死區（±10）才算偏多／偏空", () => {
    expect(evaluateChipDivergence(full({ retailNetRatioPct: 10 })).retailStance).toBe("中性");
    expect(evaluateChipDivergence(full({ retailNetRatioPct: 10.1 })).retailStance).toBe("偏多");
    expect(evaluateChipDivergence(full({ retailNetRatioPct: -10.1 })).retailStance).toBe("偏空");
  });

  it("微台與小台不同向時，敘事同時列出兩者", () => {
    const r = evaluateChipDivergence(
      full({ foreignSpotNetYi: -100, foreignFuturesNetOI: -20000, retailNetRatioPct: 12, retailNetRatioPctTmf: -18 }),
    );
    expect(r.narrative).toContain("小台");
    expect(r.narrative).toContain("微台");
  });

  it("完全沒有資料時，如實說資料不足，不編造分歧", () => {
    const r = evaluateChipDivergence(full());
    expect(r.narrative).toContain("資料不足");
    expect(r.evidence.insufficient.length).toBe(3);
    expect(r.diverged).toBe(false);
  });

  it("部分資料缺失時，insufficient 只列出缺的那幾項", () => {
    const r = evaluateChipDivergence(full({ foreignSpotNetYi: -100, foreignFuturesNetOI: -20000 }));
    expect(r.evidence.insufficient).toEqual(["散戶多空比資料不足"]);
  });

  it("同輸入同輸出（決定性，跟其他規則引擎一致的要求）", () => {
    const input = full({ foreignSpotNetYi: -383.34, foreignFuturesNetOI: -83918, retailNetRatioPct: 28.4, retailNetRatioChangePct: 16.2 });
    const a = evaluateChipDivergence(input);
    const b = evaluateChipDivergence(input);
    expect(a).toEqual(b);
  });
});
