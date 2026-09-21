/**
 * 籌碼分歧規則引擎（外資 vs 散戶）
 *
 * 目的：把「外資看空、散戶看多」這類分歧判斷，從人工每天判讀寫結論，
 * 換成規則判斷＋句型模板自動產生——跟 pa-default.ts 判斷「多頭 Pin Bar 已確認」
 * 是同一套哲學：規則決定「要不要說」，模板決定「怎麼說」，資料不足就承認
 * 不足，不編造分歧。
 *
 * 輸入來源（呼叫端負責組裝，本檔案只做純邏輯判斷，不做任何資料抓取）：
 *   - 外資現貨買賣超（億元）：TWSE T86
 *   - 外資期貨未平倉淨口數：TAIFEX ChipCardData.traders 找「外資及陸資」
 *   - 散戶淨多空比：taifex.ts 的 fetchRetailFuturesPosition()（小台 MTX 為主、微台 TMF 為輔）
 *
 * 散戶多空比定義（2026-09-21 對照 MacroMicro／玩股網後定案，v1 的「多方佔比 0–100」
 * 語意已作廢）：
 *   散戶淨多空比 = (散戶多單 − 散戶空單) ÷ 市場總未平倉 × 100
 *                = (法人空 − 法人多) ÷ 市場總未平倉 × 100
 *   正值＝散戶偏多、負值＝散戶偏空、0＝多空均衡。
 *
 * 版本化：v1→v2 是「語意變更」（多方佔比 → 淨多空比），刻意換版號避免舊資料誤解。
 */

export const CHIP_DIVERGENCE_VERSION = "chip_divergence.v2";

export type Stance = "偏多" | "偏空" | "中性";

export interface ChipDivergenceInput {
  /** 外資現貨買賣超（億元），null 表示無資料 */
  foreignSpotNetYi: number | null;
  /** 外資期貨未平倉淨口數（正=多單、負=空單），null 表示無資料 */
  foreignFuturesNetOI: number | null;
  /** 散戶（小台 MTX）淨多空比，有號 −100~+100；正值＝散戶偏多。null 表示無資料 */
  retailNetRatioPct: number | null;
  /** 散戶（微台 TMF）淨多空比，次要參考（與小台可能不同向）。null 表示無資料 */
  retailNetRatioPctTmf?: number | null;
  /** 散戶淨多空比當日變動（百分點），null 表示無資料（無歷史比較基準） */
  retailNetRatioChangePct: number | null;
}

export interface ChipDivergenceResult {
  version: typeof CHIP_DIVERGENCE_VERSION;
  foreignStance: Stance;
  retailStance: Stance;
  /** 兩方立場是否相反（其中一方中性時一律視為未分歧，避免弱訊號誤判） */
  diverged: boolean;
  /** 組好的一句話敘事；資料不足以判斷分歧時回傳中性、如實告知缺什麼 */
  narrative: string;
  evidence: { confirmed: string[]; insufficient: string[] };
}

// 外資現貨死區（億元）：金額在正負門檻內視為方向不明顯，避免小幅波動被誤判成明確偏多/偏空
const FOREIGN_SPOT_DEAD_ZONE_YI = 30;
// 外資期貨未平倉死區（口數）：沿用 taifex.ts 既有 biasFromNet() 的同一個門檻，保持全站一致
const FOREIGN_FUTURES_DEAD_ZONE_OI = 5000;
// 散戶淨多空比死區（百分點，以 0 為中心）：±10 內視為多空接近，不算明確偏多/偏空。
// 註：這是保守初值，台股歷史分布的正式校準要等存檔累積後回測調整。
const RETAIL_NET_DEAD_ZONE_PCT = 10;
// 散戶淨多空比單日變動達到這個百分點以上，敘事才會加註變動幅度
const RETAIL_NET_SWING_PCT = 15;

