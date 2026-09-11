/**
 * 輕量回訪通知：不需後端 push 伺服器，用瀏覽器 Notification API 在裝置端提醒。
 * 侷限：分頁未開啟時無法收到通知（真正的離線推播需要 VAPID + 訂閱後端，屬 Phase 2 範圍）。
 * 這裡先解決「今天有沒有東西值得回來看」的每日摘要提醒。
 */

const SEEN_KEY = "gr.digest.notified.v1";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

/** 同一個 asOf（盤後日期）只提醒一次，避免重複打擾 */
function alreadyNotified(asOf: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === asOf;
  } catch {
    return false;
  }
}

function markNotified(asOf: string) {
  try {
    localStorage.setItem(SEEN_KEY, asOf);
  } catch {
    /* Local Storage 不可用時安靜略過 */
  }
}

/** 若權限已允許、且今天尚未提醒過，發出一則本機通知 */
export function maybeNotifyDigest(asOf: string, triggeredCount: number, strategyName: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (triggeredCount <= 0) return;
  if (alreadyNotified(asOf)) return;
  try {
    new Notification("股流 Radar・今日重點", {
      body: `自選股中有 ${triggeredCount} 檔觸發「${strategyName}」條件，回來看看結構。`,
      icon: "/icon.svg",
      tag: "gr-daily-digest",
    });
    markNotified(asOf);
  } catch {
    /* 部分瀏覽器環境限制建構 Notification，安靜失敗即可 */
  }
}
