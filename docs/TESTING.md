# 股流 Radar｜測試計畫

## 目前前端

```bash
pnpm check
pnpm build
```

UI 驗證至少檢查：

- 桌面版首頁
- 390px 手機首頁
- 熱區詳情
- 掃描列表
- 研判頁
- 自選空狀態與有資料狀態
- 搜尋抽屜

## PA Facts Layer 必測案例

新增事實層後，建立固定 fixture：

- `uptrend-hh-hl`
- `downtrend-lh-ll`
- `range-double-top`
- `breakout-pullback`
- `false-breakout`
- `insufficient-data`

每個 fixture 應驗證：

- swing pivot
- HH/HL/LH/LL
- 趨勢與信心
- 支撐、壓力、失效位區域
- Pin Bar／吞沒／雙頂雙底
- confirmed／unconfirmed 狀態
- 量能比率

核心要求：同一份輸入必須產生完全相同的輸出。

## 策略與通知

- 條件未滿足不可產生觸發訊號。
- 同一股票、同一策略、同一交易日不可重複推播。
- 推播必須保留 factsVersion、strategyVersion、sourceDataDate。
- 資料延遲或缺漏時不可產生正常訊號。