function fmtSigned(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function classifyForeign(spotYi: number | null, futuresOI: number | null): Stance {
  const spotSignal: Stance | null =
    spotYi == null ? null : spotYi > FOREIGN_SPOT_DEAD_ZONE_YI ? "偏多" : spotYi < -FOREIGN_SPOT_DEAD_ZONE_YI ? "偏空" : "中性";
  const futuresSignal: Stance | null =
    futuresOI == null
      ? null
      : futuresOI > FOREIGN_FUTURES_DEAD_ZONE_OI
        ? "偏多"
        : futuresOI < -FOREIGN_FUTURES_DEAD_ZONE_OI
          ? "偏空"
          : "中性";

  // 兩個訊號都有時，只有方向一致才判定；不一致視為中性（現貨期貨打架，不強行給結論）
  if (spotSignal != null && futuresSignal != null) {
    return spotSignal === futuresSignal ? spotSignal : "中性";
  }
  return spotSignal ?? futuresSignal ?? "中性";
}

function classifyRetail(netPct: number | null): Stance {
  if (netPct == null) return "中性";
  if (netPct > RETAIL_NET_DEAD_ZONE_PCT) return "偏多";
  if (netPct < -RETAIL_NET_DEAD_ZONE_PCT) return "偏空";
  return "中性";
}

function foreignClause(input: ChipDivergenceInput, stance: Stance): string {
  const parts: string[] = [];
  if (input.foreignSpotNetYi != null) {
    parts.push(input.foreignSpotNetYi >= 0 ? `現貨買超 ${input.foreignSpotNetYi.toFixed(1)} 億` : `現貨賣超 ${Math.abs(input.foreignSpotNetYi).toFixed(1)} 億`);
  }
  if (input.foreignFuturesNetOI != null) {
    parts.push(input.foreignFuturesNetOI >= 0 ? `期貨多單 ${input.foreignFuturesNetOI.toLocaleString()} 口` : `期貨空單 ${Math.abs(input.foreignFuturesNetOI).toLocaleString()} 口`);
  }
  const detail = parts.length > 0 ? `：${parts.join("、")}` : "";
  return `外資${stance}${detail}`;
}

function retailClause(input: ChipDivergenceInput, stance: Stance): string {
  if (input.retailNetRatioPct == null) return `散戶${stance}`;
  const tmf =
    input.retailNetRatioPctTmf != null ? `、微台 ${fmtSigned(input.retailNetRatioPctTmf)}` : "";
  const swing =
    input.retailNetRatioChangePct != null && Math.abs(input.retailNetRatioChangePct) >= RETAIL_NET_SWING_PCT
      ? `（單日${input.retailNetRatioChangePct > 0 ? "走升" : "走弱"} ${Math.abs(input.retailNetRatioChangePct).toFixed(1)} 個百分點）`
      : "";
  return `散戶${stance}：淨多空比 小台 ${fmtSigned(input.retailNetRatioPct)}${tmf}${swing}`;
}

/**
 * 評估外資與散戶的籌碼立場是否出現分歧，並產生一句話敘事。
 * 純函式，資料不足時不編造——foreignStance/retailStance 缺資料時回傳「中性」，
 * narrative 會如實說明是「資料不足」還是「無明顯分歧」，兩者不能混為一談。
 *
 * 註：散戶多空比在台灣實務上多作為「逆勢」參考（散戶偏多 → 常解讀為大戶偏空），
 * 但本引擎只做「陳述立場是否分歧」，不下後市漲跌結論，維持中立。
 */
export function evaluateChipDivergence(input: ChipDivergenceInput): ChipDivergenceResult {
  const confirmed: string[] = [];
  const insufficient: string[] = [];

  if (input.foreignSpotNetYi == null) insufficient.push("外資現貨買賣超資料不足");
  if (input.foreignFuturesNetOI == null) insufficient.push("外資期貨未平倉資料不足");
  if (input.retailNetRatioPct == null) insufficient.push("散戶多空比資料不足");

  const foreignStance = classifyForeign(input.foreignSpotNetYi, input.foreignFuturesNetOI);
  const retailStance = classifyRetail(input.retailNetRatioPct);
  const diverged = foreignStance !== "中性" && retailStance !== "中性" && foreignStance !== retailStance;

  if (foreignStance !== "中性") confirmed.push(foreignClause(input, foreignStance));
  if (retailStance !== "中性") confirmed.push(retailClause(input, retailStance));

  let narrative: string;
  if (input.foreignSpotNetYi == null && input.foreignFuturesNetOI == null && input.retailNetRatioPct == null) {
    narrative = "今日籌碼資料不足，暫無法判斷外資與散戶是否分歧。";
  } else if (diverged) {
    narrative = `${foreignClause(input, foreignStance)}；${retailClause(input, retailStance)}——籌碼出現分歧。`;
  } else if (foreignStance === "中性" && retailStance === "中性") {
    narrative = "外資與散戶籌碼方向都不明顯，今日無明顯分歧訊號。";
  } else {
    narrative = `${foreignClause(input, foreignStance)}；${retailClause(input, retailStance)}——雙方方向一致，無分歧。`;
  }

  return {
    version: CHIP_DIVERGENCE_VERSION,
    foreignStance,
    retailStance,
    diverged,
    narrative,
    evidence: { confirmed, insufficient },
  };
}
