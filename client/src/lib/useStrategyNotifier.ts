/**
 * 策略觸發通知：監聽自選股策略狀態變化，觸發時發送瀏覽器通知。
 *
 * 邏輯：
 * 1. 定期（盤中每 5 分鐘）重新掃描策略
 * 2. 比對上一輪狀態，偵測「等待中 → 已觸發」的轉變
 * 3. 發送本機通知（需使用者允許）
 * 4. 記錄通知歷史到 localStorage（同一 asOf + symbol 不重複通知）
 */

import { useEffect, useRef } from "react";
import type { StrategyEval } from "@shared/types";
import { notificationsSupported, requestNotificationPermission } from "./notify";
import { useWatchlist } from "./watchlist";
import { useAuth } from "./auth";

const TRIGGERED_KEY_PREFIX = "gr.triggered."; // localStorage key prefix

/** 檢查是否已通知過（同 asOf + symbol） */
function hasNotified(asOf: string, symbol: string): boolean {
  try {
    return localStorage.getItem(`${TRIGGERED_KEY_PREFIX}${symbol}`) === asOf;
  } catch {
    return false;
  }
}

/** 標記已通知 */
function markNotified(symbol: string, asOf: string) {
  try {
    localStorage.setItem(`${TRIGGERED_KEY_PREFIX}${symbol}`, asOf);
  } catch {
    /* ignore */
  }
}

/**
 * 策略觸發通知 Hook
 * @param strategyId 策略 ID（預設 pa_default）
 * @param scanFn 掃描函數，回傳 { asOf, rows: StrategyEval[] }
 */
export function useStrategyNotifier(
  strategyId: string,
  scanFn: () => Promise<{ asOf: string; rows: StrategyEval[] }>,
) {
  const { isAuthenticated } = useAuth();
  const prevTriggersRef = useRef<Set<string>>(new Set());
  const lastAsOfRef = useRef<string>("");

  useEffect(() => {
    if (!notificationsSupported()) return;

    const checkAndNotify = async () => {
      try {
        const result = await scanFn();
        const { asOf, rows } = result;

        // 只處理 triggered 狀態
        const triggeredSymbols = new Set(
          rows
            .filter((r) => r.status === "triggered")
            .map((r) => r.symbol),
        );

        // 偵測新觸發（上一輪沒有，這輪有）
        const newTriggers = [...triggeredSymbols].filter(
          (s) => !prevTriggersRef.current.has(s) && !hasNotified(asOf, s),
        );

        if (newTriggers.length > 0) {
          // 請求通知權限（如果還沒授權）
          if (Notification.permission === "default") {
            await requestNotificationPermission();
          }

          if (Notification.permission === "granted") {
            for (const symbol of newTriggers) {
              markNotified(symbol, asOf);
              try {
                new Notification("股流 Radar・策略觸發", {
                  body: `${symbol} 觸發「${strategyId}」條件，回來看看結構。`,
                  icon: "/icon.svg",
                  tag: `gr-strategy-${symbol}`,
                });
              } catch {
                /* 瀏覽器限制 */
              }
            }
          }
        }

        // 更新狀態
        prevTriggersRef.current = triggeredSymbols;
        lastAsOfRef.current = asOf;
      } catch {
        /* 掃描失敗時安靜忽略 */
      }
    };

    // 立即檢查一次
    checkAndNotify();

    // 每 5 分鐘檢查一次（盤中）
    const interval = setInterval(checkAndNotify, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [strategyId, scanFn]);

  // 回傳當前觸發狀態供 UI 顯示
  return { lastAsOf: lastAsOfRef.current, prevTriggers: prevTriggersRef.current };
}
