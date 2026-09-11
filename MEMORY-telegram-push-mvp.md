---
name: telegram-push-mvp
description: guliu-radar Telegram Bot 推播 MVP（LINE Push 的替代方案，先測試用）
metadata:
  type: project
---

## 為什麼加這個（2026-09-09）

使用者問「有沒有可能不要用 LINE 推播」——LINE Basic 帳號每月只有 200 則額度，且需要 LINE 官方帳號審核。Telegram Bot API 免額度限制、申請只要跟 @BotFather 對話拿 token，適合先拿來測試「近進場區」這類推播機制能不能用，之後量大或要正式上線再考慮要不要換回 LINE／WebPush／兩者並存。

## 架構

跟現有 LINE 推播並列的獨立模組，不動 LINE 那一套：

| 檔案 | 對應 LINE 版本 | 差異 |
|---|---|---|
| `server/data/providers/telegram-push.ts` | `line-push.ts` | 多了 `getBotInfo()`／`findChatIdByLinkCode()`（LINE 用 OAuth，Telegram 沒有，改用驗證碼機制） |
| `server/data/telegram-notifications.ts` | `notifications.ts` 裡的綁定部分 | 用乾淨型別重寫（LINE 那版有 `as any` 混雜 lineIds 的髒寫法，這次沒有照抄） |

## 綁定流程（沒有 webhook，本機開發也能測）

1. 使用者在 App 按「產生綁定驗證碼」→ 後端存一組 6 碼驗證碼（10 分鐘過期），回傳 `t.me/<bot>?start=<code>` 深連結
2. 使用者點深連結，在 Telegram 對 Bot 傳送 `/start <code>`
3. 使用者回 App 按「驗證綁定」→ 後端呼叫 Telegram `getUpdates`（單次快照，不是常駐輪詢），在最近訊息裡找 `/start <code>`，取出 `chat_id` 存起來

**已知限制**：`getUpdates` 輪詢模式只適合少量使用者同時測試；正式多人使用要改 webhook 模式（Telegram 主動推送更新到你的伺服器），目前沒做。

## 部署前要做的事

1. 跟 [@BotFather](https://t.me/BotFather) 申請 bot，拿到 token
2. 設環境變數 `TELEGRAM_BOT_TOKEN`（跟 `LINE_BOT_CHANNEL_ACCESS_TOKEN` 同慣例，`.env` 不進版控）
3. 沒設這個變數時，所有 Telegram 端點會回傳 `{ success: false, error: "TELEGRAM_BOT_TOKEN 未設定" }`，不會噴例外

## API 端點（都要帶 `Authorization: Bearer <JWT>`，跟其他 notifications 端點同慣例）

- `GET /api/notifications/telegram/status` → `{ linked: boolean }`
- `POST /api/notifications/telegram/link-code` → `{ code, botUsername, deepLink, expiresInSec }`
- `POST /api/notifications/telegram/verify`（body: `{ code }`）→ `{ linked, error? }`
- `POST /api/notifications/telegram/test` → 發測試訊息
- `POST /api/notifications/telegram/entry-watch-push`（body: `{ symbols: string[] }`）→ 掃描近進場區並推播摘要，回傳 `{ success, asOf, itemCount }`

## 前端

`client/src/components/NotificationSettings.tsx` 在 LINE 綁定區塊後加了一個 Telegram 區塊：產生驗證碼 → 開 Telegram 連結 → 驗證綁定 → 測試通知／推播近進場區清單（會抓 `useWatchlist()` 的自選股清單）。

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 19/19 全過
- 獨立腳本驗證過（不需要真實網路連線）：驗證碼產生／驗證／消耗、跨用戶驗證碼互不通用、綁定完成後 chat_id 正確存取、缺 token 時所有函式優雅回傳錯誤而非拋例外、`buildEntryWatchCopy()` 產生的中文文案格式正確
- **沒有實際跟 Telegram API 對接測試過**（沙盒網路白名單不含 api.telegram.org）——需要你設好 `TELEGRAM_BOT_TOKEN` 後在本機實際跑一次完整綁定流程驗證
