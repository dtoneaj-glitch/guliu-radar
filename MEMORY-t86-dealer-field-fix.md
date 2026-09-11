---
name: t86-dealer-field-fix
description: T86 API「自營商買賣超股數」欄位索引誤判修復（index 7 vs index 11）
metadata:
  type: project
---

## 問題
Dashboard 自營資料顯示 0 億（破線），原因是 `findIdx(["自營商買賣超股數"])` 使用了 `findIndex` + `includes`，誤命中 index 7（`外資自營商買賣超股數`），實際應該用 index 11（`自營商買賣超股數`）。

## 修復
修改 `server/data/providers/twse.ts` 的 `findIdx` 函數，改為先精確匹配（`indexOf`），再回退到包含匹配（`findIndex`）。

```typescript
const findIdx = (keywords: string[]): number => {
  // 先嘗試精確匹配，再嘗試包含匹配（避免「外資自營商」誤命中「自營商」）
  for (const kw of keywords) {
    const exact = fields.indexOf(kw);
    if (exact >= 0) return exact;
  }
  for (const kw of keywords) {
    const idx = fields.findIndex((f) => f.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
};
const dealerIdx = findIdx(["自營商買賣超股數", "自營商買賣超股數(自行買賣)"]);
```

## 驗證
- 修復前：`dealerFlow: 0`，`topBuys.dealer` 全為 0
- 修復後：`dealerFlow: 100`（09-07 資料），`topBuys.dealer` 顯示聯發科 21 億、台積電 18 億

## 備註
- T86 欄位結構：index 7 = 外資自營商買賣超股數，index 11 = 自營商買賣超股數（總計）
- 外資自營商（index 7）通常為 0，本國自營商（index 11）才有買賣超數據
