import { describe, expect, it } from "vitest";
import { computeTrailingStop } from "@shared/trailing-stop";

describe("computeTrailingStop", () => {
  it("完全沒有結構資料時，如實承認不足，不編造停損", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 110, initialStop: null, recentSwingLow: null });
    expect(r.stage).toBe("insufficient");
    expect(r.stopLevel).toBeNull();
    expect(r.lockedProfitPct).toBeNull();
  });

  it("只有初始失效位、還沒有新HL：stage=initial，不鎖利", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 110, initialStop: 90, recentSwingLow: null });
    expect(r.stopLevel).toBe(90);
    expect(r.stage).toBe("initial");
    expect(r.lockedProfitPct).toBeNull();
  });

  it("最近HL高於初始停損、且低於現價：停損棘輪往上移動到HL", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 130, initialStop: 90, recentSwingLow: 105 });
    expect(r.stopLevel).toBe(105);
  });

  it("停損移動到成本價以上：stage=locked-profit，正確算出鎖住的獲利百分比", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 130, initialStop: 90, recentSwingLow: 110 });
    expect(r.stage).toBe("locked-profit");
    expect(r.stopLevel).toBe(110);
    expect(r.lockedProfitPct).toBeCloseTo(10, 5);
  });

  it("停損剛好等於成本價：stage=breakeven，不算獲利也不算虧損", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 120, initialStop: 90, recentSwingLow: 100 });
    expect(r.stage).toBe("breakeven");
    expect(r.lockedProfitPct).toBe(0);
  });

  it("最近HL已經被現價跌破（HL >= currentClose）：不採用，維持原本停損（棘輪不會用已失效的HL）", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 95, initialStop: 90, recentSwingLow: 98 });
    expect(r.stopLevel).toBe(90);
  });

  it("最近HL低於目前候選停損：不會下修，維持原本較高的停損（棘輪只升不降）", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 130, initialStop: 110, recentSwingLow: 105 });
    expect(r.stopLevel).toBe(110);
  });

  it("只有最近HL、沒有初始失效位，仍可用HL當停損", () => {
    const r = computeTrailingStop({ costPrice: 100, currentClose: 130, initialStop: null, recentSwingLow: 108 });
    expect(r.stopLevel).toBe(108);
    expect(r.stage).toBe("locked-profit");
  });

  it("同輸入同輸出（決定性）", () => {
    const input = { costPrice: 100, currentClose: 130, initialStop: 90, recentSwingLow: 110 };
    expect(computeTrailingStop(input)).toEqual(computeTrailingStop(input));
  });
});
