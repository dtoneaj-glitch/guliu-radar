/**
 * B0 歷史資料補檔
 *
 * TWSE/TPEx API 不提供歷史日期查詢，此檔案用真實結構 + 合理波動
 * 產生過去 N 個交易日的存檔，讓 B5 狀態機有足夠資料計算趨勢。
 *
 * 使用方式：
 *   POST /api/history/seed  → body: { start: "2026-09-01", days: 5 }
 */
import fs from "node:fs";
import path from "node:path";
import type { InstitutionalBreakdown, Quote } from "../../shared/types";
import { saveSnapshot, listArchiveDates } from "./archive";
import { MarketSummary } from "../../shared/types";

const ARCHIVE_DIR = path.resolve(process.cwd(), "server", "data", "archive", "daily");

// ─── seeded random ────────────────────────────────────────────────
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function randn(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── 生成單日快照 ───────────────────────────────────────────────
function generateDay(dateStr: string, dayIndex: number, rng: () => number): { quotes: Quote[]; instMap: Map<string, InstitutionalBreakdown>; summary: MarketSummary } {
  // 模擬 20 支重點股的真實價格區間
  const stockData = [
    { sym: "2330", name: "台積電", base: 920 },
    { sym: "2454", name: "聯發科", base: 750 },
    { sym: "2317", name: "鴻海", base: 190 },
    { sym: "3481", name: "群創", base: 28 },
    { sym: "4904", name: "友訊", base: 52 },
    { sym: "2357", name: "緯創", base: 420 },
    { sym: "2308", name: "華碩", base: 1150 },
    { sym: "3486", name: "矽品", base: 38 },
    { sym: "2412", name: "光寶科", base: 380 },
    { sym: "2327", name: "和碩", base: 95 },
    { sym: "3045", name: "宏碁", base: 48 },
    { sym: "2379", name: "瑞昱", base: 880 },
    { sym: "2409", name: "奇美電", base: 22 },
    { sym: "3529", name: "瑞儀", base: 165 },
    { sym: "2451", name: "日月光", base: 340 },
    { sym: "3446", name: "台揚", base: 120 },
    { sym: "2303", name: "群創", base: 28 },
    { sym: "2353", name: "友達", base: 22 },
    { sym: "2395", name: "鴻海", base: 190 },
    { sym: "3505", name: "聯發科", base: 750 },
  ];

  // 決定今日情緒（dayIndex 越大表示越新，市場有連續性）
  // 假設 9/1~9/5 有震盪到轉強的趨勢
  const trendBias = Math.min(dayIndex * 0.08, 0.3); // 逐日偏多
  const breadthPct = 50 + trendBias * 100 + randn(rng) * 10;
  const instNetYi = trendBias * 500 + randn(rng) * 150;
  const totalValueYi = 2800 + randn(rng) * 600;

  const quotes: Quote[] = [];
  const instMap = new Map<string, InstitutionalBreakdown>();
  let advance = 0, decline = 0, flat = 0;

  for (const s of stockData) {
    const priceMove = (breadthPct - 50) / 50 * 2 + randn(rng) * 2.5;
    const close = Math.round(s.base * (1 + priceMove / 100) * 100) / 100;
    const open = Math.round(s.base * (1 + (priceMove + randn(rng) * 0.3) / 100) * 100) / 100;
    const high = Math.max(open, close) * (1 + rng() * 0.005);
    const low = Math.min(open, close) * (1 - rng() * 0.005);
    const volume = Math.round((800000 + rng() * 6000000) / 100) * 100;
    const value = Math.round(volume * close / 1e8 * 100) / 100;

    quotes.push({
      symbol: s.sym,
      name: s.name,
      market: "twse",
      industry: null,
      prevClose: s.base,
      open,
      high,
      low,
      close,
      changePct: Math.round(priceMove * 100) / 100,
      volumeShares: volume,
      value,
      netBuyShares: null,
      netBuyValue: null,
    });

    if (close > s.base) advance++;
    else if (close < s.base) decline++;
    else flat++;

    // 法人買賣超
    const instBias = instNetYi / 3000;
    instMap.set(s.sym, {
      foreign: Math.round((instBias * 600 + randn(rng) * 150) * 100) / 100,
      trust: Math.round((instBias * 250 + randn(rng) * 100) * 100) / 100,
      dealer: Math.round((instBias * 100 + randn(rng) * 80) * 100) / 100,
      total: Math.round((instBias * 950 + randn(rng) * 250) * 100) / 100,
    });
  }

  return {
    quotes,
    instMap,
    summary: {
      advance,
      decline,
      flat,
      totalValue: totalValueYi,
      institutionalNet: instNetYi,
      institutionalCoverage: instNetYi >= 0 ? "買超" : "賣超",
    },
  };
}

// ─── 主函數 ─────────────────────────────────────────────────────
export async function seedHistory(opts: { start: string; days: number }): Promise<{ archived: string[]; skipped: string[] }> {
  const existing = new Set(listArchiveDates());
  const { start, days } = opts;

  // 從 start 開始往後數 days 個交易日（台北時間）
  const dates: string[] = [];
  // 直接解析 "YYYY-MM-DD" 為台北時間的日期物件
  const [startY, startM, startD] = start.split("-").map(Number);
  let d = new Date(Date.UTC(startY, startM - 1, startD)); // UTC 時間
  // 因為是 UTC，但我們用 +8 來轉成台北時間
  // toISOString() 會回傳 UTC 時間，所以用本地時間轉換

  while (dates.length < days) {
    // 將 UTC 時間轉為台北時間的日期字串
    const tpStr = d.toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
    const ymd = tpStr.split(" ")[0]; // "YYYY-MM-DD"
    const tpDate = new Date(tpStr + " GMT+8");
    const dow = tpDate.getDay();
    if (dow !== 0 && dow !== 6) dates.push(ymd);
    d = new Date(d.getTime() + 86400000);
  }

  const archived: string[] = [];
  const skipped: string[] = [];
  let seed = 20260901;
  let prevInstNet: number | undefined;

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    if (existing.has(dateStr)) { skipped.push(dateStr); continue; }

    const rng = makeRng(seed + i * 1013);
    const gen = generateDay(dateStr, i, rng);
    prevInstNet = gen.summary.institutionalNet;

    try {
      const snapshot = {
        asOf: dateStr,
        generatedAt: new Date().toISOString(),
        quotes: gen.quotes,
        bySymbol: new Map(gen.quotes.map((q) => [q.symbol, q])),
        summary: gen.summary,
        institutional: gen.instMap,
      };
      saveSnapshot(dateStr, snapshot, gen.instMap);
      archived.push(dateStr);
    } catch (e) {
      skipped.push(dateStr);
    }
  }

  return { archived, skipped };
}
