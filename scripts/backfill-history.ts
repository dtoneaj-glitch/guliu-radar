/**
 * 回補歷史缺口：用「可指定日期」的端點，重建指定交易日的 B0 快照並寫入 archive。
 *
 * 為什麼需要：正常管線只抓「最新交易日」，所以過去漏掉的日子補不回來。
 * 但證交所 rwd（MI_INDEX）與櫃買的端點**接受指定日期**，所以能逐日重建——
 * 這支腳本就是做這件事（邏輯與 hotzones.getSnapshot 一致，只差在日期）。
 *
 * 用法：
 *   node_modules\.bin\tsx scripts\backfill-history.ts 2026-09-10 2026-09-11 2026-09-14 2026-09-15 2026-09-17
 *
 * 特性：已存在的日期會跳過；取不到資料（休市）會印出並繼續。
 */
import { fetchTwseDailyByDate, fetchTwseInstitutional } from "../server/data/providers/twse";
import { fetchTpexDaily, fetchTpexInstitutional } from "../server/data/providers/tpex";
import { fetchIndustryMap } from "../server/data/providers/finmind";
import { deriveChange } from "../shared/quote-change";
import { saveSnapshot, listArchiveDates } from "../server/data/archive";
import type { Snapshot } from "../server/data/hotzones";
import type { Quote, InstitutionalBreakdown, MarketSummary } from "../shared/types";

async function buildSnapshotForDate(date: string): Promise<Snapshot | null> {
  const twse = await fetchTwseDailyByDate(date);
  if (!twse || twse.rows.length < 100) return null;

  const [tpex, industry, inst, tpexInst] = await Promise.all([
    fetchTpexDaily(twse.date).catch(() => null),
    fetchIndustryMap().catch(() => new Map()),
    fetchTwseInstitutional(twse.date).catch(() => null),
    fetchTpexInstitutional(twse.date).catch(() => null),
  ]);

  const quotes: Quote[] = [];
  for (const row of twse.rows) {
    const info = industry.get(row.symbol);
    const breakdown = inst?.get(row.symbol);
    const netShares = breakdown?.total ?? null;
    const chg = deriveChange(row.close, row.change);
    quotes.push({
      symbol: row.symbol,
      name: row.name || info?.name || row.symbol,
      market: "twse",
      industry: info?.industry || null,
      prevClose: chg.prevClose,
      close: row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      changePct: chg.changePct,
      exDividend: chg.exDividend,
      volumeShares: row.volumeShares,
      value: row.value,
      netBuyShares: netShares,
      netBuyValue: netShares != null ? netShares * row.close : null,
    });
  }
  if (tpex) {
    for (const row of tpex.rows) {
      const info = industry.get(row.symbol);
      const breakdown = tpexInst?.get(row.symbol);
      const netShares = breakdown?.total ?? null;
      const chg = deriveChange(row.close, row.change ?? null);
      quotes.push({
        symbol: row.symbol,
        name: row.name || info?.name || row.symbol,
        market: "tpex",
        industry: info?.industry || null,
        prevClose: chg.prevClose,
        close: row.close,
        open: row.open,
        high: row.high,
        low: row.low,
        changePct: chg.changePct,
        exDividend: chg.exDividend,
        volumeShares: row.volumeShares,
        value: row.value,
        netBuyShares: netShares,
        netBuyValue: netShares != null ? netShares * row.close : null,
      });
    }
  }

  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  let advance = 0;
  let decline = 0;
  let flat = 0;
  let totalValue = 0;
  let institutionalNet = 0;
  for (const q of quotes) {
    totalValue += q.value;
    if (q.changePct == null) flat += 1;
    else if (q.changePct > 0) advance += 1;
    else if (q.changePct < 0) decline += 1;
    else flat += 1;
    if (q.netBuyValue != null) institutionalNet += q.netBuyValue;
  }

  const combinedInstitutional: Map<string, InstitutionalBreakdown> | null =
    inst || tpexInst ? new Map([...(inst ?? new Map()), ...(tpexInst ?? new Map())]) : null;

  const coverageLabel = (() => {
    if (inst && tpexInst) return "上市（TWSE）＋上櫃（TPEx）法人買賣超";
    if (inst) return "僅上市（TWSE）法人買賣超；上櫃今日暫時無法取得";
    if (tpexInst) return "僅上櫃（TPEx）法人買賣超；上市今日暫時無法取得";
    return "法人資料暫時無法取得";
  })();

  const summary: MarketSummary = {
    advance,
    decline,
    flat,
    totalValue: totalValue / 1e8,
    institutionalNet: institutionalNet / 1e8,
    institutionalCoverage: coverageLabel,
  };

  return {
    asOf: twse.date,
    generatedAt: new Date().toISOString(),
    quotes,
    bySymbol,
    summary,
    institutional: combinedInstitutional,
  };
}

async function main(): Promise<void> {
  const dates = process.argv.slice(2).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) {
    console.log("用法：tsx scripts/backfill-history.ts 2026-09-10 2026-09-11 ...");
    process.exit(1);
  }
  const existing = new Set(listArchiveDates());
  let filled = 0;
  let skipped = 0;
  let noData = 0;

  for (const date of dates) {
    if (existing.has(date)) {
      console.log(`[skip] ${date} 已有存檔`);
      skipped += 1;
      continue;
    }
    const snap = await buildSnapshotForDate(date).catch(() => null);
    if (!snap || snap.asOf !== date) {
      console.log(`[nodata] ${date} 端點無資料或日期不符（休市？）`);
      noData += 1;
      continue;
    }
    saveSnapshot(snap.asOf, snap, snap.institutional);
    filled += 1;
    console.log(
      `[ok] ${date} 已回補｜報價 ${snap.quotes.length} 檔｜漲 ${snap.summary.advance} 跌 ${snap.summary.decline}｜成交 ${snap.summary.totalValue.toFixed(0)} 億｜法人 ${snap.summary.institutionalNet.toFixed(1)} 億`,
    );
  }
  console.log(`\n完成：回補 ${filled} 天、跳過 ${skipped} 天、無資料 ${noData} 天`);
}

main().catch((err) => {
  console.error("[backfill] 失敗：", err);
  process.exit(1);
});
