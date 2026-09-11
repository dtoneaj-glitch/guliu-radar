/** 極簡 TTL 記憶體快取（原型用；正式資料庫在 B0 積木導入） */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/** 帶逾時的 fetch（免費源不可信任，一律設上限） */
export async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (guliu-radar prototype)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** 數字字串轉數值：去千分位逗號、處理 "--" 與空白 */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.replace(/,/g, "").trim();
  if (s === "" || s === "--" || s === "X" || s === "N/A") return NaN;
  return Number(s);
}
