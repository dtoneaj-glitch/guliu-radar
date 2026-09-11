/**
 * LINE Login OAuth2 Provider
 *
 * LINE Login 流程：
 * 1. 前端導向 /api/auth/line?redirect=...
 * 2. 後端導向 LINE 授權頁面（帶 state）
 * 3. LINE 回調到 /api/auth/line/callback?code=XXX&state=YYY
 * 4. 後端用 code 換 access token
 * 5. 後端取得 LINE 用戶資料
 * 6. 後端建立/連結帳號，回傳 JWT
 */

import { randomBytes } from "node:crypto";

const LINE_AUTH_URL = "https://login.line.me/oauth2/auth";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

/** LINE OAuth 配置（從環境變數讀取） */
interface LineConfig {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
}

function getConfig(): LineConfig | null {
  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const redirectUri = process.env.LINE_REDIRECT_URI;
  if (!channelId || !channelSecret) return null;
  return { channelId, channelSecret, redirectUri: redirectUri ?? `${process.env.BASE_URL ?? "http://localhost:3001"}/api/auth/line/callback` };
}

/** 產生 state（CSRF 保護） */
function generateState(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 產生 LINE 授權 URL
 * @param redirectParam 登入成功後跳回的前端路徑
 */
export function getLineAuthUrl(redirectParam: string): { url: string; state: string } {
  const config = getConfig();
  if (!config) throw new Error("LINE_CHANNEL_ID / LINE_CHANNEL_SECRET 未設定");

  const state = generateState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.channelId,
    redirect_uri: config.redirectUri,
    state,
    scope: "profile",
    loginType: "link", // 使用 LINE Login Button（網頁版）
  });
  // 把我們自己的 redirect 也帶進去 state（或另行存 session）
  // 這裡用 URL encoding 把 redirect 藏進 state
  const extendedState = `${state}:${encodeURIComponent(redirectParam)}`;

  return {
    url: `${LINE_AUTH_URL}?${params.toString()}`,
    state: extendedState,
  };
}

/**
 * 用 authorization code 換 access token
 */
export async function exchangeCodeForToken(code: string, state: string): Promise<{ accessToken: string; refreshToken: string }> {
  const config = getConfig();
  if (!config) throw new Error("LINE_CONFIG_MISSING");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.channelId,
    client_secret: config.channelSecret,
  }).toString();

  const res = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string };
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

/**
 * 用 access token 取得 LINE 用戶資料
 */
export async function getLineProfile(accessToken: string): Promise<{ userId: string; displayName: string; pictureUrl: string }> {
  const res = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE profile fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { userId: string; displayName: string; pictureUrl: string };
  return data;
}

/**
 * 解析 state，回傳原始 state + redirect 路徑
 */
export function parseState(state: string): { state: string; redirect: string } {
  const parts = state.split(":");
  const originalState = parts[0];
  const redirect = parts.slice(1).join(":");
  return {
    state: originalState,
    redirect: decodeURIComponent(redirect),
  };
}
