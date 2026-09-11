---
name: tpex-institutional-data
description: guliu-radar 上櫃三大法人買賣超接上（未經真實 API 驗證，部署後第一件事要查）
metadata:
  type: project
---

## 變更內容（2026-09-09）

`server/data/providers/tpex.ts` 新增 `fetchTpexInstitutional(dateAd)`，仿 `twse.ts` 的 `fetchTwseInstitutional()` 寫法（同樣的欄位容錯比對邏輯 `findIdx()`）。`hotzones.ts` 的 `getSnapshot()` 併行抓取這份資料，把原本寫死 `netBuyShares: null, netBuyValue: null` 的上櫃報價改成真的填值，並把 `snapshot.institutional` 從只有 TWSE 改成 TWSE＋TPEx 合併 Map。

## ⚠️ 最重要的事：這支端點沒有實際打過

沙盒環境連不到 `tpex.org.tw`（網路白名單不含這個網域），所以 `fetchTpexInstitutional()` 用的網址跟回傳欄位解析，是根據網路上找到的一份 2018 年開發者部落格範例程式碼（用的是 `3itrade_hedge_result.php` 這支端點）＋現有 `stk_quote_result.php`（同一個網站系統、2024 年 10 月改版後）的回傳形狀 `{date, tables:[{fields,data}]}` **推斷**出來的，兩者不是同一個端點，欄位名稱、日期格式（用民國年 `115/09/09`）都只驗證過解析邏輯本身（用模擬資料），沒有驗證過真實回應長什麼樣子。

**本機部署後第一件事**：
```bash
# 直接測這支函式，看有沒有抓到資料
npx tsx -e "
import { fetchTpexInstitutional } from './server/data/providers/tpex.ts';
fetchTpexInstitutional('2026-09-09').then(m => console.log('筆數:', m.size, [...m.entries()].slice(0,3)));
"
```
如果印出 `筆數: 0` 或直接噴錯，代表網址或欄位名稱猜錯了，需要打開瀏覽器實際看一次 `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=AL&t=D&d=115/09/09` 回傳的真實 JSON 結構，照著調整 `tpex.ts` 裡的欄位關鍵字清單。

## 失敗安全設計

就算端點猜錯，也不會讓現有功能壞掉：
- `hotzones.ts` 呼叫時包了 `.catch(() => null)`，抓不到資料就回傳 `null`，上櫃股的 `netBuyValue` 會維持原本的 `null`（回到修改前的行為）
- `institutionalCoverage` 文案會自動反映實際涵蓋狀態（`上市＋上櫃` / `僅上市` / `僅上櫃` / `法人資料暫時無法取得`），不會謊報涵蓋範圍

## 驗證

- `tsc --noEmit` 0 錯誤、`vitest run` 19/19 全過
- 用模擬 JSON（仿造預期形狀）驗證過欄位解析邏輯本身正確：能抓到 `foreign`/`trust`/`dealer`/`total`、能過濾非法代號、ROC 日期換算正確（2026 → 115）
- **沒有驗證過真實 TPEx API 回應**——這是本次改動裡風險最高的一項，跟前面幾次改動（SQLite 遷移、熱度均值）不同，那些都用沙盒裡真實存在的資料驗證過，這次做不到
