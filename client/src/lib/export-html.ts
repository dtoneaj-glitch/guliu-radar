/**
 * 離線 HTML 匯出器
 *
 * 從 /api/export 抓取最新快照，產生一個自包含的 .html 檔：
 * 內嵌 CSS（Tailwind CDN）+ 所有資料 + 渲染邏輯，離線可看。
 */

import type { ExportSnapshot } from "../../../server/export";
import type { HotZone } from "../../../shared/types";

interface ExportSummary {
  advance: number;
  decline: number;
  flat: number;
  totalValueYi: number;
  institutionalNetYi: number;
  institutionalCoverage: string;
}

/** 產生日期的中文讀法 */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+08:00");
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" }) +
    "（" + dateStr + "）";
}

/** 數字格式化 */
function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === undefined || n === null) return "—";
  return n.toFixed(decimals);
}

/** 顏色判斷 */
function colorClass(v: number): string {
  if (v > 0) return "text-red-500";
  if (v < 0) return "text-green-500";
  return "text-gray-400";
}

/** 大數值轉億元（API 回傳已是億元） */
function yi(v: number): string {
  if (!v) return "0.00";
  return v.toFixed(2);
}

/** 產出一整份離線 HTML */
export function generateOfflineHTML(snapshot: ExportSnapshot): string {
  const { asOf, generatedAt, source, summary, institutional, hotzones, chipCard, optionsOI, pantlas, regime, sectorFlows } = snapshot;

  const s = (summary ?? {}) as ExportSummary;
  const hz = hotzones ?? null;
  const rc = regime ?? null;

  const balance = s.advance + s.decline + s.flat;
  const advancePct = balance > 0 ? ((s.advance / balance) * 100).toFixed(1) : "—";

  // 籌碼卡表格行（口徑與 ChipCard.tsx 一致：期貨/選擇權皆用未平倉淨額 OI，合計為兩者相加）
  const chipRows = (chipCard?.traders ?? []).map(t => `
    <tr class="border-b border-gray-700">
      <td class="px-3 py-2 font-medium">${t.trader}</td>
      <td class="px-3 py-2 text-right ${colorClass(t.futuresNetOI)}">${t.futuresNetOI.toLocaleString()} 口</td>
      <td class="px-3 py-2 text-right ${colorClass(t.optionsNetOI)}">${t.optionsNetOI.toLocaleString()} 口</td>
      <td class="px-3 py-2 text-right font-bold ${colorClass(t.futuresNetOI + t.optionsNetOI)}">${(t.futuresNetOI + t.optionsNetOI).toLocaleString()} 口</td>
    </tr>`).join("");

  // 選擇權契約未平倉表格（實際資料只有外資/自營商未平倉，無 Call/Put 拆分）
  const oiRows = (optionsOI?.contracts ?? []).slice(0, 8).map(c => `
    <tr class="border-b border-gray-700">
      <td class="px-3 py-2 font-mono text-sm">${c.name}</td>
      <td class="px-3 py-2 text-right ${colorClass(c.foreignNetOI)}">${c.foreignNetOI.toLocaleString()}</td>
      <td class="px-3 py-2 text-right ${colorClass(c.dealerNetOI)}">${c.dealerNetOI.toLocaleString()}</td>
      <td class="px-3 py-2 text-right text-xs text-gray-400">${c.bias}</td>
    </tr>`).join("");

  // 大盤籌碼卡描述
  const chipDesc = chipCard
    ? `<div class="text-sm text-gray-400 mb-2">市場:${chipCard.marketBiasDescription} ｜ P/C=${fmt(chipCard.putCallRatio)} (${chipCard.putCallDescription})</div>`
    : "";

  // Pantlas 概覽
  const pt = pantlas ?? null;
  const pantlasHtml = pt ? `
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-500">漲</div>
        <div class="text-xl font-bold text-red-500">${pt.advancers}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-500">跌</div>
        <div class="text-xl font-bold text-green-500">${pt.decliners}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-500">平</div>
        <div class="text-xl font-bold text-gray-400">${pt.unchanged}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3 col-span-2">
        <div class="text-xs text-gray-500">成交值</div>
        <div class="text-xl font-bold">${fmt(pt.turnoverBillion, 0)} 億</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-500">估計漲停/跌停</div>
        <div class="text-sm font-bold">
          <span class="text-red-400">${pt.estimatedLimitUp}</span>
          <span class="text-gray-600 mx-1">/</span>
          <span class="text-green-400">${pt.estimatedLimitDown}</span>
        </div>
      </div>
    </div>` : "";

  // 熱區表格
  const zoneRows = (hz?.zones ?? []).slice(0, 12).map(z => {
    const dotCls = z.status === "聚焦" ? "bg-red-500" : z.status === "升溫" ? "bg-orange-400" : z.status === "分歧" ? "bg-yellow-500" : "bg-gray-500";
    return `<tr class="border-b border-gray-800 hover:bg-gray-800/50">
      <td class="px-3 py-2"><span class="inline-block w-2 h-2 rounded-full mr-2 ${dotCls}"></span>${z.name}</td>
      <td class="px-3 py-2 text-right text-xs text-gray-400">${z.id}</td>
      <td class="px-3 py-2 text-right font-bold ${colorClass(z.changePct ?? 0)}">${fmt(z.changePct ?? 0, 2)}%</td>
      <td class="px-3 py-2 text-right ${colorClass(z.flowValue ?? 0)}">${fmt(z.flowValue ?? 0, 1)} 億</td>
      <td class="px-3 py-2 text-right text-xs text-gray-500">${fmt(z.avg5d ?? 0, 1)}</td>
      <td class="px-3 py-2 text-right text-xs text-gray-500">${fmt(z.avg20d ?? 0, 1)}</td>
    </tr>`;
  }).join("");

  // 板塊資金流
  const sfRows = (sectorFlows ?? []).slice(0, 10).map(sf => `
    <tr class="border-b border-gray-800 hover:bg-gray-800/50">
      <td class="px-3 py-2 font-medium">${sf.sector}</td>
      <td class="px-3 py-2 text-right ${colorClass(sf.foreign5D)}">${fmt(sf.foreign5D, 1)}</td>
      <td class="px-3 py-2 text-right ${colorClass(sf.trust5D)}">${fmt(sf.trust5D, 1)}</td>
      <td class="px-3 py-2 text-right ${colorClass(sf.dealer5D)}">${fmt(sf.dealer5D, 1)}</td>
      <td class="px-3 py-2 text-right font-bold ${colorClass(sf.total5D)}">${fmt(sf.total5D, 1)}</td>
      <td class="px-3 py-2 text-right text-xs text-gray-500">${sf.stockCount}</td>
    </tr>`).join("");

  // 市場狀態機
  const regimeHtml = rc ? `
    <div class="mb-4">
      <div class="text-xs text-gray-500 mb-2">市場狀態機</div>
      <div class="grid grid-cols-5 gap-2 mb-2">
        ${(["強多","偏多","震盪","偏空","強空"] as const).map(l => `
          <div class="text-center p-2 rounded-lg ${rc.regime === l ? (l.includes("多") ? "bg-red-600" : l.includes("空") ? "bg-green-600" : "bg-gray-500") : "bg-gray-800"}">
            <div class="text-xs ${rc.regime === l ? "text-white font-bold" : "text-gray-500"}">${l}</div>
          </div>`).join("")}
      </div>
      <div class="text-xs text-gray-500">${rc.note}</div>
    </div>` : "";

  // 法人明細（Top 10）
  const instTop10 = Object.entries(institutional ?? {})
    .sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0))
    .slice(0, 10)
    .map(([sym, b]) => `
    <tr class="border-b border-gray-800">
      <td class="px-3 py-2 font-mono text-sm">${sym}</td>
      <td class="px-3 py-2 text-right ${colorClass(b.foreign ?? 0)}">${fmt(b.foreign ?? 0, 1)} 億</td>
      <td class="px-3 py-2 text-right ${colorClass(b.trust ?? 0)}">${fmt(b.trust ?? 0, 1)} 億</td>
      <td class="px-3 py-2 text-right ${colorClass(b.dealer ?? 0)}">${fmt(b.dealer ?? 0, 1)} 億</td>
      <td class="px-3 py-2 text-right font-bold ${colorClass(b.total ?? 0)}">${fmt(b.total ?? 0, 1)} 億</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>股流 Radar ｜ 離線報告 ${formatDate(asOf)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background: #0f172a; color: #e2e8f0; }
  .card { background: #1e293b; border-radius: 12px; padding: 16px; }
  .section-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #475569; font-weight: 500; padding: 6px 12px; border-bottom: 1px solid #334155; }
  td { padding: 6px 12px; font-size: 13px; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #1e293b; }
  ::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
</style>
</head>
<body class="min-h-screen p-4 md:p-8">
<div class="max-w-6xl mx-auto">

  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-white">股流 Radar</h1>
      <p class="text-sm text-gray-500 mt-1">${formatDate(asOf)} · 資料來源：${source === "live" ? "即時抓取" : "歷史存檔"}</p>
    </div>
    <div class="text-right text-xs text-gray-500">
      <div>產生時間</div>
      <div class="text-gray-400">${new Date(generatedAt).toLocaleString("zh-TW")}</div>
    </div>
  </div>

  <!-- 大盤摘要 -->
  <div class="card mb-4">
    <div class="section-title">大盤摘要</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div>
        <div class="text-xs text-gray-500 mb-1">漲 / 跌 / 平</div>
        <div class="flex gap-3 text-lg font-bold">
          <span class="text-red-400">${s.advance}</span>
          <span class="text-green-400">${s.decline}</span>
          <span class="text-gray-400">${s.flat}</span>
        </div>
        <div class="text-xs text-gray-500 mt-1">廣度 ${advancePct}%</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">總成交值</div>
        <div class="text-lg font-bold text-white">${fmt(s.totalValueYi, 0)} 億</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">三大法人合計</div>
        <div class="text-lg font-bold ${colorClass(s.institutionalNetYi ?? 0)}">${fmt(s.institutionalNetYi ?? 0, 2)} 億</div>
        <div class="text-xs ${colorClass(s.institutionalNetYi ?? 0)}">${s.institutionalCoverage ?? "—"}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">市場狀態</div>
        <div class="text-lg font-bold ${rc ? (rc.regime.includes("多") ? "text-red-400" : rc.regime.includes("空") ? "text-green-400" : "text-yellow-400") : "text-gray-500"}">${rc ? rc.regime : "—"}</div>
        <div class="text-xs text-gray-500 mt-1">${rc?.note ?? ""}</div>
      </div>
    </div>
    ${pantlasHtml}
    ${regimeHtml}
  </div>

  <!-- 熱門板塊 -->
  ${hz ? `
  <div class="card mb-4">
    <div class="section-title">熱門板塊（主題策展）</div>
    <table>
      <thead><tr><th>板塊</th><th>ID</th><th>今日漲幅</th><th>資金流</th><th>5日均值</th><th>20日均值</th></tr></thead>
      <tbody>${zoneRows}</tbody>
    </table>
  </div>` : ""}

  <!-- 板塊資金流 -->
  ${sectorFlows && sectorFlows.length > 0 ? `
  <div class="card mb-4">
    <div class="section-title">板塊資金流向（5 日）</div>
    <table>
      <thead><tr><th>產業別</th><th>外資</th><th>投信</th><th>自營</th><th>合計</th><th>股數</th></tr></thead>
      <tbody>${sfRows}</tbody>
    </table>
  </div>` : ""}

  <!-- 籌碼卡 + 選擇權 OI -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    ${chipCard ? `
    <div class="card">
      <div class="section-title">籌碼卡</div>
      ${chipDesc}
      <table>
        <thead><tr><th>法人</th><th>期貨未平倉</th><th>選擇權未平倉</th><th>合計</th></tr></thead>
        <tbody>${chipRows}</tbody>
      </table>
    </div>` : ""}
    ${optionsOI ? `
    <div class="card">
      <div class="section-title">選擇權未平倉口數（OI）</div>
      <table>
        <thead><tr><th>契約</th><th>外資未平倉</th><th>自營商未平倉</th><th>方向</th></tr></thead>
        <tbody>${oiRows}</tbody>
      </table>
    </div>` : ""}
  </div>

  <!-- 法人明細 Top 10 -->
  ${instTop10 ? `
  <div class="card mb-4">
    <div class="section-title">法人買賣超 Top 10（上市）</div>
    <table>
      <thead><tr><th>代號</th><th>外資</th><th>投信</th><th>自營</th><th>合計</th></tr></thead>
      <tbody>${instTop10}</tbody>
    </table>
  </div>` : ""}

  <!-- Footer -->
  <div class="text-center text-xs text-gray-600 py-4">
    股流 Radar 離線報告 · 僅供參考，非投資建議
  </div>

</div>
</body>
</html>`;

  return html;
}

/** 觸發下載：呼叫 API 取得 snapshot → 產生日文檔 → 下載 */
export async function downloadOfflineHTML(dateStr?: string): Promise<void> {
  const base = window.location.origin;
  const resp = await fetch(`${base}/api/export${dateStr ? `?date=${dateStr}` : ""}`);
  if (!resp.ok) throw new Error(`匯出失敗：${resp.status}`);
  const snapshot = await resp.json() as ExportSnapshot;
  const html = generateOfflineHTML(snapshot);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `guliu-radar-${snapshot.asOf}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
