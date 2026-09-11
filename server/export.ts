/**
 * 匯出端點：把目前所有市場資料包成一個 JSON blob，供離線 HTML 使用。
 *
 * GET /api/export?date=YYYY-MM-DD  — 指定日期（讀 archive，支援歷史）
 * GET /api/export                  — 今天（即時從 providers 抓取）
 */

import {
  getSnapshot,
  getHotzones,
  buildSectorFlows,
} from "./data/hotzones";
import { fetchChipCard, fetchOptionsOISnapshot } from "./data/providers/taifex";
import { fetchPantlasOverview } from "./data/providers/pantlas";
import { loadArchiveDate } from "./data/archive";
import { getTodayRegime } from "./data/regime";
import type {
  HotZone,
  MarketRegime,
  SectorFlow,
  InstitutionalBreakdown,
  ChipCardData,
} from "../shared/types";
import type { OptionsOISnapshot } from "./data/providers/taifex";
import type { Snapshot } from "./data/hotzones";

export interface ExportSnapshot {
  asOf: string;
  generatedAt: string;
  source: "live" | "archive";
  summary?: {
    advance: number;
    decline: number;
    flat: number;
    totalValueYi: number;
    institutionalNetYi: number;
    institutionalCoverage: string;
  };
  institutional?: Record<string, InstitutionalBreakdown>;
  hotzones?: HotzonesExport;
  chipCard?: ChipCardExport;
  optionsOI?: OptionsOIExport | null;
  pantlas?: PantlasExport;
  regime?: MarketRegime;
  sectorFlows?: SectorFlow[];
}

interface HotzonesExport {
  asOf: string;
  generatedAt: string;
  summary: { totalValue: number; institutionalNet: number; institutionalCoverage: string };
  zones: HotZone[];
  industryZones: HotZone[];
  highlights: {
    sentiment: { value: number; label: string; advance: number; decline: number };
    topFlow: { id: string; name: string; status: string; flowValue: number; changePct: number }[];
    whales: { symbol: string; name: string; netBuyValue: number; changePct: number | null }[];
  };
}

interface ChipCardExport extends ChipCardData {}

interface OptionsOIExport {
  asOf: string;
  contracts: Array<{
    contractCode: string;
    name: string;
    foreignNetOI: number;
    dealerNetOI: number;
    bias: string;
  }>;
  putCallRatio: number | null;
  pcTrend: (number | null)[];
  totalForeignNetOI: number;
  marketBias: string;
  marketBiasDescription: string;
}

interface PantlasExport {
  dataAsOf: string;
  advancers: number;
  decliners: number;
  unchanged: number;
  turnoverBillion: number;
  estimatedLimitUp: number;
  estimatedLimitDown: number;
}

export async function getExportSnapshot(dateStr?: string): Promise<ExportSnapshot> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const targetDate = dateStr ?? today;
  const isToday = targetDate === today;

  const archive = loadArchiveDate(targetDate);

  if (archive) {
    return buildArchiveSnapshot(targetDate, archive);
  }

  if (!isToday) {
    return buildEmptySnapshot(targetDate, "archive");
  }

  return buildLiveSnapshot();
}

/** 從 archive 重建匯出資料（不需要再抓網路） */
function buildArchiveSnapshot(
  date: string,
  archive: NonNullable<ReturnType<typeof loadArchiveDate>>,
): ExportSnapshot {
  const regime = getTodayRegime({
    advance: archive.summary.advance,
    decline: archive.summary.decline,
    flat: archive.summary.flat,
    institutionalNet: archive.summary.institutionalNetYi,
  });

  // 重建 Snapshot 物件供 buildSectorFlows 使用
  let sectorFlows: SectorFlow[] | undefined;
  try {
    const fakeSnapshot: Snapshot = {
      asOf: archive.meta.date,
      generatedAt: archive.meta.generatedAt,
      quotes: archive.quotes,
      bySymbol: new Map(archive.quotes.map((q) => [q.symbol, q])),
      summary: {
        advance: archive.summary.advance,
        decline: archive.summary.decline,
        flat: archive.summary.flat,
        totalValue: archive.summary.totalValueYi,
        institutionalNet: archive.summary.institutionalNetYi,
        institutionalCoverage: archive.summary.institutionalCoverage,
      },
      institutional: new Map(archive.institutional.entries()),
    };
    sectorFlows = buildSectorFlows(fakeSnapshot);
  } catch {
    /* ignore */
  }

  return {
    asOf: archive.meta.date,
    generatedAt: archive.meta.generatedAt,
    source: "archive",
    summary: {
      advance: archive.summary.advance,
      decline: archive.summary.decline,
      flat: archive.summary.flat,
      totalValueYi: archive.summary.totalValueYi,
      institutionalNetYi: archive.summary.institutionalNetYi,
      institutionalCoverage: archive.summary.institutionalCoverage,
    },
    institutional: Object.fromEntries(archive.institutional.entries()),
    regime,
    sectorFlows,
  };
}

/** 即時抓取（今日無 archive） */
async function buildLiveSnapshot(): Promise<ExportSnapshot> {
  const [snapshot, hotzones, chipCard, optionsOI, pantlas] = await Promise.all([
    getSnapshot(),
    getHotzones(),
    fetchChipCard(null).catch(() => null),
    fetchOptionsOISnapshot(null).catch(() => null),
    fetchPantlasOverview().catch(() => null),
  ]);

  const regime = getTodayRegime({
    advance: snapshot.summary.advance,
    decline: snapshot.summary.decline,
    flat: snapshot.summary.flat,
    institutionalNet: snapshot.summary.institutionalNet,
  });

  const sectorFlows = buildSectorFlows(snapshot);

  return {
    asOf: hotzones.asOf,
    generatedAt: hotzones.generatedAt,
    source: "live",
    summary: {
      advance: snapshot.summary.advance,
      decline: snapshot.summary.decline,
      flat: snapshot.summary.flat,
      totalValueYi: snapshot.summary.totalValue,
      institutionalNetYi: snapshot.summary.institutionalNet,
      institutionalCoverage: snapshot.summary.institutionalCoverage,
    },
    institutional: snapshot.institutional
      ? Object.fromEntries(snapshot.institutional.entries())
      : undefined,
    hotzones: {
      asOf: hotzones.asOf,
      generatedAt: hotzones.generatedAt,
      summary: {
        totalValue: hotzones.summary.totalValue,
        institutionalNet: hotzones.summary.institutionalNet,
        institutionalCoverage: hotzones.summary.institutionalCoverage,
      },
      zones: hotzones.zones,
      industryZones: hotzones.industryZones ?? [],
      highlights: hotzones.highlights,
    },
    chipCard: (chipCard ?? undefined) as ChipCardExport | undefined,
    optionsOI: (optionsOI ?? null) as OptionsOIExport | null,
    pantlas: pantlas ?? undefined,
    regime,
    sectorFlows,
  };
}

function buildEmptySnapshot(date: string, source: "live" | "archive"): ExportSnapshot {
  return { asOf: date, generatedAt: new Date().toISOString(), source };
}
