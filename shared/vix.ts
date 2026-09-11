/**
 * 台指選擇權波動率指數（VIX 概念，來源為台指選擇權引申波動率，非 CBOE VIX）判讀。
 *
 * 只給數字使用者不一定懂意義，這裡把數值轉成講白話意思的標籤（如「市場緊張」），
 * 適合塞進徽章（badge）顯示，不需要額外占版面高度。
 *
 * 等級門檻是波動率指數的通用參考區間（非台股實測校準），
 * 部署後如果台股波動率的歷史分布跟這個門檻對不上（例如台股波動率長期偏低，
 * 20 其實已經算高），需要用歷史資料重新校準這幾個門檻，而不是照搬國際慣例。
 */

export type VixLevel = "情緒平穩" | "略微緊張" | "市場緊張" | "極度恐慌";

export interface VixReading {
  level: VixLevel;
  /** 極短提示文字，適合放進徽章，目前等同 level，保留獨立欄位方便未來加註 */
  hint: string;
  trend: "上升" | "下降" | "持平" | null;
}

const CALM_MAX = 20;
const WATCH_MAX = 25;
const ELEVATED_MAX = 30;
/** 變動幅度在正負這個範圍內視為持平，避免小數點雜訊被講成「上升/下降」 */
const TREND_DEAD_ZONE = 0.03;

export function classifyVix(value: number, changeFromPrevClose: number | null = null): VixReading {
  const level: VixLevel =
    value < CALM_MAX ? "情緒平穩" : value < WATCH_MAX ? "略微緊張" : value < ELEVATED_MAX ? "市場緊張" : "極度恐慌";
  const trend: VixReading["trend"] =
    changeFromPrevClose == null
      ? null
      : changeFromPrevClose > TREND_DEAD_ZONE
        ? "上升"
        : changeFromPrevClose < -TREND_DEAD_ZONE
          ? "下降"
          : "持平";
  return { level, hint: level, trend };
}
