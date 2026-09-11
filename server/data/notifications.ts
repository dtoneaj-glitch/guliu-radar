/**
 * 通知服務 — 策略觸發 LINE Push 推播
 *
 * 功能：
 * 1. 記錄每位用戶的通知設定（訂閱哪些策略）
 * 2. 掃描策略結果，偵測「等待 → 觸發」狀態轉變
 * 3. 發送 LINE Push 通知（去重：同 asOf + symbol + strategyId 只通知一次）
 * 4. 測試推播端點
 */

import fs from "node:fs";
import path from "node:path";
import type { StrategyEval } from "../../shared/types";
import { notifyStrategyTrigger, sendLinePush } from "./providers/line-push";

/* ── 檔案路徑 ─────────────────────────────────────────────────── */
const NOTIFICATIONS_FILE = path.resolve(process.cwd(), "server", "data", "notifications.json");

/* ── 資料結構 ─────────────────────────────────────────────────── */
export interface NotificationSettings {
  enabled: boolean;                  // 是否啟用推播
  strategies: string[];              // 訂閱的策略 ID 清單
  lineLinked: boolean;               // 是否已綁定 LINE
}

export interface NotifiedRecord {
  asOf: string;
  symbol: string;
  strategyId: string;
  notifiedAt: string;                // ISO timestamp
}

interface NotificationsFile {
  version: number;
  settings: Record<string, NotificationSettings>;  // userId -> settings
  notified: NotifiedRecord[];            // 已通知紀錄（用於去重）
  lineIds?: Record<string, string>;      // userId -> LINE user ID
}

const VERSION = 1;

function readNotifications(): NotificationsFile {
  if (!fs.existsSync(NOTIFICATIONS_FILE)) {
    return { version: VERSION, settings: {}, notified: [] };
  }
  try {
    const raw = fs.readFileSync(NOTIFICATIONS_FILE, "utf-8");
    return JSON.parse(raw) as NotificationsFile;
  } catch {
    return { version: VERSION, settings: {}, notified: [] };
  }
}

