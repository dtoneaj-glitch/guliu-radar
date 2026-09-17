# scripts — 每日存檔排程

用途：**累積 SQLite 歷史資料庫**，不需要讓 dev server 一直開著。

每次執行會存兩份快照：
1. **B0 每日快照**（`archive_*` 表）：全市場報價 + 三大法人買賣超分項
2. **大盤籌碼快照**（`archive_chipcard` 表）：三大法人期貨未平倉（本週彙總要用）

## 檔案

| 檔案 | 作用 |
|---|---|
| `daily-archive.ts` | 實際的存檔工作（可用 `tsx` 直接跑） |
| `run-daily-archive.bat` | 包裝：切到專案根目錄、輸出寫進 `logs/daily-archive.log` |
| `register-daily-task.bat` | 建立／執行／刪除 Windows 工作排程 |

## 手動執行（測試用）

```bat
cd /d D:\個人台\股流Radar\guliu-radar-local
node_modules\.bin\tsx scripts\daily-archive.ts
```

或雙擊 `scripts\run-daily-archive.bat`，結果看 `logs\daily-archive.log`。

## 建立每日自動排程

```bat
scripts\register-daily-task.bat          :: 建立（週一~週五 20:30）
scripts\register-daily-task.bat run      :: 立刻試跑一次
scripts\register-daily-task.bat delete   :: 刪除
```

## 設計重點

- **重複執行安全**：以「資料源最新交易日」為存檔鍵，已存的日期會自動跳過。
- **時間點**：排在 **20:30**，因為 TAIFEX 法人籌碼約 16:00~20:00 才公布；排太早會抓到前一日（仍會被隔天補上，只是延遲）。
- **不需要常駐 server**：這是獨立進程，跑完就結束；與 app 內建的 13:35 排程互不衝突（都走 idempotent 存檔）。
- **Zcode 測試**：把整個 `scripts/` 複製到任一專案目錄即可，但 `daily-archive.ts` 依賴 `server/` 與 `shared/` 的相對路徑，需與專案同層才能跑。

## 注意

- 需要能連外網（TWSE / TPEx / FinMind / TAIFEX / Yahoo）。
- `logs/` 已加入 `.gitignore`。
