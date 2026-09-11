import { useEffect, useRef, useState } from "react";
import type { StockSignal } from "@shared/types";
import { useWatchlist } from "@/lib/watchlist";
import { fmtPrice, fmtPct, fmtSignedPrice } from "@/lib/format";
import { fetchStockSignal } from "@/lib/api";
import { Star } from "lucide-react";

interface StockDetailProps {
  symbol: string;
  onBack: () => void;
  /** 從掃描頁「策略掃描」點進來時，帶著當下選的戰法名稱（如「回湧」）過來，
   * 讓使用者一眼看到「我是為了這個戰法點進來的」，不用在九個戰法裡自己找。 */
  highlightStrategy?: string | null;
}

export default function StockDetail({ symbol, onBack, highlightStrategy }: StockDetailProps) {
  const [signal, setSignal] = useState<StockSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wl = useWatchlist();
  const isWatched = wl.symbols.includes(symbol);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchStockSignal(symbol)
      .then((s) => { setSignal(s); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [symbol]);

  useEffect(() => {
    if (!loading && highlightStrategy && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, symbol, highlightStrategy]);

  if (loading) return <EmptyState icon="◌" text="分析中…" />;
  if (error || !signal) return <EmptyState icon="✕" text={`載入失敗：${error ?? "查無資料"}`} />;

  const statusColor: Record<string, string> = {
    觀察中: "#ffb25c",
    可留意: "var(--accent)",
    不建議: "var(--destructive)",
    條件符合: "var(--primary)",
  };

  // 水池（庫存股）：已經持有的部位，畫面該優先回答「該不該擔心／停損在哪」，
  // 不是「新的進場訊號」——所以持有中的股票把風險摘要挪到最前面，
  // 戰法匹配度（適合找新進場點）挪到後面當參考，不是拿掉。
  const item = wl.items.find((i) => i.symbol === symbol);
  const isHolding = item?.groups.includes("ride") ?? false;
  const costPrice = item?.costPrice;
  const pnlDiff = costPrice != null ? signal.close - costPrice : null;
  const pnlPct = costPrice != null && costPrice !== 0 ? ((signal.close - costPrice) / costPrice) * 100 : null;
  const isGain = pnlDiff != null && pnlDiff >= 0;

  const strategySection = (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        戰法匹配度{isHolding && <span style={{ marginLeft: 8, color: "var(--muted-foreground)", fontWeight: 400 }}>（已持有中，找加碼/新進場點才需要看這個）</span>}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
        {signal.strategies.map((s) => {
          const isHighlighted = highlightStrategy != null && s.name === highlightStrategy;
          return (
          <div
            key={s.name}
            ref={isHighlighted ? highlightRef : undefined}
            style={{
              padding: "12px 14px", borderBottom: "1px solid var(--border)",
              background: isHighlighted ? "rgba(255,114,94,0.08)" : undefined,
              boxShadow: isHighlighted ? "inset 3px 0 0 var(--primary)" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: isHighlighted ? 700 : 400 }}>
                {s.name}{isHighlighted && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--primary)", fontFamily: "'DM Mono', monospace" }}>← 你從掃描點進來看的</span>}
              </span>
              <span style={{
                fontSize: 11, fontFamily: "'DM Mono', monospace",
                color: s.status === "符合" ? "var(--primary)" : s.status === "等待中" ? "#ffb25c" : "var(--muted-foreground)",
              }}>
                {s.status}
              </span>
            </div>
            <div style={{ height: 5, background: "var(--muted)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${s.matchPct}%`, height: "100%",
                background: s.status === "符合" ? "var(--primary)" : s.status === "等待中" ? "#ffb25c" : "var(--muted-foreground)",
                borderRadius: 3, transition: "width 0.4s ease",
              }} />
            </div>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "6px 0 0", lineHeight: 1.5 }}>{s.plainText}</p>
          </div>
          );
        })}
      </div>
    </div>
  );

  const riskSection = isHolding && (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
        持股風險摘要 · 水池
      </div>
      <div style={{ border: "1px solid rgba(255,114,94,.25)", borderRadius: 12, padding: 16, background: "rgba(255,114,94,.04)" }}>
        {costPrice != null ? (
          <div style={{ display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 3 }}>成本價</div>
              <div style={{ fontSize: 16, fontFamily: "'DM Mono', monospace", color: "var(--foreground)" }}>{fmtPrice(costPrice)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 3 }}>{isGain ? "浮盈" : "浮虧"}</div>
              <div style={{ fontSize: 16, fontFamily: "'DM Mono', monospace", fontWeight: 600, color: isGain ? "var(--primary)" : "var(--accent)" }}>
                {fmtSignedPrice(pnlDiff)}（{fmtPct(pnlPct)}）
              </div>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
            還沒設定成本價——到自選股頁面幫這檔加上成本價，才能看到浮盈/浮虧。
          </p>
        )}
        <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.7 }}>
          {signal.pricePosition.support
            ? `支撐參考 ${fmtPrice(signal.pricePosition.support[0])}–${fmtPrice(signal.pricePosition.support[1])}——跌破這個區間，代表原本撐住股價的買方力道可能不在了，該重新評估是否續抱。`
            : "目前沒有明確的支撐參考位，結構偏不確定，續抱前建議先看下方戰法匹配度跟法人動向再判斷。"}
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 0 40px" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "14px 20px", borderBottom: "1px solid var(--border)",
        background: "rgba(7,16,20,.85)", position: "sticky", top: 0, zIndex: 20,
      }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, color: "var(--muted-foreground)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--foreground)" }}>
            {signal.name}
            <span style={{ fontSize: 12, color: "var(--muted-foreground)", marginLeft: 6, fontFamily: "'DM Mono', monospace" }}>{signal.symbol}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{signal.industry ?? ""}</div>
        </div>
        <button
          onClick={() => wl.toggle(symbol)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 6,
            color: isWatched ? "var(--primary)" : "var(--muted-foreground)",
            borderRadius: 8, transition: ".15s ease",
          }}
        >
          <Star size={18} fill={isWatched ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Price + Status */}
      <div style={{ padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 30, fontWeight: 500, fontFamily: "'DM Mono', monospace", color: "var(--foreground)" }}>
            {fmtPrice(signal.close)}
          </span>
          <span style={{ fontSize: 14, fontFamily: "'DM Mono', monospace", fontWeight: 500, color: (signal.changePct ?? 0) >= 0 ? "var(--primary)" : "var(--destructive)" }}>
            {(signal.changePct ?? 0) >= 0 ? "▲" : "▼"} {fmtSignedPrice(signal.changeAmt)} · {fmtPct(signal.changePct)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{
            fontSize: 11, padding: "4px 10px", borderRadius: 8,
            background: `${statusColor[signal.status]}18`, color: statusColor[signal.status],
            border: `1px solid ${statusColor[signal.status]}30`, fontWeight: 500,
          }}>
            {signal.status}
          </span>
          {signal.pricePosition.ma20 != null && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 8,
              background: "var(--muted)", color: "var(--muted-foreground)",
              border: "1px solid var(--border)", fontFamily: "'DM Mono', monospace",
            }}>
              月線 {fmtPrice(signal.pricePosition.ma20)}
            </span>
          )}
        </div>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.6 }}>
          {signal.statusReason}
        </p>
      </div>

      {/* 水池：風險摘要優先顯示 */}
      {isHolding && riskSection}

      {/* Price Position */}
      <PricePositionViz position={signal.pricePosition} />

      {/* 非持有中：戰法匹配度放在價格位置後面（找進場點是這裡的主角） */}
      {!isHolding && strategySection}

      {/* Advice */}
      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ border: "1px solid rgba(101,230,189,.2)", borderRadius: 12, padding: 14, background: "rgba(101,230,189,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>給你的建議</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.8 }}>
            {signal.advice.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      </div>

      {/* 水池：戰法匹配度移到建議之後（加碼/新進場點才需要看，不是首要資訊） */}
      {isHolding && strategySection}

      {/* Institutional + Pantlas */}
      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
          法人動向
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[
            { label: "外資", value: signal.institutional.foreign, days: signal.consecutiveDays.foreign, days5D: signal.pantlas5D?.foreign },
            { label: "投信", value: signal.institutional.trust, days: signal.consecutiveDays.trust, days5D: signal.pantlas5D?.trust },
            { label: "自營", value: signal.institutional.dealer, days: signal.consecutiveDays.dealer, days5D: signal.pantlas5D?.dealer },
          ].map((item) => (
            <div key={item.label} style={{
              border: "1px solid var(--border)", borderRadius: 12, padding: "14px 12px", textAlign: "center", background: "var(--card)",
            }}>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 17, fontWeight: 500, fontFamily: "'DM Mono', monospace", color: item.value != null ? (item.value >= 0 ? "var(--primary)" : "var(--destructive)") : "var(--muted-foreground)" }}>
                {item.value != null ? `${item.value >= 0 ? "+" : ""}${item.value}億` : "—"}
              </div>
              {item.days !== 0 && (
                <div style={{
                  fontSize: 10, fontFamily: "'DM Mono', monospace", marginTop: 5,
                  color: item.days > 0 ? "var(--primary)" : "var(--destructive)",
                  background: item.days > 0 ? "rgba(255,114,94,.1)" : "rgba(255,107,107,.1)",
                  padding: "2px 6px", borderRadius: 6, display: "inline-block",
                }}>
                  {item.days > 0 ? "▲" : "▼"} 連續 {Math.abs(item.days)} 天
                </div>
              )}
              {item.days5D != null && (
                <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", marginTop: 4, color: "var(--muted-foreground)" }}>
                  5日 {item.days5D >= 0 ? "+" : ""}{Number(item.days5D).toFixed(2)} 億
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pantlas Fundamentals */}
      {signal.pantlasFundamentals && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "var(--muted-foreground)", letterSpacing: ".1em", marginBottom: 10 }}>
            基本面（Pantlas）
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[
              { label: "本益比", value: signal.pantlasFundamentals.pe != null ? signal.pantlasFundamentals.pe.toFixed(1) : "—" },
              { label: "淨值比", value: signal.pantlasFundamentals.pbr != null ? signal.pantlasFundamentals.pbr.toFixed(2) : "—" },
              { label: "毛利率", value: signal.pantlasFundamentals.grossMarginPercent != null ? `${signal.pantlasFundamentals.grossMarginPercent.toFixed(1)}%` : "—" },
              { label: "營增高", value: signal.pantlasFundamentals.revenueYoY != null ? `${signal.pantlasFundamentals.revenueYoY >= 0 ? "+" : ""}${signal.pantlasFundamentals.revenueYoY.toFixed(1)}%` : "—" },
              { label: "最新季", value: signal.pantlasFundamentals.latestQuarter ?? "—" },
              { label: "殖利率", value: signal.pantlasFundamentals.dividendYield != null ? `${signal.pantlasFundamentals.dividendYield.toFixed(2)}%` : "—" },
            ].map((item) => (
              <div key={item.label} style={{
                border: "1px solid var(--border)", borderRadius: 10, padding: "12px 10px", textAlign: "center", background: "var(--card)",
              }}>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 15, fontWeight: 500, fontFamily: "'DM Mono', monospace", color: "var(--foreground)" }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "0 20px", fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", lineHeight: 1.6 }}>
        以上分析僅供參考，不構成投資建議。股市有風險，投資需謹慎。
      </div>
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

function PricePositionViz({ position }: { position: StockSignal["pricePosition"] }) {
  const { current, support, resistance, ma20 } = position;
  const hasSupport = support != null;
  const hasResistance = resistance != null;

  return (
    <div style={{ padding: "0 20px 16px" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--card)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)" }}>價格位置</span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}>日線 · 壓力與支撐</span>
        </div>
        <div style={{ position: "relative", height: 96 }}>
          {/* Resistance band */}
          {hasResistance && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 22,
              background: "rgba(255,107,107,.08)", borderRadius: 6,
              border: "1px dashed rgba(255,107,107,.3)",
            }}>
              <span style={{ position: "absolute", left: 8, top: 3, fontSize: 10, color: "var(--destructive)", fontFamily: "'DM Mono', monospace" }}>
                壓力 {fmtPrice(resistance[0])}–{fmtPrice(resistance[1])}
              </span>
            </div>
          )}
          {/* Current price dot */}
          <div style={{
            position: "absolute",
            top: hasResistance ? 30 : 36,
            left: 0, right: 0,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: "#ffb25c", border: "2px solid var(--background)",
              boxShadow: "0 0 8px rgba(255,178,92,.5)",
            }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)", fontFamily: "'DM Mono', monospace" }}>
              現在 {fmtPrice(current)}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>← 你在這裡</span>
          </div>
          {/* Support band */}
          {hasSupport && (
            <div style={{
              position: "absolute", top: hasResistance ? 58 : 64, left: 0, right: 0, height: 22,
              background: "rgba(101,230,189,.08)", borderRadius: 6,
              border: "1px dashed rgba(101,230,189,.3)",
            }}>
              <span style={{ position: "absolute", left: 8, top: 3, fontSize: 10, color: "var(--accent)", fontFamily: "'DM Mono', monospace" }}>
                支撐 {fmtPrice(support[0])}–{fmtPrice(support[1])}
              </span>
            </div>
          )}
        </div>
        {ma20 != null && (
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8, fontFamily: "'DM Mono', monospace" }}>
            月線(20日): {fmtPrice(ma20)}
          </div>
        )}
      </div>
    </div>
  );
}
