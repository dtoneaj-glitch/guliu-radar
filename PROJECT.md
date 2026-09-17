# 股流（股流Radar）

- **一句話定位**：台股看盤與策略儀表板（籌碼、均線、停損、進出場提示、推播）。
- **類型 / 技術**：TypeScript + React + Vite 前端；`tsx` Node 後端；SQLite 歸檔；Telegram 推播。
- **啟動方式**：雙擊 `start-guliu.bat`；或 `npm run dev`（同時起 api + web）。
- **目前狀態**：功能成熟期——已有籌碼背離引擎、滾動熱度、追蹤停損、Telegram 推播 MVP 等大量設計決策紀錄。
- **下一步**：（待補）
- **關鍵檔案**：`server/`、`client/`、`shared/`、`docs/`、`vite.config.ts`、`README-AI-HANDOFF.md`、`MEMORY-*.md`（21 份）
- **遠端倉庫**：https://github.com/dtoneaj-glitch/guliu-radar
- **敏感項**：JWT 驗證邏輯、外部 API 金鑰、`.env`；`MEMORY-jwt-timingsafeequal-bug.md` 為已知修補紀錄。
- **備註**：桌面另有 `D:\桌面專案\股流`、`C:\Users\amydo\OneDrive\桌面\股流開發`。
