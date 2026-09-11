---
name: entry-watch-push-automation
description: guliu-radar 近進場區收盤後自動推播（Telegram），含發現並補上的自選股同步缺口
metadata:
  type: project
---

## 動手前發現的關鍵缺口（2026-09-09）

要做「收盤後自動幫已綁定用戶推播近進場區清單」，伺服器排程需要知道使用者的自選股。查了才發現：

- `server/data/users.ts` 有 `watchlist` 欄位、`updateWatchlist()` 函式、`/api/users/:userId/watchlist` PUT 端點——**都已經存在**
- `client/src/lib/auth.tsx` 也有 `updateWatchlist()`（本地→伺服器推播）——**也已經寫好**
- 但 `updateWatchlist()` **從沒被任何元件呼叫過**，只有 `syncRemoteWatchlist()`（伺服器→本地拉取）在 `Home.tsx` 掛載時呼叫一次

也就是說：使用者在裝置上加減自選股，從來沒同步回伺服器。伺服器端的 `watchlist` 欄位形同虛設，排程掃了也是空的。

## 補上的東西

`client/src/lib/watchlist.ts` 的 `persist()`（所有自選股變動都會經過這裡：`toggle`/`remove`/`clear`/`toggleGroup`）加了一個 `syncToServer()`：
- 讀 localStorage 的 `gr.auth.token` / `gr.auth.user`（跟 `NotificationSettings.tsx` 同慣例），沒登入就直接跳過
- fire-and-forget 打 `PUT /api/users/:userId/watchlist`，失敗不影響本地操作、不重試（下次變動時自然會再打一次）
- 沒有動 `auth.tsx` 既有的 `updateWatchlist()`／`syncRemoteWatchlist()`，這次走的是獨立的背景同步，避免把非 React 模組硬綁進 AuthContext

## 排程本體

| 檔案 | 內容 |
|---|---|
| `server/data/entry-watch-scheduler.ts`（新） | `runEntryWatchPushForAllUsers()`：掃過 `telegram-notifications.ts` 的所有已綁定用戶，各自讀 `users.ts` 的 watchlist，跑 `scanEntryZoneProximity`，推播 |
| `server/data/telegram-notifications.ts` | 新增 `getAllLinkedUsers()`、`hasPushedEntryWatchToday()`、`markEntryWatchPushed()`（去重用） |
| `server/index.ts` | 新增排程：收盤後 13:40（比 B0 存檔的 13:35 晚 5 分鐘，確保 snapshot 穩定）開始，每 5 分鐘檢查一次，靠 `hasPushedEntryWatchToday` 去重，同一天不會重複推播同一人 |
| `server/api.ts` | 新增 `POST /api/admin/notify-entry-watch-scan`，登入即可手動觸發，測試不用等到 13:40 |

## 順手修的 bug

`server/index.ts` 的 `tryArchive()` 原本用 `fs.existsSync(archive/daily/{date}/meta.json)` 判斷今天存過檔沒有——但 **2026-09-09 遷移到 SQLite 後 `archive.ts` 不再寫 JSON 檔案**，這個判斷式從遷移完那天起就一直是 `false`，代表收盤後每 5 分鐘都會重新打一次即時資料重存一次（不會造成資料錯誤，因為 SQLite 版是 upsert，但會浪費 API 額度）。這次做排程時剛好經過這段程式碼，一併改成呼叫 `listArchiveDates().includes(dateStr)`。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 26/26 全過
- 獨立腳本驗證過（不需連網）：多用戶去重隔離正確、同一天標記後不重複、換日期重置正確、`users.ts` 的 watchlist 讀寫正確
- **沒有端對端測試過**：`runEntryWatchPushForAllUsers()` 依賴 `getSnapshot()`（需要即時 TWSE/Yahoo）＋真實 Telegram API，沙盒都連不到。本機部署後用 `POST /api/admin/notify-entry-watch-scan` 手動觸發一次驗證完整流程
