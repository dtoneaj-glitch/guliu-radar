/**
 * 策略編輯器頁面（Phase 3+）
 * 用戶可建立/編輯自訂策略：加入前置過濾、進場觸發、失效條件
 */

import { useState, useEffect } from "react";
import { Plus, Trash2, Save, X, Play, RefreshCw, Eye } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  fetchUserStrategies,
  createUserStrategy,
  updateUserStrategy,
  deleteUserStrategy,
  runBacktestApi,
} from "@/lib/api";
import { CONDITION_TEMPLATES, type Condition, type ConditionGroup, type UserStrategyDef, type CondType } from "@shared/strategy-builder";
import type { BacktestResult } from "@shared/types";

/* ---------- 條件參數定義 ---------- */

const COND_PARAM_SCHEMA: Record<CondType, Array<{ key: string; label: string; type: "number" | "select"; options?: { value: string; label: string }[] }>> = {
  ma_cross_up:       [{ key: "maShort", label: "短均線週期", type: "number" }, { key: "maLong", label: "長均線週期", type: "number" }],
  ma_cross_down:     [{ key: "maShort", label: "短均線週期", type: "number" }, { key: "maLong", label: "長均線週期", type: "number" }],
  price_above_ma:    [{ key: "ma", label: "均線週期", type: "number" }],
  price_below_ma:    [{ key: "ma", label: "均線週期", type: "number" }],
  volume_spike:      [{ key: "ratio", label: "量比倍數", type: "number" }],
  bias_extreme:      [{ key: "threshold", label: "BIAS 閾值(%)", type: "number" }],
  support_near:      [{ key: "tolerance", label: "容差(%)", type: "number" }],
  resistance_near:   [{ key: "tolerance", label: "容差(%)", type: "number" }],
  days_above_ma:     [{ key: "ma", label: "均線週期", type: "number" }, { key: "minDays", label: "最少天數", type: "number" }],
  trend_up:          [],
  trend_down:        [],
  swing_high_near:   [{ key: "tolerance", label: "容差(%)", type: "number" }],
  swing_low_near:    [{ key: "tolerance", label: "容差(%)", type: "number" }],
  volume_ratio_gt:   [{ key: "threshold", label: "量比下限", type: "number" }],
  volume_ratio_lt:   [{ key: "threshold", label: "量比上限", type: "number" }],
  slope_positive:    [{ key: "ma", label: "均線週期", type: "number" }],
  slope_negative:    [{ key: "ma", label: "均線週期", type: "number" }],
  is_bull_candle:    [],
  is_bear_candle:    [],
};

function makeCondition(type: CondType, params: Record<string, number | string> = {}): Condition {
  return { id: crypto.randomUUID(), type, params, label: type };
}

function emptyGroup(): ConditionGroup { return { logic: "and", conditions: [] }; }

