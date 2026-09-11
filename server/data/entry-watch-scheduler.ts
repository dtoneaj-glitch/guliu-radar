import { getSnapshot } from "./hotzones";
import { scanEntryZoneProximity } from "./entry-watch";
import { getAllLinkedUsers, hasPushedEntryWatchToday, markEntryWatchPushed } from "./telegram-notifications";
import { findUserById } from "./users";
import { sendTelegramMessage, buildEntryWatchCopy } from "./providers/telegram-push";

export interface EntryWatchPushRunResult {
  asOf: string;
  linkedUsers: number;
  pushed: number;
  skippedNoWatchlist: number;
  skippedAlreadyPushed: number;
  failed: number;
}

/**
 * 收盤後自動推播：掃過所有已綁定 Telegram 的使用者，各自用他們伺服器端的自選股
 * （`users.ts` 的 `watchlist`，由 `client/src/lib/watchlist.ts` 背景同步寫入）
 * 跑一次「近進場區」掃描並推播。
 *
 * 去重：同一天同一使用者只推一次（`telegram-notifications.ts` 的 lastEntryWatchPush 記錄），
 * 排程用 setInterval 重複檢查，靠這個去重不會重複推播。
 */
export async function runEntryWatchPushForAllUsers(): Promise<EntryWatchPushRunResult> {
  const snapshot = await getSnapshot();
  const dateStr = snapshot.asOf;
  const linked = getAllLinkedUsers();

  const result: EntryWatchPushRunResult = {
    asOf: dateStr,
    linkedUsers: Object.keys(linked).length,
    pushed: 0,
    skippedNoWatchlist: 0,
    skippedAlreadyPushed: 0,
    failed: 0,
  };

  for (const [userId, chatId] of Object.entries(linked)) {
    if (hasPushedEntryWatchToday(userId, dateStr)) {
      result.skippedAlreadyPushed++;
      continue;
    }
    const user = findUserById(userId);
    const symbols = (user?.watchlist ?? []).map((w) => w.symbol);
    if (symbols.length === 0) {
      result.skippedNoWatchlist++;
      continue;
    }
    try {
      const items = await scanEntryZoneProximity(snapshot, symbols.slice(0, 50));
      const sendResult = await sendTelegramMessage(chatId, buildEntryWatchCopy(items));
      if (sendResult.success) {
        markEntryWatchPushed(userId, dateStr);
        result.pushed++;
      } else {
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }

  return result;
}
