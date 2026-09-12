import type { MultiTimeframeFacts, PAFacts } from "./pa-facts";

export const PA_DEFAULT_VERSION = "pa_default.v1";

type SectionId = "structure" | "levels" | "patterns" | "scenarios" | "risk" | "evidence";
export interface AnalysisSection {
  id: SectionId;
  title: string;
  summary: string;
  items: string[];
}

export interface PaDefaultResult {
  strategyId: "pa_default";
  version: typeof PA_DEFAULT_VERSION;
  symbol: string;
  name: string;
  status: "triggered" | "waiting" | "no-trade" | "insufficient";
  sections: AnalysisSection[];
  evidence: { confirmed: string[]; inferred: string[]; waiting: string[] };
  disclaimer: string;
}

function formatRange(low: number, high: number): string {
  return `${low.toFixed(0)}–${high.toFixed(0)}`;
}

function factsFor(bundle: MultiTimeframeFacts, timeframe: "1w" | "1d" | "60m" | "15m"): PAFacts {
  return bundle.timeframes[timeframe];
}

export function evaluatePaDefault(input: { symbol: string; name: string; bundle: MultiTimeframeFacts; daily?: PAFacts }): PaDefaultResult {
  const bundle = input.bundle;
  const weekly = factsFor(bundle, "1w");
  const daily = input.daily ?? factsFor(bundle, "1d");
  const hourly = factsFor(bundle, "60m");
  const minute = factsFor(bundle, "15m");
  const confirmed = [...bundle.alignment.confirmed];
  const inferred: string[] = [];
  const waiting = [...bundle.alignment.waiting];
  const sections: AnalysisSection[] = [];

  if (daily.data.status === "ready") {
    confirmed.push(`日線市場結構：${daily.structure.trend}（${daily.structure.sequence ?? "結構序列未明"}）`);
  }
  if (weekly.data.status === "ready" && daily.data.status === "ready" && weekly.structure.trend && daily.structure.trend && weekly.structure.trend !== daily.structure.trend) {
    inferred.push(`週線${weekly.structure.trend}、日線${daily.structure.trend}，大級別與主要結構不一致`);
  }

  sections.push({
    id: "structure",
    title: "一、判斷市場結構",
    summary: daily.data.status === "ready" ? `日線目前為${daily.structure.trend}結構。` : "日線資料不足，無法確認主要結構。",
    items: [
      daily.data.status === "ready" ? `日線：${daily.structure.trend}／${daily.structure.sequence ?? "高低點序列未明確"}` : "日線：尚未確認",
      weekly.data.status === "ready" ? `週線：${weekly.structure.trend}／${weekly.structure.sequence ?? "高低點序列未明確"}` : "週線：等待資料",
      bundle.alignment.status === "aligned" ? "多時間框架方向一致" : "多時間框架尚未完全一致或資料不足",
      ...(bundle.alignment.score != null ? [`多時框加權分數：${bundle.alignment.score}（-100 空方 ～ +100 多方，週線佔比最重）`] : []),
    ],
  });

  const support = daily.keyLevels.find((level) => level.role === "support");
  const resistance = daily.keyLevels.find((level) => level.role === "resistance");
  sections.push({
    id: "levels",
    title: "二、識別關鍵價位",
    summary: support ? `日線支撐區 ${formatRange(support.low, support.high)}。` : "目前沒有足夠證據確認日線支撐區。",
    items: [
      support ? `支撐：${formatRange(support.low, support.high)}（${support.basis}）` : "支撐：未確認",
      resistance ? `壓力：${formatRange(resistance.low, resistance.high)}（${resistance.basis}）` : "壓力：未確認",
      daily.invalidation != null ? `結構失效位：${daily.invalidation.toFixed(0)}` : "結構失效位：未確認",
    ],
  });
  if (support) confirmed.push(`日線支撐區 ${formatRange(support.low, support.high)}`);
  if (resistance) confirmed.push(`日線壓力區 ${formatRange(resistance.low, resistance.high)}`);
  else waiting.push("等待日線壓力區形成或確認");

  const patterns = daily.patterns;
  sections.push({
    id: "patterns",
    title: "三、分析價格行為",
    summary: patterns.length ? `最近 K 線出現 ${patterns.map((pattern) => pattern.name).join("、")}。` : "最近 K 線尚未偵測到指定形態。",
    items: patterns.length ? patterns.map((pattern) => `${pattern.name}：${pattern.status}；${pattern.note}`) : ["Pin Bar／吞沒／突破／回踩：目前未確認"],
  });
  patterns.forEach((pattern) => (pattern.status === "已確認" ? confirmed : inferred).push(`${pattern.name}（${pattern.status}）`));
  if (!patterns.length) waiting.push("等待價格行為形態確認");

  const nearSupport = support && daily.price.close != null && daily.price.close >= support.low - (support.high - support.low) * 0.5 && daily.price.close <= support.high + (support.high - support.low) * 0.35;
  const bullPattern = patterns.some((pattern) => pattern.name.startsWith("多頭"));
  // 多時框對齊分數必須淨多方傾斜（>0）才允許觸發——分數已經算出來顯示給使用者看了，
  // 決策邏輯不該視而不見；資料不足（null）時維持保守，不觸發，跟其餘欄位「不足就不給結論」一致。
  const alignmentSupportsLong = bundle.alignment.score != null && bundle.alignment.score > 0;
  const triggered = daily.data.status === "ready" && daily.structure.trend !== "下降" && alignmentSupportsLong && Boolean(nearSupport && bullPattern && minute.data.status === "ready");
  const noTrade = daily.data.status === "ready" && daily.structure.trend === "下降" && !bullPattern;
  sections.push({
    id: "scenarios",
    title: "四、提出交易情境",
    summary: triggered ? "順勢做多條件暫時齊備，仍需核對風險報酬。" : noTrade ? "目前不交易：日線下降且沒有多頭確認。" : "等待確認，不直接追價或預測反轉。",
    items: [
      triggered ? "順勢做多：支撐區附近＋多頭價格行為＋多時框對齊偏多＋15 分觸發資料已具備" : `順勢做多：等待支撐區、反轉 K、15 分觸發條件${alignmentSupportsLong ? "" : "，以及多時框對齊分數轉為淨多方（目前未偏多或資料不足）"}`,
      noTrade ? "不交易：結構失效或缺乏反轉證據" : "不交易條件：跌破結構失效位、風險報酬不足或多週期衝突",
      hourly.data.status === "ready" ? "60 分：可進一步檢查回踩與進場區" : "60 分：等待資料確認進場區",
    ],
  });
  if (hourly.data.status !== "ready") waiting.push("等待 60 分回踩資料");
  if (minute.data.status !== "ready") waiting.push("等待 15 分信號 K 資料");

  const entry = daily.entryZone;
  const riskItems = entry && daily.invalidation != null
    ? [`進場觀察區：${formatRange(entry.low, entry.high)}`, `結構止損／失效位：${daily.invalidation.toFixed(0)}`, "止盈：以最近壓力區或至少 2R 作為條件式目標", "倉位：帳戶風險金額 ÷（預計進場價－失效位）"]
    : ["進場區、止損與止盈尚未能由目前事實可靠推導", "在關鍵價位未確認前，不計算倉位或盈虧比"];
  sections.push({ id: "risk", title: "五、制定風險管理", summary: entry && daily.invalidation != null ? "已有條件式風險框架，仍不可視為獲利保證。" : "資料不足，先不給出虛假的精確風控數字。", items: riskItems });

  sections.push({
    id: "evidence",
    title: "六、區分確認、推測與等待",
    summary: `已確認 ${confirmed.length} 項；推測 ${inferred.length} 項；等待 ${waiting.length} 項。`,
    items: [
      `已確認：${confirmed.length ? confirmed.join("；") : "目前沒有足夠確認事實"}`,
      `推測情境：${inferred.length ? inferred.join("；") : "無，避免過度解讀"}`,
      `尚待條件：${waiting.length ? waiting.join("；") : "目前沒有額外等待條件"}`,
    ],
  });

  return {
    strategyId: "pa_default",
    version: PA_DEFAULT_VERSION,
    symbol: input.symbol,
    name: input.name,
    status: triggered ? "triggered" : noTrade ? "no-trade" : daily.data.status === "ready" ? "waiting" : "insufficient",
    sections,
    evidence: { confirmed, inferred, waiting },
    disclaimer: "本研判為條件式教育資訊，不保證獲利，不構成投資或下單建議。",
  };
}
