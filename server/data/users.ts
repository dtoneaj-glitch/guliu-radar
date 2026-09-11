/**
 * 會員資料層（JSON 檔案，無需資料庫）
 * - bcrypt 用 Node 內建 crypto.scryptSync（安全哈希）
 * - JWT 用 Node 內建 crypto.createHmac（HMAC-SHA256 簽章）
 * - 單一 JSON 檔案：server/data/users.json
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** JWT 簽章金鑰（實際部署應用環境變數） */
const JWT_SECRET = process.env.JWT_SECRET ?? "guliu-radar-dev-secret-change-in-prod";
const JWT_EXPIRES_IN = "7d"; // 7 天有效期

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string; // ISO string
  watchlist: WatchlistEntry[];
  /** LINE OAuth user ID（可選，用於第三方登入） */
  lineUserId?: string;
}

export interface WatchlistEntry {
  symbol: string;
  groups: string[];
}

interface UsersFile {
  version: number;
  users: User[];
}

const USERS_FILE = path.resolve(process.cwd(), "server", "data", "users.json");
const VERSION = 1;

function readUsers(): UsersFile {
  if (!fs.existsSync(USERS_FILE)) {
    return { version: VERSION, users: [] };
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw) as UsersFile;
  } catch {
    return { version: VERSION, users: [] };
  }
}

function writeUsers(data: UsersFile): void {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* ---------- 密碼哈希 ---------- */

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  const attempt = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(attempt, "hex"), Buffer.from(hash, "hex"));
}

/* ---------- JWT ---------- */

function base64urlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

interface JwtPayload {
  userId: string;
  username: string;
  exp: number; // Unix timestamp
}

export function signToken(userId: string, username: string): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64urlEncode(Buffer.from(JSON.stringify({ userId, username, exp })));
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("hex");
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest("hex");
    if (signature !== expected) return null;
    const decoded = JSON.parse(base64urlDecode(payload).toString("utf-8")) as JwtPayload;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/* ---------- CRUD ---------- */

export function createUser(username: string, password: string): { user: User; token: string } | null {
  const data = readUsers();
  if (data.users.some((u) => u.username === username)) return null;
  const { hash, salt } = hashPassword(password);
  const user: User = {
    id: randomBytes(8).toString("hex"),
    username,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
    watchlist: [],
  };
  data.users.push(user);
  writeUsers(data);
  const token = signToken(user.id, user.username);
  return { user: cleanUser(user), token };
}

export function findUserByUsername(username: string): User | null {
  const data = readUsers();
  const user = data.users.find((u) => u.username === username);
  return user ? cleanUser(user) : null;
}

export function findUserById(userId: string): User | null {
  const data = readUsers();
  const user = data.users.find((u) => u.id === userId);
  return user ? cleanUser(user) : null;
}

export function login(username: string, password: string): { user: User; token: string } | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  // cleanUser 已去 salt/hash，重新讀取做驗證
  const data = readUsers();
  const raw = data.users.find((u) => u.username === username);
  if (!raw || !verifyPassword(password, raw.passwordHash, raw.passwordSalt)) return null;
  const token = signToken(user.id, user.username);
  return { user, token };
}

export function updateWatchlist(userId: string, watchlist: WatchlistEntry[]): User | null {
  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  data.users[idx].watchlist = watchlist;
  writeUsers(data);
  return cleanUser(data.users[idx]);
}

export function getUsers(): Array<{ id: string; username: string; createdAt: string; watchlistCount: number }> {
  return readUsers().users.map((u) => ({
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    watchlistCount: u.watchlist.length,
  }));
}

/** 依 LINE user ID 找用戶 */
export function findUserByLineId(lineUserId: string): User | null {
  const data = readUsers();
  const user = data.users.find((u) => u.lineUserId === lineUserId);
  return user ? cleanUser(user) : null;
}

/** LINE OAuth 登入：若已存在則直接回 JWT，否則建立新帳號 */
export function lineLogin(lineUserId: string, displayName: string): { user: User; token: string } | null {
  // 先查是否已綁定
  const existing = findUserByLineId(lineUserId);
  if (existing) return { user: existing, token: signToken(existing.id, existing.username) };

  // 建立新帳號
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(randomBytes(16).toString("hex"), salt, 64).toString("hex");
  const username = `line_${displayName}_${randomBytes(3).toString("hex")}`;
  const user: User = {
    id: randomBytes(8).toString("hex"),
    username,
    passwordHash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
    watchlist: [],
    lineUserId,
  };
  const data = readUsers();
  data.users.push(user);
  writeUsers(data);
  return { user: cleanUser(user), token: signToken(user.id, user.username) };
}

function cleanUser(u: User): Omit<User, "passwordHash" | "passwordSalt"> & { passwordHash: string; passwordSalt: string } {
  return u;
}

/** 供 API 回應使用的乾淨用戶（不含密碼） */
export function publicUser(u: User): { id: string; username: string; createdAt: string; watchlist: WatchlistEntry[] } {
  return { id: u.id, username: u.username, createdAt: u.createdAt, watchlist: u.watchlist };
}
