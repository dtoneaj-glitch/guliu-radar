import fs from "node:fs";
import path from "node:path";

/**
 * Telegram 綁定資料（JSON 檔案存儲，跟 users.ts / notifications.ts 同慣例）
 *
 *  - chatIds: userId -> Telegram chat_id（綁定完成後才有）
 *  - codes:   驗證碼 -> { userId, expiresAt }（綁定過程中的暫存，10 分鐘過期）
 */

const FILE_PATH = path.resolve(process.cwd(), "server", "data", "telegram-notifications.json");
const CODE_TTL_MS = 10 * 60 * 1000;

interface LinkCode {
  userId: string;
  expiresAt: number;
}

interface TelegramFile {
  version: 1;
  chatIds: Record<string, string>;
  codes: Record<string, LinkCode>;
  /** userId -> 最後成功推播「近進場區」摘要的日期（YYYY-MM-DD），排程去重用 */
  lastEntryWatchPush?: Record<string, string>;
}

function readFile(): TelegramFile {
  if (!fs.existsSync(FILE_PATH)) return { version: 1, chatIds: {}, codes: {} };
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf-8")) as TelegramFile;
  } catch {
    return { version: 1, chatIds: {}, codes: {} };
  }
}

function writeFile(data: TelegramFile): void {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆字元（0/O、1/I）
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** 產生一組新的驗證碼給使用者（10 分鐘內有效；重複呼叫會覆蓋前一組未使用的碼） */
export function generateLinkCode(userId: string): { code: string; expiresInSec: number } {
  const data = readFile();
  // 清掉這個使用者之前產生但沒用掉的碼，避免累積
  for (const [code, entry] of Object.entries(data.codes)) {
    if (entry.userId === userId) delete data.codes[code];
  }
  const code = randomCode();
  const expiresAt = Date.now() + CODE_TTL_MS;
  data.codes[code] = { userId, expiresAt };
  writeFile(data);
  return { code, expiresInSec: CODE_TTL_MS / 1000 };
}

/** 驗證碼是否存在且未過期、且屬於這個使用者 */
export function isValidLinkCode(userId: string, code: string): boolean {
  const data = readFile();
  const entry = data.codes[code];
  if (!entry) return false;
  if (entry.userId !== userId) return false;
  if (entry.expiresAt < Date.now()) return false;
  return true;
}

/** 綁定成功後：存 chat_id、消耗掉驗證碼 */
export function completeLinking(userId: string, code: string, chatId: string): void {
  const data = readFile();
  data.chatIds[userId] = chatId;
  delete data.codes[code];
  writeFile(data);
}

export function getTelegramChatId(userId: string): string | null {
  return readFile().chatIds[userId] ?? null;
}

export function unlinkTelegram(userId: string): void {
  const data = readFile();
  delete data.chatIds[userId];
  writeFile(data);
}

/** 排程用：列出所有已綁定 Telegram 的使用者 chat_id（userId -> chatId） */
export function getAllLinkedUsers(): Record<string, string> {
  return readFile().chatIds;
}

/** 今天是否已經成功推播過近進場區摘要給這個使用者（避免排程重跑造成重複推播） */
export function hasPushedEntryWatchToday(userId: string, dateStr: string): boolean {
  return readFile().lastEntryWatchPush?.[userId] === dateStr;
}

export function markEntryWatchPushed(userId: string, dateStr: string): void {
  const data = readFile();
  if (!data.lastEntryWatchPush) data.lastEntryWatchPush = {};
  data.lastEntryWatchPush[userId] = dateStr;
  writeFile(data);
}
