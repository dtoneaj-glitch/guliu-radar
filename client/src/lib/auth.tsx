/**
 * 會員認證 Context
 * - 登入/註冊後以 Bearer token 儲存於 localStorage
 * - 所有 API 請求自動帶上 Authorization header
 * - 提供 currentUser / isAuthenticated / login / logout / register
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AuthUser } from "@shared/types";

const TOKEN_KEY = "gr.auth.token";
const USER_KEY = "gr.auth.user";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  lineLogin: () => void;
  updateWatchlist: (items: { symbol: string; groups: string[] }[]) => Promise<void>;
  syncRemoteWatchlist: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 AuthProvider 內使用");
  return ctx;
}

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}
function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
function saveUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 檢查 URL hash 是否有 LINE 登入回傳的 token 或 error
    const hash = window.location.hash;
    if (hash && hash.startsWith("#")) {
      const search = hash.substring(1);
      const params = new URLSearchParams(search);
      const token = params.get("token");
      const userJson = params.get("user");
      const error = params.get("error");

      if (error) {
        alert(`LINE 登入失敗：${error}`);
        // 清除 hash
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setLoading(false);
        return;
      }
      if (token && userJson) {
        saveToken(token);
        const u = JSON.parse(decodeURIComponent(userJson)) as AuthUser;
        setUser(u);
        saveUser(u);
        // 清除 hash
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setLoading(false);
        return;
      }
    }

    // 啟動時驗證 token
    const storedToken = getToken();
    if (!storedToken) { setLoading(false); return; }
    apiFetch<AuthUser>("/api/auth/me")
      .then((u) => { setUser(u); saveUser(u); })
      .catch(() => { clearAuth(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    saveToken(res.token);
    setUser(res.user);
    saveUser(res.user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser; token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    saveToken(res.token);
    setUser(res.user);
    saveUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  const lineLogin = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") ?? "/";
    window.location.href = `/api/auth/line?redirect=${encodeURIComponent(redirect)}`;
  }, []);

  const updateWatchlist = useCallback(async (items: { symbol: string; groups: string[] }[]) => {
    const token = getToken();
    if (!user?.id || !token) return;
    await apiFetch(`/api/users/${user.id}/watchlist`, {
      method: "PUT",
      body: JSON.stringify({ watchlist: items }),
    });
  }, [user?.id]);

  const syncRemoteWatchlist = useCallback(async () => {
    if (!user?.id) return;
    const res = await apiFetch<{ symbols: string[]; items: { symbol: string; groups: string[] }[] }>(
      `/api/users/${user.id}/watchlist`,
    );
    // 同步到 localStorage（供 useWatchlist 使用）
    try {
      const localKey = "gr.watchlist.v2";
      const localRaw = localStorage.getItem(localKey);
      let localItems: { symbol: string; groups: string[] }[] = [];
      if (localRaw) {
        const parsed = JSON.parse(localRaw) as { items?: unknown; groups?: unknown };
        if (Array.isArray(parsed.items)) {
          localItems = (parsed.items as unknown[])
            .filter((x): x is { symbol: string; groups: string[] } =>
              !!x && typeof (x as any).symbol === "string" && Array.isArray((x as any).groups))
            .map((x) => ({ symbol: x.symbol, groups: x.groups.filter((g: unknown) => typeof g === "string") }));
        }
      }
      // 合併：以本地為主，補上雲端有的、本地沒有的
      const localSyms = new Set(localItems.map((i) => i.symbol));
      const merged = [...localItems];
      for (const item of res.items) {
        if (!localSyms.has(item.symbol)) merged.push(item);
      }
      const uniqueMap = new Map<string, { symbol: string; groups: string[] }>();
      for (const item of merged) uniqueMap.set(item.symbol, item);
      const finalItems = [...uniqueMap.values()];
      localStorage.setItem(localKey, JSON.stringify({ items: finalItems, groups: [] }));
      // 觸發 useWatchlist 重載
      window.dispatchEvent(new Event("storage"));
    } catch { /* ignore */ }
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, register, logout, lineLogin, updateWatchlist, syncRemoteWatchlist }}>
      {children}
    </AuthContext.Provider>
  );
}
