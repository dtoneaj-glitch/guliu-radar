import { describe, expect, it } from "vitest";
import { deriveChange } from "@shared/quote-change";

describe("deriveChange（漲跌/漲跌幅，含除權息）", () => {
  it("一般情況：由收盤與漲跌反推前收與漲跌幅", () => {
    const r = deriveChange(2460, 35);
    expect(r.exDividend).toBe(false);
    expect(r.prevClose).toBe(2425);
    expect(r.changeAmt).toBe(35);
    expect(r.changePct).toBeCloseTo(1.4433, 3);
  });

  it("平盤：漲跌 0 → 漲跌幅 0、前收等於收盤", () => {
    const r = deriveChange(100, 0);
    expect(r.exDividend).toBe(false);
    expect(r.changePct).toBe(0);
    expect(r.changeAmt).toBe(0);
    expect(r.prevClose).toBe(100);
  });

  it("下跌：負的漲跌", () => {
    const r = deriveChange(240.5, -2);
    expect(r.changePct).toBeCloseTo(-0.8247, 3);
    expect(r.changeAmt).toBe(-2);
  });

  it("除權息（官方欄位是 X → NaN）：標記 exDividend，漲跌與漲跌幅為 null，且不產生 NaN", () => {
    const r = deriveChange(512, Number.NaN);
    expect(r.exDividend).toBe(true);
    expect(r.changePct).toBeNull();
    expect(r.changeAmt).toBeNull();
    expect(r.prevClose).toBe(512);
    expect(Number.isNaN(r.prevClose)).toBe(false);
  });

  it("欄位缺漏（null/undefined）：同樣視為不可計算", () => {
    for (const v of [null, undefined]) {
      const r = deriveChange(50, v);
      expect(r.exDividend).toBe(true);
      expect(r.changePct).toBeNull();
    }
  });

  it("反推前收不合理（<=0）：漲跌額保留，但漲跌幅為 null 而非硬算", () => {
    const r = deriveChange(10, 12); // prevClose = -2
    expect(r.changeAmt).toBe(12);
    expect(r.changePct).toBeNull();
    expect(r.prevClose).toBe(10);
  });

  it("同輸入同輸出（決定性）", () => {
    expect(deriveChange(123.5, -4.5)).toEqual(deriveChange(123.5, -4.5));
  });
});
