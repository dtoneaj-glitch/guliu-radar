import { useEffect, useMemo, useState } from "react";
import type { Candle, ChartResponse, HotZone, HotzonesResponse, MarketHighlights, ScanStock, StockBrief, StrategyEval, Timeframe } from "@shared/types";
import {
  ArrowUpRight,
  BarChart,
  Bell,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Gauge,
  LineChart,
  LogOut,
  Percent,
  Radar,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  X,
  Zap,
  TrendingUp,
} from "lucide-react";
import { fetchBriefs, fetchChart, fetchMarketStrategyScan, fetchPaDefaultAnalysis, fetchRanking, fetchScan, fetchSearch, fetchStrategyEval, fetchStrategyScan, fetchTrends, fetchChipCard } from "@/lib/api";
import ReviewOverlay from "@/components/ReviewOverlay";
import StockSearch from "@/components/StockSearch";
import DigestBanner from "@/components/DigestBanner";
import GuideOverlay from "@/components/GuideOverlay";
import ChipCard from "@/components/ChipCard";
import NotificationSettings from "@/components/NotificationSettings";
import ExportButton from "@/components/ExportButton";
import Dashboard from "./Dashboard";
import StockDetail from "./StockDetail";
import StrategyBuilder from "./StrategyBuilder";
import { fmtDateTime, fmtDate, fmtPct, fmtPrice, fmtSignedPrice, fmtYi, shortZoneName } from "@/lib/format";
import { buildMarketFacts, estimateRiskReward, LEVELS_VERSION, type MarketFacts } from "@shared/levels";
import { useAsync, useDebounced } from "@/lib/useAsync";
import { useAppData } from "@/lib/useAppData";
import { useWatchlist } from "@/lib/watchlist";
import { useAuth } from "@/lib/auth";
import { useStrategyNotifier } from "@/lib/useStrategyNotifier";
import { useStateMachine } from "@/lib/useStateMachine";
import { useIsMobile } from "@/hooks/useMobile";

type Tab = "hotzones" | "scan" | "pa" | "chipcard" | "watchlist" | "strategy";

const TIMEFRAME_LABELS: { id: Timeframe; label: string }[] = [
  { id: "1w", label: "週線" },
  { id: "1d", label: "日線" },
  { id: "60m", label: "60 分" },
  { id: "15m", label: "15 分" },
];

const TONE: Record<HotZone["status"], string> = { 聚焦: "#ff725e", 升溫: "#65e6bd", 分歧: "#ffb25c", 觀望: "#8c9cff", 退潮: "#4a7777" };

const STRATEGIES: { id: string; name: string; desc: string }[] = [
  { id: "pa_default", name: "聲納", desc: "條件式 PA 基礎雷達：支撐區附近＋反轉 K 即響" },
  { id: "breakout-pullback", name: "破浪", desc: "前高突破 → 回踩不破 → 止跌 K 確認" },
  { id: "institution-tailwind", name: "順流", desc: "當日法人買超 ≥ 1 億＋板塊升溫＋回踩確認" },
  { id: "trend-follow", name: "潮流", desc: "上升結構自前高回調、HL 之上等反轉 K" },
  { id: "range-fade", name: "潮間帶", desc: "震盪箱體下緣反轉；區間中間不交易" },
  { id: "volume-refill", name: "回湧", desc: "MA25 上方地量回檔，量能拐頭＋陽線確認（2560 戰法）" },
  { id: "ma21-break", name: "破堤", desc: "MA21 走平向上，3% 帶量突破或連 3 天站穩（2133 戰法）" },
  { id: "deep-reversal", name: "鯨躍", desc: "下跌趨勢中開低收復昨低的關鍵反轉 K＋BIAS(5) < -3%（123 法）" },
  { id: "ma200-current", name: "洋流", desc: "MA200 斜率向上的回調買點，MA21 聯動減碼出場（200 生命線）" },
];

const STRAT_STATUS: Record<StrategyEval["status"], { label: string }> = {
  triggered: { label: "條件已符合" },
  waiting: { label: "等待中" },
  "no-trade": { label: "不交易" },
  insufficient: { label: "資料不足" },
};

function StatusPill({ status }: { status: HotZone["status"] }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}

/* ---------- 載入骨架 ---------- */

function ZoneSkeleton() {
  return <div className="zone-card skeleton-card"><span className="skeleton" style={{ width: "38%", height: 14 }} /><span className="skeleton" style={{ width: "64%", height: 26, marginTop: 22 }} /><span className="skeleton" style={{ width: "48%", height: 12, marginTop: 24 }} /><span className="skeleton" style={{ width: "100%", height: 30, marginTop: 26 }} /></div>;
}

function RowSkeleton() {
  return <div className="row-skeleton"><span className="skeleton" style={{ width: 30, height: 12 }} /><span className="skeleton" style={{ width: "38%", height: 14 }} /><span className="skeleton" style={{ marginLeft: "auto", width: 70, height: 12 }} /><span className="skeleton" style={{ width: 54, height: 12 }} /></div>;
}

function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="notice-card" role="status"><RotateCw size={15} /><p><b>資料載入失敗：</b>{message}<button className="text-button" onClick={onRetry}>重試 <RotateCw size={12} /></button></p></div>;
}

/* ---------- 泡泡資金流地圖（絕對座標＋可點擊＋hover 資訊卡） ---------- */

function niceCeil(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  const m = v / pow;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return n * pow;
}

