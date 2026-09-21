/**
 * 自選股 SQLite 儲存層驗證（不依賴正式資料庫，使用 in-memory SQLite）
 * 執行：node_modules\.bin\tsx scripts\verify-watchlist-sqlite.ts
 */
import Database from "better-sqlite3";
import { createWatchlistStore, type WatchlistItem } from "../server/data/watchlist-store";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${detail}`); }
}

const mem = new Database(":memory:");
const store = createWatchlistStore(mem);

console.log("=== 1. 寫入後讀回（含順序、群組、成本價）===");
const items: WatchlistItem[] = [
  { symbol: "2330", groups: ["main"] },
  { symbol: "2454", groups: ["ride", "charge"], costPrice: 1234.5 },
  { symbol: "2317", groups: [] },
];
store.replace("userA", items);
const a = store.get("userA");
check("筆數 3", a.length === 3, JSON.stringify(a));
check("順序保留", a.map((x) => x.symbol).join(",") === "2330,2454,2317", a.map((x) => x.symbol).join(","));
check("群組保留", JSON.stringify(a[1].groups) === JSON.stringify(["ride", "charge"]));
check("成本價保留", a[1].costPrice === 1234.5);
check("未設成本價為 undefined", a[0].costPrice === undefined);

console.log("=== 2. 使用者隔離 ===");
store.replace("userB", [{ symbol: "2412", groups: ["main"] }]);
check("B 只有 1 筆", store.get("userB").length === 1);
check("A 不受影響（仍 3 筆）", store.get("userA").length === 3);
check("A/B 代號不重疊", store.get("userA").every((x) => x.symbol !== "2412"));

console.log("=== 3. 覆蓋（刪除會真的消失、順序重排）===");
store.replace("userA", [{ symbol: "2454", groups: ["ride"] }]);
const a2 = store.get("userA");
check("刪除後只剩 1 筆", a2.length === 1, JSON.stringify(a2));
check("保留的是 2454", a2[0]?.symbol === "2454");
check("成本價未帶 → 清空為 undefined", a2[0]?.costPrice === undefined);

console.log("=== 4. 同代號更新（upsert，不重複）===");
store.replace("userA", [{ symbol: "2330", groups: ["main"], costPrice: 100 }]);
store.replace("userA", [{ symbol: "2330", groups: ["main", "still"], costPrice: 200 }]);
const a3 = store.get("userA");
check("仍只有 1 筆", a3.length === 1, JSON.stringify(a3));
check("成本價更新為 200", a3[0]?.costPrice === 200);
check("群組更新", JSON.stringify(a3[0]?.groups) === JSON.stringify(["main", "still"]));

console.log("=== 5. 原子性（覆蓋為空即清空）===");
store.replace("userA", []);
check("清空後 0 筆", store.get("userA").length === 0);
check("count=0", store.count("userA") === 0);
check("hasAny=false", store.hasAny("userA") === false);

console.log("=== 6. 大量寫入（200 檔上限情境）===");
const many: WatchlistItem[] = Array.from({ length: 200 }, (_, i) => ({
  symbol: String(1101 + i),
  groups: ["main"],
}));
store.replace("userC", many);
check("200 檔寫入成功", store.count("userC") === 200, String(store.count("userC")));
check("最後一筆順序正確", store.get("userC")[199]?.symbol === String(1101 + 199));

console.log("=== 7. app_meta（遷移旗標）===");
check("初始 meta 為 null", store.getMeta("watchlist_migrated_from_json_v1") === null);
store.setMeta("watchlist_migrated_from_json_v1", "2026-09-21T00:00:00.000Z");
check("設定後可讀回", store.getMeta("watchlist_migrated_from_json_v1") === "2026-09-21T00:00:00.000Z");
store.setMeta("watchlist_migrated_from_json_v1", "updated");
check("再次設定會覆蓋", store.getMeta("watchlist_migrated_from_json_v1") === "updated");

mem.close();
console.log(`\n結果：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
