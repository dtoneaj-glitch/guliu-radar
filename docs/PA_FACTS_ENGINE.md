# 股流 Radar｜PA Facts Layer 與 pa_default v1

## 目的

本模組把 OHLCV K 線轉成可重現的價格行為事實，再由 `pa_default` 將事實整理成六段式、條件式研判。引擎不保證獲利、不預測反轉，也不直接產生下單指令。

## 四時間框架契約

| 時間框架 | 代號 | 用途 | Yahoo 備援參數 |
|---|---|---|---|
| 週線 | `1w` | 確認大方向 | `range=5y&interval=1wk` |
| 日線 | `1d` | 判斷主要結構與關鍵價位 | `range=2y&interval=1d` |
| 60 分 | `60m` | 尋找回踩與進場區 | `range=2mo&interval=60m` |
| 15 分 | `15m` | 確認觸發 K | `range=60d&interval=15m` |

資料不足時使用 `insufficient`；尚未取得資料時使用 `unavailable`，不能以空資料代替有效事實。

## PAFacts 輸出

`buildPAFacts(candles, timeframe)` 固定輸出版本、資料狀態、結構、關鍵價位、形態、價格與量能、進場區及失效位。結構與價位沿用既有純函式低階規則，透過版本化契約隔離未來替換演算法的影響。

**形態偵測範圍**（`shared/levels.ts`）：單根 K 棒（Pin Bar、吞沒）＋擺盪型態（雙頂/雙底、頭肩頂/頭肩底，以頸線突破/跌破判斷已確認/未確認）＋量價背離（頂背離/底背離）。進場區寬度與失效位緩衝採 ATR(14) 為主，資料不足時退回支撐區寬度百分比，不讓功能整組失效。

`buildMultiTimeframeFacts(symbol, candlesByTimeframe)` 固定回傳四個時間框架欄位，並計算 `aligned`、`mixed` 或 `insufficient` 的多週期一致性狀態，另外附上 **加權一致性分數**（-100～+100，週線 40%／日線 30%／60分 20%／15分 10%，只在有資料的時框間正規化）。

## pa_default 輸出

`evaluatePaDefault` 固定輸出六段：

1. 市場結構
2. 關鍵價位
3. 價格行為
4. 交易情境
5. 風險管理
6. 確認／推測／等待證據

每次輸出包含 `strategyId=pa_default`、版本、狀態、證據分類與風險聲明。

## API

```text
GET /api/stocks/:symbol/pa-analysis
```

此路由會嘗試抓取週／日／60 分／15 分資料；單一時間框架失敗不會偽造結果，而會在回應中保留 `unavailable` 或 `insufficient` 狀態。

## 驗證

目前測試涵蓋：上升結構、資料不足、四時框架固定契約、部分時框不可用、六段式輸出、確認／推測／等待分離與免責聲明、Pin Bar、ATR 計算、雙頂/雙底、頭肩頂/頭肩底、量價背離、以上型態偵測的決定性（同輸入同輸出）。
