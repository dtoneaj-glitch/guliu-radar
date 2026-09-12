---
name: external-api-verification
description: 2026-09-12 用web_search/web_fetch交叉查證三個外部資料端點的結果，含新發現的bot偵測與「僅最新交易日」限制
metadata:
  type: project
---

## 背景

`docs/TODO.md`／`README-AI-HANDOFF.md` 列出幾個「未經真實 API 驗證」的資料源。沙盒的 `bash_tool` 連不到 TWSE/TPEx/TAIFEX，但 `web_search`／`web_fetch` 走不同網路管道，這次用這兩個工具交叉查證真實社群案例（其他人維護的開源專案、官方說明頁），不是直接呼叫 API，但能顯著提高信心或抓出新問題。

## 查證結果

### 1. `fetchTpexInstitutional()`（上櫃法人）—— 端點與欄位邏輯確認正確，但發現 bot 偵測風險

- **端點網址正確**：真實維護中的開源專案 `voidful/tw-institutional-stocker`（2026-02 仍在跑，GitHub Actions 每日自動執行）就是在抓 `3itrade_hedge_result.php` 這支端點
- **欄位排除邏輯正確**：TPEx 官方說明頁明確寫「外資自營商買賣金額已計入自營商買賣金額，故不納入三大法人買賣金額之合計數計算」——跟我們程式碼排除「外資自營商」欄位的邏輯一致，不是憑空猜的
- **⚠️ 新發現的風險**：`voidful/tw-institutional-stocker` 是用 **Playwright**（真實瀏覽器）去抓，不是單純 HTTP fetch。我自己用 `web_fetch` 直接打這支端點，**被 TPEx 的 bot 偵測擋下來**（`Site blocked the request (bot detection)`）。這代表 `tpex.ts` 目前用純 `fetch()` 的寫法，部署到正式環境後也可能被擋——這比「欄位名稱猜錯」更根本的風險，欄位名稱錯了頂多資料是 null，bot 偵測擋掉是整支函式直接失敗。**部署後第一件事除了看欄位對不對，還要看是不是被擋（例如回應是不是一個驗證頁面而不是 JSON）**

### 2. `fetchRetailFuturesPosition()`（散戶留倉，`DailyMarketReportFut`）—— 端點與契約代碼確認正確，但發現「無歷史查詢」的限制

- **端點名稱、契約代碼（MTX/TMF）確認正確**：真實可執行的開源工具 `edwardhu/future_prediction`（README 明確示範 `python main.py -c MTX` / `-c TMF`）用的端點清單，包含 `DailyMarketReportFut`、`MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate`，跟我們程式碼裡的端點名稱一字不差
- **⚠️ 新發現、影響更大的限制**：另一個實測過 openapi.taifex.com.tw **全部 135 個端點**的維護者（`twjackysu/TWSEMCPServer` release note）明確指出：**這個 OpenAPI 完全沒有歷史查詢功能，每一個端點都只回傳「最新一個交易日」**，不管你傳什麼 `date` 參數。
  - 這代表 `fetchRetailFuturesPosition(contract, date)` 的 `date` 參數，如果傳的不是「今天」，API 可能根本不理會，永遠回傳最新一天的資料
  - **更嚴重的是牽連到既有的 `ChipCard.tsx`「本週」切換功能**——這個功能傳 `isoWeekStart(today)`（本週一）這個過去的日期進去 `fetchChipCard()`，如果 API 真的忽略歷史日期，「本週累計」這個標籤顯示的其實就是「今日」的same資料，是誤導性的展示。已經在 `ChipCard.tsx` 加了程式碼註解警示，**部署後第一件事是切換「今日」跟「本週」，比較數字是否真的不同**，不同才代表 date 參數有效
  - 這個限制不影響「散戶留倉」「籌碼分歧」這兩個新功能本身（它們只關心「今天」），但影響既有的週切換功能，是這次意外挖到的既有問題

### 3. VIX（台指選擇權波動率指數）—— 確認真實存在但很可能沒有免費 API

- 確認「臺指選擇權波動率指數（TAIWAN VIX）」是 TAIFEX 官方真實指數，採用 CBOE 授權的編製公式，以台指選擇權（TXO）價格為基礎，衡量加權指數未來 30 天預期波動——跟 `shared/vix.ts` 設計時假設的性質相符
- **但看起來免費 API 路線走不通**：TAIFEX 透過付費的「期貨智慧資訊商店」（edatashop.taifex.com.tw）販售這個指數的歷史資料；同時，實測過 openapi.taifex.com.tw 全部 135 個端點的第三方專案，工具清單裡完全沒有波動率指數相關端點
- **結論**：要嘛付費訂閱 TAIFEX 資料商店，要嘛爬第三方網站（例如玩股網 wantgoo.com 有即時報價頁面，但屬於非官方、不穩定的來源）。`shared/vix.ts` 的分類邏輯已經寫好且測試過，卡的是資料源這一關，不是邏輯

