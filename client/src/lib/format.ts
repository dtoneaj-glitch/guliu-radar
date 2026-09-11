/** 顯示格式化（台股慣例：紅漲綠跌由樣式層處理，這裡只管數字與文字） */

export function fmtYi(valueYi: number): string {
  const sign = valueYi > 0 ? "+" : valueYi < 0 ? "−" : "";
  const abs = Math.abs(valueYi);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 1;
  return `${sign}${abs.toFixed(digits)} 億`;
}

export function fmtPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function fmtPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return price.toLocaleString("zh-Hant-TW", { maximumFractionDigits: 2 });
}

export function fmtSignedPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return `${price > 0 ? "+" : price < 0 ? "−" : ""}${fmtPrice(Math.abs(price))}`;
}

/** ISO → "2026/09/04" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replaceAll("-", "/");
}

/** ISO → "09/04 18:20"（台北時間） */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 泡泡圖短標籤：去「業」尾並截斷 */
export function shortZoneName(name: string): string {
  const trimmed = name.replace(/業$/, "").replace(/\*+$/, "");
  return trimmed.length > 4 ? trimmed.slice(0, 4) : trimmed;
}
