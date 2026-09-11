---
name: pa-facts-a-b-status-check
description: 核對「A（型態補強）+ B（多時框加權）」範圍，發現大部分已完成，補了缺口與過期文件
metadata:
  type: project
---

## 查核結果（2026-09-09）

使用者要求做 A（補強型態辨識：頭肩頂/底、雙頂/雙底、量價背離、ATR 取代固定百分比）+ B（多時框一致性加深）。

**動手前先查了現有程式碼，發現 A、B 兩項其實都已經實作完成**：

| 項目 | 狀態 | 位置 |
|---|---|---|
| 頭肩頂/頭肩底、雙頂/雙底 | ✅ 已完成 | `shared/levels.ts` `detectSwingPatterns()` |
| 量價背離（頂/底背離） | ✅ 已完成 | `shared/levels.ts` `detectVolumeDivergence()` |
| ATR 取代固定百分比 | ✅ 已完成 | `shared/levels.ts` `calculateATR()`，`buildMarketFacts()` 已用於 entryZone/invalidation |
| 多時框加權一致性分數 | ✅ 已完成 | `shared/pa-facts.ts` `computeAlignmentScore()`（週40%/日30%/60分20%/15分10%） |
| 六段式輸出有呈現以上內容 | ✅ 已完成 | `shared/pa-default.ts`（patterns 全部列出、alignment.score 顯示在「一、市場結構」段） |

只有一個小缺口：**頭肩頂/頭肩底沒有專屬單元測試**（雙頂/雙底、背離都有，頭肩獨缺）。已補上兩個測試案例（`client/src/lib/levels.test.ts`）。

## 為什麼會有這個落差

`docs/TODO.md` 和 `docs/ARCHITECTURE.md` 當時寫的是「研判為 v0 規則版；完整 PA 事實層於 Sprint 3」「packages/facts 尚未建立」，但程式碼本身已經超前文件的進度——這次一併更新了三份文件（`docs/TODO.md`、`docs/ARCHITECTURE.md`、`docs/PA_FACTS_ENGINE.md`），並把 `shared/levels.ts` 的 `LEVELS_VERSION` 從 `"v0.1"` 更新為 `"v0.2"`（程式碼裡的註解早就寫著「v0.2 新增」但版本常數沒跟著動）。

## 驗證

- `tsc --noEmit` 0 錯誤
- `vitest run` 26/26 全過（原本 24，新增頭肩頂/頭肩底 2 個測試）
