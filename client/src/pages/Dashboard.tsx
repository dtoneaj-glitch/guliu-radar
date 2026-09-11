import { useEffect, useState } from "react";
import type { DashboardResponse, MarketSummary, StockSignalBrief, TopFiveGroup, TopicBoard, MarketRegime, HotZone } from "@shared/types";
import type { ChipDivergenceResult } from "@shared/chip-divergence";
import { useWatchlist } from "@/lib/watchlist";
import { fmtPrice, fmtPct, fmtSignedPrice } from "@/lib/format";
import { fetchDashboard, fetchStockSignals, fetchRegime, fetchChipDivergence, fetchHotzones } from "@/lib/api";

interface DashboardProps {
  goStock: (symbol: string) => void;
}

export default function Dashboard({ goStock }: DashboardProps) {
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [divergence, setDivergence] = useState<ChipDivergenceResult | null>(null);
  const [themeZones, setThemeZones] = useState<HotZone[]>([]);
  const wl = useWatchlist();
  const [wlSignals, setWlSignals] = useState<StockSignalBrief[]>([]);
  const [wlLoading, setWlLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchDashboard().then((d) => setDash(d)).catch((e) => setError(e.message)),
      // 市場總覽改用 /api/hotzones 的 summary——真的是 TWSE OpenAPI + TPEx 算出來的，
      // 不是另一條 Pantlas 管線（之前這裡誤用了 fetchPantlasOverview，資料來源標籤
      // 跟實際抓的資料對不上，這次一起換掉，不只是改標籤文字）
      fetchHotzones().then((h) => { setThemeZones(h.zones); setSummary(h.summary); }).catch(() => null),
      fetchRegime(5).then((r) => setRegime(r)).catch(() => null),
      fetchChipDivergence().then((d) => setDivergence(d)).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (wl.symbols.length === 0) return;
    setWlLoading(true);
    fetchStockSignals(wl.symbols)
      .then((d) => { setWlSignals(d.signals); setWlLoading(false); })
      .catch(() => setWlLoading(false));
  }, [wl.symbols.join(",")]);

  if (loading) return <EmptyState icon="●" text="載入市場資料中…" />;
  if (error || !dash) return <EmptyState icon="✕" text={`載入失敗：${error ?? "未知原因"}`} />;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 0 60px" }}>
      <MoodHeader mood={dash.mood} />
      <MarketOverviewCard summary={summary} asOf={dash.asOf} />
      <RegimeCard regime={regime} />
      <ChipDivergenceCard divergence={divergence} />
      <FlowCards mood={dash.mood} />
      <TopicStrip topics={dash.topics} onClick={(t) => t.topStocks[0] && goStock(t.topStocks[0].symbol)} />
      <ThemeZoneAccordion zones={themeZones} />
      <SectorFlowBar flows={dash.sectorFlows} onClick={(s) => console.log("sector click", s)} />
      <TopFiveSection group={dash.topBuys} onClick={goStock} />
      <WatchlistSection signals={wlSignals} loading={wlLoading} onClick={goStock} />
    </div>
  );
}

/** 籌碼分歧卡（外資 vs 散戶）：規則引擎自動產生，非人工判讀。見 shared/chip-divergence.ts */
function ChipDivergenceCard({ divergence }: { divergence: ChipDivergenceResult | null }) {
  if (!divergence) return null;
  const stanceColor = (s: string) => (s === "偏多" ? "var(--primary)" : s === "偏空" ? "var(--accent)" : "var(--muted-foreground)");
  return (
    <div style={{ margin: "0 20px 16px", padding: "14px 16px", borderRadius: 12,
      border: divergence.diverged ? "1px solid rgba(255,114,94,.3)" : "1px solid var(--border)",
      background: divergence.diverged ? "rgba(255,114,94,.04)" : "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {divergence.diverged && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "rgba(255,114,94,.16)", color: "var(--primary)" }}>
            籌碼分歧
          </span>
        )}
        <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)" }}>
          外資 <b style={{ color: stanceColor(divergence.foreignStance) }}>{divergence.foreignStance}</b>
          {" · "}
          散戶 <b style={{ color: stanceColor(divergence.retailStance) }}>{divergence.retailStance}</b>
        </span>
      </div>
      <p style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.7, margin: 0 }}>{divergence.narrative}</p>
      {divergence.evidence.insufficient.length > 0 && (
        <p style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 8 }}>
          ⚠ {divergence.evidence.insufficient.join("、")}
        </p>
      )}
    </div>
  );
}

