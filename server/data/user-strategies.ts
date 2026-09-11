/**
 * 使用者自訂策略資料層（JSON 檔案，相對於 users.json）
 *
 * 檔案：server/data/user-strategies.json
 * 結構：
 *   {
 *     version: 1,
 *     strategies: UserStrategyDef[]
 *   }
 */

import fs from "node:fs";
import path from "node:path";
import type { UserStrategyDef } from "../../shared/strategy-builder";

const STRATEGIES_FILE = path.resolve(process.cwd(), "server", "data", "user-strategies.json");
const VERSION = 1;

interface StrategiesFile {
  version: number;
  strategies: UserStrategyDef[];
}

function readStrategies(): StrategiesFile {
  if (!fs.existsSync(STRATEGIES_FILE)) {
    return { version: VERSION, strategies: [] };
  }
  try {
    const raw = fs.readFileSync(STRATEGIES_FILE, "utf-8");
    return JSON.parse(raw) as StrategiesFile;
  } catch {
    return { version: VERSION, strategies: [] };
  }
}

function writeStrategies(data: StrategiesFile): void {
  fs.mkdirSync(path.dirname(STRATEGIES_FILE), { recursive: true });
  fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/** 列出某用戶的所有策略 */
export function getUserStrategies(userId: string): UserStrategyDef[] {
  return readStrategies().strategies.filter((s) => s.userId === userId);
}

/** 取得單筆策略 */
export function getUserStrategy(userId: string, strategyId: string): UserStrategyDef | null {
  const data = readStrategies();
  return data.strategies.find((s) => s.userId === userId && s.id === strategyId) ?? null;
}

/** 新增策略 */
export function createUserStrategy(userId: string, strategy: Omit<UserStrategyDef, "id" | "createdAt" | "updatedAt">): UserStrategyDef | null {
  const data = readStrategies();
  // 檢查同名
  if (data.strategies.some((s) => s.userId === userId && s.name === strategy.name)) return null;
  const now = new Date().toISOString();
  const newStrategy: UserStrategyDef = {
    ...strategy,
    userId,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  data.strategies.push(newStrategy);
  writeStrategies(data);
  return newStrategy;
}

/** 更新策略 */
export function updateUserStrategy(userId: string, strategyId: string, updates: Partial<Pick<UserStrategyDef, "name" | "desc" | "filters" | "triggers" | "invalidations">>): UserStrategyDef | null {
  const data = readStrategies();
  const idx = data.strategies.findIndex((s) => s.userId === userId && s.id === strategyId);
  if (idx === -1) return null;
  data.strategies[idx] = { ...data.strategies[idx], ...updates, updatedAt: new Date().toISOString() };
  writeStrategies(data);
  return data.strategies[idx];
}

/** 刪除策略 */
export function deleteUserStrategy(userId: string, strategyId: string): boolean {
  const data = readStrategies();
  const idx = data.strategies.findIndex((s) => s.userId === userId && s.id === strategyId);
  if (idx === -1) return false;
  data.strategies.splice(idx, 1);
  writeStrategies(data);
  return true;
}

/** 取得某用戶的策略數量 */
export function countUserStrategies(userId: string): number {
  return getUserStrategies(userId).length;
}
