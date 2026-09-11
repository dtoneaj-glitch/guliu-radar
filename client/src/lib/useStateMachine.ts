/**
 * B5 狀態機：追蹤每檔股策略狀態變化歷史
 *
 * 狀態：triggered / waiting / no-trade / insufficient
 * 轉換：任何狀態 → 任何狀態（記錄時間戳與原因）
 * 儲存：localStorage（per-user，按 strategyId 隔離）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StrategyEval } from "@shared/types";
import { useAuth } from "./auth";

export type StatusTransition = "triggered" | "waiting" | "no-trade" | "insufficient";

export interface StateHistoryEntry {
  timestamp: string; // ISO
  from: StatusTransition | null;
  to: StatusTransition;
  reason: string;
}

export interface StockState {
  symbol: string;
  strategyId: string;
  currentStatus: StatusTransition;
  history: StateHistoryEntry[];
  lastUpdate: string;
}

const HISTORY_KEY_PREFIX = "gr.state.";

/** 讀取 localStorage 中的狀態歷史 */
function loadHistory(userId: string, strategyId: string): Record<string, StockState> {
  try {
    const raw = localStorage.getItem(`${HISTORY_KEY_PREFIX}${userId}:${strategyId}`);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StockState>;
  } catch {
    return {};
  }
}

/** 寫入 localStorage */
function saveHistory(userId: string, strategyId: string, history: Record<string, StockState>) {
  try {
    localStorage.setItem(`${HISTORY_KEY_PREFIX}${userId}:${strategyId}`, JSON.stringify(history));
  } catch {
    /* ignore */
  }
}

/**
 * B5 狀態機 Hook
 * @param userId 使用者 ID（從 auth context 取得）
 * @param strategyId 策略 ID
 * @param scans 最新的掃描結果
 */
export function useStateMachine(
  userId: string | null,
  strategyId: string,
  scans: StrategyEval[],
) {
  const [history, setHistory] = useState<Record<string, StockState>>(() =>
    userId ? loadHistory(userId, strategyId) : {},
  );
  const prevScansRef = useRef<StrategyEval[]>([]);

  // 當掃描結果變化時，計算狀態轉換
  useEffect(() => {
    if (!userId || scans.length === 0) return;

    const prevMap = new Map(prevScansRef.current.map((s) => [s.symbol, s]));
    const nextMap = new Map(scans.map((s) => [s.symbol, s]));

    const updated: Record<string, StockState> = { ...history };

    // 處理所有当前 scan 中的股票
    for (const scan of scans) {
      const prev = prevMap.get(scan.symbol);
      const prevStatus = prev?.status ?? null;
      const currStatus = scan.status as StatusTransition;

      // 偵測狀態變化
      if (prevStatus !== currStatus) {
        const symbol = scan.symbol;
        const existing = updated[symbol];

        if (existing) {
          // 更新現有狀態
          updated[symbol] = {
            ...existing,
            currentStatus: currStatus,
            history: [
              {
                timestamp: new Date().toISOString(),
                from: prevStatus,
                to: currStatus,
                reason: scan.note || `${prevStatus ?? "初始"} → ${currStatus}`,
              },
              ...existing.history.slice(0, 19), // 保留最近 20 筆
            ],
            lastUpdate: new Date().toISOString(),
          };
        } else {
          // 新股票
          updated[symbol] = {
            symbol,
            strategyId,
            currentStatus: currStatus,
            history: [
              {
                timestamp: new Date().toISOString(),
                from: null,
                to: currStatus,
                reason: scan.note || "初始狀態",
              },
            ],
            lastUpdate: new Date().toISOString(),
          };
        }
      }
    }

    // 標記已消失的股票為「insufficient」（可選）
    for (const [symbol, state] of Object.entries(updated)) {
      if (!nextMap.has(symbol)) {
        // 股票已不在掃描結果中，保持當前狀態但不更新
      }
    }

    setHistory(updated);
    saveHistory(userId, strategyId, updated);
    prevScansRef.current = scans;
  }, [scans, userId, strategyId, history]);

  /** 取得單檔股的狀態 */
  const getStockState = useCallback(
    (symbol: string): StockState | null => history[symbol] ?? null,
    [history],
  );

  /** 取得所有有狀態變化的股票（triggered 或近期有變化） */
  const getActiveStates = useCallback(
    () =>
      Object.values(history)
        .filter((s) => s.currentStatus === "triggered" || s.history.length > 0)
        .sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime()),
    [history],
  );

  /** 清除某檔股的狀態歷史 */
  const clearState = useCallback(
    (symbol: string) => {
      if (!userId) return;
      const updated = { ...history };
      delete updated[symbol];
      setHistory(updated);
      saveHistory(userId, strategyId, updated);
    },
    [userId, strategyId, history],
  );

  /** 清除所有狀態歷史 */
  const clearAll = useCallback(() => {
    if (!userId) return;
    setHistory({});
    saveHistory(userId, strategyId, {});
  }, [userId, strategyId]);

  return { history, getStockState, getActiveStates, clearState, clearAll };
}
