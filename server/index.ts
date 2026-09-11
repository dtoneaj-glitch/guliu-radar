import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createApi } from "./api";
import { getSnapshot } from "./data/hotzones";
import { saveSnapshot, listArchiveDates } from "./data/archive";
import { runEntryWatchPushForAllUsers } from "./data/entry-watch-scheduler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Phase 1 API（盤後資料）
  app.use("/api", createApi());

  // ========== B0 自動存檔定時任務 ==========
  // 台股收盤後 13:30 執行，每分鐘檢查是否已存檔今日資料
  const ARCHIVE_HOUR = 13;
  const ARCHIVE_MINUTE = 35; // 收盤後 5 分鐘

  function currentTaipeiTime(): { dateStr: string; hour: number; minute: number; weekday: number } {
    const now = new Date();
    const tw = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    return { dateStr: tw.toISOString().split("T")[0], hour: tw.getHours(), minute: tw.getMinutes(), weekday: tw.getDay() };
  }

  async function tryArchive() {
    const { dateStr, hour, minute, weekday } = currentTaipeiTime();

    // 週一至週五，13:30-23:59 之間才嘗試存檔
    if (weekday === 0 || weekday === 6) return; // 週末跳過
    if (hour < ARCHIVE_HOUR || (hour === ARCHIVE_HOUR && minute < ARCHIVE_MINUTE)) return;

    // 檢查今日是否已存檔（SQLite 版，取代舊版檢查 JSON 檔案是否存在的寫法——
    // 那個寫法在 2026-09-09 遷移到 SQLite 後已經失效，會導致這個判斷式永遠為 false）
    if (listArchiveDates().includes(dateStr)) return; // 今日已存檔

    console.log(`[archive] 自動存檔 ${dateStr}...`);
    try {
      const snapshot = await getSnapshot();
      saveSnapshot(snapshot.asOf, snapshot, snapshot.institutional);
      console.log(`[archive] ✅ 已存檔 ${snapshot.asOf}`);
    } catch (err) {
      console.error(`[archive] ❌ 存檔失敗:`, err);
    }
  }

  // 啟動時立即檢查一次
  setTimeout(() => { void tryArchive(); }, 5000);

  // 每 5 分鐘檢查一次
  setInterval(() => { void tryArchive(); }, 5 * 60 * 1000);

  // ========== 近進場區自動推播（Telegram，MVP） ==========
  // 排在存檔之後（存檔 13:35，推播 13:40），確保這次要用的 snapshot 資料已經穩定。
  // 去重靠 telegram-notifications.ts 的 lastEntryWatchPush 記錄，setInterval 重複觸發不會重複推播。
  const PUSH_HOUR = 13;
  const PUSH_MINUTE = 40;

  async function tryEntryWatchPush() {
    const { hour, minute, weekday } = currentTaipeiTime();
    if (weekday === 0 || weekday === 6) return;
    if (hour < PUSH_HOUR || (hour === PUSH_HOUR && minute < PUSH_MINUTE)) return;

    try {
      const result = await runEntryWatchPushForAllUsers();
      if (result.linkedUsers > 0) {
        console.log(
          `[entry-watch-push] ${result.asOf} 已綁定 ${result.linkedUsers} 人｜推播 ${result.pushed}｜已推過 ${result.skippedAlreadyPushed}｜無自選股 ${result.skippedNoWatchlist}｜失敗 ${result.failed}`,
        );
      }
    } catch (err) {
      console.error("[entry-watch-push] ❌ 執行失敗:", err);
    }
  }

  setTimeout(() => { void tryEntryWatchPush(); }, 10000);
  setInterval(() => { void tryEntryWatchPush(); }, 5 * 60 * 1000);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(`[api] 股流 Radar API running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
