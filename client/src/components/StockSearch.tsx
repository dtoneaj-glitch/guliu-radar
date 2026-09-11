import { useState } from "react";
import { Check, Search, Star } from "lucide-react";
import { fetchSearch } from "@/lib/api";
import { fmtSignedPrice, fmtPct, fmtPrice } from "@/lib/format";
import { useAsync, useDebounced } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

/**
 * 全市場股票搜尋（共用元件）
 * - inline：header 常駐輸入框，聚焦展開下拉
 * - block：整塊常開列表（抽屜／自選頁「＋新增」用）
 * 每列：代號＋名稱＋產業＋收盤＋漲跌％，右側一鍵加入／移除自選。
 */

export default function StockSearch({ mode = "inline", onPick, autoFocus = false }: { mode?: "inline" | "block"; onPick?: (symbol: string) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const debounced = useDebounced(query, 220);
  const search = useAsync(() => fetchSearch(debounced), [debounced]);
  const wl = useWatchlist();
  const results = search.data?.results ?? [];
  const open = mode === "block" ? true : focused;

  const pick = (symbol: string) => {
    onPick?.(symbol);
    setQuery("");
    setFocused(false);
  };

  return (
    <div
      className={`stock-search ss-${mode} ${open ? "open" : ""}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      <div className="ss-field">
        <Search size={16} />
        <input
          value={query}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFocused(false);
            if (e.key === "Enter" && results.length > 0 && onPick) pick(results[0].symbol);
          }}
          placeholder="搜尋股票：代號或名稱（全市場）"
          aria-label="搜尋股票"
        />
      </div>
      {open && (
        <div className="ss-drop">
          {search.loading ? (
            <div className="ss-state">搜尋中…</div>
          ) : search.error ? (
            <div className="ss-state">搜尋失敗：{search.error}</div>
          ) : results.length === 0 ? (
            <div className="ss-state">{query ? "沒有找到，確認代號或名稱後再試" : "輸入代號或名稱開始搜尋"}</div>
          ) : (
            results.map((s) => {
              const added = wl.has(s.symbol);
              return (
                <div className="ss-row" key={s.symbol}>
                  <button
                    type="button"
                    className="ss-pick"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(s.symbol)}
                    aria-label={`查看 ${s.symbol} ${s.name}`}
                  >
                    <span className="search-symbol">{s.symbol}</span>
                    <span className="ss-name"><b>{s.name}</b><small>{s.industry ?? ""}</small></span>
                    <span className="ss-quote">
                      <b className={(s.changePct ?? 0) >= 0 ? "up" : "down"}>{fmtPrice(s.close)}</b>
                      <small>{fmtSignedPrice(s.changeAmt)} · {fmtPct(s.changePct)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`ss-add ${added ? "added" : ""}`}
                    title={added ? "移除自選" : "加入自選"}
                    aria-label={added ? `移除 ${s.symbol} 自選` : `加入 ${s.symbol} 自選`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => wl.toggle(s.symbol)}
                  >
                    {added ? <Check size={14} /> : <Star size={14} />}
                  </button>
                </div>
              );
            })
          )}
          {mode === "block" && <div className="ss-state hint">點列進研判頁；按右側 ☆ 直接加入／移除自選</div>}
        </div>
      )}
    </div>
  );
}