## 沒有改變的結論

三項原本列在「未驗證」清單的項目，**都不能升級為「已驗證」**——這次查證屬於「找到強力的間接證據」，不是「真的打過一次 API 拿到真實回應」。真正的驗證仍然要等部署到有網路的環境後，實際呼叫確認。

## 這次查證帶來的實際變更

- `client/src/components/ChipCard.tsx`：加了程式碼註解，警示「本週」功能可能是誤導性的（openapi 可能忽略歷史日期）
- 本檔案：記錄查證過程與結論，供部署後對照驗證

## 後續更新（2026-09-12，同一天）：「本週」功能改用自己的資料庫，不再依賴 TAIFEX 歷史查詢

使用者提醒：既然已經有 SQLite 存檔機制（`archive.ts`），本週彙總可以自己存、自己查，不需要依賴 TAIFEX API 根本不存在的歷史查詢功能。照這個方向動手做了：

| 檔案 | 變更 |
|---|---|
| `server/data/db.ts` | 新增 `archive_chipcard` 資料表（date 為主鍵，存完整 JSON + 拆出三大法人期貨未平倉淨額／P&C Ratio 方便查詢） |
| `server/data/chipcard-archive.ts`（新） | `saveChipCardSnapshot()`／`loadChipCardDate()`／`getChipCardWeeklyAggregate()`，跟 `archive.ts` 同樣的模式（JSON 完整存＋拆欄位加速查詢、失敗靜默不影響主流程） |
| `server/api.ts` | `/api/chipcard` 每次成功抓到資料就順便存一筆快照（upsert，同一天重複存不會壞事）；新增 `/api/chipcard/weekly?weekStart=` 端點，查自己資料庫彙總 |
| `client/src/lib/api.ts` | 新增 `fetchChipCardWeekly()` |
| `client/src/components/ChipCard.tsx` | 「本週」模式改叫 `fetchChipCardWeekly()`，彙總三大法人期貨未平倉淨額；結論卡/選擇權OI/P&C儀表/散戶留倉維持只看「今天」（這些是即時狀態指標，加總沒有意義，只有期貨未平倉淨額適合累加）；本週尚無存檔資料時清楚告知「這個功能是新的，需要每天實際造訪過這頁才會累積資料」，不是顯示空白或錯誤 |

**這個功能有一個先天限制，跟資料庫存檔本身無關**：既然是從「今天開始存」，剛上線的頭幾天「本週」彙總的資料筆數會不足（例如週三才上線，本週只有 3 天的存檔），要等實際運作一段時間後才會有完整一週的資料可以看。已經在 UI 上如實告知筆數（「本週累計（N 個交易日）」），不是假裝有完整一週。

驗證：`tsc --noEmit` 0 錯誤、`vitest run` 45/45 全過。跟其他這類功能一樣，沒有機會在沙盒裡實測（連不到網路），部署後才能真的驗證資料存不存得進去、查得不查得出來。

## 再次自我審查發現的兩個問題（同一天，週彙總功能上線後馬上抓到）

1. **「本週」+「按契約」組合顯示錯資料**：週彙總只做了「按法人」彙總，但「按契約」按鈕沒鎖住，選這個組合時標題寫「本週累計」、內容卻悄悄還是「今天」的資料。修法：選「本週」時自動鎖定「按法人」，「按契約」按鈕在本週模式下停用（灰階+提示文字），避免顯示不一致的資料。

2. **彙總了錯的欄位（存量 vs 流量的概念錯誤）**：一開始把 `futuresNetOI`（未平倉淨額，某天收盤當下的部位「存量」）加總了 5 天，這樣做沒有意義——如果外資這幾天都維持同一個空單部位不動，加總會變成 5 倍大，看起來像瘋狂加碼，其實只是同一個部位算了 5 次。正確做法是加總 `futuresNetTrade`（今日買賣超淨額，真正的「流量」，可以累加代表「這週淨買了/賣了多少」），`futuresNetOI` 只取最新一天的值當「目前部位」參考，不做加總。已修正 `db.ts`（新增 net_trade 欄位，含防禦性 `ALTER TABLE` 遷移舊 schema）、`chipcard-archive.ts`、`ChipCard.tsx` 三處。

這兩個問題都是功能寫完後，主動再檢查一遍「有沒有邏輯上不一致或概念錯誤的地方」才抓到的，不是使用者發現才修——這次刻意練習「做完不代表結束，還要自己抓漏」。
