# 貢獻與 AI 修改規則

## 修改前

1. 先讀 `README.md`、`docs/PRODUCT_SPEC.md`、`docs/ARCHITECTURE.md`。
2. 確認修改屬於 UI、事實層、研判層、資料管線或通知層。
3. 不要只看網站網址推測原始架構；以 repository 為準。

## AI 修改原則

- 不可把 mock data 當真實資料。
- 不可讓 LLM 自行計算價位、發明形態或推翻事實層。
- 不可把條件式情境改成無條件買賣指令。
- 不可刪除已確認／推測／等待三區分。
- 不可把 API key、LINE token、資料庫密碼提交進 Git。
- 目前 `server/` 為 template placeholder；未明確規劃前不要改動。
- UI 修改必須檢查 390px 與桌面版。
- 新增策略必須有版本、條件、失效位與測試 fixture。

## 修改後必須執行

```bash
pnpm check
pnpm build
```

若修改 UI，也必須確認：

- 沒有水平捲軸
- 鍵盤 focus 可見
- 不只用紅綠色傳達資訊
- `prefers-reduced-motion` 仍有效
- Loading、Empty、Error 狀態沒有被破壞

## Git 協作

- 一個功能一個 branch。
- commit message 使用明確動詞，例如 `feat: add daily price facts fixture`。
- 不要 force push `main`。
- 重要策略變更要附測試與文件更新。