function FlowChart({ zones, onOpen }: { zones: HotZone[]; onOpen: (z: HotZone) => void }) {
  const [hover, setHover] = useState<HotZone | null>(null);
  const top = [...zones].sort((a, b) => b.score - a.score).slice(0, 14);
  // SVG 單一座標系：刻度、網格、泡泡全部用同一套像素數學，不會錯位
  const W = 860;
  const H = 400;
  const padL = 64;
  const padR = 28;
  const padT = 20;
  const padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const flowMax = niceCeil(Math.max(20, ...top.map((z) => Math.abs(z.flowValue))));
  const maxAbsPct = Math.max(1, ...top.map((z) => Math.abs(z.changePct)));
  const pctMax = Math.min(10, niceCeil(maxAbsPct));
  const clampPct = (p: number) => Math.max(-pctMax, Math.min(pctMax, p));
  const X = (flow: number) => padL + ((flow + flowMax) / (2 * flowMax)) * plotW;
  const Y = (pct: number) => padT + (1 - (clampPct(pct) / pctMax + 1) / 2) * plotH;
  const maxTurnover = Math.sqrt(Math.max(...top.map((z) => z.turnoverValue), 1));
  const R = (z: HotZone) => 20 + (Math.sqrt(z.turnoverValue) / maxTurnover) * 32;
  const flowTicks = [-1, -0.5, 0, 0.5, 1].map((f) => f * flowMax);
  const pctTicks = [-1, -0.5, 0, 0.5, 1].map((f) => f * pctMax);
  const px = (vx: number) => (vx / W) * 100;
  const py = (vy: number) => (vy / H) * 100;

  return (
    <div className="flow-chart" aria-label="熱門類別資金流向圖">
      <svg className="flow-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`XY 軸：X 為當日法人買賣超（億，±${flowMax}），Y 為類股漲跌幅（±${pctMax}%）`}>
        {flowTicks.map((t) => (
          <line key={"v" + t} x1={X(t)} x2={X(t)} y1={padT} y2={padT + plotH} stroke={t === 0 ? "rgba(170,206,210,.35)" : "rgba(170,206,210,.12)"} strokeWidth="1" />
        ))}
        {pctTicks.map((t) => (
          <line key={"h" + t} x1={padL} x2={padL + plotW} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "rgba(170,206,210,.35)" : "rgba(170,206,210,.12)"} strokeWidth="1" />
        ))}
        {flowTicks.map((t) => (
          <text key={"vx" + t} x={X(t)} y={padT + plotH + 20} textAnchor="middle" fill="#748b8f" fontSize="11" fontFamily="DM Mono, monospace">{t > 0 ? `+${t}` : t}</text>
        ))}
        {pctTicks.map((t) => (
          <text key={"hy" + t} x={padL - 10} y={Y(t) + 4} textAnchor="end" fill="#748b8f" fontSize="11" fontFamily="DM Mono, monospace">{t > 0 ? `+${t}%` : t === 0 ? "0%" : `${t}%`}</text>
        ))}
        <text x={padL + plotW / 2} y={H - 8} textAnchor="middle" fill="#6f888b" fontSize="10" fontFamily="DM Mono, monospace">← 資金流出（億）　　資金流入（億）→</text>
        <text x={14} y={padT - 6} fill="#6f888b" fontSize="10" fontFamily="DM Mono, monospace">漲跌幅 ↗</text>
        {top.map((zone) => {
          const cx = Math.min(padL + plotW - R(zone) * 0.4, Math.max(padL + R(zone) * 0.4, X(zone.flowValue)));
          const cy = Math.min(padT + plotH - R(zone) * 0.4, Math.max(padT + R(zone) * 0.4, Y(zone.changePct)));
          const r = R(zone);
          return (
            <g
              key={zone.id}
              className="flow-bubble"
              tabIndex={0}
              role="button"
              aria-label={`${zone.name}，${zone.status}，法人買超 ${fmtYi(zone.flowValue)}，查看詳情`}
              onClick={() => onOpen(zone)}
              onMouseEnter={() => setHover(zone)}
              onMouseLeave={() => setHover((h) => (h?.id === zone.id ? null : h))}
            >
              <circle cx={cx} cy={cy} r={r} fill={TONE[zone.status]} opacity="0.92" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
              <text x={cx} y={cy + (r >= 27 ? -3 : 4)} textAnchor="middle" fill="#071014" fontSize={r >= 30 ? 12 : 10.5} fontWeight="800">{shortZoneName(zone.name).slice(0, 4)}</text>
              {r >= 27 && <text x={cx} y={cy + 12} textAnchor="middle" fill="#071014" fontSize="9.5" fontFamily="DM Mono, monospace" fontWeight="600">{fmtYi(zone.flowValue)}</text>}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className={`bubble-pop ${Y(hover.changePct) < 36 ? "bubble-pop-below" : ""}`}
          role="status"
          style={{ left: `${Math.min(74, Math.max(26, px(X(hover.flowValue))))}%`, top: `${Math.max(24, py(Y(hover.changePct)))}%` }}
        >
          <div className="bubble-pop-head"><b>{hover.name}</b><StatusPill status={hover.status} /></div>
          <div className="bubble-pop-row"><span>當日法人買超</span><b className={hover.flowValue >= 0 ? "up" : "down"}>{fmtYi(hover.flowValue)}</b></div>
          <div className="bubble-pop-row"><span>類股漲幅</span><b className={(hover.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(hover.changePct)}</b></div>
          <div className="bubble-pop-row"><span>成交值</span><b>{fmtYi(hover.turnoverValue)}</b></div>
          <div className="bubble-pop-row"><span>上漲廣度</span><b>{hover.gainers}／{hover.count}</b></div>
          <div className="bubble-pop-row"><span>代表股</span><b>{hover.topStocks.slice(0, 3).map((s) => s.name).join("・") || "—"}</b></div>
          <div className="bubble-pop-hint">點擊泡泡查看熱度拆解 →</div>
        </div>
      )}
    </div>
  );
}

function MicroBars({ zone }: { zone: HotZone }) {
  return (
    <span className="micro-bars" title={`資金 ${Math.round(zone.components.flow)}｜價格 ${Math.round(zone.components.price)}｜集中度 ${Math.round(zone.components.volume)}｜廣度 ${Math.round(zone.components.breadth)}`}>
      {(["flow", "price", "volume", "breadth"] as const).map((k) => (
        <i key={k} style={{ height: `${Math.max(12, Math.round(zone.components[k] * 0.26))}px` }} />
      ))}
    </span>
  );
}

/* ---------- 真實 K 線圖（SVG） ---------- */

function CandleChart({ candles, facts }: { candles: Candle[]; facts: MarketFacts | null }) {
  const slice = candles.slice(-52);
  const W = 520;
  const H = 238;
  const padL = 6;
  const padR = 86;
  const padT = 12;
  const padB = 10;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  let lo = Math.min(...slice.map((c) => c.low));
  let hi = Math.max(...slice.map((c) => c.high));
  const marks = [facts?.support?.low, facts?.support?.high, facts?.resistance?.low, facts?.resistance?.high, facts?.invalidation].filter(
    (x): x is number => x != null,
  );
  if (marks.length > 0) {
    lo = Math.min(lo, ...marks);
    hi = Math.max(hi, ...marks);
  }
  const pad = (hi - lo) * 0.05 || 1;
  lo -= pad;
  hi += pad;

  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * chartH;
  const step = chartW / slice.length;
  const bw = Math.max(2, step * 0.62);

  const levels: { p: number; color: string; label: string }[] = [];
  if (facts?.resistance) levels.push({ p: (facts.resistance.low + facts.resistance.high) / 2, color: "#ff725e", label: `壓力 ${fmtPrice(facts.resistance.low)}–${fmtPrice(facts.resistance.high)}` });
  if (facts?.support) levels.push({ p: (facts.support.low + facts.support.high) / 2, color: "#65e6bd", label: `支撐 ${fmtPrice(facts.support.low)}–${fmtPrice(facts.support.high)}` });
  if (facts?.invalidation != null) levels.push({ p: facts.invalidation, color: "#ffb25c", label: `失效 ${fmtPrice(facts.invalidation)} 下方` });

  return (
    <svg className="candle-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 ${slice.length} 根 K 線與關鍵價位`}>
      {facts?.entryZone && (
        <rect x={padL} y={y(facts.entryZone.high)} width={chartW} height={Math.max(2, y(facts.entryZone.low) - y(facts.entryZone.high))} fill="#ffb25c" opacity="0.1" />
      )}
      {slice.map((c, i) => {
        const up = c.close >= c.open;
        const color = up ? "#ff725e" : "#65e6bd";
        const x = padL + i * step + step / 2;
        const bodyTop = y(Math.max(c.open, c.close));
        const bodyH = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
        return (
          <g key={c.time}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" opacity="0.7" />
            <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} opacity="0.92" rx="1" />
          </g>
        );
      })}
      {levels.map((l) => (
        <g key={l.label}>
          <line x1={padL} x2={padL + chartW} y1={y(l.p)} y2={y(l.p)} stroke={l.color} strokeWidth="1" strokeDasharray="4 4" opacity="0.75" />
          <text x={padL + chartW + 6} y={y(l.p) + 3} fill={l.color} fontSize="9.5" fontFamily="DM Mono, monospace">{l.label}</text>
        </g>
      ))}
    </svg>
  );
}

/* ---------- 頁首／導覽 ---------- */

function AppHeader({ onSearch, goPA, onLogin, onNotifications }: { onSearch: () => void; goPA: (symbol: string) => void; onLogin: () => void; onNotifications: () => void }) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <div className="brand-mark"><Radar size={20} strokeWidth={2.2} /></div>
        <div><strong>股流 <em>Radar</em></strong><span>MARKET FOCUS / PRICE ACTION</span></div>
      </div>
      <div className="header-search-wrap"><StockSearch mode="inline" onPick={(s) => goPA(s)} /></div>
      <div className="header-actions">
        <ExportButton />
        <button className="icon-button header-search-mobile" aria-label="搜尋股票或類別" onClick={onSearch}><Search size={19} /></button>
        <button className="icon-button" aria-label="登入/註冊" onClick={onLogin}>
          <User size={18} />
        </button>
      </div>
    </header>
  );
}

