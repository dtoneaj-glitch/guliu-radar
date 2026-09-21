/**
 * 極簡 .env 載入器（避免新增 dotenv 相依）。
 * 只補「尚未設定」的環境變數，不覆蓋既有值。
 * 由 server/index.ts 在啟動最前面呼叫。
 */
import fs from "node:fs";
import path from "node:path";

export function loadEnvFile(file = path.resolve(process.cwd(), ".env")): void {
  try {
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && (process.env[key] === undefined || process.env[key] === "")) process.env[key] = value;
    }
  } catch {
    /* 讀不到 .env 不影響啟動 */
  }
}

// 模組被 import 時就立即載入（確保早於其他模組讀取 process.env）
loadEnvFile();
