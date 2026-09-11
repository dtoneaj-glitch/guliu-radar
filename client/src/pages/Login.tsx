/**
 * 登入 / 註冊頁面
 * - 兩個 tab 切換：登入 / 註冊
 * - 成功後自動跳回原頁面（?redirect=...）
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { user, login, register, lineLogin, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 已登入直接跳回首頁
  useEffect(() => {
    if (isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") ?? "/";
      window.location.href = redirect;
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("請填寫帳號與密碼");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("兩次密碼不一致");
      return;
    }
    if (mode === "register" && password.length < 6) {
      setError("密碼至少 6 個字元");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
      // 跳回首頁
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") ?? "/";
      window.location.href = redirect;
    } catch (err) {
      setError(err instanceof Error ? err.message : "發生錯誤");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
      <div style={{
        width: "100%", maxWidth: 380, padding: "32px 24px",
        border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--foreground)", letterSpacing: "-0.02em" }}>
            股流 <em style={{ fontWeight: 400 }}>Radar</em>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>MARKET FOCUS / PRICE ACTION</div>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 500,
                background: mode === m ? "rgba(255,114,94,.12)" : "transparent",
                color: mode === m ? "var(--primary)" : "var(--muted-foreground)",
                border: "none", cursor: "pointer", transition: ".15s ease",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {m === "login" ? "登入" : "註冊"}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 6 }}>
              帳號
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="2-20 個字元"
              maxLength={20}
              autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--background)",
                color: "var(--foreground)", fontSize: 14, boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 6 }}>
              密碼
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 6 個字元" : "輸入密碼"}
              minLength={6}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--background)",
                color: "var(--foreground)", fontSize: 14, boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>
          {mode === "register" && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 6 }}>
                確認密碼
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次輸入密碼"
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--background)",
                  color: "var(--foreground)", fontSize: 14, boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>
          )}
          {error && (
            <div style={{
              fontSize: 12, color: "var(--destructive)", marginBottom: 14,
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(255,107,107,.08)", border: "1px solid rgba(255,107,107,.2)",
            }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 8,
              border: "none", background: "var(--primary)", color: "#fff",
              fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1, transition: ".15s ease",
            }}
          >
            {loading ? "處理中…" : mode === "login" ? "登入" : "註冊"}
          </button>
        </form>

        {/* 分隔線 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>或</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {/* LINE 登入按鈕 */}
        <button
          onClick={lineLogin}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#06C755",
            color: "#fff",
            fontSize: 14, fontWeight: 500, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: ".15s ease",
          }}
        >
          {/* LINE Logo SVG */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M12 2C6.48 2 2 6.04 2 11.06c0 2.81 1.48 5.31 3.81 7.02V22l3.41-1.87c.91.25 1.87.38 2.86.38 5.52 0 10-4.04 10-9.06S17.52 2 12 2zm-1.5 13.5l-1.5-1.8L7 15.5l3.5-4.5L12 12.5l1.5-1.5L17 15.5l-2-1.8-1.5 1.8z"/>
          </svg>
          用 LINE 帳號登入
        </button>

        <div style={{ marginTop: 20, fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", lineHeight: 1.6 }}>
          {mode === "login" ? "還沒有帳號？" : "已有帳號？"}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: 11, padding: 0 }}
          >
            {mode === "login" ? "立即註冊" : "返回登入"}
          </button>
        </div>
      </div>
    </div>
  );
}
