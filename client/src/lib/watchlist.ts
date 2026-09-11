import { useCallback, useSyncExternalStore } from "react";

/**
 * 自選股 v2：代號＋多重群組標籤（Local Storage，裝置端）
 * 預設群組（2026-09-10 更名：「主流」「乘流」原本的水流隱喻不夠白話，
 * 改成直接講意思；id 不變，只換 name，舊資料不用遷移）：
 *  - 觀察股（id: main）：核心關注，每天都要看
 *  - 蓄勢：準備進場，等條件成熟
 *  - 水池（id: ride）：已進場持有中（庫存股）——用「水池」而非「庫存股」
 *    三個字，是因為要跟其他群組一樣維持水流意象，但選一個「裝著、不是流動」
 *    的水池意象，比原本「乘流」（正在衝浪的動感）更貼近「已經持有、放著」的語意。
 *  - 靜流：暫不關注（UI 預設收合）
 * 可自訂新增群組；一檔股票可貼多個標籤；v1 純代號清單自動遷移為「觀察股」。
 *
 * 成本價（2026-09-10 補上）：「水池」（庫存股）不一定是賺錢的部位——使用者可能捨不得
 * 停損才放著——所以成本價的用途是「如實算出浮盈或浮虧」，不是只給賺錢時的漂亮數字。
 * `costPrice` 是選填欄位，跟分類無關（沒標水池的股票理論上也可以填，只是 UI 目前只在
 * 水池分類底下顯示編輯入口）；沒填就不顯示損益，不會拿 0 或 close 去假裝一個成本。
 */

export interface WatchGroup {
  id: string;
  name: string;
}

export interface WatchItem {
  symbol: string;
  groups: string[];
  /** 買入成本價（選填）；用來算浮盈/浮虧，沒填就不算 */
  costPrice?: number;
}

export const PRESET_GROUPS: WatchGroup[] = [
  { id: "main", name: "觀察股" },
  { id: "charge", name: "蓄勢" },
  { id: "ride", name: "水池" },
  { id: "still", name: "靜流" },
];

const PRESET_IDS = new Set(PRESET_GROUPS.map((g) => g.id));
const KEY = "gr.watchlist.v2";
const LEGACY_KEY = "gr.watchlist.v1";

interface Store {
  items: WatchItem[];
  groups: WatchGroup[];
}

const EMPTY: Store = { items: [], groups: PRESET_GROUPS };
let cache: Store | null = null;
const listeners = new Set<() => void>();

function load(): Store {
  if (cache) return cache;
  let items: WatchItem[] = [];
  let custom: WatchGroup[] = [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { items?: unknown; groups?: unknown };
      if (Array.isArray(parsed.items)) {
        items = (parsed.items as unknown[])
          .filter((x): x is WatchItem => {
            const it = x as WatchItem;
            return !!it && typeof it.symbol === "string" && Array.isArray(it.groups);
          })
          .map((it) => ({
            symbol: it.symbol,
            groups: it.groups.filter((g) => typeof g === "string"),
            ...(typeof it.costPrice === "number" && Number.isFinite(it.costPrice) ? { costPrice: it.costPrice } : {}),
          }));
      }
      if (Array.isArray(parsed.groups)) {
        custom = (parsed.groups as unknown[]).filter(
          (g): g is WatchGroup => {
            const grp = g as WatchGroup;
            return !!grp && typeof grp.id === "string" && typeof grp.name === "string" && !PRESET_IDS.has(grp.id);
          },
        );
      }
    } else {
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const arr = JSON.parse(legacy) as unknown;
        if (Array.isArray(arr)) {
          items = (arr as unknown[]).filter((s): s is string => typeof s === "string").map((s) => ({ symbol: s, groups: ["main"] }));
        }
      }
    }
  } catch {
    /* 壞資料視為空清單 */
  }
  cache = { items, groups: [...PRESET_GROUPS, ...custom] };
  return cache;
}

const AUTH_TOKEN_KEY = "gr.auth.token";
const AUTH_USER_KEY = "gr.auth.user";