/** 概念股熱度：收合成一條，點開看完整清單（重用真實 hotzones 主題資料，取 Top 12） */
function ThemeZoneAccordion({ zones }: { zones: HotZone[] }) {
  const [open, setOpen] = useState(false);
  if (zones.length === 0) return null;
  const top12 = [...zones].sort((a, b) => b.score - a.score).slice(0, 12);
  const hottest = top12[0];
  return (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        今日概念股熱度
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "14px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
            borderBottom: open ? "1px solid var(--border)" : "none" }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>12 大分類</div>
            <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>點開看完整清單</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {hottest && (
              <>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>HOT：{hottest.name}</span>
                <span style={{ fontSize: 13, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: hottest.changePct >= 0 ? "var(--primary)" : "var(--accent)" }}>
                  {hottest.changePct >= 0 ? "▲" : "▼"}{Math.abs(hottest.changePct).toFixed(1)}%
                </span>
              </>
            )}
            <span style={{ fontSize: 11, color: "var(--muted-foreground)", transform: open ? "rotate(180deg)" : undefined, transition: ".15s" }}>▾</span>
          </div>
        </button>
        {open && top12.map((z, i) => (
          <div key={z.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px",
            borderBottom: i < top12.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace", width: 16 }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{z.name}</div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>{z.count} 檔</div>
              </div>
            </div>
            <span style={{ fontSize: 13, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: z.changePct >= 0 ? "var(--primary)" : "var(--accent)" }}>
              {z.changePct >= 0 ? "▲" : "▼"}{Math.abs(z.changePct).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 市場狀態機卡片 */
function RegimeCard({ regime }: { regime: MarketRegime | null }) {
  if (!regime) return null;
  const regimeColor: Record<string, string> = {
    強多: "#00e676",
    偏多: "#69f0ae",
    震盪: "#8da0a5",
    偏空: "#ff7043",
    強空: "#ff5252",
  };
  const color = regimeColor[regime.regime] ?? "#8da0a5";
  const trendIcon = regime.trend === "轉強" ? "↑" : regime.trend === "轉弱" ? "↓" : "→";
  const trendColor = regime.trend === "轉強" ? "#00e676" : regime.trend === "轉弱" ? "#ff5252" : "#8da0a5";

  return (
    <div style={{ margin: "0 20px 16px", padding: "14px 16px", borderRadius: 12,
      border: "1px solid var(--border)", background: "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".06em" }}>
          市場狀態
        </span>
        <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{regime.note}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={{ fontSize: 18, fontWeight: 600, color }}>{regime.regime}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>
          分數 {regime.score > 0 ? "+" : ""}{regime.score}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 13, color: trendColor, fontWeight: 500 }}>
          {trendIcon} {regime.trend}
        </div>
      </div>
      {regime.history.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
          {regime.history.map((h) => {
            const hColor = regimeColor[h.regime] ?? "#8da0a5";
            return (
              <div key={h.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", height: 4, borderRadius: 2, background: hColor, opacity: 0.7 }} />
                <span style={{ fontSize: 9, color: "var(--muted-foreground)" }}>{h.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, gap: 8 }}>
      <span style={{ fontSize: 28, opacity: 0.35 }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{text}</span>
    </div>
  );
}

function MoodHeader({ mood }: { mood: DashboardResponse["mood"] }) {
  const dotColor: Record<string, string> = {
    樂觀: "var(--primary)",
    偏多: "var(--primary)",
    中性: "#8da0a5",
    偏空: "var(--destructive)",
    恐慌: "#ff3b3b",
  };
  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: "50%", display: "inline-block",
            background: dotColor[mood.sentiment] ?? "#8da0a5",
            boxShadow: `0 0 8px ${dotColor[mood.sentiment] ?? "#8da0a5"}`,
          }}
        />
        <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".06em" }}>
          {mood.date} 盤後
        </span>
      </div>
      <h1 style={{ fontSize: 17, fontWeight: 500, margin: 0, lineHeight: 1.45, color: "var(--foreground)" }}>
        {mood.summaryText}
      </h1>
    </div>
  );
}

function FlowCards({ mood }: { mood: DashboardResponse["mood"] }) {
  const cardStyle: Record<string, string> = {
    外資: mood.foreignFlow >= 0 ? "var(--primary)" : "var(--destructive)",
    投信: mood.trustFlow >= 0 ? "var(--accent)" : "var(--destructive)",
    自營: mood.dealerFlow >= 0 ? "var(--primary)" : "var(--destructive)",
  };
  const tag: Record<string, string> = {
    外資: mood.foreignFlow > 50 ? "大舉買入" : mood.foreignFlow > 0 ? "持續買入" : "賣超",
    投信: mood.trustFlow > 20 ? "積極買入" : mood.trustFlow > 0 ? "持續買入" : "賣超",
    自營: mood.dealerFlow > 20 ? "積極買入" : mood.dealerFlow > 0 ? "持續買入" : "賣超",
  };
  const cards = [
    { label: "外資", value: mood.foreignFlow, unit: "億", tag: tag.外資, color: cardStyle.外資 },
    { label: "投信", value: mood.trustFlow, unit: "億", tag: tag.投信, color: cardStyle.投信 },
    { label: "自營", value: mood.dealerFlow, unit: "億", tag: tag.自營, color: cardStyle.自營 },
    { label: "散戶動向", value: 0, unit: "", tag: mood.retailMood, color: "#8da0a5" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, padding: "0 20px 16px" }}>
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            border: "1px solid var(--border)", borderRadius: 12, padding: "14px 12px",
            background: "var(--card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{c.label}</span>
            <span
              style={{
                fontSize: 10, fontFamily: "'DM Mono', monospace",
                padding: "2px 7px", borderRadius: 99,
                background: `${c.color}18`, color: c.color,
                border: `1px solid ${c.color}30`,
              }}
            >
              {c.tag}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: c.color, fontFamily: "'DM Mono', monospace", fontVariantNumeric: "tabular-nums" }}>
            {c.value >= 0 && c.value !== 0 ? "+" : ""}{c.value === 0 ? "—" : c.value}
            <span style={{ fontSize: 12, color: "var(--muted-foreground)", marginLeft: 2 }}>{c.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopicStrip({ topics, onClick }: { topics: TopicBoard[]; onClick: (t: TopicBoard) => void }) {
  if (topics.length === 0) return null;
  return (
    <div style={{ padding: "0 20px 14px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        今日熱門話題
      </div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {topics.map((t) => (
          <button
            key={t.id}
            onClick={() => onClick(t)}
            style={{
              flexShrink: 0, border: "1px solid var(--border)", borderRadius: 12,
              padding: "12px 16px", minWidth: 150, textAlign: "left", background: "var(--card)",
              cursor: "pointer", transition: ".18s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,114,94,.45)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)", marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: t.changePct >= 0 ? "var(--primary)" : "var(--destructive)" }}>
              {t.changePct >= 0 ? "▲" : "▼"} {Math.abs(t.changePct).toFixed(1)}%
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4 }}>{t.tag}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TopFiveSection({ group, onClick }: { group: TopFiveGroup; onClick: (sym: string) => void }) {
  const [tab, setTab] = useState<"foreign" | "trust" | "dealer">("foreign");
  const tabs = [
    { key: "foreign" as const, label: "外資買超" },
    { key: "trust" as const, label: "投信買超" },
    { key: "dealer" as const, label: "自營買超" },
  ];
  const rows = group[tab];
  return (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        誰在買？
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 8, border: "1px solid var(--border)",
              fontSize: 12, cursor: "pointer", background: tab === t.key ? "rgba(255,114,94,.12)" : "transparent",
              color: tab === t.key ? "var(--primary)" : "var(--muted-foreground)",
              fontFamily: "'DM Mono', monospace", transition: ".15s ease",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
        {rows.map((r, i) => (
          <div
            key={r.symbol}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
              cursor: "pointer", transition: ".12s ease",
            }}
            onClick={() => onClick(r.symbol)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.03)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace", width: 16 }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{r.name}</div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>{r.symbol}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, fontFamily: "'DM Mono', monospace", color: "var(--primary)", fontWeight: 500 }}>+{r.flow} 億</span>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>＋觀察</span>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>暫無資料</div>}
      </div>
    </div>
  );
}

function WatchlistSection({ signals, loading, onClick }: { signals: StockSignalBrief[]; loading: boolean; onClick: (sym: string) => void }) {
  const statusColor: Record<string, string> = {
    觀察中: "#ffb25c",
    可留意: "var(--accent)",
    不建議: "var(--destructive)",
    條件符合: "var(--primary)",
  };
  const isUp = (s: StockSignalBrief) => (s.changePct ?? 0) >= 0;
  return (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em" }}>
          我的觀察名單 <span style={{ color: "var(--foreground)" }}>{signals.length} 檔</span>
        </span>
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>計算趨勢中…</div>
      ) : signals.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
          還沒有觀察股票，從上方名單點「＋觀察」加入
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 8 }}>
          {signals.map((s) => {
            const up = isUp(s);
            const color = up ? "var(--primary)" : "var(--destructive)";
            return (
              <button
                key={s.symbol}
                onClick={() => onClick(s.symbol)}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 12px 10px",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "border-color .12s ease, background .12s ease",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,.15)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.04)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.background = "var(--card)"; }}
              >
                {/* header: name + status badge */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 18 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "'DM Mono', monospace" }}>{s.name}</span>
                  <span
                    style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 99,
                      background: `${statusColor[s.status]}18`, color: statusColor[s.status],
                      border: `1px solid ${statusColor[s.status]}30`,
                      fontFamily: "'DM Mono', monospace",
                      lineHeight: 1.3,
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                {/* symbol */}
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>{s.symbol}</div>
                {/* divider */}
                <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
                {/* price */}
                <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>
                  {fmtPrice(s.close)}
                </div>
                {/* change row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color, lineHeight: 1 }}>
                    {up ? "▲" : "▼"}
                  </span>
                  <span style={{ fontSize: 12, color, fontFamily: "'DM Mono', monospace" }}>
                    {fmtSignedPrice(s.changeAmt)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>
                    {fmtPct(s.changePct)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Pantlas 產業資金流向條 — 快速瀏覽哪個產業獲法人青睞 */
function SectorFlowBar({ flows, onClick }: { flows: DashboardResponse["sectorFlows"]; onClick: (s: string) => void }) {
  if (!flows || flows.length === 0) return null;
  // 篩選非 ETF 的類股，最多 8 筆
  const filtered = flows.filter((f) => !["ETF", "存託憑證", "受益證券"].includes(f.sector)).slice(0, 8);
  if (filtered.length === 0) return null;
  return (
    <div style={{ padding: "0 20px 14px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        產業動能（今日法人）
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
        {filtered.map((f, i) => {
          const maxAbs = Math.max(Math.abs(f.foreign5D), Math.abs(f.trust5D), Math.abs(f.dealer5D), 1);
          return (
            <button
              key={f.sector}
              onClick={() => onClick(f.sector)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
                transition: ".12s ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.03)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)", width: 64, flexShrink: 0 }}>{f.sector}</span>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace", width: 50, flexShrink: 0 }}>
                {f.stockCount} 檔
              </span>
              {/* Foreign bar */}
              <ProgressBar value={f.foreign5D} max={maxAbs} color="var(--primary)" label="外" />
              {/* Trust bar */}
              <ProgressBar value={f.trust5D} max={maxAbs} color="#ffb25c" label="投" />
              {/* Dealer bar */}
              <ProgressBar value={f.dealer5D} max={maxAbs} color="#8da0a5" label="自" />
              <span style={{
                fontSize: 12, fontFamily: "'DM Mono', monospace", width: 52, textAlign: "right", flexShrink: 0,
                color: f.total5D >= 0 ? "var(--primary)" : "var(--destructive)",
              }}>
                {f.total5D >= 0 ? "+" : ""}{f.total5D.toFixed(1)} 億
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6, paddingLeft: 4 }}>
        來源：Pantlas（盤圖）· 5 日法人累積買賣超估算，非正式盤後數據
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.abs(value) / max * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: "var(--muted-foreground)", width: 12, textAlign: "center" }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "var(--muted)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute",
          left: value >= 0 ? "50%" : "auto",
          right: value < 0 ? "50%" : "auto",
          width: `${pct / 2}%`,
          height: "100%",
          background: color,
          borderRadius: value >= 0 ? "0 3px 3px 0" : "3px 0 0 3px",
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

/** 市場總覽卡片：漲跌家數、成交值——來源 TWSE OpenAPI + TPEx（/api/hotzones 的 summary），不是 Pantlas */
function MarketOverviewCard({ summary, asOf }: { summary: MarketSummary | null; asOf: string }) {
  if (!summary) return null;
  const { advance, decline, totalValue } = summary;
  return (
    <div style={{ padding: "0 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em" }}>
          市場總覽
        </span>
        <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>來源：TWSE OpenAPI · TPEx · {asOf}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[
          { label: "上漲", value: advance, color: "var(--primary)" },
          { label: "下跌", value: decline, color: "var(--accent)" },
          { label: "成交", value: `${totalValue.toFixed(1)} 億`, color: "var(--foreground)" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              border: "1px solid var(--border)", borderRadius: 10,
              padding: "12px 8px", textAlign: "center", background: "var(--card)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: item.color, fontVariantNumeric: "tabular-nums" }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