function Sidebar({ active, setActive, data, phase }: { active: Tab; setActive: (tab: Tab) => void; data: HotzonesResponse | null; phase: string }) {
  const navItems: { id: Tab; label: string; helper: string; icon: typeof Radar }[] = [
    { id: "hotzones", label: "熱區", icon: Radar, helper: "市場焦點" },
    { id: "scan", label: "掃描", icon: Crosshair, helper: "候選股" },
    { id: "pa", label: "研判", icon: LineChart, helper: "讀圖決策" },
    { id: "chipcard", label: "大盤籌碼", icon: Percent, helper: "三大法人＋選擇權" },
    { id: "watchlist", label: "自選", icon: Star, helper: "我的追蹤" },
    { id: "strategy", label: "策略", icon: TrendingUp, helper: "條件組合" },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-topline"><span>DAILY BRIEF</span><span className="live-dot">{phase === "ready" ? "EOD" : phase === "fallback" ? "DEMO" : "…"}</span></div>
      <p className="side-note">先找熱區，再讀結構。<br />讓每一次交易都有條件。</p>
      <nav className="side-nav" aria-label="主要導覽">
        {navItems.map(({ id, label, icon: Icon, helper }) => (
          <button key={id} className={`side-nav-item ${active === id ? "active" : ""}`} onClick={() => setActive(id)}>
            <Icon size={18} /><span><b>{label}</b><small>{helper}</small></span><ChevronRight size={15} className="nav-chevron" />
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="pa-mini"><Sparkles size={16} /><div><b>研判提示</b><p>熱門不等於可交易。先等結構。</p></div></div>
        <div className="data-source">
          資料：{data?.sources.slice(0, 3).join("・") ?? "—"}<br />
          <span>{data ? `${fmtDate(data.asOf)} 盤後・更新 ${fmtDateTime(data.generatedAt)}` : "讀取中…"}</span>
        </div>
      </div>
    </aside>
  );
}

function BottomNav({ active, setActive }: { active: Tab; setActive: (tab: Tab) => void }) {
  const navItems: { id: Tab; label: string; icon: typeof Radar }[] = [
    { id: "hotzones", label: "熱區", icon: Radar },
    { id: "scan", label: "掃描", icon: Crosshair },
    { id: "pa", label: "研判", icon: LineChart },
    { id: "chipcard", label: "大盤籌碼", icon: Percent },
    { id: "watchlist", label: "自選", icon: Star },
    { id: "strategy", label: "策略", icon: TrendingUp },
  ];
  return <nav className="bottom-nav" aria-label="手機主要導覽">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? "active" : ""} onClick={() => setActive(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>;
}

function SummaryStrip({ data }: { data: HotzonesResponse | null }) {
  if (!data) {
    return <section className="summary-strip" aria-label="市場摘要">{[0, 1, 2, 3].map((i) => <div key={i}><span className="skeleton" style={{ width: 56, height: 10 }} /><span className="skeleton" style={{ width: 84, height: 22, marginTop: 12, display: "block" }} /></div>)}</section>;
  }
  const { summary, zones } = data;
  const denom = summary.advance + summary.decline;
  const temperature = denom > 0 ? Math.round((summary.advance / denom) * 100) : null;
  const focusCount = zones.filter((z) => z.status === "聚焦").length;
  return (
    <section className="summary-strip" aria-label="市場摘要">
      <div><span>市場溫度</span><b className="temperature"><i /> {temperature ?? "—"} <small>/ 100</small></b><em>廣度法（v0）</em></div>
      <div><span>聚焦熱區</span><b>{focusCount} <small>個</small></b><em className="up">共 {zones.length} 個類股</em></div>
      <div><span>法人合計</span><b className={summary.institutionalNet >= 0 ? "up" : "down"}>{fmtYi(summary.institutionalNet)}</b><em>{summary.institutionalCoverage}</em></div>
      <div><span>資料狀態</span><b className="data-ok"><i />{fmtDate(data.asOf)}</b><em>盤後・更新 {fmtDateTime(data.generatedAt)}</em></div>
    </section>
  );
}

/* ---------- 今日重點（規則引擎） ---------- */

function HighlightCard({ highlights, openZoneId, goPA }: { highlights: MarketHighlights; openZoneId: (id: string) => void; goPA: (symbol: string) => void }) {
  const { sentiment, topFlow, whales } = highlights;
  return (
    <section className="highlight-card" aria-label="今日重點">
      <div className="highlight-col">
        <span className="eyebrow">TODAY / SENTIMENT</span>
        <h3>今日情緒：<em>{sentiment.label}</em></h3>
        <div className="sentiment-bar"><i style={{ left: `${Math.min(96, Math.max(4, sentiment.value))}%` }} /></div>
        <p>{sentiment.advance} 家上漲・{sentiment.decline} 家下跌（廣度溫度計）</p>
      </div>
      <div className="highlight-col">
        <span className="eyebrow">TODAY / TOP FLOW</span>
        <h3>法人買最多板塊</h3>
        {topFlow.length === 0 ? <p className="hl-empty">今日無明顯法人買超板塊</p> : topFlow.map((z) => (
          <button key={z.id} className="highlight-row" onClick={() => openZoneId(z.id)}>
            <span>{z.name} <StatusPill status={z.status} /></span>
            <b className="up">{fmtYi(z.flowValue)}</b>
          </button>
        ))}
      </div>
      <div className="highlight-col">
        <span className="eyebrow">TODAY / WHALE ALERT</span>
        <h3>大戶異常</h3>
        {whales.length === 0 ? <p className="hl-empty">今日無突出的大額法人進出</p> : whales.map((w) => (
            <button key={w.symbol} className="highlight-row" onClick={() => goPA(w.symbol)}>
            <span>{w.symbol} {w.name}</span>
            <b className={w.netBuyValue >= 0 ? "up" : "down"}>{fmtYi(w.netBuyValue / 1e8)}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- 板塊排行榜（bottom sheet） ---------- */

function ZoneSheet({ zones, status, onClose, openZone }: { zones: HotZone[]; status: HotZone["status"]; onClose: () => void; openZone: (z: HotZone) => void }) {
  const rows = zones.filter((z) => z.status === status).sort((a, b) => b.score - a.score);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={`${status}板塊排行`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><StatusPill status={status} /><h3>{status}　{rows.length} 個板塊</h3><button className="icon-button" onClick={onClose} aria-label="關閉排行"><X size={18} /></button></div>
        <div className="sheet-rows">
          {rows.map((z, i) => (
            <button key={z.id} className="sheet-row" onClick={() => { onClose(); openZone(z); }}>
              <span className="candidate-rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="sheet-name">{z.name}<small>{z.count} 檔</small></span>
              <b className={(z.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(z.changePct)}</b>
              <b className={z.flowValue >= 0 ? "up" : "down"}>{fmtYi(z.flowValue)}</b>
              <b className="sheet-score">{z.score}</b>
              <ChevronRight size={15} />
            </button>
          ))}
          {rows.length === 0 && <div className="empty-state"><h3>此狀態目前沒有板塊</h3></div>}
        </div>
        <div className="sheet-foot">依熱度排序・點任一板塊查看熱度拆解</div>
      </section>
    </div>
  );
}

/* ---------- 熱區頁 ---------- */

function HotzoneCard({ zone, index, onOpen }: { zone: HotZone; index: number; onOpen: (zone: HotZone) => void }) {
  return (
    <button className="zone-card fade-up" style={{ animationDelay: `${index * 0.05}s` }} onClick={() => onOpen(zone)}>
      <div className="zone-card-head"><span className="eyebrow">#{String(index + 1).padStart(2, "0")} / BOARD</span><StatusPill status={zone.status} /></div>
      <div className="zone-title-row"><div><h3>{zone.name}</h3><span className="zone-flow">法人買賣超 <strong>{fmtYi(zone.flowValue)}</strong></span></div><div className="zone-score"><b>{zone.score}</b><span>熱度</span>{zone.avg5d != null && <span className="zone-avg">5日均 <i>{zone.avg5d}</i></span>}</div></div>
      <div className="zone-metrics"><span><i>漲幅</i><b className={(zone.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(zone.changePct)}</b></span><span><i>廣度</i><b>{zone.gainers}／{zone.count} 上漲</b></span><span><i>集中度</i><b>{(zone.turnoverShare * 100).toFixed(1)}%</b></span></div>
      <div className="zone-footer"><MicroBars zone={zone} /><span>查看板塊 <ChevronRight size={16} /></span></div>
    </button>
  );
}

function Hotzones({ data, openZone, setTab, goPA }: { data: HotzonesResponse; openZone: (zone: HotZone) => void; setTab: (tab: Tab) => void; goPA: (symbol: string) => void }) {
  const [filter, setFilter] = useState<"全部" | HotZone["status"]>("全部");
  const [board, setBoard] = useState<"theme" | "industry">("theme");
  const [sheet, setSheet] = useState<HotZone["status"] | null>(null);
  const zones = board === "theme" ? data.zones : data.industryZones ?? [];
  const filtered = filter === "全部" ? zones : zones.filter((z) => z.status === filter);
  const openZoneId = (id: string) => {
    const z = zones.find((x) => x.id === id);
    if (z) openZone(z);
  };
  const statusCounts = (["聚焦", "升溫", "分歧", "觀望", "退潮"] as HotZone["status"][]).map((s) => ({ s, n: zones.filter((z) => z.status === s).length }));
  const wl = useWatchlist();
  return (
    <>
      <div className="page-intro"><div><span className="eyebrow coral-text">AFTER MARKET / {fmtDate(data.asOf)}</span><h1>今天市場<br /><em>哪裡最熱？</em></h1><p>熱區用來縮小研究範圍，<br />價格行為用來規劃條件。</p></div><div className="date-stamp"><span>{data.asOf.slice(8, 10)}</span><b>{data.asOf.slice(5, 7)}月<br />{data.asOf.slice(0, 4)}</b></div></div>
      <DigestBanner symbols={wl.symbols} asOf={data.asOf} onOpenScan={() => setTab("scan")} />
      <SummaryStrip data={data} />
      <HighlightCard highlights={data.highlights} openZoneId={openZoneId} goPA={goPA} />
      <section className="section-block visual-section">
        <div className="section-heading"><div><span className="eyebrow">CAPITAL FLOW MAP</span><h2>資金流向地圖</h2></div>
          <div className="board-switch">{(["theme", "industry"] as const).map((b) => <button key={b} className={board === b ? "selected" : ""} onClick={() => setBoard(b)}>{b === "theme" ? `主題板塊 ${data.zones.length}` : `官方產業 ${data.industryZones?.length ?? 0}`}</button>)}</div>
        </div>
        <FlowChart zones={zones} onOpen={openZone} />
        <div className="chart-caption"><span>← 資金流出（億）</span><b>越右＝當日法人買越多・越上＝漲幅越大・圓越大＝成交值越大（點泡泡看詳情）</b><span>資金流入 →</span></div>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">STATUS BOARDS</span><h2>板塊狀態計數 <small>點卡片看完整排行</small></h2></div><button className="text-button" onClick={() => setTab("scan")}>查看掃描 <ChevronRight size={15} /></button></div>
        <div className="status-count-row">{statusCounts.map(({ s, n }) => <button key={s} className="status-count" onClick={() => setSheet(s)}><StatusPill status={s} /><b>{n}</b><small>個板塊</small></button>)}</div>
      </section>
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">{board === "theme" ? "THEME BOARDS" : "OFFICIAL INDUSTRIES"}</span><h2>{board === "theme" ? "熱門主題板塊" : "熱門官方產業"} <small>{zones.length} 個（{fmtDate(data.asOf)}）</small></h2></div></div><div className="filter-row">{["全部", "聚焦", "升溫", "分歧", "觀望", "退潮"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item as typeof filter)}>{item}</button>)}</div><div className="zones-grid">{filtered.slice(0, 12).map((zone, i) => <HotzoneCard key={zone.id} zone={zone} index={i} onOpen={openZone} />)}{filtered.length === 0 && <div className="empty-state"><h3>此分層目前沒有板塊</h3><p>換個分層看看，或等明天盤後更新。</p></div>}</div></section>
      <div className="pa-banner"><div className="banner-icon"><Sparkles size={20} /></div><div><span className="eyebrow">PRICE ACTION ANALYSIS</span><h3>熱門只是起點，結構才是訊號。</h3><p>選一檔熱區內的股票，查看支撐、壓力、回踩與失效位。</p></div><button className="primary-button" onClick={() => setTab("pa")}>開啟研判 <ChevronRight size={16} /></button></div>
      {sheet && <ZoneSheet zones={zones} status={sheet} onClose={() => setSheet(null)} openZone={openZone} />}
    </>
  );
}

function ZoneDetail({ zone, onBack, goPA }: { zone: HotZone; onBack: () => void; goPA: (symbol: string) => void }) {
  return (
    <>
      <button className="back-link" onClick={onBack}>← 返回熱門類別</button>
      <div className="zone-detail-hero"><div><span className="eyebrow coral-text">CATEGORY DETAIL</span><h1>{zone.name}</h1><p>資金與價格的熱度拆解</p></div><StatusPill status={zone.status} /></div>
      <div className="detail-metrics">
        <div><small>熱度分數</small><b>{zone.score}<i>／100</i></b></div>
        <div><small>法人買賣超</small><b className={zone.flowValue >= 0 ? "up" : "down"}>{fmtYi(zone.flowValue)}</b></div>
        <div><small>上漲廣度</small><b>{zone.gainers}／{zone.count}</b></div>
        <div><small>成交值集中度</small><b>{(zone.turnoverShare * 100).toFixed(1)}%</b></div>
      </div>
      <div className="zone-detail-grid">
        <section className="detail-panel"><span className="eyebrow">WHY IT IS HOT</span><h2>熱度來源 <small>權重 35／25／20／20</small></h2>
          <div className="source-bars">
            <div><span>資金流向</span><b style={{ width: `${Math.max(3, Math.round(zone.components.flow))}%` }} /><strong>{Math.round(zone.components.flow)}</strong></div>
            <div><span>價格強度</span><b style={{ width: `${Math.max(3, Math.round(zone.components.price))}%` }} /><strong>{Math.round(zone.components.price)}</strong></div>
            <div><span>量能集中</span><b style={{ width: `${Math.max(3, Math.round(zone.components.volume))}%` }} /><strong>{Math.round(zone.components.volume)}</strong></div>
            <div><span>上漲廣度</span><b style={{ width: `${Math.max(3, Math.round(zone.components.breadth))}%` }} /><strong>{Math.round(zone.components.breadth)}</strong></div>
          </div>
        </section>
        <section className="detail-panel"><span className="eyebrow">TOP CONTRIBUTORS</span><h2>法人買超前段個股</h2>
          {zone.topStocks.length === 0 ? <div className="empty-state"><h3>沒有個股明細</h3><p>此區需 API 連線才會顯示。</p></div> : zone.topStocks.map((s) => (
            <button className="mini-stock" key={s.symbol} onClick={() => goPA(s.symbol)}>
              <span>{s.symbol} {s.name} <small className={s.changePct != null && s.changePct < 0 ? "down" : "up"}>{fmtPrice(s.close)}</small> · {fmtSignedPrice(s.changeAmt)} · {fmtPct(s.changePct)}</span>
              <b>{s.netBuyValue != null ? fmtYi(s.netBuyValue / 1e8) : "—"}</b>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </section>
      </div>
      <div className="pa-banner"><div className="banner-icon"><Sparkles size={20} /></div><div><span className="eyebrow">NEXT STEP</span><h3>熱區只是篩選，結構才是決策。</h3><p>選擇候選股，交給價格行為研判進一步拆解。</p></div><button className="primary-button" onClick={() => goPA(zone.topStocks[0]?.symbol ?? "2330")}>開始讀圖 <ChevronRight size={16} /></button></div>
    </>
  );
}

/* ---------- 掃描頁 ---------- */

type ScanMode = "zones" | "buy" | "sell" | "strategy" | "market";

function Scan({ zones, goPA }: { zones: HotZone[]; goPA: (symbol: string, highlightStrategy?: string) => void }) {
  const [mode, setMode] = useState<ScanMode>("zones");
  const [zoneFilter, setZoneFilter] = useState<string>("全部熱區");
  const [strategyScanId, setStrategyScanId] = useState("pa_default");
  const wl = useWatchlist();
  const wlKey = wl.symbols.join(",");
  const query = zoneFilter === "全部熱區" ? null : zoneFilter;
  const data = useAsync(async () => {
    if (mode === "zones") {
      const r = await fetchScan(query, 20);
      return { kind: "scan" as const, asOf: r.asOf, stocks: r.stocks, stratRows: [] as StrategyEval[], scopeNote: "" };
    }
    if (mode === "strategy") {
      if (wl.symbols.length === 0) return { kind: "strategy" as const, asOf: "", stocks: [], stratRows: [] as StrategyEval[], scopeNote: "" };
      const r = await fetchStrategyScan(wl.symbols, strategyScanId);
      return { kind: "strategy" as const, asOf: r.asOf, stocks: [], stratRows: r.rows, scopeNote: "" };
    }
    if (mode === "market") {
      const r = await fetchMarketStrategyScan(strategyScanId);
      return { kind: "market" as const, asOf: r.asOf, stocks: [], stratRows: r.rows, scopeNote: r.scopeNote };
    }
    const r = await fetchRanking(20);
    return { kind: "rank" as const, asOf: r.asOf, stocks: mode === "buy" ? r.buy : r.sell, stratRows: [] as StrategyEval[], scopeNote: "" };
  }, [mode, query, strategyScanId, wlKey]);

  const strategyName = STRATEGIES.find((s) => s.id === strategyScanId)?.name ?? "";
  const title = mode === "zones" ? "熱區候選股" : mode === "buy" ? "全市場法人買超 Top 20" : mode === "sell" ? "全市場法人賣超 Top 20" : mode === "strategy" ? `自選股×${strategyName}掃描` : `戰法×法人買超 Top 100（${strategyName}）`;
  const rows = data.data?.stocks ?? [];
  const stratRows = data.data?.stratRows ?? [];
  const scopeNote = data.data?.scopeNote ?? "";

  // B5 狀態機
  const { getActiveStates } = useStateMachine(null, strategyScanId, stratRows);
  const activeStates = getActiveStates();

  return (
    <>
      <div className="page-intro compact"><div><span className="eyebrow coral-text">SCANNER / CANDIDATES</span><h1>從熱區找候選股</h1><p>先用市場熱度縮小範圍，再把圖表交給價格行為研判。</p></div><div className="radar-orb"><Radar size={58} strokeWidth={1.2} /><span>{zones.length}<small>HOT ZONES</small></span></div></div>
      <section className="scan-controls">
        <div className="control-label">掃描模式</div>
        <div className="filter-scroll">{(["zones", "buy", "sell", "strategy", "market"] as ScanMode[]).map((m) => <button key={m} className={mode === m ? "selected" : ""} onClick={() => setMode(m)}>{m === "zones" ? "熱區候選" : m === "buy" ? "法人買超 Top 20" : m === "sell" ? "法人賣超 Top 20" : m === "strategy" ? "策略掃描（自選）" : "戰法×法人 Top 100"}</button>)}</div>
        {mode === "zones" && <div className="filter-scroll">{["全部熱區", ...zones.slice(0, 8).map((z) => z.name)].map((item) => <button key={item} className={zoneFilter === item ? "selected" : ""} onClick={() => setZoneFilter(item)}>{item}</button>)}</div>}
        {(mode === "strategy" || mode === "market") && <div className="filter-scroll">{STRATEGIES.map((s) => <button key={s.id} title={s.desc} className={strategyScanId === s.id ? "selected" : ""} onClick={() => setStrategyScanId(s.id)}>{s.name}</button>)}</div>}
      </section>
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">WATCH CANDIDATES</span><h2>{title} <small>{mode === "strategy" || mode === "market" ? stratRows.length : rows.length} 檔</small></h2></div></div>
        {activeStates.length > 0 && mode !== "zones" && (
          <div className="state-alert">
            <Zap size={14} /><span className="state-alert-text">狀態變更：{activeStates.slice(0, 3).map(s => `${s.symbol} ${s.currentStatus === 'triggered' ? '已觸發' : s.history[0]?.from ?? '初始'} → ${s.currentStatus}`).join('、')}</span>
          </div>
        )}
        {data.loading ? <div className="candidate-list">{[0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} />)}</div>
          : data.error ? <ErrorNote message={data.error} onRetry={data.reload} />
            : mode === "strategy" || mode === "market" ? (
              <>
                {mode === "market" && scopeNote && <div className="single-frame-note"><CircleHelp size={15} /><span>{scopeNote}・首次掃描需抓取個股日線，約數秒至數十秒。</span></div>}
                <div className="candidate-list">
                  {stratRows.map((r) => (
                    <button className="candidate-row strat-row" key={r.symbol} onClick={() => goPA(r.symbol, strategyName)}>
                      <span className={`strat-pill strat-${r.status}`}>{STRAT_STATUS[r.status].label}</span>
                      <span className="candidate-main"><b>{r.symbol} <strong>{r.name}</strong></b><small>{r.status === "triggered" ? r.met.join("・") : r.missing.join("・") || r.note}</small></span>
                      <span className="candidate-change"><b className={(r.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPrice(r.close)}</b><small>{fmtSignedPrice(r.changeAmt)} · {fmtPct(r.changePct)}</small></span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {stratRows.length === 0 && <div className="empty-state"><h3>{mode === "strategy" ? "自選清單是空的" : "此戰法今日無名單"}</h3><p>{mode === "strategy" ? "先到研判頁按星號加入股票，再用策略掃描。" : "條件未齊是常態——等明天盤後再掃。"}</p></div>}
                </div>
              </>
            ) : (
              <div className="candidate-list">{rows.map((s: ScanStock | StockBrief, index: number) => (
                  <button className="candidate-row" key={s.symbol} onClick={() => goPA(s.symbol)}>
                  <span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="candidate-main"><b>{s.symbol} <strong>{s.name}</strong></b><small>{s.industry ?? ""}</small></span>
                  <span className="candidate-flow"><b className={(s.netBuyValue ?? 0) >= 0 ? "up" : "down"}>{s.netBuyValue != null ? fmtYi(s.netBuyValue / 1e8) : "—"}</b><small>法人今日</small></span>
                  <span className="candidate-change"><b className={(s.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPrice(s.close)}</b><small>{fmtSignedPrice(s.changeAmt)} · {fmtPct(s.changePct)}</small></span>
                  <ChevronRight size={16} />
                </button>
              ))}{rows.length === 0 && <div className="empty-state"><h3>沒有符合的候選股</h3><p>試著換一個模式或熱區，或等明天盤後更新。</p></div>}</div>
            )}
      </section>
      <div className="notice-card"><ShieldCheck size={17} /><p><b>候選不等於推薦。</b>「熱區候選」＝熱度前段板塊內、法人買賣超領先的成分股（每板塊前 4 名，跨板塊去重）；「Top 20」＝全市場法人買（賣）超金額排行；「策略掃描」＝你的自選股逐檔套用所選策略條件；「戰法×法人 Top 100」＝法人買超前 100 名逐檔套用戰法規則（收盤確認、隔日參考）。是否形成可交易結構，請進入研判頁確認。</p></div>
    </>
  );
}

/* ---------- 研判頁 ---------- */

function buildScenarios(facts: MarketFacts): { kind: "long" | "wait" | "no-trade"; title: string; text: string }[] {
  const rows: { kind: "long" | "wait" | "no-trade"; title: string; text: string }[] = [];
  const entry = facts.entryZone;
  const res = facts.resistance;
  if (facts.trend === "上升" && entry) {
    rows.push({ kind: "long", title: "順勢做多（條件式）", text: `若回踩 ${fmtPrice(entry.low)}–${fmtPrice(entry.high)} 且出現止跌 K（多頭吞沒／多頭 Pin Bar），才進一步評估。` });
  } else if (facts.trend === "下降" && res) {
    rows.push({ kind: "wait", title: "反彈觀察", text: `若反彈至壓力 ${fmtPrice(res.low)}–${fmtPrice(res.high)} 出現轉弱 K，才考慮空方條件（並注意台股融券規則）。` });
  } else {
    rows.push({ kind: "wait", title: "等待結構", text: facts.support ? `先等待回踩 ${fmtPrice(facts.support.low)}–${fmtPrice(facts.support.high)} 的確認行為，再談進場。` : "先等待明確的支撐／壓力區形成，再談進場。" });
  }
  const pending = facts.patterns.filter((p) => p.status === "未確認");
  rows.push({
    kind: "wait",
    title: "等待確認",
    text: pending.length > 0
      ? `${pending.map((p) => `${p.name}（${p.time.slice(-5)}）`).join("、")} 尚未收確認；另需確認更大級別方向是否一致。`
      : "尚無進行中的形態；等待觸及關鍵區後的 K 線證據。",
  });
  rows.push({
    kind: "no-trade",
    title: "不交易條件",
    text: [facts.invalidation != null ? `收盤跌破 ${fmtPrice(facts.invalidation)}（結構失效）` : null, "區間中間追價", "盈虧比不足 1:2", "訊號互相矛盾或資料不足"].filter(Boolean).join("；") + "。",
  });
  return rows;
}

function PA({ symbol, goPA }: { symbol: string; goPA: (symbol: string) => void }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [strategyId, setStrategyId] = useState("pa_default");
  const [showRisk, setShowRisk] = useState(false);
  const [accountSize, setAccountSize] = useState(500000);
  const [riskPct, setRiskPct] = useState(1);
  const watchlist = useWatchlist();
  const chart = useAsync(() => fetchChart(symbol, timeframe), [symbol, timeframe]);
  const strat = useAsync(() => fetchStrategyEval(symbol, strategyId), [symbol, strategyId]);
  const paAnalysis = useAsync(() => fetchPaDefaultAnalysis(symbol), [symbol]);

  const candles = chart.data?.candles ?? [];
  const facts = useMemo(() => (candles.length > 0 ? buildMarketFacts(candles) : null), [candles]);
  const last = candles[candles.length - 1];
  const prevClose = chart.data?.prevClose ?? last?.open ?? 0;
  const changePct = prevClose > 0 && last ? ((last.close - prevClose) / prevClose) * 100 : null;
  const rr = useMemo(() => (facts && last ? estimateRiskReward(facts, last.close) : null), [facts, last]);
  const riskAmount = (accountSize * riskPct) / 100;
  const perShareRisk = rr ? (rr.entry[0] + rr.entry[1]) / 2 - rr.stop : 0;
  const shares = perShareRisk > 0 ? Math.floor(riskAmount / perShareRisk) : 0;
  const fav = watchlist.symbols.includes(symbol);

  return (
    <>
      <div className="pa-header">
        <div>
          <span className="eyebrow coral-text">PRICE ACTION ANALYSIS / {TIMEFRAME_LABELS.find((t) => t.id === timeframe)?.label}</span>
          <h1>{symbol} <em>{chart.data?.name ?? ""}</em></h1>
          <p>{chart.data?.industry ?? "…"} · 收 {fmtPrice(last?.close)} {fmtPct(changePct)} · 價格行為研判（v0 規則版）</p>
        </div>
        <button className={`star-action ${fav ? "active" : ""}`} onClick={() => watchlist.toggle(symbol)} aria-label={fav ? "移除自選" : "加入自選"}><Star size={19} fill={fav ? "currentColor" : "none"} /></button>
      </div>
      <div className="timeframe-tabs">{TIMEFRAME_LABELS.map((t) => <button className={timeframe === t.id ? "selected" : ""} key={t.id} onClick={() => setTimeframe(t.id)}>{t.label}</button>)}</div>
      <div className="single-frame-note"><CircleHelp size={15} /><span>圖表目前顯示 {TIMEFRAME_LABELS.find((t) => t.id === timeframe)?.label}；上方 PA_DEFAULT 研判引擎會另行整合週／日／60 分／15 分資料。</span></div>
      <div className="strategy-bar"><span className="eyebrow">STRATEGY</span>{STRATEGIES.map((s) => <button key={s.id} title={s.desc} className={`strategy-chip ${strategyId === s.id ? "selected" : ""}`} onClick={() => setStrategyId(s.id)}>{s.name}</button>)}</div>
      {strat.loading ? <div className="strategy-card"><span className="skeleton" style={{ width: "60%", height: 16 }} /></div>
        : strat.error ? <ErrorNote message={strat.error} onRetry={strat.reload} />
          : strat.data && (
            <section className={`strategy-card strat-${strat.data.status}`}>
              <div className="strategy-card-head">
                <div><span className="eyebrow">STRATEGY STATUS</span><h3>{strat.data.strategyName} <span className={`strat-pill strat-${strat.data.status}`}>{STRAT_STATUS[strat.data.status].label}</span></h3></div>
              </div>
              <div className="strategy-conds">
                <div className="cond-col met">{strat.data.met.map((m) => <div key={m}>✓ {m}</div>)}</div>
                <div className="cond-col missing">{strat.data.missing.map((m) => <div key={m}>○ {m}</div>)}</div>
              </div>
              <p className="strategy-note">{strat.data.note}。策略為 v1 規則版、條件式語句，不構成買賣指令。</p>
            </section>
          )}

      {paAnalysis.loading ? <div className="strategy-card"><span className="skeleton" style={{ width: "72%", height: 16 }} /></div>
        : paAnalysis.error ? <ErrorNote message={`研判引擎：${paAnalysis.error}`} onRetry={paAnalysis.reload} />
          : paAnalysis.data && (
            <section className="strategy-card strat-waiting">
              <div className="strategy-card-head"><div><span className="eyebrow">PA_DEFAULT / {paAnalysis.data.version}</span><h3>價格行為研判引擎 <span className="strat-pill strat-waiting">{STRAT_STATUS[paAnalysis.data.status].label}</span></h3></div></div>
              <div className="strategy-conds">
                <div className="cond-col met">{paAnalysis.data.sections.slice(0, 3).map((section) => <div key={section.id}>✓ {section.title}：{section.summary}</div>)}</div>
                <div className="cond-col missing">{paAnalysis.data.evidence.waiting.slice(0, 3).map((item) => <div key={item}>○ {item}</div>)}</div>
              </div>
              <p className="strategy-note">{paAnalysis.data.disclaimer}</p>
            </section>
          )}

      <section className="chart-card">
        <div className="chart-card-head"><div><span className="eyebrow">PRICE STRUCTURE</span><h2>{fmtPrice(last?.close)} <small className={(changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(changePct)}</small></h2></div><span className="chart-date">{last?.time ?? "…"} 收</span></div>
        {chart.loading ? <div className="candle-chart"><span className="skeleton" style={{ position: "absolute", inset: "12% 20% 8% 4%" }} /></div>
          : chart.error ? <ErrorNote message={chart.error} onRetry={chart.reload} />
            : <div className="candle-chart"><CandleChart candles={candles} facts={facts} /></div>}
        <div className="chart-legend"><span><i className="legend-line resistance" />壓力</span><span><i className="legend-line support" />支撐</span><span><i className="legend-line entry" />回踩區／失效</span><span className="v0-chip">levels {LEVELS_VERSION}</span></div>
      </section>

      {facts == null && !chart.loading ? (
        <div className="notice-card"><CircleHelp size={17} /><p><b>資料不足。</b>有效 K 線少於 30 根，無法產生結構判讀；請稍後再試或切換時間框架。</p></div>
      ) : facts && (
        <>
          <div className="analysis-grid">
            <section className="analysis-card confirmed"><div className="analysis-title"><span className="step-number">01</span><div><span className="eyebrow">MARKET STRUCTURE</span><h3>市場結構</h3></div><span className="confidence">{facts.confidence}信心</span></div>
              <div className="structure-read"><div><small>趨勢</small><b>{facts.trend}</b></div><div><small>高低點</small><b>{facts.sequence}</b></div><div><small>級別</small><b>單一時框</b></div></div>
              <p>以上為 PA Facts v1 從 Swing 轉折推導：<strong>{facts.trend}</strong>、序列 {facts.sequence}。大小級別一致性由上方四時間框架研判引擎提供。</p>
            </section>
            <section className="analysis-card confirmed"><div className="analysis-title"><span className="step-number">02</span><div><span className="eyebrow">KEY LEVELS</span><h3>關鍵價位</h3></div></div>
              <div className="level-list">
                {facts.resistance ? <div><i className="level-mark resistance" /><span>壓力區</span><b>{fmtPrice(facts.resistance.low)}–{fmtPrice(facts.resistance.high)}</b></div> : <div><i className="level-mark resistance" /><span>壓力區</span><b>未確認</b></div>}
                {facts.support ? <div><i className="level-mark support" /><span>支撐區</span><b>{fmtPrice(facts.support.low)}–{fmtPrice(facts.support.high)}</b></div> : <div><i className="level-mark support" /><span>支撐區</span><b>未確認</b></div>}
                <div><i className="level-mark invalid" /><span>結構失效</span><b>{facts.invalidation != null ? `${fmtPrice(facts.invalidation)} 下方` : "未確認"}</b></div>
              </div>
              {facts.support && <p className="level-basis">{facts.support.basis}</p>}
            </section>
            <section className="analysis-card uncertain"><div className="analysis-title"><span className="step-number">03</span><div><span className="eyebrow">PRICE ACTION</span><h3>價格行為</h3></div><span className="pending-tag">{facts.patterns.some((p) => p.status === "已確認") ? "部分確認" : "未確認"}</span></div>
              <div className="finding-list">
                {facts.patterns.length === 0 ? <div><span className="finding-state pending-dot" />近三根 K 無明顯形態<small>證據不足即不標註</small></div>
                  : facts.patterns.map((p) => <div key={p.name + p.time}><span className={`finding-state ${p.status === "已確認" ? "confirmed-dot" : "pending-dot"}`} />{p.name}（{p.time.slice(-5)}）<small>{p.status}</small></div>)}
              </div>
              <p>形態由 PA Facts v1 規則辨識（Pin Bar／吞沒），「未確認」＝最後一根 K 尚未收確認，不因漲多而預測反轉。</p>
            </section>
            <section className="analysis-card scenario-card"><div className="analysis-title"><span className="step-number">04</span><div><span className="eyebrow">TRADE SCENARIOS</span><h3>交易情境</h3></div></div>
              <div className="scenario-list">
                {buildScenarios(facts).map((s) => (
                  <div className={`scenario-row ${s.kind === "long" ? "long" : s.kind === "wait" ? "wait" : "no-trade"}`} key={s.title}>
                    {s.kind === "long" ? <ArrowUpRight size={16} /> : s.kind === "wait" ? <Gauge size={16} /> : <X size={16} />}
                    <div><b>{s.title}</b><span>{s.text}</span></div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="triage-grid" aria-label="三區分摘要">
            <div className="triage-item confirmed-triage"><h4>已確認的圖表資訊</h4><p>趨勢 {facts.trend}（{facts.confidence}信心）；{facts.support ? `支撐 ${fmtPrice(facts.support.low)}–${fmtPrice(facts.support.high)}` : "支撐未確認"}；{facts.resistance ? `壓力 ${fmtPrice(facts.resistance.low)}–${fmtPrice(facts.resistance.high)}` : "壓力未確認"}。</p></div>
            <div className="triage-item"><h4>推測情境</h4><p>{facts.trend === "上升" ? "回踩支撐區且止跌 K 成立後的多方延續。" : facts.trend === "下降" ? "反彈至壓力轉弱後的空方條件。" : "區間邊緣反轉或有效突破後的方向選擇。"}</p></div>
            <div className="triage-item"><h4>尚需等待的條件</h4><p>{facts.patterns.filter((p) => p.status === "未確認").map((p) => p.name).join("、") || "回踩確認 K"}；更大級別一致性；量能配合。</p></div>
          </div>

          <section className="risk-plan">
            <div className="risk-copy"><span className="eyebrow">05 / RISK PLAN</span><h2>風險先於方向。</h2><p>以下是條件成立後的規劃範例，不是無條件進場指令。輸入帳戶資訊可試算倉位。</p></div>
            <div className="risk-numbers">
              <div><small>進場觀察區</small><b>{rr ? `${fmtPrice(rr.entry[0])}–${fmtPrice(rr.entry[1])}` : "未確認"}</b></div>
              <div><small>結構止損</small><b>{rr ? `${fmtPrice(rr.stop)} 下方` : "未確認"}</b></div>
              <div><small>目標一／二</small><b>{rr ? `${fmtPrice(rr.target1)}／${fmtPrice(rr.target2)}` : "未確認"}</b></div>
              <div><small>估算 R:R</small><b className={(rr?.rr1 ?? 0) >= 2 ? "up" : "down"}>{rr?.rr1 ? `1 : ${rr.rr1.toFixed(1)}` : "—"}</b></div>
            </div>
            <button className="secondary-button" onClick={() => setShowRisk(!showRisk)}>{showRisk ? "收起計算器" : "計算我的倉位"}<ChevronRight size={16} /></button>
          </section>
          {showRisk && rr && (
            <section className="position-calculator">
              <div><span className="eyebrow">POSITION SIZE</span><h3>用風險反推倉位</h3></div>
              <label>帳戶淨值<input inputMode="numeric" value={accountSize} onChange={(e) => setAccountSize(Math.max(0, Number(e.target.value.replace(/[^\d]/g, "")) || 0))} aria-label="帳戶淨值" /></label>
              <label>單筆風險 %<input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(Math.min(10, Math.max(0.1, Number(e.target.value.replace(/[^\d.]/g, "")) || 0.1)))} aria-label="單筆風險百分比" /></label>
              <div className="calculated"><small>可承受風險 {fmtPrice(riskAmount)} 元</small><b>{shares > 0 ? `${shares.toLocaleString()} 股` : "風險距離不足"}</b><span>整股／零股、滑價與交易成本未計入，實際下單前請自行調整。</span></div>
            </section>
          )}
        </>
      )}
      <div className="pa-disclaimer"><BookOpen size={15} /><span>研判 v0 由規則引擎從公開盤後資料計算，不構成投資建議、買賣推薦或獲利保證；六段框架的完整事實層於 Sprint 3 接入。</span></div>
    </>
  );
}

/* ---------- 自選頁 ---------- */

const TREND_CLS: Record<string, string> = { 上升: "up", 下降: "down", 震盪: "flat" };

/**
 * 水池（庫存股）成本價與浮盈/浮虧顯示。
 * 如實顯示虧損——使用者可能是捨不得停損才放著，這裡不美化，賺虧都用同一套
 * 紅漲綠跌的顏色語意（浮盈＝coral、浮虧＝mint），跟看盤時的漲跌顏色邏輯一致。
 */
function CostBlock({
  symbol, close, costPrice, editing, draft, onDraftChange, onStartEdit, onSave, onClear,
}: {
  symbol: string; close: number; costPrice: number | undefined;
  editing: boolean; draft: string; onDraftChange: (v: string) => void;
  onStartEdit: () => void; onSave: () => void; onClear: () => void;
}) {
  if (editing) {
    return (
      <div className="cost-edit-row" onClick={(e) => e.stopPropagation()}>
        <input
          type="number" inputMode="decimal" placeholder="成本價" value={draft} autoFocus
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onClear(); }}
        />
        <button className="text-button" onClick={onSave}>儲存</button>
      </div>
    );
  }
  if (costPrice == null) {
    return (
      <button className="cost-set-btn" onClick={(e) => { e.stopPropagation(); onStartEdit(); }} aria-label={`設定 ${symbol} 成本價`}>
        ＋設定成本價
      </button>
    );
  }
  const diff = close - costPrice;
  const pct = costPrice !== 0 ? (diff / costPrice) * 100 : 0;
  const isGain = diff >= 0;
  return (
    <button className="cost-pnl-row" onClick={(e) => { e.stopPropagation(); onStartEdit(); }} aria-label={`編輯 ${symbol} 成本價`}>
      <span className="cost-basis">成本 {fmtPrice(costPrice)}</span>
      <span className={isGain ? "up" : "down"}>{isGain ? "浮盈" : "浮虧"} {fmtSignedPrice(diff)}（{fmtPct(pct)}）</span>
    </button>
  );
}

function Watchlist({ goPA }: { goPA: (symbol: string) => void }) {
  const wl = useWatchlist();
  const symbols = wl.symbols;
  const key = symbols.join(",");
  const briefs = useAsync(() => (symbols.length > 0 ? fetchBriefs(symbols) : Promise.resolve({ asOf: "", found: [], notFound: [] })), [key]);
  const trends = useAsync(() => (symbols.length > 0 ? fetchTrends(symbols) : Promise.resolve({ asOf: "", trends: [] })), [key]);
  const trendMap = useMemo(() => new Map((trends.data?.trends ?? []).map((t) => [t.symbol, t])), [trends.data]);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [trendFilter, setTrendFilter] = useState<"all" | "上升" | "震盪" | "下降">("all");
  const [tagEdit, setTagEdit] = useState<string | null>(null);
  const [costEdit, setCostEdit] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [frozenOpen, setFrozenOpen] = useState(false);

  const found = briefs.data?.found ?? [];
  const itemOf = (sym: string) => wl.items.find((i) => i.symbol === sym);
  const groupName = (id: string) => wl.groups.find((g) => g.id === id)?.name ?? id;
  const matches = (sym: string) => {
    if (groupFilter !== "all" && !(itemOf(sym)?.groups.includes(groupFilter) ?? false)) return false;
    if (trendFilter !== "all" && (trendMap.get(sym)?.trend ?? null) !== trendFilter) return false;
    return true;
  };
  const isStillOnly = (sym: string) => {
    const g = itemOf(sym)?.groups ?? [];
    return g.length > 0 && g.every((x) => x === "still");
  };
  const rows = found.filter((s) => matches(s.symbol) && !(groupFilter === "all" && isStillOnly(s.symbol)));
  const frozenRows = found.filter((s) => matches(s.symbol) && groupFilter === "all" && isStillOnly(s.symbol));
  const trendCount = (t: "上升" | "震盪" | "下降") => symbols.filter((s) => (trendMap.get(s)?.trend ?? null) === t).length;

  return (
    <>
      <div className="page-intro compact"><div><span className="eyebrow coral-text">MY WATCHLIST</span><h1>把注意力留給重要的。</h1><p>自選股存在這台裝置上，一檔可貼多個標籤；靜流＝暫不關注。</p></div><div className="watchlist-count"><b>{symbols.length}</b><span>STOCKS</span></div></div>
      <section className="watch-controls">
        <div className="filter-scroll">
          <button className={groupFilter === "all" ? "selected" : ""} onClick={() => setGroupFilter("all")}>全部 {symbols.length}</button>
          {wl.groups.map((g) => <button key={g.id} title={g.id === "main" ? "核心關注" : g.id === "charge" ? "準備進場" : g.id === "ride" ? "已進場持有" : g.id === "still" ? "暫不關注（預設收合）" : undefined} className={groupFilter === g.id ? "selected" : ""} onClick={() => setGroupFilter(g.id)}>{g.name}{g.id === "ride" && <small className="group-hint">（庫存）</small>} {wl.items.filter((i) => i.groups.includes(g.id)).length}</button>)}
        </div>
        <div className="filter-scroll">
          {(["all", "上升", "震盪", "下降"] as const).map((t) => <button key={t} className={trendFilter === t ? "selected" : ""} onClick={() => setTrendFilter(t)}>{t === "all" ? `全部趨勢` : `${t} ${trendCount(t)}`}</button>)}
          {trends.loading && <span className="watch-hint">趨勢計算中…</span>}
        </div>
        <div className="watch-add-group">{showAdd ? <>
          <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newGroup.trim()) { wl.addGroup(newGroup); setNewGroup(""); setShowAdd(false); } }} placeholder="群組名稱（Enter 新增）" aria-label="新增群組" maxLength={8} autoFocus />
          <button className="text-button" onClick={() => { if (newGroup.trim()) { wl.addGroup(newGroup); setNewGroup(""); setShowAdd(false); } }}>新增</button>
        </> : <button className="text-button" onClick={() => setShowAdd(true)}>＋新增群組</button>}</div>
      </section>
      <section className="section-block watch-add-search">
        <div className="section-heading"><div><span className="eyebrow">ADD STOCK</span><h2>＋新增股票 <small>搜尋後按 ☆ 直接加入</small></h2></div></div>
        <StockSearch mode="block" onPick={goPA} />
      </section>
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">SAVED CANDIDATES</span><h2>自選股票 <small>{rows.length + frozenRows.length} 檔</small></h2></div>{symbols.length > 0 && <button className="text-button" onClick={wl.clear}>清空</button>}</div>
        {symbols.length === 0 ? <div className="empty-state"><Star size={22} /><h3>還沒有自選股票</h3><p>從掃描或研判頁按下星號，保存你的觀察清單。</p></div>
          : briefs.loading || trends.loading ? <div className="saved-list">{symbols.slice(0, 5).map((s) => <RowSkeleton key={s} />)}</div>
            : briefs.error ? <ErrorNote message={briefs.error} onRetry={briefs.reload} />
              : <div className="saved-list">
                {rows.map((s: StockBrief) => {
                  const item = itemOf(s.symbol);
                  const tr = trendMap.get(s.symbol)?.trend ?? null;
                  return (
                    <div className="saved-row" key={s.symbol}>
                      <button className="saved-main" onClick={() => goPA(s.symbol)} aria-label={`查看 ${s.symbol} 研判`}>
                        <span className="saved-star"><Star size={16} fill="currentColor" /></span>
                        <span className="saved-id"><b>{s.symbol} {s.name}</b><small>{tr && <em className={`trend-badge trend-${TREND_CLS[tr] ?? "flat"}`}>{tr}</em>}{s.industry ?? ""}</small></span>
                        <span className="saved-price"><b>{fmtPrice(s.close)}</b><small className={(s.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(s.changePct)}</small></span>
                      </button>
                      <div className="tag-wrap">
                        <button className={`tag-btn ${tagEdit === s.symbol ? "open" : ""}`} onClick={() => setTagEdit(tagEdit === s.symbol ? null : s.symbol)} aria-label={`編輯 ${s.symbol} 標籤`}>
                          {item && item.groups.length > 0 ? item.groups.map(groupName).join("·") : "＋標籤"}
                        </button>
                        {tagEdit === s.symbol && (
                          <div className="tag-pop" role="menu" aria-label={`${s.symbol} 群組標籤`}>
                            {wl.groups.map((g) => (
                              <label key={g.id} className="tag-option">
                                <input type="checkbox" checked={item?.groups.includes(g.id) ?? false} onChange={() => wl.toggleGroup(s.symbol, g.id)} />
                                <span>{g.name}{g.id === "ride" && " （庫存）"}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {item?.groups.includes("ride") && (
                        <CostBlock
                          symbol={s.symbol} close={s.close} costPrice={item.costPrice}
                          editing={costEdit === s.symbol} draft={costDraft}
                          onDraftChange={setCostDraft}
                          onStartEdit={() => { setCostEdit(s.symbol); setCostDraft(item.costPrice != null ? String(item.costPrice) : ""); }}
                          onSave={() => { wl.setCostPrice(s.symbol, costDraft.trim() === "" ? null : Number(costDraft)); setCostEdit(null); }}
                          onClear={() => setCostEdit(null)}
                        />
                      )}
                      <button className="row-remove" aria-label={`移除 ${s.symbol}`} onClick={() => wl.remove(s.symbol)}><X size={14} /></button>
                    </div>
                  );
                })}
                {rows.length === 0 && frozenRows.length === 0 && <div className="empty-state"><h3>沒有符合篩選的股票</h3><p>換個群組或趨勢篩選看看。</p></div>}
                {frozenRows.length > 0 && (
                  <div className="frozen-block">
                    <button className="frozen-toggle" onClick={() => setFrozenOpen(!frozenOpen)}>{frozenOpen ? "▾" : "▸"} 靜流・暫不關注（{frozenRows.length} 檔）</button>
                    {frozenOpen && frozenRows.map((s: StockBrief) => {
                      const item = itemOf(s.symbol);
                      const tr = trendMap.get(s.symbol)?.trend ?? null;
                      return (
                        <div className="saved-row is-frozen" key={s.symbol}>
                          <button className="saved-main" onClick={() => goPA(s.symbol)} aria-label={`查看 ${s.symbol} 研判`}>
                            <span className="saved-star"><Star size={16} fill="currentColor" /></span>
                            <span className="saved-id"><b>{s.symbol} {s.name}</b><small>{tr && <em className={`trend-badge trend-${TREND_CLS[tr] ?? "flat"}`}>{tr}</em>}{s.industry ?? ""}</small></span>
                            <span className="saved-price"><b>{fmtPrice(s.close)}</b><small className={(s.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPct(s.changePct)}</small></span>
                          </button>
                          <div className="tag-wrap">
                            <button className={`tag-btn ${tagEdit === s.symbol ? "open" : ""}`} onClick={() => setTagEdit(tagEdit === s.symbol ? null : s.symbol)} aria-label={`編輯 ${s.symbol} 標籤`}>
                              {item && item.groups.length > 0 ? item.groups.map(groupName).join("·") : "＋標籤"}
                            </button>
                            {tagEdit === s.symbol && (
                              <div className="tag-pop" role="menu" aria-label={`${s.symbol} 群組標籤`}>
                                {wl.groups.map((g) => (
                                  <label key={g.id} className="tag-option">
                                    <input type="checkbox" checked={item?.groups.includes(g.id) ?? false} onChange={() => wl.toggleGroup(s.symbol, g.id)} />
                                    <span>{g.name}{g.id === "ride" && " （庫存）"}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                          {item?.groups.includes("ride") && (
                            <CostBlock
                              symbol={s.symbol} close={s.close} costPrice={item.costPrice}
                              editing={costEdit === s.symbol} draft={costDraft}
                              onDraftChange={setCostDraft}
                              onStartEdit={() => { setCostEdit(s.symbol); setCostDraft(item.costPrice != null ? String(item.costPrice) : ""); }}
                              onSave={() => { wl.setCostPrice(s.symbol, costDraft.trim() === "" ? null : Number(costDraft)); setCostEdit(null); }}
                              onClear={() => setCostEdit(null)}
                            />
                          )}
                          <button className="row-remove" aria-label={`移除 ${s.symbol}`} onClick={() => wl.remove(s.symbol)}><X size={14} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(briefs.data?.notFound.length ?? 0) > 0 && <div className="storage-note"><ShieldCheck size={16} /><span>以下代號今日無資料：{briefs.data?.notFound.join("、")}</span></div>}
              </div>}
      </section>
      <div className="storage-note"><ShieldCheck size={16} /><span>目前保存在此裝置的 Local Storage。趨勢標籤為日線 v0 規則（與研判同源）；帳號同步與推播將於 Phase 2 加入。</span></div>
    </>
  );
}

/* ---------- 搜尋 ---------- */

function SearchDrawer({ onClose, onPA }: { onClose: () => void; onPA: (symbol: string) => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <section className="search-drawer" role="dialog" aria-modal="true" aria-label="搜尋股票或類別" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><div><span className="eyebrow">SEARCH</span><h2>找一檔股票</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉搜尋"><X size={18} /></button></div>
        <div className="drawer-search-body">
          <StockSearch mode="block" autoFocus onPick={(s) => { onPA(s); onClose(); }} />
        </div>
      </section>
    </div>
  );
}

/* ---------- 根元件 ---------- */

export default function Home() {
  const { phase, data, errorMessage, reload, lastUpdated, isPolling } = useAppData();
  const [active, setActive] = useState<Tab>("hotzones");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [paSymbol, setPaSymbol] = useState("2330");
  const [paHighlightStrategy, setPaHighlightStrategy] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { user, isAuthenticated, logout, syncRemoteWatchlist } = useAuth();
  const isMobile = useIsMobile();

  const selectedZone = data
    ? [...data.zones, ...(data.industryZones ?? [])].find((z) => z.id === selectedZoneId) ?? null
    : null;
  const goPA = (symbol: string, highlightStrategy?: string) => { setPaSymbol(symbol); setPaHighlightStrategy(highlightStrategy ?? null); setActive("pa"); setSelectedZoneId(null); window.scrollTo({ top: 0 }); };
  const navTo = (tab: Tab) => { setActive(tab); setSelectedZoneId(null); };

  // 登入後同步遠端自選股
  useEffect(() => {
    if (isAuthenticated) syncRemoteWatchlist();
  }, [isAuthenticated]);

  // 策略觸發通知
  useStrategyNotifier("pa_default", async () => {
    const r = await fetchMarketStrategyScan("pa_default");
    return { asOf: r.asOf, rows: r.rows };
  });



  return (
    <div className="app-shell">
      <AppHeader onSearch={() => setSearchOpen(true)} goPA={goPA} onLogin={() => window.location.href = "/login"} onNotifications={() => setNotifOpen(true)} />
      <div className="app-layout">
        {!isMobile && <Sidebar active={active} setActive={navTo} data={data} phase={phase} />}
        <main className="main-content">
          <div className="mobile-context"><span>{data ? `${fmtDate(data.asOf)} · 盤後更新` : "讀取中…"}</span><span className="live-dot">{phase === "fallback" ? "○ 離線示範" : isPolling ? "● 盤中輪詢中" : "● EOD 已更新"}</span>{lastUpdated && <span className="last-updated">最後更新 {lastUpdated}</span>}</div>
          {phase === "fallback" && (
            <div className="api-banner" role="alert">
              <Zap size={15} />
              <p><b>API 未連線（{errorMessage ?? "未知原因"}）</b>——目前顯示離線示範資料，僅供介面預覽，不可當成真實市場資料。</p>
              <button className="text-button" onClick={reload}>重新連線 <RotateCw size={12} /></button>
            </div>
          )}
          {phase === "loading" ? (
            <>
              <SummaryStrip data={null} />
              <section className="section-block"><div className="zones-grid">{[0, 1, 2, 3].map((i) => <ZoneSkeleton key={i} />)}</div></section>
            </>
          ) : data && (
            selectedZone ? <ZoneDetail zone={selectedZone} onBack={() => setSelectedZoneId(null)} goPA={goPA} />
              : active === "hotzones" ? <Dashboard goStock={goPA} />
                : active === "scan" ? <Scan zones={data.zones} goPA={goPA} />
                  : active === "pa" ? <StockDetail symbol={paSymbol} highlightStrategy={paHighlightStrategy} onBack={() => { setActive("hotzones"); setSelectedZoneId(null); }} />
                    : active === "chipcard" ? <ChipCard />
                      : active === "strategy" ? <StrategyBuilder goPA={goPA} />
                      : <Watchlist goPA={goPA} />
          )}
          <footer className="page-footer"><span>股流 Radar · 盤後市場焦點</span><span>僅供公開資料整理與研究，不構成投資建議。</span></footer>
        </main>
      </div>
      {isMobile && <BottomNav active={active} setActive={navTo} />}
      {searchOpen && <SearchDrawer onClose={() => setSearchOpen(false)} onPA={goPA} />}
      {guideOpen && <GuideOverlay onClose={() => setGuideOpen(false)} />}
      <ReviewOverlay tab={active} paSymbol={paSymbol} />
      <button className="floating-help" aria-label="開啟說明" onClick={() => setGuideOpen(true)}><CircleHelp size={18} /></button>
      {/* 登入狀態指示 */}
      {isAuthenticated && (
        <>
          <div className="user-badge" title={`登入為 ${user?.username}，點擊登出`}>
            <User size={14} /><span>{user?.username}</span>
            <button className="icon-button" aria-label="登出" onClick={() => { logout(); window.location.reload(); }}>
              <LogOut size={14} />
            </button>
          </div>
          <button className="notif-bell-btn" aria-label="推播設定" onClick={() => setNotifOpen(true)} title="推播設定">
            <Bell size={16} />
          </button>
        </>
      )}
      {notifOpen && (
        <div className="notif-overlay" onClick={() => setNotifOpen(false)}>
          <div className="notif-drawer" onClick={(e) => e.stopPropagation()}>
            <NotificationSettings onClose={() => setNotifOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
