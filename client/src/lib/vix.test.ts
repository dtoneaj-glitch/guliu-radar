import { describe, expect, it } from "vitest";
import { classifyVix } from "@shared/vix";

describe("classifyVix", () => {
  it("< 20 判定情緒平穩", () => {
    expect(classifyVix(15.2).level).toBe("情緒平穩");
  });

  it("20–25 判定略微緊張", () => {
    expect(classifyVix(22.5).level).toBe("略微緊張");
  });

  it("25–30 判定市場緊張（今日實測範例 26.27）", () => {
    expect(classifyVix(26.27).level).toBe("市場緊張");
  });

  it(">= 30 判定極度恐慌", () => {
    expect(classifyVix(32.1).level).toBe("極度恐慌");
  });

  it("邊界值：剛好等於門檻歸類到下一級", () => {
    expect(classifyVix(20).level).toBe("略微緊張");
    expect(classifyVix(25).level).toBe("市場緊張");
    expect(classifyVix(30).level).toBe("極度恐慌");
  });

  it("變動幅度判斷趨勢方向", () => {
    expect(classifyVix(26.27, -0.08).trend).toBe("下降");
    expect(classifyVix(26.27, 0.5).trend).toBe("上升");
    expect(classifyVix(26.27, 0.02).trend).toBe("持平");
  });

  it("沒有前一日資料時 trend 為 null，不編造方向", () => {
    expect(classifyVix(26.27).trend).toBeNull();
  });

  it("同輸入同輸出（決定性）", () => {
    const a = classifyVix(26.27, -0.08);
    const b = classifyVix(26.27, -0.08);
    expect(a).toEqual(b);
  });
});
