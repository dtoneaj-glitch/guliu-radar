/**
 * 通知設定面板 — LINE Push 推播設定
 *
 * 功能：
 * 1. 顯示當前通知狀態（啟用/停用）
 * 2. 選擇要訂閱的策略（可多選）
 * 3. 測試推播按鈕
 * 4. LINE 綁定狀態顯示
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Send, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWatchlist } from "@/lib/watchlist";

function getToken(): string | null {
  try { return localStorage.getItem("gr.auth.token"); } catch { return null; }
}

interface NotificationSettings {
  enabled: boolean;
  strategies: string[];
  lineLinked: boolean;
  lineUserId?: string | null;
}

interface TelegramLinkState {
  code: string;
  deepLink: string | null;
  botUsername: string | null;
  expiresInSec: number;
}

const STRATEGIES = [
  { id: "pa_default", name: "聲納", desc: "條件式 PA 基礎雷達" },
  { id: "breakout-pullback", name: "破浪", desc: "前高突破＋回踩" },
  { id: "institution-tailwind", name: "順流", desc: "法人買超＋板塊升溫" },
  { id: "trend-follow", name: "潮流", desc: "上升結構回調" },
  { id: "range-fade", name: "潮間帶", desc: "箱體邊緣反轉" },
  { id: "volume-refill", name: "回湧", desc: "地量拐頭＋陽線" },
  { id: "ma21-break", name: "破堤", desc: "MA21 帶量突破" },
  { id: "ma200-current", name: "洋流", desc: "MA200 回調買點" },
] as const;

export default function NotificationSettings({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const token = getToken();
  const { symbols: watchSymbols } = useWatchlist();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Telegram 綁定狀態
  const [tgLinked, setTgLinked] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgLink, setTgLink] = useState<TelegramLinkState | null>(null);
  const [tgVerifying, setTgVerifying] = useState(false);
  const [tgMessage, setTgMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [tgTestLoading, setTgTestLoading] = useState(false);
  const [tgEntryWatchLoading, setTgEntryWatchLoading] = useState(false);

  const authFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });

  // 載入 Telegram 綁定狀態
  useEffect(() => {
    if (!token) return;
    authFetch("/api/notifications/telegram/status")
      .then((r) => r.json())
      .then((data: { linked: boolean }) => setTgLinked(!!data.linked))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const generateTelegramCode = async () => {
    if (!token) return;
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await authFetch("/api/notifications/telegram/link-code", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTgLink(data);
      } else {
        setTgMessage({ success: false, text: data.error ?? "產生驗證碼失敗" });
      }
    } catch {
      setTgMessage({ success: false, text: "網路錯誤" });
    } finally {
      setTgLoading(false);
    }
  };

  const verifyTelegramLink = async () => {
    if (!token || !tgLink) return;
    setTgVerifying(true);
    setTgMessage(null);
    try {
      const res = await authFetch("/api/notifications/telegram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: tgLink.code }),
      });
      const data = await res.json();
      if (data.linked) {
        setTgLinked(true);
        setTgLink(null);
        setTgMessage({ success: true, text: "Telegram 綁定成功！" });
      } else {
        setTgMessage({ success: false, text: data.error ?? "尚未驗證成功，請確認已在 Telegram 傳送驗證碼" });
      }
    } catch {
      setTgMessage({ success: false, text: "網路錯誤" });
    } finally {
      setTgVerifying(false);
    }
  };

  const sendTelegramTest = async () => {
    if (!token) return;
    setTgTestLoading(true);
    setTgMessage(null);
    try {
      const res = await authFetch("/api/notifications/telegram/test", { method: "POST" });
      const data = await res.json();
      setTgMessage(
        data.success ? { success: true, text: "測試通知已發送！請查看 Telegram。" } : { success: false, text: data.error ?? "發送失敗" },
      );
    } catch {
      setTgMessage({ success: false, text: "網路錯誤" });
    } finally {
      setTgTestLoading(false);
    }
  };

  const pushEntryWatchToTelegram = async () => {
    if (!token || watchSymbols.length === 0) return;
    setTgEntryWatchLoading(true);
    setTgMessage(null);
    try {
      const res = await authFetch("/api/notifications/telegram/entry-watch-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: watchSymbols }),
      });
      const data = await res.json();
      setTgMessage(
        data.success
          ? { success: true, text: `近進場區摘要已推播（掃描 ${data.itemCount} 檔）！` }
          : { success: false, text: data.error ?? "推播失敗" },
      );
    } catch {
      setTgMessage({ success: false, text: "網路錯誤" });
    } finally {
      setTgEntryWatchLoading(false);
    }
  };

  // 載入設定
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetch("/api/notifications/settings", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  // 切換策略訂閱
  const toggleStrategy = (strategyId: string) => {
    if (!settings) return;
    const strategies = settings.strategies.includes(strategyId)
      ? settings.strategies.filter((s) => s !== strategyId)
      : [...settings.strategies, strategyId];
    saveSettings({ ...settings, strategies });
  };

  // 切換總開關
  const toggleEnabled = () => {
    if (!settings) return;
    saveSettings({ ...settings, enabled: !settings.enabled });
  };

  // 儲存設定
  const saveSettings = async (newSettings: NotificationSettings) => {
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled: newSettings.enabled,
          strategies: newSettings.strategies,
        }),
      });
      const data = await res.json();
      setSettings(data);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  // 測試推播
  const sendTestPush = async () => {
    if (!token) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult(data.success ? { success: true, message: "測試通知已發送！請查看 LINE。" } : { success: false, message: data.error ?? "發送失敗" });
    } catch {
      setTestResult({ success: false, message: "網路錯誤" });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="notif-panel">
        <div className="notif-loading">
          <Loader2 size={20} className="spin" />
          <span>載入通知設定…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="notif-panel">
      {/* 標題列 */}
      <div className="notif-header">
        <div>
          <span className="notif-eyebrow">NOTIFICATIONS</span>
          <h2>推播設定</h2>
          <p className="notif-desc">策略條件符合時，透過 LINE 即時通知</p>
        </div>
        {onClose && (
          <button className="notif-close-btn" onClick={onClose} aria-label="關閉">
            <X size={18} />
          </button>
        )}
      </div>

      {/* LINE 綁定狀態 */}
      <div className="notif-section">
        <div className={`line-status ${settings?.lineLinked ? "linked" : "not-linked"}`}>
          <div className="line-status-icon">
            {settings?.lineLinked ? <Check size={18} /> : <span className="line-icon">L</span>}
          </div>
          <div className="line-status-text">
            <b>{settings?.lineLinked ? "LINE 已綁定" : "尚未綁定 LINE"}</b>
            <span>{settings?.lineLinked
              ? `已連結至 LINE 帳號，可接收推播`
              : "請先完成 LINE 登入以啟用推播功能"
            }</span>
          </div>
          {!settings?.lineLinked && (
            <a href="/api/auth/line?redirect=/" className="line-link-btn">
              綁定 LINE
            </a>
          )}
        </div>
      </div>

      {/* Telegram 綁定狀態（MVP 測試用） */}
      <div className="notif-section">
        <div className={`line-status ${tgLinked ? "linked" : "not-linked"}`}>
          <div className="line-status-icon">
            {tgLinked ? <Check size={18} /> : <span className="line-icon">T</span>}
          </div>
          <div className="line-status-text">
            <b>{tgLinked ? "Telegram 已綁定（測試版）" : "尚未綁定 Telegram（測試版）"}</b>
            <span>{tgLinked ? "已連結，可接收測試推播" : "免額度限制，適合先測試推播機制"}</span>
          </div>
        </div>

        {!tgLinked && !tgLink && (
          <button className="notif-test-btn" onClick={generateTelegramCode} disabled={tgLoading}>
            {tgLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            <span>{tgLoading ? "產生中…" : "產生綁定驗證碼"}</span>
          </button>
        )}

        {!tgLinked && tgLink && (
          <div className="notif-section" style={{ paddingLeft: 0 }}>
            <p className="notif-desc">
              1. 點下方按鈕開啟 Telegram，對 Bot 傳送：<br />
              <b style={{ fontFamily: "monospace", fontSize: 16 }}>/start {tgLink.code}</b>
              （{Math.floor(tgLink.expiresInSec / 60)} 分鐘內有效）
            </p>
            {tgLink.deepLink && (
              <a href={tgLink.deepLink} target="_blank" rel="noreferrer" className="line-link-btn" style={{ marginBottom: 8, display: "inline-block" }}>
                在 Telegram 開啟 Bot
              </a>
            )}
            <button className="notif-test-btn" onClick={verifyTelegramLink} disabled={tgVerifying}>
              {tgVerifying ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              <span>{tgVerifying ? "驗證中…" : "我已傳送，驗證綁定"}</span>
            </button>
          </div>
        )}

        {tgLinked && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button className="notif-test-btn" onClick={sendTelegramTest} disabled={tgTestLoading}>
              {tgTestLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              <span>{tgTestLoading ? "發送中…" : "發送測試通知"}</span>
            </button>
            <button className="notif-test-btn" onClick={pushEntryWatchToTelegram} disabled={tgEntryWatchLoading || watchSymbols.length === 0}>
              {tgEntryWatchLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              <span>{tgEntryWatchLoading ? "推播中…" : `推播近進場區清單（${watchSymbols.length} 檔）`}</span>
            </button>
          </div>
        )}

        {tgMessage && (
          <div className={`notif-test-result ${tgMessage.success ? "success" : "error"}`}>
            {tgMessage.success ? <Check size={14} /> : <X size={14} />}
            <span>{tgMessage.text}</span>
          </div>
        )}
      </div>

      {/* 總開關 */}
      <div className="notif-section">
        <div className="notif-toggle-row">
          <div className="notif-toggle-label">
            <b>啟用推播</b>
            <span>策略觸發時自動發送 LINE 通知</span>
          </div>
          <button
            className={`notif-toggle-btn ${settings?.enabled ? "on" : ""}`}
            onClick={toggleEnabled}
            disabled={!settings?.lineLinked || saving}
            aria-label={settings?.enabled ? "停用推播" : "啟用推播"}
          >
            {settings?.enabled ? <Bell size={16} /> : <BellOff size={16} />}
            <span>{settings?.enabled ? "已啟用" : "已停用"}</span>
          </button>
        </div>
      </div>

      {/* 策略選擇 */}
      <div className="notif-section">
        <div className="notif-section-title">
          <span className="notif-eyebrow">STRATEGIES</span>
          <h3>訂閱策略</h3>
        </div>
        <div className="notif-strategy-list">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              className={`notif-strategy-btn ${settings?.strategies.includes(s.id) ? "selected" : ""} ${!settings?.enabled ? "disabled" : ""}`}
              onClick={() => toggleStrategy(s.id)}
              disabled={!settings?.enabled}
            >
              <span className="notif-strategy-name">{s.name}</span>
              <span className="notif-strategy-desc">{s.desc}</span>
              {settings?.strategies.includes(s.id) && <Check size={14} className="check-icon" />}
            </button>
          ))}
        </div>
      </div>

      {/* 測試推播 */}
      <div className="notif-section">
        <button
          className="notif-test-btn"
          onClick={sendTestPush}
          disabled={testLoading || !settings?.lineLinked}
        >
          {testLoading ? (
            <>
              <Loader2 size={16} className="spin" />
              <span>發送中…</span>
            </>
          ) : (
            <>
              <Send size={16} />
              <span>發送測試通知</span>
            </>
          )}
        </button>
        {testResult && (
          <div className={`notif-test-result ${testResult.success ? "success" : "error"}`}>
            {testResult.success ? <Check size={14} /> : <X size={14} />}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* 說明 */}
      <div className="notif-footer">
        <p>推播訊息採用「條件式語句」格式，說明已確認條件、等待條件與失效位，不構成買賣建議。</p>
        <p>LINE 免費方案每月 200 則額度，超過需升級至 Premium。</p>
      </div>
    </div>
  );
}
