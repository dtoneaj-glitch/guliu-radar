# 股流 Radar｜架構交接

## 北極星

股流 Radar 先找出台股熱門類別，再在熱區內用價格行為框架整理條件式交易情境。

## 目標架構

```text
資料源（TWSE / TPEx / FinMind）
        ↓
供應商抽象層（可替換）
        ↓
資料管線與資料庫
        ↓
PA Facts Layer（純函式、可重現）
        ↓
Coach Engine（六段框架）
        ↓
Strategy Profiles（pa_default 起步）
        ↓
PWA 呈現 + Phase 2 通知
```

## 三條約束

1. 資料源可替換：上層只能依賴統一介面。
2. 事實先於 AI：模型只能解釋 Facts Layer 結果，不可自行計算價位或發明形態。
3. 單向依賴：呈現層讀研判輸出，研判讀事實層，事實層讀資料庫。

## 目前實作與目標差異

> ⚠️ **這節已過期（2026-09-09 註記）**：以下描述的是專案初期（原型階段）的規劃，當時後端與 Facts Layer 都還沒動工。實際現況請看 `README-AI-HANDOFF.md`——後端已是完整 Express + SQLite（`server/`），Facts Layer 的核心功能（swing/結構/關鍵位/形態/量價、六段框架）已經在 `shared/levels.ts`／`shared/pa-facts.ts`／`shared/pa-default.ts` 實作完成並接上 API，不是下面規劃的 `packages/facts` 獨立套件形式，但功能範圍已涵蓋。是否要重構成獨立 package 純粹是程式碼組織問題，不是功能缺口。

目前為 Vite + React + Tailwind 的前端原型，資料寫在 `client/src/pages/Home.tsx`。正式化時預計新增：

```text
packages/facts/       swing、結構、關鍵位、形態、量價
packages/pa/       六段框架與策略視角
workers/pipeline/     盤後抓取、清洗、聚合
server/api/           讀取資料與研判輸出
 data/                SQLite schema 與 migrations
```

正式後端未建立前，不要把 mock data 當成真實市場資料。

## UI 入口

- `/`：目前由 `Home.tsx` 以狀態切換呈現熱區、掃描、研判、自選。
- 後續可拆成 route-level pages，但先維持可快速驗證的單頁原型。

## 時間框架

產品決策為週線、日線、60 分、15 分。週線與日線用於方向判讀；60 分與 15 分用於進場觀察。若資料源尚未累積完成，前端必須顯示明確狀態，不可偽造分析結果。
