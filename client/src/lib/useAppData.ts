import { useCallback, useEffect, useState } from "react";
import type { HotzonesResponse } from "@shared/types";
import { fetchHotzones } from "./api";
import { DEMO_HOTZONES } from "./mock";

export type AppDataPhase = "loading" | "ready" | "fallback" | "error";

export interface AppData {
  phase: AppDataPhase;
  data: HotzonesResponse | null;
  errorMessage: string | null;
  reload: () => void;
  lastUpdated: string | null;
  isPolling: boolean;
}

/** 台股盤中時段（9:00-13:30，週一到週五） */
function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours * 60 + minutes;
  return time >= 540 && time < 810; // 9:00 = 540min, 13:30 = 810min
}

/** 取得倒數計時（秒）到下次輪詢 */
function getNextPollSeconds(): number {
  if (!isMarketHours()) return 0;
  // 盤中每 5 分鐘輪詢一次
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const nextFive = Math.ceil(minutes / 5) * 5;
  return (nextFive - minutes) * 60 + 60; // 加 60 秒避免立即觸發
}

/**
 * Phase 1 資料流：進站抓一次盤後熱區。
 * API 失敗 → 降級為「離線示範資料」（明確標示，絕不冒充真實資料）。
 * 盤中自動輪詢（5 分鐘），盤後停止。
 */
export function useAppData(): AppData {
  const [phase, setPhase] = useState<AppDataPhase>("loading");
  const [data, setData] = useState<HotzonesResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const fetchData = useCallback(() => {
    let alive = true;
    setPhase("loading");
    setErrorMessage(null);
    setIsPolling(true);
    fetchHotzones()
      .then((res) => {
        if (!alive) return;
        setData(res);
        setPhase("ready");
        setLastUpdated(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }));
        setIsPolling(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setErrorMessage(err instanceof Error ? err.message : "未知錯誤");
        setData(DEMO_HOTZONES);
        setPhase("fallback");
        setIsPolling(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const controller = fetchData();

    // 盤中自動輪詢
    const pollInterval = setInterval(() => {
      if (isMarketHours()) {
        fetchData();
      } else {
        clearInterval(pollInterval);
      }
    }, 5 * 60 * 1000); // 5 分鐘

    return () => {
      controller();
      clearInterval(pollInterval);
    };
  }, [tick, fetchData]);

  return { phase, data, errorMessage, reload, lastUpdated, isPolling };
}
