/**
 * 大盤籌碼頁 — 三大法人期貨 + 五契約選擇權未平倉 + P/C 比 + 散戶留倉 + 籌碼分歧
 * 結論卡置頂，直覺掌握市場多空方向；2026-09-11 從 diverging bar 圖表改成簡化統計卡，
 * 密集的長條圖對「大白話」的產品定位來說太技術性，換成跟首頁同一套「標籤+徽章+大數字」語言。
 */

import { useMemo, useState } from "react";
import type { ChipCardData, OptionsOIData } from "@shared/types";
import type { ChipDivergenceResult } from "@shared/chip-divergence";
import { fetchChipCard, fetchOptionsOI, fetchChipDivergence, fetchRetailFutures, fetchChipCardWeekly } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { BadgeCheck, Calendar, ChevronUp, Clock, TrendingDown, TrendingUp } from "lucide-react";

/* ── 週計算 helper ─────────────────────────────────────────────── */
function isoWeekStart(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay() ?? 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function biasLabel(b: "long" | "short" | "flat"): string {
  return b === "long" ? "偏多" : b === "short" ? "偏空" : "中性";
}

/* ── P/C 比儀表板（有意義的視覺化）────────────────────────────── */
function PCDashboard({ ratio, trend }: { ratio: number | null; trend: (number | null)[] }) {
  if (ratio == null) return null;

  // API 回傳百分比（123.9 = 123.9%），前端轉為小數顯示（1.24）
  const today = ratio / 100;
  const yesterday = trend[1] != null ? trend[1]! / 100 : null;
  const dir = yesterday != null ? (today > yesterday ? "up" : today < yesterday ? "down" : "flat") : "flat";
  const dirLabel = dir === "up" ? "↑ 上升" : dir === "down" ? "↓ 下降" : "→ 持平";

  // 情緒判斷（以 ratio 小數為主：>1.4 極度謹慎，>1.2 偏保守，<0.8 偏樂觀）
  const sentiment = today > 1.4 ? "極度謹慎" : today > 1.2 ? "偏保守" : today > 1.0 ? "中性偏慎" : today > 0.8 ? "中性偏多" : "偏樂觀";
  const sentimentColor = today > 1.2 ? "#ff725e" : today < 1.0 ? "#65e6bd" : "#8c9cff";

  // 儀表刻度：0.6~1.6，today 在其中的位置
  const MIN_RATIO = 0.6, MAX_RATIO = 1.6;
  const pctPos = Math.max(0, Math.min(100, ((today - MIN_RATIO) / (MAX_RATIO - MIN_RATIO)) * 100));

  // 關鍵閾值標記
  const THRESHOLDS = [
    { v: 0.8, label: "樂觀", color: "#65e6bd" },
    { v: 1.0, label: "平衡", color: "#8c9cff" },
    { v: 1.2, label: "保守", color: "#ffb25c" },
    { v: 1.4, label: "謹慎", color: "#ff725e" },
  ];

  return (
    <div className="chip-pc-dashboard">
      <div className="chip-pc-header">
        <span className="chip-pc-eyebrow">PUT / CALL RATIO</span>
        <span className="chip-pc-big-num" style={{ color: sentimentColor }}>
          {today.toFixed(2)}
        </span>
        <span className="chip-pc-sentiment" style={{ color: sentimentColor }}>{sentiment}</span>
        <span className="chip-pc-dir">{dirLabel}</span>
      </div>

      {/* 儀表刻度 */}
      <div className="chip-pc-gauge-wrap">
        <div className="chip-pc-gauge-track">
          {/* 背景分段 */}
          <div className="chip-pc-gauge-seg" style={{ background: "#65e6bd" }} />
          <div className="chip-pc-gauge-seg" style={{ background: "#8c9cff" }} />
          <div className="chip-pc-gauge-seg" style={{ background: "#ffb25c" }} />
          <div className="chip-pc-gauge-seg" style={{ background: "#ff725e" }} />
          <div className="chip-pc-gauge-seg" style={{ background: "#ff4d4d" }} />
          {/* 指針 */}
          <div className="chip-pc-gauge-needle" style={{ left: `${pctPos}%` }} />
        </div>
        <div className="chip-pc-gauge-labels">
          {THRESHOLDS.map((t) => (
            <span key={t.v} className="chip-pc-gauge-th" style={{ color: t.color }}>{t.label}</span>
          ))}
        </div>
      </div>

      {/* 5 日趨勢 mini bars */}
      <div className="chip-pc-trend-row">
        <span className="chip-pc-trend-label">近 5 日</span>
        <div className="chip-pc-trend-bars">
          {trend.map((v, i) => {
            if (v == null) return <div key={i} className="chip-pc-trend-empty" />;
            const h = Math.max(4, Math.min(22, ((v / 100 - 0.6) / 1.0) * 22));
            const isToday = i === 0;
            return (
              <div key={i} className="chip-pc-trend-item" title={isToday ? "今日" : `-${trend.length - i} 日`}>
                <div className={`chip-pc-trend-bar ${isToday ? "today" : ""} ${v / 100 > 1.2 ? "high" : v / 100 < 1.0 ? "low" : "mid"}`} style={{ height: h }} />
                <span className="chip-pc-trend-num">{(v / 100).toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── 結論卡組件（期貨 + 選擇權，兩欄）──────────────────────── */
function ConclusionCards({ chipData, optData }: { chipData: ChipCardData; optData: OptionsOIData }) {
  const fBias = chipData.marketBias;
  const fDesc = chipData.marketBiasDescription;
  const oBias = optData.marketBias;
  const oDesc = optData.marketBiasDescription;

  return (
    <div className="chip-conclusion">
      {/* 期貨方向 */}
      <div className={`chip-conclusion-card ${fBias}`}>
        <div className="chip-conclusion-icon market">
          {fBias === "long" ? <TrendingUp size={16} /> : fBias === "short" ? <TrendingDown size={16} /> : <BadgeCheck size={16} />}
        </div>
        <div className="chip-conclusion-body">
          <span className="chip-conclusion-label">期貨大戶方向</span>
          <p className="chip-conclusion-text">{fDesc}</p>
          <span className="chip-conclusion-num">
            {(() => {
              const fx = chipData.traders.find((t) => t.trader === "外資及陸資");
              const zz = chipData.traders.find((t) => t.trader === "自營商");
              return `外資 ${fx?.futuresNetOI != null ? (fx.futuresNetOI >= 0 ? "+" : "") + fx.futuresNetOI.toLocaleString() : "—"} 口 ・自營 ${zz?.futuresNetOI != null ? (zz.futuresNetOI >= 0 ? "+" : "") + zz.futuresNetOI.toLocaleString() : "—"} 口`;
            })()}
          </span>
        </div>
      </div>

      {/* 選擇權方向 */}
      <div className={`chip-conclusion-card ${oBias}`}>
        <div className="chip-conclusion-icon market">
          {oBias === "long" ? <TrendingUp size={16} /> : oBias === "short" ? <TrendingDown size={16} /> : <BadgeCheck size={16} />}
        </div>
        <div className="chip-conclusion-body">
          <span className="chip-conclusion-label">選擇權大戶方向</span>
          <p className="chip-conclusion-text">{oDesc}</p>
          <span className="chip-conclusion-num">
            合計 {optData.totalForeignNetOI >= 0 ? "+" : ""}{optData.totalForeignNetOI.toLocaleString()} 口
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 籌碼分歧卡（外資 vs 散戶，規則引擎自動產生）────────────── */
function DivergenceCard({ d }: { d: ChipDivergenceResult | null }) {
  if (!d) return null;
  return (
    <div className={`chip-divergence-card ${d.diverged ? "diverged" : ""}`}>
      <div className="chip-divergence-stance">
        {d.diverged && <span className="chip-divergence-badge">籌碼分歧</span>}
        外資 <b className={d.foreignStance === "偏多" ? "long" : d.foreignStance === "偏空" ? "short" : ""}>{d.foreignStance}</b>
        {" · "}散戶 <b className={d.retailStance === "偏多" ? "long" : d.retailStance === "偏空" ? "short" : ""}>{d.retailStance}</b>
      </div>
      <p className="chip-divergence-text">{d.narrative}</p>
    </div>
  );
}

/* ── 散戶（小台/微台）留倉卡（公式未經真實驗證，警示標記不能拿掉）── */
function RetailCard({ contract, label }: { contract: "MTX" | "TMF"; label: string }) {
  const { data } = useAsync(() => fetchRetailFutures(contract), [contract]);
  if (!data) return null;
  return (
    <div className="chip-retail-card">
      <div className="chip-retail-head">
        <b>{label}散戶留倉</b>
        <span className="chip-retail-unverified">公式待驗證</span>
      </div>
      <div className="chip-retail-nums">
        <div><small>多方佔比</small><b style={{ color: (data.retailLongRatioPct ?? 50) > 50 ? "var(--primary)" : "var(--accent)" }}>
          {data.retailLongRatioPct != null ? `${data.retailLongRatioPct.toFixed(1)}%` : "—"}
        </b></div>
        <div><small>多方留倉</small><b>{data.retailLong.toLocaleString()} 口</b></div>
        <div><small>空方留倉</small><b>{data.retailShort.toLocaleString()} 口</b></div>
      </div>
    </div>
  );
}

/* ── 主元件 ────────────────────────────────────────────────────── */
type Period = "daily" | "weekly";
type ViewMode = "trader" | "contract";

export default function ChipCard() {
  const today = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<Period>("daily");
  const [viewMode, setViewMode] = useState<ViewMode>("trader");

  // 結論卡/選擇權OI/P&C儀表/散戶留倉一律看「今天」——這些是即時狀態指標，
  // 「本週累計」對它們沒有意義，只有期貨未平倉淨額適合累加
  const { data: chipData, error: chipError, reload } = useAsync(() => fetchChipCard(today), []);
  const { data: optData } = useAsync(() => fetchOptionsOI(today), []);
  const { data: divergence } = useAsync(() => fetchChipDivergence(), []);

  // 本週彙總：查自己資料庫存的每日快照加總（不依賴 TAIFEX API 的歷史查詢，它沒有這功能，
  // 見 chipcard-archive.ts 的說明），只有選「本週」時才會發這個請求
  const { data: weeklyData, error: weeklyError } = useAsync(
    () => (period === "weekly" ? fetchChipCardWeekly(isoWeekStart(today)) : Promise.resolve(null)),
    [period],
  );

  // 期貨未平倉卡片實際顯示的資料：本週模式顯示「本週買賣超合計」（流量，可加總）+ 最新未平倉部位（存量，僅供參考）
  const futuresDisplay = useMemo(() => {
    if (period === "weekly") {
      if (!weeklyData) return null;
      return weeklyData.traders.map((t) => ({
        trader: t.trader,
        netOI: t.netTradeSum,
        latestNetOI: t.latestNetOI,
        bias: (t.netTradeSum > 0 ? "long" : t.netTradeSum < 0 ? "short" : "flat") as "long" | "short" | "flat",
      }));
    }
    if (!chipData) return null;
    return chipData.traders.map((t) => ({ trader: t.trader, netOI: t.futuresNetOI, latestNetOI: null as number | null, bias: t.futuresBias }));
  }, [period, weeklyData, chipData]);

  // 期貨契約排行（按契約檢視用；直接列表，不用圖表——只有今日模式才有這個資料）
  const topFutures = useMemo(() => (chipData ? chipData.topFutures.slice(0, 5) : []), [chipData]);

  return (
    <section className="chip-card">
      {/* ── 標題列 ── */}
      <div className="chip-header">
        <div>
          <span className="chip-eyebrow">MARKET CAPITAL</span>
          <h2>大盤籌碼 <small>期貨 · 選擇權未平倉</small></h2>
          {period === "weekly"
            ? weeklyData && <p className="chip-as-of">{weeklyData.weekStart} 起 · 本週累計（{weeklyData.daysIncluded.length} 個交易日）</p>
            : chipData && <p className="chip-as-of">{fmtDate(chipData.asOf)} · 今日盤後</p>}
        </div>
        <div className="chip-controls">
          <div className="chip-period-btns" role="group">
            <button className={`chip-period-btn ${period === "daily" ? "active" : ""}`} onClick={() => setPeriod("daily")}>
              <Clock size={12} /><span>今日</span>
            </button>
            <button className={`chip-period-btn ${period === "weekly" ? "active" : ""}`} onClick={() => { setPeriod("weekly"); setViewMode("trader"); }}>
              <Calendar size={12} /><span>本週</span>
            </button>
          </div>
          <div className="chip-view-toggle" role="group">
            <button className={`chip-view-btn ${viewMode === "trader" ? "active" : ""}`} onClick={() => setViewMode("trader")}>按法人</button>
            <button
              className={`chip-view-btn ${viewMode === "contract" ? "active" : ""}`}
              onClick={() => setViewMode("contract")}
              disabled={period === "weekly"}
              title={period === "weekly" ? "本週彙總目前只支援按法人檢視" : undefined}
            >
              按契約
            </button>
          </div>
          <button className="chip-refresh-btn" onClick={reload} aria-label="重新整理"><ChevronUp size={14} /></button>
        </div>
      </div>

      {/* ── 結論卡（置頂） ── */}
      {chipData && optData?.data ? (
        <ConclusionCards chipData={chipData} optData={optData.data} />
      ) : (
        <div className="chip-empty">讀取中…</div>
      )}

      {/* ── 籌碼分歧（外資 vs 散戶） ── */}
      <DivergenceCard d={divergence ?? null} />

      {/* ── 期貨未平倉：簡化統計卡 ── */}
      <div className="chip-section-label">
        <span className="chip-eyebrow">FUTURES OI</span>
        <h3>{period === "weekly" ? "三大法人期貨本週買賣超" : "三大法人期貨未平倉"}</h3>
      </div>
      {viewMode === "trader" ? (
        period === "weekly" && !weeklyData ? (
          <div className="chip-empty">
            <p>{weeklyError ?? "本週尚無存檔資料——這個功能是新的，需要每天實際造訪過這頁才會累積資料，明後天再回來看"}</p>
          </div>
        ) : futuresDisplay ? (
          <div className="chip-stat-grid">
            {futuresDisplay.map((t) => (
              <div key={t.trader} className="chip-stat-card">
                <div className="chip-stat-head">
                  <small>{t.trader}</small>
                  <span className={`chip-stat-badge ${t.bias}`}>{biasLabel(t.bias)}</span>
                </div>
                <div className={`chip-stat-num ${t.bias}`}>{t.netOI >= 0 ? "+" : ""}{t.netOI.toLocaleString()} 口</div>
                {period === "weekly" && t.latestNetOI != null && (
                  <div className="chip-stat-sub">目前未平倉 {t.latestNetOI >= 0 ? "+" : ""}{t.latestNetOI.toLocaleString()} 口</div>
                )}
                {period === "daily" && chipData && (
                  <div className="chip-stat-sub">
                    今日買賣超 {(() => {
                      const raw = chipData.traders.find((x) => x.trader === t.trader)?.futuresNetTrade ?? 0;
                      return `${raw >= 0 ? "+" : ""}${raw.toLocaleString()} 口`;
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : chipError ? (
          <div className="chip-empty"><p>籌碼資料讀取失敗：{chipError}</p><button className="text-button" onClick={reload}>重試</button></div>
        ) : <div className="chip-empty">讀取中…</div>
      ) : (
        chipData && (
          <div className="chip-opt-list">
            {topFutures.map((fc) => (
              <div key={fc.name} className="chip-opt-row">
                <span className="chip-opt-name">{fc.name}</span>
                <span className="chip-opt-nums"><span>外資未平倉 <b>{fc.foreignNetOI >= 0 ? "+" : ""}{fc.foreignNetOI.toLocaleString()} 口</b></span><span>{biasLabel(fc.bias)}</span></span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── 選擇權 OI：簡化清單 ── */}
      <div className="chip-section-label">
        <span className="chip-eyebrow">OPTIONS OI</span>
        <h3>選擇權未平倉 <small>五契約</small></h3>
      </div>
      {optData?.data ? (
        <div className="chip-opt-list">
          {optData.data.contracts.map((c) => (
            <div key={c.contractCode} className="chip-opt-row">
              <span className="chip-opt-name">{c.name}</span>
              <span className="chip-opt-nums">
                <span>外資 <b>{c.foreignNetOI >= 0 ? "+" : ""}{c.foreignNetOI.toLocaleString()}</b></span>
                <span>自營 <b>{c.dealerNetOI >= 0 ? "+" : ""}{c.dealerNetOI.toLocaleString()}</b></span>
                <span>{biasLabel(c.bias)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="chip-empty">選擇權資料讀取中…</div>
      )}

      {/* P/C 情緒儀表板 */}
      {optData?.data && (
        <section className="chip-pc-section">
          <PCDashboard ratio={optData.data.putCallRatio} trend={optData.data.pcTrend} />
        </section>
      )}

      {/* ── 散戶留倉（小台/微台）── */}
      <div className="chip-section-label">
        <span className="chip-eyebrow">RETAIL POSITION</span>
        <h3>散戶留倉</h3>
      </div>
      <div className="chip-stat-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <RetailCard contract="MTX" label="小台" />
        <RetailCard contract="TMF" label="微台" />
      </div>
    </section>
  );
}
