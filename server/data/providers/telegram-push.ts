/**
 * Telegram Bot API Provider（LINE Push 的替代方案 / MVP 測試用）
 *
 * 需要環境變數：
 *   TELEGRAM_BOT_TOKEN — 跟 @BotFather 申請的 bot token
 *
 * 額度：Telegram Bot API 官方無明確速率限制文件，實務上「同一 chat 每秒約 1 則」內都安全，
 * 遠比 LINE Basic 帳號的每月 200 則寬鬆，適合先用來驗證推播機制。
 *
 * 綁定方式（不需要公開 webhook，本機開發也能測）：
 *   1. 使用者在 App 內產生一組驗證碼（telegram-notifications.ts）
 *   2. 使用者在 Telegram 對 Bot 傳送 `/start <驗證碼>`
 *   3. App 呼叫 verify 端點，後端用 getUpdates（長輪詢的單次快照）找出符合的訊息，取出 chat_id 並存起來
 * 之後要正式上線、多用戶同時使用時，建議改成 webhook 模式（Telegram 主動推送更新），
 * 目前的 getUpdates 輪詢模式僅適合 MVP 測試（同時間只有少量使用者在做綁定動作）。
 */

const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callTelegramApi<T>(method: string, body?: Record<string, unknown>): Promise<TelegramApiResult<T>> {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN 未設定" };
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json()) as TelegramApiResult<T>;
    return data;
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  }
}

/** 發送單則 Telegram 訊息 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<{ success: boolean; error?: string }> {
  const data = await callTelegramApi<unknown>("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
  if (!data.ok) return { success: false, error: data.description ?? "未知錯誤" };
  return { success: true };
}

/** 取得 bot 資訊（username，用來組 t.me 深連結） */
export async function getBotInfo(): Promise<{ username: string } | null> {
  const data = await callTelegramApi<{ username: string }>("getMe");
  if (!data.ok || !data.result?.username) return null;
  return { username: data.result.username };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { username?: string };
  };
}

/**
 * 在最近的 updates 中尋找 `/start <code>` 訊息，回傳對應的 chat_id。
 * 找不到回傳 null（使用者可能還沒傳訊息，或訊息已經被前一次 getUpdates 消耗掉）。
 */
export async function findChatIdByLinkCode(code: string): Promise<{ chatId: string; username: string | null } | null> {
  const data = await callTelegramApi<TelegramUpdate[]>("getUpdates", { limit: 50, timeout: 0 });
  if (!data.ok || !data.result) return null;
  const target = `/start ${code}`;
  // 從新到舊找，避免同碼被重複使用時抓到舊的訊息
  for (const update of [...data.result].reverse()) {
    const text = update.message?.text?.trim();
    if (text === target && update.message?.chat?.id != null) {
      return { chatId: String(update.message.chat.id), username: update.message.from?.username ?? null };
    }
  }
  return null;
}

/** 構建近進場區清單推播文案（條件式語句，不構成買賣建議） */
export function buildEntryWatchCopy(
  items: Array<{ symbol: string; name: string; close: number | null; distancePct: number | null; status: string }>,
): string {
  const inZone = items.filter((i) => i.status === "in-zone");
  const approaching = items.filter((i) => i.status === "approaching");

  if (inZone.length === 0 && approaching.length === 0) {
    return "股流 Radar・近進場區摘要\n\n自選股中今日暫無收盤價進入或接近 PA 進場區的標的。";
  }

  const lines: string[] = ["📍 股流 Radar・近進場區摘要", ""];

  if (inZone.length > 0) {
    lines.push("✅ 已進入進場區：");
    for (const i of inZone) {
      lines.push(`   • ${i.symbol} ${i.name} 收 ${i.close?.toLocaleString() ?? "—"}`);
    }
    lines.push("");
  }

  if (approaching.length > 0) {
    lines.push("⏳ 接近進場區（2% 內）：");
    for (const i of approaching) {
      lines.push(`   • ${i.symbol} ${i.name} 距上緣 ${i.distancePct?.toFixed(1) ?? "—"}%`);
    }
    lines.push("");
  }

  lines.push("此為條件式訊號，不構成買賣建議。請打開 App 查看完整結構分析。");
  return lines.join("\n");
}
