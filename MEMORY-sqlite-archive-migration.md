---
name: sqlite-archive-migration
description: guliu-radar B0 每日快照存檔從 JSON 檔案遷移至 SQLite（better-sqlite3）
metadata:
  type: project
---

## 變更內容（2026-09-09）

`server/data/archive.ts` 原本用 `archive/daily/YYYY-MM-DD/*.json` 四個檔案存每日快照，改為 SQLite（`better-sqlite3`）。

**新增檔案**：
- `server/data/db.ts` — DB 連線（`server/data/radar.db`，WAL 模式）+ schema（`archive_meta` / `archive_summary` / `archive_quotes` / `archive_institutional` 四張表）
- `server/data/migrate-archive.ts` — 一次性搬遷腳本，`npm run db:migrate` 執行，冪等（預設跳過已存在日期，`--force` 強制覆蓋）

**設計取捨**：Quote / InstitutionalBreakdown 仍以完整 JSON 存在 `data` 欄位（不逐欄拆 SQL column），只把 `close`／`change_pct` 額外拆出來做索引，避免型別一改就要跟著改 schema。

**對外行為不變**：`saveSnapshot` / `listArchiveDates` / `loadArchiveDate` 三個匯出函式簽名與回傳形狀跟舊版完全一致，`hotzones.ts`／`history.ts`／`regime.ts`／`api.ts` 皆不需修改。

## 驗證

- 7 天既有 JSON 存檔（2026-09-01 ~ 09）全數遷移成功，逐筆比對 quotes 數量與內容一致
- 重複執行 `db:migrate` 正確跳過已存在日期；`--force` 正確覆蓋
- `loadArchiveDate('2026-09-09')` 回傳形狀與舊版 JSON 版本逐欄位比對一致
- `tsc --noEmit` 0 錯誤、`vitest run` 19/19 全過

## 備註

- 舊版 JSON 檔案邏輯備份在 `_migration-backup/archive.legacy-json.ts`（不在編譯路徑內）
- 舊版 `archive/daily/` JSON 檔案**尚未刪除**，留著當備份；確認 SQLite 資料在正式環境跑穩後可手動清掉
- `server/data/radar.db`（含 `-shm`/`-wal`）已加入 `.gitignore`，不進版控
- `package.json` 的 `build` 用 `esbuild --packages=external`，`better-sqlite3` 是原生模組，維持 external 不會被打包，正式部署主機需要能安裝原生依賴（跟 `npm install` 環境一致即可，這次在沙盒測試過原生綁定可正常載入）