/**
 * 背景同步到伺服器（fire-and-forget，不擋 UI，失敗不影響本地體驗）。
 *
 * 為什麼需要：伺服器端排程（例如收盤後自動推播）看不到瀏覽器的 localStorage，
 * 必須有一份「使用者現在真正關注哪些股票」的伺服器端快照才能運作。
 * `client/src/lib/auth.tsx` 的 `updateWatchlist()` 走同一個 API，但那個函式
 * 目前只在 AuthContext 內定義、沒有任何地方呼叫，等於伺服器端資料從未被寫入過。
 * 這裡直接讀 localStorage 的 token/user（跟 NotificationSettings.tsx 同慣例），
 * 不依賴 React Context，讓純函式模組也能做到。
 */
function syncToServer(items: WatchItem[]): void {
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const userRaw = window.localStorage.getItem(AUTH_USER_KEY);
    if (!token || !userRaw) return;
    const user = JSON.parse(userRaw) as { id?: string };
    if (!user?.id) return;
    fetch(`/api/users/${user.id}/watchlist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ watchlist: items.map((i) => ({ symbol: i.symbol, groups: i.groups, costPrice: i.costPrice ?? null })) }),
    }).catch(() => {
      /* 背景同步失敗不影響本地操作，下次變動時會再試一次 */
    });
  } catch {
    /* localStorage 不可用（如隱私模式）時直接放棄同步 */
  }
}

function persist(next: Store) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ items: next.items, groups: next.groups.filter((g) => !PRESET_IDS.has(g.id)) }));
  } catch {
    /* 隱私模式等場景允許失敗 */
  }
  syncToServer(next.items);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWatchlist() {
  const store = useSyncExternalStore(subscribe, load, () => EMPTY);

  const symbols = store.items.map((i) => i.symbol);

  const has = useCallback((symbol: string) => store.items.some((i) => i.symbol === symbol), [store]);

  const toggle = useCallback(
    (symbol: string) => {
      const cur = load();
      if (cur.items.some((i) => i.symbol === symbol)) {
        persist({ ...cur, items: cur.items.filter((i) => i.symbol !== symbol) });
      } else {
        if (cur.items.length >= 200) return; // 裝置端名單上限
        persist({ ...cur, items: [...cur.items, { symbol, groups: ["main"] }] });
      }
    },
    [],
  );

  const remove = useCallback((symbol: string) => {
    persist({ ...load(), items: load().items.filter((i) => i.symbol !== symbol) });
  }, []);

  const clear = useCallback(() => {
    persist({ ...load(), items: [] });
  }, []);

  const toggleGroup = useCallback((symbol: string, groupId: string) => {
    const cur = load();
    const items = cur.items.map((i) => {
      if (i.symbol !== symbol) return i;
      const groups = i.groups.includes(groupId) ? i.groups.filter((g) => g !== groupId) : [...i.groups, groupId];
      return { ...i, groups };
    });
    persist({ ...cur, items });
  }, []);

  /** 設定／清除買入成本價。price 傳 null 或非正數會清掉這個欄位，不會存進一個無意義的成本。 */
  const setCostPrice = useCallback((symbol: string, price: number | null) => {
    const cur = load();
    const items = cur.items.map((i) => {
      if (i.symbol !== symbol) return i;
      if (price == null || !Number.isFinite(price) || price <= 0) {
        const { costPrice: _drop, ...rest } = i;
        return rest;
      }
      return { ...i, costPrice: price };
    });
    persist({ ...cur, items });
  }, []);

  const addGroup = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 8);
    const cur = load();
    if (!trimmed || cur.groups.some((g) => g.name === trimmed)) return;
    const id = `g-${Date.now().toString(36)}`;
    persist({ ...cur, groups: [...cur.groups, { id, name: trimmed }] });
    return id;
  }, []);

  return { items: store.items, groups: store.groups, symbols, has, toggle, remove, clear, toggleGroup, addGroup, setCostPrice };
}
