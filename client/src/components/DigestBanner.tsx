import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { fetchStrategyScan, fetchEntryWatch } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import {
  maybeNotifyDigest,
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from "@/lib/notify";

const STRATEGY_ID = "pa_default";
const STRATEGY_NAME = "聲納";

/**
 * 每日回訪摘要：掃描自選股在預設策略下今日是否觸發、以及誰的收盤價已進或接近 PA 進場區，
 * 並提供「開啟每日通知」開關——這是輕量版回訪機制，
 * 目的是解決「使用者關掉分頁後沒有理由回來」的問題。
 */
export default function DigestBanner({ symbols, asOf, onOpenScan }: { symbols: string[]; asOf: string; onOpenScan: () => void }) {
  const [permission, setPermission] = useState(notificationPermission());
  const hasSymbols = symbols.length > 0;

  const scan = useAsync(async () => {
    if (!hasSymbols) return { rows: [] as { status: string }[] };
    const r = await fetchStrategyScan(symbols, STRATEGY_ID);
    return r;
  }, [symbols.join(","), hasSymbols]);

  const entryWatch = useAsync(async () => {
    if (!hasSymbols) return { items: [] as { status: string }[] };
    const r = await fetchEntryWatch(symbols);
    return r;
  }, [symbols.join(","), hasSymbols]);

  const triggered = (scan.data?.rows ?? []).filter((r) => r.status === "triggered").length;
  const nearEntry = (entryWatch.data?.items ?? []).filter((i) => i.status === "in-zone" || i.status === "approaching").length;

  useEffect(() => {
    if (permission === "granted" && asOf) maybeNotifyDigest(asOf, triggered, STRATEGY_NAME);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, asOf, triggered]);

  if (!notificationsSupported() && !hasSymbols) return null;

  const enableNotify = async () => {
    const p = await requestNotificationPermission();
    setPermission(p);
  };

  return (
    <section className="digest-banner" aria-label="每日回訪摘要">
      <div className="digest-main">
        <span className="digest-icon">{triggered > 0 || nearEntry > 0 ? <BellRing size={16} /> : <Bell size={16} />}</span>
        {!hasSymbols ? (
          <p>先把想追蹤的股票加進自選，這裡就會每天幫你摘要「聲納」策略是否觸發、以及誰接近進場區。</p>
        ) : scan.loading || entryWatch.loading ? (
          <p>正在檢查自選股今日訊號…</p>
        ) : (
          <p>
            自選 {symbols.length} 檔中，
            {triggered > 0 && (
              <>
                <b className="up">{triggered} 檔</b>今日觸發「{STRATEGY_NAME}」條件
              </>
            )}
            {triggered > 0 && nearEntry > 0 && "、"}
            {nearEntry > 0 && (
              <>
                <b className="up">{nearEntry} 檔</b>收盤價已進或接近進場區，明天可以有方向地看
              </>
            )}
            {triggered === 0 && nearEntry === 0 && "今日暫無訊號，明天盤後再回來看"}
            。
          </p>
        )}
      </div>
      <div className="digest-actions">
        {hasSymbols && (triggered > 0 || nearEntry > 0) && (
          <button className="text-button" onClick={onOpenScan}>
            查看觸發清單
          </button>
        )}
        {notificationsSupported() && (
          <button
            className={`icon-button subtle ${permission === "granted" ? "digest-bell-on" : ""}`}
            onClick={enableNotify}
            disabled={permission === "granted" || permission === "denied"}
            aria-label={permission === "granted" ? "已開啟每日通知" : "開啟每日通知"}
            title={
              permission === "granted"
                ? "已開啟每日通知"
                : permission === "denied"
                  ? "瀏覽器已封鎖通知權限，請於瀏覽器設定手動開啟"
                  : "開啟每日通知"
            }
          >
            {permission === "denied" ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
        )}
      </div>
    </section>
  );
}
