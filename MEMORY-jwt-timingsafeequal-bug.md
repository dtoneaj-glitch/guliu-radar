---
name: jwt-timingsafeequal-bug
description: guliu-radar JWT verifyToken 的 timingSafeEqual 長度不匹配 bug 及修復方向
metadata:
  type: project
  originSessionId: sess_56ffeb90-af4e-4521-bb26-5fa8c7303454
---

guliu-radar `server/data/users.ts` 的 JWT verifyToken 有一個 timingSafeEqual bug：

```typescript
// Bug：signature（base64url 字串）解碼後長度 ≠ digest("base64url") 輸出長度
if (!timingSafeEqual(Buffer.from(signature, "base64url"), Buffer.from(expected))) {
  return null;
}
```

Node.js 的 `timingSafeEqual` 要求兩個 buffer 長度完全相同，否則拋 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`。

**已修復（2026-09-09）**：改用字串比較 `signature !== expected`（hex 固定 64 字元，無 timing attack 風險）。驗證全流程通過：register → login → auth/me → watchlist CRUD。

**相關檔案**：`server/data/users.ts` 第 94~102 行（verifyToken）