function writeNotifications(data: NotificationsFile): void {
  fs.mkdirSync(path.dirname(NOTIFICATIONS_FILE), { recursive: true });
  fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* ── 用戶設定 CRUD ─────────────────────────────────────────────── */

/** 取得用戶通知設定（若不存在則回傳預設值） */
export function getNotificationSettings(userId: string): NotificationSettings {
  const data = readNotifications();
  return data.settings[userId] ?? {
    enabled: false,
    strategies: ["pa_default"],
    lineLinked: false,
  };
}

/** 更新用戶通知設定 */
export function updateNotificationSettings(
  userId: string,
  updates: Partial<NotificationSettings>,
): NotificationSettings {
  const data = readNotifications();
  const current = data.settings[userId] ?? {
    enabled: false,
    strategies: ["pa_default"],
    lineLinked: false,
  };
  const updated = { ...current, ...updates };
  data.settings[userId] = updated;
  writeNotifications(data);
  return updated;
}

/** 標記用戶已綁定 LINE */
export function linkLineAccount(userId: string, lineUserId: string): void {
  const data = readNotifications();
  if (!data.settings[userId]) {
    data.settings[userId] = { enabled: true, strategies: ["pa_default"], lineLinked: false };
  }
  data.settings[userId].lineLinked = true;
  // 同時把 LINE user ID 存入（用特殊 key 存）
  data.settings[`${userId}:lineId`] = { enabled: false, strategies: [], lineLinked: true } as any;
  // 實際存 lineId 到一個 separate map
  if (!data.lineIds) data.lineIds = {} as any;
  (data as any).lineIds[userId] = lineUserId;
  writeNotifications(data);
}

/** 取得用戶的 LINE user ID */
export function getLineUserId(userId: string): string | null {
  const data = readNotifications();
  return ((data as any).lineIds?.[userId] ?? null) as string | null;
}

/* ── 去重 ──────────────────────────────────────────────────────── */

/** 檢查是否已通知過（同 asOf + symbol + strategyId） */
function hasNotified(asOf: string, symbol: string, strategyId: string): boolean {
  const data = readNotifications();
  return data.notified.some(
    (r) => r.asOf === asOf && r.symbol === symbol && r.strategyId === strategyId,
  );
}

/** 標記已通知（保留最近 7 天的紀錄） */
function markNotified(asOf: string, symbol: string, strategyId: string) {
  const data = readNotifications();
  const now = new Date().toISOString();
  data.notified.push({ asOf, symbol, strategyId, notifiedAt: now });
  // 清理超過 7 天的紀錄
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  data.notified = data.notified.filter((r) => r.notifiedAt > cutoff);
  writeNotifications(data);
}

/* ── 策略掃描推播 ──────────────────────────────────────────────── */

/**
 * 掃描策略觸發並發送 LINE 推播
 *
 * @param strategyId 策略 ID
 * @param scanResult 掃描結果
 * @returns 推送統計 { sent: number; skipped: number; errors: string[] }
 */
export async function scanAndNotify(
  strategyId: string,
  scanResult: { asOf: string; rows: StrategyEval[] },
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const data = readNotifications();
  const { asOf, rows } = scanResult;

  // 找出 triggered 的股票
  const triggered = rows.filter((r) => r.status === "triggered");
  if (triggered.length === 0) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const userEntry of Object.entries(data.settings)) {
    const [userId, settings] = userEntry;

    // 跳過非用戶設定（如 lineIds 存檔）
    if (userId.includes(":")) continue;
    if (!settings.enabled || !settings.lineLinked) continue;
    if (!settings.strategies.includes(strategyId)) continue;

    const lineUserId = ((data as any).lineIds?.[userId] ?? null) as string | null;
    if (!lineUserId) continue;

    // 對每檔 triggered 股票發送通知
    for (const row of triggered) {
      const key = `${asOf}:${row.symbol}:${strategyId}`;
      if (hasNotified(asOf, row.symbol, strategyId)) {
        skipped++;
        continue;
      }

      const result = await notifyStrategyTrigger({
        lineUserId,
        symbol: row.symbol,
        name: row.name,
        strategyName: row.strategyName,
        close: row.close,
        changePct: row.changePct,
        met: row.met,
        missing: row.missing,
        invalidation: row.note.includes("失效")
          ? row.note.split("失效：")[1]?.split("。")[0] ?? "未確認"
          : "未確認",
        note: `此為條件式訊號，不構成買賣建議。請至股流 Radar 查看完整六段框架分析。`,
      });

      if (result.success) {
        markNotified(asOf, row.symbol, strategyId);
        sent++;
      } else {
        errors.push(`${row.symbol}: ${result.error}`);
      }
    }
  }

  return { sent, skipped, errors };
}

/** 手動觸發指定策略的掃描並推播（供管理員使用） */
export async function triggerManualScan(
  strategyId: string,
  scanFn: () => Promise<{ asOf: string; rows: StrategyEval[] }>,
): Promise<{ sent: number; skipped: number; errors: string[]; asOf: string }> {
  const scanResult = await scanFn();
  const stats = await scanAndNotify(strategyId, scanResult);
  return { ...stats, asOf: scanResult.asOf };
}

/* ── 測試推播 ──────────────────────────────────────────────────── */

/** 發送測試推播給指定 LINE user ID */
export async function sendTestPush(lineUserId: string): Promise<{ success: boolean; error?: string }> {
  if (!lineUserId) {
    return { success: false, error: "lineUserId 未提供" };
  }
  return sendLinePush({
    to: lineUserId,
    messages: [{
      type: "text",
      text: [
        "🔔 股流 Radar · 測試通知",
        "",
        "這是測試推播訊息。",
        "如果您收到這則訊息，代表 LINE Push 功能已正常運作。",
        "",
        "當策略條件符合時，您會收到類似的即時通知。",
        "",
        "— 股流 Radar 團隊",
      ].join("\n"),
    }],
  });
}
