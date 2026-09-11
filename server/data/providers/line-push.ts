/**
 * LINE Messaging API Provider
 *
 * 發送推播通知給已綁定 LINE 帳號的用戶。
 * 需要環境變數：
 *   LINE_BOT_CHANNEL_ACCESS_TOKEN — LINE Messaging API 的 channel access token
 *
 * LINE 免費額度：200 則/月（basic account）或無限制（premium/enterprise）
 * 推播格式遵循「條件式語句」原則：說「策略條件已符合」不說「現在買進」
 */

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

interface LineConfig {
  token: string;
}

function getConfig(): LineConfig | null {
  const token = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  return { token };
}

export interface PushMessage {
  to: string;          // LINE user ID
  messages: Array<{
    type: "text";
    text: string;
  }>;
}

/** 發送單則 LINE 推播 */
export async function sendLinePush(message: PushMessage): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) {
    return { success: false, error: "LINE_BOT_CHANNEL_ACCESS_TOKEN 未設定" };
  }

  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `LINE API ${res.status}: ${text.slice(0, 200)}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * 構建策略觸發推播文案（條件式語句，不構成買賣建議）
 *
 * 格式：
 * ┌─ 股流 Radar・策略觸發 ─────────────────┐
 * │  [策略名稱] 條件已符合                  │
 * │                                         │
 * │  📈 [代號] [名稱] 收 [價格] ([漲跌幅])  │
 * │  ⏱ [時間框架]                           │
 * │                                         │
 * │  ✅ 已確認：                             │
 * │     • [條件1]                           │
 * │     • [條件2]                           │
 * │                                         │
 * │  ⏳ 等待中：                             │
 * │     • [缺少的條件1]                     │
 * │                                         │
 * │  ⚠️ 結構失效：[失效位]                  │
 * │                                         │
 * │  🔗 股流 Radar：查看完整分析             │
 * └─────────────────────────────────────────┘
 */
export function buildStrategyTriggerCopy(
  symbol: string,
  name: string,
  strategyName: string,
  close: number | null,
  changePct: number | null,
  met: string[],
  missing: string[],
  invalidation: string,
  note: string,
): string {
  const priceLine = close != null
    ? `${symbol} ${name} 收 ${close.toLocaleString()} (${changePct != null ? (changePct >= 0 ? "+" : "") + changePct.toFixed(1) + "%" : "—"})`
    : `${symbol} ${name}`;

  const metLines = met.length > 0 ? met.map((m) => `   • ${m}`).join("\n") : "   （無）";
  const missingLines = missing.length > 0 ? missing.map((m) => `   • ${m}`).join("\n") : "   （全部齊備）";

  return [
    `「${strategyName}」條件已符合`,
    ``,
    `📈 ${priceLine}`,
    `⏱ 日線 · 價格行為研判`,
    ``,
    `✅ 已確認：`,
    metLines,
    ``,
    `⏳ 尚待確認：`,
    missingLines,
    ``,
    `⚠️ 失效位：${invalidation || "未確認"}`,
    ``,
    note,
    ``,
    `🔗 股流 Radar：打开 App 查看完整六段框架分析`,
  ].join("\n");
}

/** 發送策略觸發通知給單一用戶 */
export async function notifyStrategyTrigger(params: {
  lineUserId: string;
  symbol: string;
  name: string;
  strategyName: string;
  close: number | null;
  changePct: number | null;
  met: string[];
  missing: string[];
  invalidation: string;
  note: string;
}): Promise<{ success: boolean; error?: string }> {
  const copy = buildStrategyTriggerCopy(
    params.symbol,
    params.name,
    params.strategyName,
    params.close,
    params.changePct,
    params.met,
    params.missing,
    params.invalidation,
    params.note,
  );

  return sendLinePush({
    to: params.lineUserId,
    messages: [{ type: "text", text: copy }],
  });
}