function condLabel(c: Condition): string {
  const t = CONDITION_TEMPLATES.find((t) => t.type === c.type);
  const p = Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${t?.label ?? c.type}${p ? ` (${p})` : ""}`;
}

/* ---------- 策略列表 ---------- */

function StrategyList({
  strategies, loading, onEdit, onDelete, onRunBacktest,
}: {
  strategies: UserStrategyDef[];
  loading: boolean;
  onEdit: (s: UserStrategyDef) => void;
  onDelete: (id: string) => void;
  onRunBacktest: (s: UserStrategyDef) => void;
}) {
  if (loading) return <div className="section-block"><div className="empty-state"><span>載入中…</span></div></div>;
  if (strategies.length === 0) return <div className="section-block"><div className="empty-state"><h3>尚無自訂策略</h3><p>點擊「新增策略」開始建立你的第一支策略。</p></div></div>;
  return (
    <div className="section-block">
      <div className="section-heading"><h2>我的策略 <small>({strategies.length})</small></h2></div>
      <div className="strategy-grid">
        {strategies.map((s) => (
          <div key={s.id} className="strategy-card">
            <div className="strategy-card-head">
              <div>
                <span className="eyebrow">策略</span>
                <h3>{s.name}</h3>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="icon-button subtle" title="編輯" onClick={() => onEdit(s)}><Eye size={14} /></button>
                <button className="icon-button subtle" title="回測" onClick={() => onRunBacktest(s)}><Play size={14} /></button>
                <button className="icon-button" title="刪除" onClick={() => { if (confirm(`刪除「${s.name}」？`)) onDelete(s.id); }}><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="strategy-note">{s.desc || "無描述"}</p>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["filters", "triggers", "invalidations"].map((key) => {
                const g = s[key as keyof UserStrategyDef] as ConditionGroup;
                if (!g?.conditions?.length) return null;
                return <span key={key} className="strategy-chip" title={`${key}：${g.conditions.length} 個條件`}>{key.slice(0, 3)} {g.conditions.length}</span>;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 條件編輯器 ---------- */

function ConditionRow({
  cond, onUpdate, onRemove, canRemove,
}: {
  cond: Condition;
  onUpdate: (c: Condition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const schema = COND_PARAM_SCHEMA[cond.type] ?? [];
  const updateParam = (key: string, val: number | string) => {
    onUpdate({ ...cond, params: { ...cond.params, [key]: val } });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <select
        value={cond.type}
        onChange={(e) => onUpdate({ ...cond, type: e.target.value as CondType, params: {} })}
        style={{ flex: "1 1 140px", padding: "5px 8px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 }}
      >
        {CONDITION_TEMPLATES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
      </select>
      {schema.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{f.label}:</span>
          <input
            type="number"
            step="0.1"
            value={String(cond.params[f.key] ?? "")}
            onChange={(e) => updateParam(f.key, parseFloat(e.target.value) || 0)}
            style={{ width: 60, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--muted)", color: "var(--foreground)", fontSize: 11 }}
          />
        </div>
      ))}
      <span style={{ fontSize: 10, color: "var(--muted-foreground)", minWidth: 80 }}>{condLabel(cond)}</span>
      {canRemove && <button className="icon-button" onClick={onRemove}><X size={13} /></button>}
    </div>
  );
}

function ConditionGroupEditor({
  title, group, onChange, icon, color,
}: {
  title: string; group: ConditionGroup; onChange: (g: ConditionGroup) => void;
  icon: React.ReactNode; color: string;
}) {
  const updateCondition = (idx: number, c: Condition) => {
    onChange({ ...group, conditions: group.conditions.map((cc, i) => i === idx ? c : cc) });
  };
  const addCondition = (type: CondType) => {
    const t = CONDITION_TEMPLATES.find((tt) => tt.type === type);
    onChange({ ...group, conditions: [...group.conditions, makeCondition(type, t?.defaultParams as Record<string, number | string> ?? {})] });
  };
  const removeCondition = (idx: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  };
  return (
    <div style={{ border: `1px solid ${color}44`, borderRadius: 12, padding: "12px 14px", background: `${color}08` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color }}>{icon}</span>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color }}>{title}</span>
          <select
            value={group.logic}
            onChange={(e) => onChange({ ...group, logic: e.target.value as "and" | "or" })}
            style={{ padding: "3px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)", fontSize: 10 }}
          >
            <option value="and">AND（全部符合）</option>
            <option value="or">OR（任一符合）</option>
          </select>
        </div>
        <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{group.conditions.length} 個條件</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {group.conditions.map((c, i) => (
          <ConditionRow key={c.id} cond={c} onUpdate={(cc) => updateCondition(i, cc)} onRemove={() => removeCondition(i)} canRemove={group.conditions.length > 0} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
        {CONDITION_TEMPLATES.slice(0, 6).map((t) => (
          <button key={t.type} className="secondary-button" style={{ fontSize: 10, padding: "4px 9px" }} onClick={() => addCondition(t.type)}>
            <Plus size={11} />{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 編輯器 ---------- */

function StrategyEditor({
  strategy, onSave, onBack, onRunBacktest, userId,
}: {
  strategy?: UserStrategyDef;
  onSave: (s: UserStrategyDef) => void;
  onBack: () => void;
  onRunBacktest: (s: UserStrategyDef) => void;
  userId: string;
}) {
  const [name, setName] = useState(strategy?.name ?? "");
  const [desc, setDesc] = useState(strategy?.desc ?? "");
  const [filters, setFilters] = useState<ConditionGroup>(strategy?.filters ?? emptyGroup());
  const [triggers, setTriggers] = useState<ConditionGroup>(strategy?.triggers ?? emptyGroup());
  const [invalidations, setInvalidations] = useState<ConditionGroup>(strategy?.invalidations ?? emptyGroup());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { alert("請填寫策略名稱"); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), desc: desc.trim(), filters, triggers, invalidations };
      let s: UserStrategyDef;
      if (strategy) {
        s = await updateUserStrategy(strategy.userId, strategy.id, payload) as UserStrategyDef;
      } else {
        s = await createUserStrategy(userId, payload);
      }
      if (s) { onSave(s); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    } catch (e: any) { alert("儲存失敗：" + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <button className="text-button" onClick={onBack}><span>←</span> 返回策略列表</button>
      <div className="section-block">
        <div className="section-heading">
          <h2>{strategy ? "編輯策略" : "新增策略"}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="secondary-button" onClick={handleSave} disabled={saving}>
              <Save size={13} />{saving ? "儲存中…" : "儲存"}
            </button>
            {saved && <span style={{ fontSize: 11, color: "var(--accent)", alignSelf: "center" }}>✓ 已儲存</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label className="eyebrow">策略名稱</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：MA 黃金交叉"
              style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, marginTop: 4 }} />
          </div>
          <div>
            <label className="eyebrow">描述</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="簡短描述此策略"
              style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, marginTop: 4 }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ConditionGroupEditor title="前置過濾" group={filters} onChange={setFilters} icon={<RefreshCw size={14} />} color="#8b9dc3" />
          <ConditionGroupEditor title="進場觸發" group={triggers} onChange={setTriggers} icon={<Play size={14} />} color="#ff725e" />
          <ConditionGroupEditor title="失效條件" group={invalidations} onChange={setInvalidations} icon={<X size={14} />} color="#ff5c5c" />
        </div>
      </div>
    </div>
  );
}

/* ---------- 回測結果顯示 ---------- */

function BacktestDisplay({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  const [strategyId, setStrategyId] = useState("");
  const [strategies, setStrategies] = useState<UserStrategyDef[]>([]);
  const [rangeDays, setRangeDays] = useState(365);
  const [stopLossPct, setStopLossPct] = useState(5);
  const [takeProfitRatio, setTakeProfitRatio] = useState(2);
  const [maxHoldDays, setMaxHoldDays] = useState(20);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    fetchUserStrategies(user.id).then((r) => setStrategies(r.strategies)).catch(() => {});
  }, [user?.id]);

  const handleRun = async () => {
    if (!strategyId) { alert("請選擇策略"); return; }
    if (!user?.id) { alert("請先登入"); return; }
    setRunning(true); setResult(null); setError(null);
    try {
      const r = await runBacktestApi({ symbol, strategyId, rangeDays, stopLossPct: stopLossPct / 100, takeProfitRatio, maxHoldDays, userId: user.id });
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setRunning(false); }
  };

  if (!isAuthenticated) return (
    <div className="section-block">
      <div className="empty-state"><h3>需要登入</h3><p>請先登入才能使用策略編輯與回測功能。</p><button className="primary-button" onClick={() => { window.location.href = "/login"; }}>前往登入</button></div>
    </div>
  );

  return (
    <div>
      <button className="text-button" onClick={onBack}><span>←</span> 返回策略列表</button>
      <div className="section-block">
        <div className="section-heading"><h2>回測：{symbol}</h2></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label className="eyebrow">選擇策略</label>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, marginTop: 4 }}>
              <option value="">— 請選擇 —</option>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow">回測期間（天）</label>
            <input type="number" value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))} min={30} max={3650}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, marginTop: 4 }} />
          </div>
          <div>
            <label className="eyebrow">停損 %</label>
            <input type="number" step="0.5" value={stopLossPct} onChange={(e) => setStopLossPct(Number(e.target.value))}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, marginTop: 4 }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label className="eyebrow">止盈倍數（R:R）</label>
            <input type="number" step="0.5" value={takeProfitRatio} onChange={(e) => setTakeProfitRatio(Number(e.target.value))}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, marginTop: 4 }} />
          </div>
          <div>
            <label className="eyebrow">最大持有天數</label>
            <input type="number" value={maxHoldDays} onChange={(e) => setMaxHoldDays(Number(e.target.value))}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12, marginTop: 4 }} />
          </div>
        </div>
        <button className="primary-button" onClick={handleRun} disabled={running || !strategyId}>
          <Play size={14} />{running ? "回測中…" : "開始回測"}
        </button>
        {error && <p style={{ color: "#ff5c5c", fontSize: 12, marginTop: 10 }}>⚠ {error}</p>}
      </div>
      {result && (
        <div className="section-block">
          <div className="section-heading">
            <h2>回測結果</h2>
            <span className="eyebrow">{result.strategyName} · {result.period.start} ～ {result.period.end} · {result.totalCandles} 根 K 線</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { label: "總交易次數", value: result.stats.totalTrades, color: "var(--foreground)" },
              { label: "勝率", value: `${result.stats.winRate.toFixed(1)}%`, color: result.stats.winRate >= 50 ? "var(--accent)" : "#ff725e" },
              { label: "平均報酬", value: `${result.stats.avgReturnPct.toFixed(2)}%`, color: result.stats.avgReturnPct >= 0 ? "var(--accent)" : "#ff725e" },
              { label: "總報酬", value: `${result.stats.totalReturnPct.toFixed(1)}%`, color: result.stats.totalReturnPct >= 0 ? "var(--accent)" : "#ff725u" },
              { label: "最大回撤", value: `${result.stats.maxDrawdownPct.toFixed(1)}%`, color: "#ff725e" },
              { label: "平均持有天數", value: result.stats.avgHoldDays.toFixed(1), color: "var(--foreground)" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(13,27,32,.85)" }}>
                <div className="eyebrow">{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 3 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.8 }}>
            <div>贏 {result.stats.winCount} 筆 · 輸 {result.stats.lossCount} 筆</div>
            <div>平均贏家報酬 {result.stats.avgWinPct.toFixed(2)}% · 平均輸家報酬 {result.stats.avgLossPct.toFixed(2)}%</div>
            <div>最大單筆損失 {result.stats.maxLossPct.toFixed(2)}% · 最大連續虧損 {result.stats.maxConsecutiveLosses} 次</div>
          </div>
          {result.signals.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--muted-foreground)" }}>查看交易訊號 ({result.signals.length})</summary>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                {result.signals.map((sig) => (
                  <div key={sig.index} style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: sig.type === "entry" ? "var(--accent)" : sig.type === "exit_win" ? "var(--primary)" : "#ff725e", minWidth: 70 }}>{sig.type}</span>
                    <span style={{ color: "var(--muted-foreground)" }}>{sig.date}</span>
                    <span>{sig.price}</span>
                    <span style={{ color: "var(--muted-foreground)" }}>{sig.reason}</span>
                    {sig.rr != null && <span style={{ color: sig.rr >= 0 ? "var(--accent)" : "#ff725e" }}>R={sig.rr}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- 主頁面 ---------- */

type EditMode = "list" | "edit" | "backtest";

export default function StrategyBuilder({ goPA }: { goPA?: (symbol: string) => void }) {
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<EditMode>("list");
  const [editingStrategy, setEditingStrategy] = useState<UserStrategyDef | null>(null);
  const [backtestSymbol, setBacktestSymbol] = useState("2330");
  const [strategies, setStrategies] = useState<UserStrategyDef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    fetchUserStrategies(user.id)
      .then((r) => setStrategies(r.strategies))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const handleSave = (s: UserStrategyDef) => {
    setStrategies((prev) => {
      const idx = prev.findIndex((p) => p.id === s.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = s; return next; }
      return [...prev, s];
    });
    setMode("list");
  };

  const handleDelete = (id: string) => {
    if (!user?.id) return;
    deleteUserStrategy(user.id, id).then(() => setStrategies((prev) => prev.filter((s) => s.id !== id))).catch(() => {});
  };

  const handleEdit = (s: UserStrategyDef) => { setEditingStrategy(s); setMode("edit"); };

  const handleRunBacktest = (s: UserStrategyDef) => {
    setEditingStrategy(s);
    setMode("backtest");
  };

  if (!isAuthenticated) return (
    <div className="section-block">
      <div className="empty-state">
        <h3>策略中心</h3>
        <p>請先登入以存取自訂策略與回測功能。</p>
        <button className="primary-button" style={{ marginTop: 12 }} onClick={() => { window.location.href = "/login"; }}>前往登入</button>
      </div>
    </div>
  );

  return (
    <div>
      {mode === "list" && (
        <div>
          <div className="section-heading" style={{ marginBottom: 16 }}>
            <h2>策略中心</h2>
            <button className="primary-button" onClick={() => { setEditingStrategy(null); setMode("edit"); }}>
              <Plus size={14} />新增策略
            </button>
          </div>
          <StrategyList strategies={strategies} loading={loading} onEdit={handleEdit} onDelete={handleDelete} onRunBacktest={handleRunBacktest} />
        </div>
      )}
      {mode === "edit" && (
        <StrategyEditor
          strategy={editingStrategy ?? undefined}
          userId={user!.id}
          onSave={handleSave}
          onBack={() => setMode("list")}
          onRunBacktest={handleRunBacktest}
        />
      )}
      {mode === "backtest" && (
        <BacktestDisplay symbol={backtestSymbol} onBack={() => setMode("list")} />
      )}
    </div>
  );
}
