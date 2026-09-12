/**
 * 移動停利（trailing stop）——把「水池」（庫存股）的成本價，跟 PA 結構性數字
 * （結構失效位、最近一個確認的 HL）接起來，算出目前該用哪個停損水位。
 *
 * 設計原則（跟 pa-default.ts／chip-divergence.ts 一致）：
 *  - 只做多方（棘輪只往上移動，不會下修）
 *  - 資料不足就承認不足，不編造停損水位
 *  - 結構依據優先於固定百分比——用「最近確認的 HL」當移動基準，不是隨手設一個 X% 回檔，
 *    跟 pa-default.ts／trend-follow(潮流) 戰法用同一套「HL 之上才算結構成立」的判斷邏輯一致
 */

export const TRAILING_STOP_VERSION = "trailing-stop.v1";

export type TrailingStopStage = "initial" | "breakeven" | "locked-profit" | "insufficient";

export interface TrailingStopInput {
  /** 買入成本價（水池分類的 costPrice） */
  costPrice: number;
  /** 現價 */
  currentClose: number;
  /** 初始結構失效位（來自 PA 事實層 f.invalidation），null 表示尚無法確認 */
  initialStop: number | null;
  /** 最近一個已確認的 HL（來自 f.swings.lastLow?.price），null 表示尚無新高點後的回檔可用 */
  recentSwingLow: number | null;
}

export interface TrailingStopResult {
  version: typeof TRAILING_STOP_VERSION;
  /** 目前該用的停損水位；null 表示資料不足，無法計算 */
  stopLevel: number | null;
  stage: TrailingStopStage;
  /** 停損移動到成本價以上時，鎖住的獲利百分比；否則為 null */
  lockedProfitPct: number | null;
  narrative: string;
}

/**
 * 計算移動停利。棘輪機制：停損只會往上移動（取初始失效位跟最近 HL 兩者較高的一個），
 * 不會因為股價拉回就跟著下修——這是移動停利的核心，跟「每次都重算一個新的固定停損」不同。
 */
export function computeTrailingStop(input: TrailingStopInput): TrailingStopResult {
  const { costPrice, currentClose, initialStop, recentSwingLow } = input;

  if (initialStop == null && recentSwingLow == null) {
    return {
      version: TRAILING_STOP_VERSION,
      stopLevel: null,
      stage: "insufficient",
      lockedProfitPct: null,
      narrative: "目前沒有足夠的結構資料可以設定停損，暫不計算移動停利。",
    };
  }

  // 棘輪：只有「最近 HL 高於目前候選停損、且低於現價（HL 本身還沒被跌破）」才往上移動
  let stopLevel = initialStop;
  if (recentSwingLow != null && recentSwingLow < currentClose && (stopLevel == null || recentSwingLow > stopLevel)) {
    stopLevel = recentSwingLow;
  }

  if (stopLevel == null) {
    return {
      version: TRAILING_STOP_VERSION,
      stopLevel: null,
      stage: "insufficient",
      lockedProfitPct: null,
      narrative: "目前沒有足夠的結構資料可以設定停損，暫不計算移動停利。",
    };
  }

  const stage: TrailingStopStage = stopLevel > costPrice ? "locked-profit" : stopLevel === costPrice ? "breakeven" : "initial";
  const lockedProfitPct = stage !== "initial" && costPrice !== 0 ? ((stopLevel - costPrice) / costPrice) * 100 : null;

  let narrative: string;
  if (stage === "locked-profit") {
    narrative = `停損已移動到 ${stopLevel.toFixed(0)}，高於你的成本 ${costPrice.toFixed(0)}——就算之後跌破停損出場，也已經鎖住約 ${lockedProfitPct!.toFixed(1)}% 的獲利，不會白忙一場。`;
  } else if (stage === "breakeven") {
    narrative = `停損已移動到成本價附近（${stopLevel.toFixed(0)}）——最差狀況是打平出場，不會虧到本金。`;
  } else {
    narrative = `目前停損還在初始設定的 ${stopLevel.toFixed(0)}，尚未隨獲利往上移動——留意股價創新高後、拉回確認新的 HL，屆時停損才會跟著往上調整。`;
  }

  return { version: TRAILING_STOP_VERSION, stopLevel, stage, lockedProfitPct, narrative };
}
