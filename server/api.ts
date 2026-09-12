import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { StrategyEval, StrategyStatus, Timeframe, TrendEntry } from "../shared/types";
import type {
  DashboardResponse,
  InstitutionalBreakdown,
  MarketMood,
  StockSignal,
  StockSignalBrief,
  StrategyMatch,
  TopFiveGroup,
} from "../shared/types";
import { buildMarketFacts } from "../shared/levels";
import { buildIndicatorFacts, type IndicatorFacts } from "../shared/indicators";
import { getSnapshot, getHotzones, getZoneStocks, searchStocks, getBriefs, getScan, getRanking, buildIndustryZones, buildThemeZones, buildSectorFlows } from "./data/hotzones";
import { getCachedCandles } from "./data/providers/yahoo-cache";
import { fetchYahooCandles, ySymbolCandidates } from "./data/providers/yahoo";
import { listArchiveDates, loadArchiveDate } from "./data/archive";
import { STRATEGIES, evaluateStrategy, getFacts, scanMarketStrategy } from "./data/strategies";
import { scanEntryZoneProximity } from "./data/entry-watch";
import { buildPaDefaultAnalysis } from "./data/pa-analysis";
import { fetchChipCard, fetchOptionsOISnapshot } from "./data/providers/taifex";
import type { OptionsOIData } from "../shared/types";
import { fetchPantlasStock, fetchPantlasOverview } from "./data/providers/pantlas";
import { getUserStrategies, getUserStrategy, createUserStrategy, updateUserStrategy, deleteUserStrategy } from "./data/user-strategies";
import { runBacktest, runBatchBacktest } from "./data/backtest";
import type { UserStrategyDef } from "../shared/strategy-builder";
import type { Candle, ChipCardData, Quote } from "../shared/types";
import type { Snapshot } from "./data/hotzones";
import { getExportSnapshot } from "./export";

/**
 * Phase 1 API（對應 PHASE1_SPEC §9）
 * GET /api/meta
 * GET /api/hotzones
 * GET /api/hotzones/:id/stocks
 * GET /api/scan?zone=&limit=
 * GET /api/stocks/search?q=
 * GET /api/stocks/briefs?symbols=
 * GET /api/stocks/:symbol
 * GET /api/stocks/:symbol/chart?timeframe=1w|1d|60m|15m
 */

const TIMEFRAME_MAP: Record<Timeframe, { range: string; interval: "1wk" | "1d" | "60m" | "15m" }> = {
  "1w": { range: "5y", interval: "1wk" },
  "1d": { range: "6mo", interval: "1d" },
  "60m": { range: "2mo", interval: "60m" },
  "15m": { range: "60d", interval: "15m" },
};

const isTimeframe = (v: string): v is Timeframe => v === "1w" || v === "1d" || v === "60m" || v === "15m";

function wrap(fn: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api] ${req.method} ${req.originalUrl} -> ${message}`);
      res.status(502).json({ error: message });
    });
  };
}

export function createApi(): express.Router {
  const api = express.Router();
  api.use((_, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  api.get(
    "/feedback/count",
    wrap(async (_req, res) => {
      const dir = path.resolve(process.cwd(), "feedback-inbox");
      const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;
      res.json({ count });
    }),
  );

  api.post(
    "/feedback",
    express.json({ limit: "2mb" }),
    wrap(async (req, res) => {
      const dir = path.resolve(process.cwd(), "feedback-inbox");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `fb-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
      console.log(`[feedback] saved ${path.basename(file)}`);
      res.json({ ok: true, file: path.basename(file) });
    }),
  );

  api.get(
    "/meta",
    wrap(async (_req, res) => {
      const snapshot = await getSnapshot();
      res.json({
        service: "guliu-radar",
        asOf: snapshot.asOf,
        generatedAt: snapshot.generatedAt,
        sources: ["TWSE OpenAPI", "TWSE T86", "TPEx 公開資料", "FinMind", "Yahoo Finance"],
        notes: [
          "Phase 1 為盤後資料，非即時行情。",
          "法人買賣超目前涵蓋上市（T86）；上櫃待 Phase 2。",
        ],
      });
    }),
  );

  api.get(
    "/hotzones",
    wrap(async (_req, res) => {
      res.json(await getHotzones());
    }),
  );

  // 籌碼分歧（外資 vs 散戶）：規則引擎自動判斷，取代人工每天判讀寫結論
  api.get(
    "/chip-divergence",
    wrap(async (_req, res) => {
      const { getChipDivergence } = await import("./data/chip-divergence");
      const snapshot = await getSnapshot();
      res.json(await getChipDivergence(snapshot));
    }),
  );

  // 散戶（小台/微台）留倉：fetchRetailFuturesPosition 之前只寫了資料抓取邏輯，沒接 API 路由，這次補上
  api.get(
    "/retail-futures",
    wrap(async (req, res) => {
      const { fetchRetailFuturesPosition } = await import("./data/providers/taifex");
      const contract = req.query.contract === "MTX" ? "MTX" : "TMF";
      const result = await fetchRetailFuturesPosition(contract);
      if (!result) {
        res.status(502).json({ error: "散戶留倉資料暫時無法取得" });
        return;
      }
      res.json(result);
    }),
  );

  api.get(
    "/hotzones/:id/stocks",
    wrap(async (req, res) => {
      const result = await getZoneStocks(req.params.id);
      if (!result) res.status(404).json({ error: "找不到此熱區" });
      else res.json(result);
    }),
  );

  api.get(
    "/scan",
    wrap(async (req, res) => {
      const zone = typeof req.query.zone === "string" && req.query.zone ? req.query.zone : null;
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      res.json(await getScan(zone, limit));
    }),
  );

  api.get(
    "/ranking",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      res.json(getRanking(snapshot, limit));
    }),
  );

  api.get("/strategies", (_req, res) => {
    res.json({ strategies: STRATEGIES });
  });

  // 單檔策略評估（研判頁用）
  api.get(
    "/strategy/evaluate",
    wrap(async (req, res) => {
      const strategyId = String(req.query.strategyId ?? "pa_default");
      if (!STRATEGIES.some((s) => s.id === strategyId)) {
        res.status(400).json({ error: "未知策略 id" });
        return;
      }
      const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
      const snapshot = await getSnapshot();
      const quote = snapshot.bySymbol.get(symbol);
      if (!quote) {
        res.status(404).json({ error: `查無 ${symbol || "代號"}` });
        return;
      }
      const { facts, ind } = await getFacts(snapshot, symbol);
      const zones = buildIndustryZones(snapshot);
      const zoneStatus = zones.find((z) => z.id === quote.industry)?.status ?? null;
      const flowYi = quote.netBuyValue != null ? quote.netBuyValue / 1e8 : null;
      res.json(evaluateStrategy(strategyId, { facts, ind, quote, zoneStatus, flowYi }, symbol));
    }),
  );

  // 四時間框架 PA Facts + pa_default 六段式研判（可重現、條件式）
  api.get(
    "/stocks/:symbol/pa-analysis",
    wrap(async (req, res) => {
      const symbol = req.params.symbol.toUpperCase();
      const snapshot = await getSnapshot();
      if (!snapshot.bySymbol.has(symbol)) {
        res.status(404).json({ error: `查無 ${symbol}` });
        return;
      }
      res.json(await buildPaDefaultAnalysis(snapshot, symbol));
    }),
  );

  // 自選股×策略批次掃描（並發 5；結果依 觸發→等待→不交易→資料不足 排序）
  api.get(
    "/strategy/scan",
    wrap(async (req, res) => {
      const strategyId = String(req.query.strategyId ?? "pa_default");
      if (!STRATEGIES.some((s) => s.id === strategyId)) {
        res.status(400).json({ error: "未知策略 id" });
        return;
      }
      const snapshot = await getSnapshot();
      const symbols =
        typeof req.query.symbols === "string"
          ? req.query.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
          : [];
      const zones = buildIndustryZones(snapshot);
      const queue = [...symbols];
      const rows: StrategyEval[] = [];
      const evalOne = async (symbol: string) => {
        const quote = snapshot.bySymbol.get(symbol);
        if (!quote) {
          rows.push({
            strategyId, strategyName: STRATEGIES.find((s) => s.id === strategyId)?.name ?? "", symbol,
            name: symbol, status: "insufficient" as StrategyStatus, met: [], missing: ["今日無此代號資料"],
            note: "", close: null, changeAmt: null, changePct: null,
          });
          return;
        }
        const { facts, ind } = await getFacts(snapshot, symbol);
        const zoneStatus = zones.find((z) => z.id === quote.industry)?.status ?? null;
        const flowYi = quote.netBuyValue != null ? quote.netBuyValue / 1e8 : null;
        rows.push(evaluateStrategy(strategyId, { facts, ind, quote, zoneStatus, flowYi }, symbol));
      };
      const worker = async () => {
        while (queue.length > 0) {
          const s = queue.shift();
          if (s != null) await evalOne(s);
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, Math.max(1, queue.length)) }, worker));
      const order: Record<StrategyStatus, number> = { triggered: 0, waiting: 1, "no-trade": 2, insufficient: 3 };
      rows.sort((a, b) => order[a.status] - order[b.status]);
      res.json({ asOf: snapshot.asOf, strategyId, rows });
    }),
  );

  // 戰法×法人買超 Top 100（資金流短名單版的全市場掃描；結果快取 30 分鐘）
  api.get(
    "/strategy/market-scan",
    wrap(async (req, res) => {
      const strategyId = String(req.query.strategyId ?? "pa_default");
      if (!STRATEGIES.some((s) => s.id === strategyId)) {
        res.status(400).json({ error: "未知策略 id" });
        return;
      }
      const snapshot = await getSnapshot();
      res.json(await scanMarketStrategy(strategyId, snapshot, 100));
    }),
  );

  // 近進場區批次掃描（盤後用途：自選股/候選池中誰的收盤價已進或接近 PA 進場區）
  api.get(
    "/entry-watch",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const symbols =
        typeof req.query.symbols === "string"
          ? req.query.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
          : [];
      if (symbols.length === 0) {
        res.json({ asOf: snapshot.asOf, items: [] });
        return;
      }
      const items = await scanEntryZoneProximity(snapshot, symbols);
      res.json({ asOf: snapshot.asOf, items });
    }),
  );

  api.get(
    "/stocks/search",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const q = typeof req.query.q === "string" ? req.query.q : "";
      res.json({ asOf: snapshot.asOf, results: searchStocks(snapshot, q) });
    }),
  );

  api.get(
    "/stocks/briefs",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const symbols = typeof req.query.symbols === "string" ? req.query.symbols.split(",") : [];
      const { found, notFound } = getBriefs(snapshot, symbols);
      res.json({ asOf: snapshot.asOf, found, notFound });
    }),
  );

  // 自選股批次趨勢標籤（v0 規則，日線；並發上限 5 保護免費源）
  api.get(
    "/stocks/trends",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const symbols =
        typeof req.query.symbols === "string"
          ? req.query.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
          : [];
      const queue = [...symbols];
      const results: TrendEntry[] = [];
      const trendOf = async (symbol: string): Promise<TrendEntry> => {
        const quote = snapshot.bySymbol.get(symbol);
        const base: TrendEntry = {
          symbol,
          trend: null,
          confidence: null,
          close: quote?.close ?? null,
          changePct: quote?.changePct ?? null,
        };
        for (const ySymbol of ySymbolCandidates(symbol, quote?.market)) {
          try {
            const { candles } = await getCachedCandles(ySymbol, "6mo", "1d");
            const facts = buildMarketFacts(candles);
            return { ...base, trend: facts?.trend ?? null, confidence: facts?.confidence ?? null };
          } catch {
            /* 換下一個候選代號 */
          }
        }
        return base;
      };
      const worker = async () => {
        while (queue.length > 0) {
          const sym = queue.shift();
          if (sym != null) results.push(await trendOf(sym));
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, Math.max(1, queue.length)) }, worker));
      res.json({ asOf: snapshot.asOf, trends: results });
    }),
  );

  api.get(
    "/stocks/:symbol/chart",
    wrap(async (req, res) => {
      const symbol = req.params.symbol.toUpperCase();
      const tfParam = String(req.query.timeframe ?? "1d");
      if (!isTimeframe(tfParam)) {
        res.status(400).json({ error: "timeframe 必須為 1w | 1d | 60m | 15m" });
        return;
      }
      const snapshot = await getSnapshot();
      const quote = snapshot.bySymbol.get(symbol);
      const market = quote?.market;
      let lastError: unknown = null;
      for (const ySymbol of ySymbolCandidates(symbol, market)) {
        try {
          const { candles, asOf } = await getCachedCandles(ySymbol, TIMEFRAME_MAP[tfParam].range, TIMEFRAME_MAP[tfParam].interval);
          res.json({
            symbol,
            name: quote?.name ?? symbol,
            industry: quote?.industry ?? null,
            timeframe: tfParam,
            prevClose: quote?.prevClose ?? candles[candles.length - 2]?.close ?? candles[0].close,
            candles,
            source: "Yahoo Finance",
            asOf,
          });
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`查無 ${symbol} 的圖表資料`);
    }),
  );

  api.get(
    "/stocks/:symbol",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const quote = snapshot.bySymbol.get(req.params.symbol.toUpperCase());
      if (!quote) res.status(404).json({ error: "查無此代號" });
      else
        res.json({
          symbol: quote.symbol,
          name: quote.name,
          market: quote.market,
          industry: quote.industry,
          close: quote.close,
          changePct: quote.changePct,
          netBuyValue: quote.netBuyValue,
        });
    }),
  );

  api.get(
    "/chipcard",
    wrap(async (req, res) => {
      const date = req.query.date as string | undefined;
      const chipData = await fetchChipCard(date ?? null);
      // 每次抓到資料就存一筆快照（upsert，同一天重複存不會壞事）——
      // 這是「本週彙總」改用自己資料庫的前提，見 chipcard-archive.ts 的說明
      const { saveChipCardSnapshot } = await import("./data/chipcard-archive");
      saveChipCardSnapshot(chipData);
      res.json(chipData);
    }),
  );

  // 大盤籌碼本週彙總：查自己資料庫已存檔的資料加總，不依賴 TAIFEX API 的歷史查詢
  // （它沒有這個功能，見 MEMORY-external-api-verification.md）
  api.get(
    "/chipcard/weekly",
    wrap(async (req, res) => {
      const weekStart = req.query.weekStart as string | undefined;
      if (!weekStart) {
        res.status(400).json({ error: "缺少 weekStart 參數" });
        return;
      }
      const { getChipCardWeeklyAggregate } = await import("./data/chipcard-archive");
      const result = getChipCardWeeklyAggregate(weekStart);
      if (!result) {
        res.status(404).json({ error: "本週尚無存檔資料——這個功能剛上線，要等每天實際造訪過大盤籌碼頁才會累積資料" });
        return;
      }
      res.json(result);
    }),
  );

  api.get(
    "/options/oi",
    wrap(async (req, res) => {
      const { date } = req.query as { date?: string };
      try {
        const data = await fetchOptionsOISnapshot(date ?? null);
        res.json({ data, error: null });
      } catch (e) {
        res.status(502).json({ data: null, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  // ========== v2 散戶版 API ==========

  api.get(
    "/dashboard",
    wrap(async (_req, res) => {
      const snapshot = await getSnapshot();
      res.json(buildDashboard(snapshot));
    }),
  );

  api.get(
    "/stocks/signals",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const symbols =
        typeof req.query.symbols === "string"
          ? req.query.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
          : [];
      const signals = await buildStockSignalsBrief(snapshot, symbols);
      res.json({ asOf: snapshot.asOf, signals });
    }),
  );

  api.get(
    "/stocks/:symbol/signal",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const symbol = req.params.symbol.toUpperCase();
      const highlight = typeof req.query.highlight === "string" ? req.query.highlight : null;
      const signal = await buildStockSignal(snapshot, symbol, highlight);
      if (!signal) res.status(404).json({ error: "查無此代號或資料不足" });
      else res.json(signal);
    }),
  );

  // ========== Pantlas 公開端點 ==========

  api.get(
    "/pantlas/overview",
    wrap(async (_req, res) => {
      const overview = await fetchPantlasOverview();
      if (!overview) throw new Error("Pantlas 市場總覽取得失敗");
      res.json({
        dataAsOf: overview.dataAsOf,
        advancers: overview.advancers,
        decliners: overview.decliners,
        unchanged: overview.unchanged,
        turnoverBillion: overview.turnoverBillion,
        estimatedLimitUp: overview.estimatedLimitUp,
        estimatedLimitDown: overview.estimatedLimitDown,
      });
    }),
  );

  // ========== 會員認證 ==========

  api.post(
    "/auth/register",
    express.json(),
    wrap(async (req, res) => {
      const { username, password } = req.body as { username: string; password: string };
      if (!username || !password) {
        res.status(400).json({ error: "帳號密碼皆需填寫" });
        return;
      }
      if (username.length < 2 || username.length > 20) {
        res.status(400).json({ error: "帳號長度 2-20 字元" });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "密碼至少 6 個字元" });
        return;
      }
      const { createUser } = await import("./data/users");
      const result = createUser(username, password);
      if (!result) {
        res.status(409).json({ error: "此帳號已被註冊" });
        return;
      }
      res.status(201).json(result);
    }),
  );

  api.post(
    "/auth/login",
    express.json(),
    wrap(async (req, res) => {
      const { username, password } = req.body as { username: string; password: string };
      if (!username || !password) {
        res.status(400).json({ error: "帳號密碼皆需填寫" });
        return;
      }
      const { login } = await import("./data/users");
      const result = login(username, password);
      if (!result) {
        res.status(401).json({ error: "帳號或密碼錯誤" });
        return;
      }
      res.json(result);
    }),
  );

  api.get(
    "/auth/me",
    wrap(async (req, res) => {
            const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken, findUserById } = await import("./data/users");
            const payload = verifyToken(token);
            if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const user = findUserById(payload.userId);
      if (!user) {
        res.status(404).json({ error: "用戶不存在" });
        return;
      }
      const { publicUser } = await import("./data/users");
      res.json(publicUser(user));
    }),
  );

  // ========== LINE Login OAuth ==========

  // GET /api/auth/line — 導向 LINE 授權頁面
  api.get(
    "/auth/line",
    wrap(async (req, res) => {
      const redirectParam = (req.query.redirect as string) ?? "/";
      const { getLineAuthUrl } = await import("./data/providers/line");
      const { url } = getLineAuthUrl(redirectParam);
      res.redirect(url);
    }),
  );

  // GET /api/auth/line/callback — LINE 授權回調
  api.get(
    "/auth/line/callback",
    wrap(async (req, res) => {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const redirectParam = req.query.redirect as string ?? "/";

      if (!code) {
        const errUrl = `${redirectParam}#error=${encodeURIComponent("LINE 授權失敗：未收到授權碼")}`;
        res.redirect(errUrl);
        return;
      }

      const { exchangeCodeForToken, getLineProfile, parseState } = await import("./data/providers/line");
      const { lineLogin } = await import("./data/users");

      // 驗證 state（簡化：只要 state 格式正確即可，實際可加 session 存儲）
      const { redirect } = parseState(state);
      const safeRedirect = redirect || redirectParam;

      let lineUser;
      try {
        const { accessToken } = await exchangeCodeForToken(code, state);
        lineUser = await getLineProfile(accessToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errUrl = `${safeRedirect}#error=${encodeURIComponent("LINE 登入失敗：" + msg)}`;
        res.redirect(errUrl);
        return;
      }

      const result = lineLogin(lineUser.userId, lineUser.displayName);
      if (!result) {
        const errUrl = `${safeRedirect}#error=${encodeURIComponent("帳號建立失敗")}`;
        res.redirect(errUrl);
        return;
      }

      // 綁定 LINE 通知設定
      const { linkLineAccount } = await import("./data/notifications");
      linkLineAccount(result.user.id, lineUser.userId);

      // 將 JWT 透過 URL hash 傳回前端（避免 CORS 問題）
      const callbackUrl = `${safeRedirect}#token=${encodeURIComponent(result.token)}&user=${encodeURIComponent(JSON.stringify(result.user))}`;
      res.redirect(callbackUrl);
    }),
  );

  // ========== 通知設定 API ==========

  // GET /api/notifications/settings — 取得當前用戶通知設定
  api.get(
    "/notifications/settings",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { getNotificationSettings, getLineUserId } = await import("./data/notifications");
      const settings = getNotificationSettings(payload.userId);
      const lineId = getLineUserId(payload.userId);
      res.json({
        ...settings,
        lineLinked: !!lineId,
        lineUserId: lineId, // 仅显示部分用於前端判斷
      });
    }),
  );

  // PUT /api/notifications/settings — 更新通知設定
  api.put(
    "/notifications/settings",
    express.json(),
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { updateNotificationSettings } = await import("./data/notifications");
      const { enabled, strategies } = req.body as { enabled?: boolean; strategies?: string[] };
      const updated = updateNotificationSettings(payload.userId, {
        enabled: enabled ?? false,
        strategies: strategies ?? ["pa_default"],
      });
      res.json(updated);
    }),
  );

  // POST /api/notifications/test — 發送測試推播
  api.post(
    "/notifications/test",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { sendTestPush, getLineUserId } = await import("./data/notifications");
      const lineUserId = getLineUserId(payload.userId);
      if (!lineUserId) {
        res.status(400).json({ error: "尚未綁定 LINE 帳號" });
        return;
      }
      const result = await sendTestPush(lineUserId);
      res.json(result);
    }),
  );

  // ========== Telegram Bot 推播（MVP 測試用，LINE 的替代方案） ==========

  // GET /api/notifications/telegram/status — 是否已綁定
  api.get(
    "/notifications/telegram/status",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { getTelegramChatId } = await import("./data/telegram-notifications");
      res.json({ linked: !!getTelegramChatId(payload.userId) });
    }),
  );

  // POST /api/notifications/telegram/link-code — 產生綁定驗證碼
  api.post(
    "/notifications/telegram/link-code",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { generateLinkCode } = await import("./data/telegram-notifications");
      const { getBotInfo } = await import("./data/providers/telegram-push");
      const { code, expiresInSec } = generateLinkCode(payload.userId);
      const bot = await getBotInfo();
      res.json({
        code,
        expiresInSec,
        botUsername: bot?.username ?? null,
        deepLink: bot ? `https://t.me/${bot.username}?start=${code}` : null,
      });
    }),
  );

  // POST /api/notifications/telegram/verify — 驗證使用者是否已在 Telegram 傳送 /start <code>
  api.post(
    "/notifications/telegram/verify",
    express.json(),
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { code } = req.body as { code?: string };
      if (!code) {
        res.status(400).json({ error: "缺少驗證碼" });
        return;
      }
      const { isValidLinkCode, completeLinking } = await import("./data/telegram-notifications");
      if (!isValidLinkCode(payload.userId, code)) {
        res.json({ linked: false, error: "驗證碼不存在或已過期，請重新產生" });
        return;
      }
      const { findChatIdByLinkCode } = await import("./data/providers/telegram-push");
      const found = await findChatIdByLinkCode(code);
      if (!found) {
        res.json({ linked: false, error: "尚未收到 /start 訊息，請先在 Telegram 傳送驗證碼給 Bot" });
        return;
      }
      completeLinking(payload.userId, code, found.chatId);
      res.json({ linked: true });
    }),
  );

  // POST /api/notifications/telegram/test — 發送測試推播
  api.post(
    "/notifications/telegram/test",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { getTelegramChatId } = await import("./data/telegram-notifications");
      const chatId = getTelegramChatId(payload.userId);
      if (!chatId) {
        res.status(400).json({ error: "尚未綁定 Telegram" });
        return;
      }
      const { sendTelegramMessage } = await import("./data/providers/telegram-push");
      const result = await sendTelegramMessage(
        chatId,
        "🔔 股流 Radar・測試通知\n\n這是測試推播訊息。如果您收到這則訊息，代表 Telegram 推播已正常運作。\n\n— 股流 Radar",
      );
      res.json(result);
    }),
  );

  // POST /api/notifications/telegram/entry-watch-push — 推播近進場區摘要（body: { symbols: string[] }）
  api.post(
    "/notifications/telegram/entry-watch-push",
    express.json(),
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { getTelegramChatId } = await import("./data/telegram-notifications");
      const chatId = getTelegramChatId(payload.userId);
      if (!chatId) {
        res.status(400).json({ error: "尚未綁定 Telegram" });
        return;
      }
      const { symbols } = req.body as { symbols?: string[] };
      const list = (symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
      if (list.length === 0) {
        res.status(400).json({ error: "symbols 為空" });
        return;
      }
      const snapshot = await getSnapshot();
      const items = await scanEntryZoneProximity(snapshot, list);
      const { sendTelegramMessage, buildEntryWatchCopy } = await import("./data/providers/telegram-push");
      const result = await sendTelegramMessage(chatId, buildEntryWatchCopy(items));
      res.json({ ...result, asOf: snapshot.asOf, itemCount: items.length });
    }),
  );

  // POST /api/admin/notify-scan — 管理員手動觸發策略掃描推播
  api.post(
    "/admin/notify-scan",
    express.json(),
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { strategyId } = req.body as { strategyId: string };
      if (!strategyId) {
        res.status(400).json({ error: "strategyId 為必填" });
        return;
      }
      const { triggerManualScan } = await import("./data/notifications");
      const { scanMarketStrategy } = await import("./data/strategies");
      const { getSnapshot } = await import("./data/hotzones");
      const snapshot = await getSnapshot();
      const result = await triggerManualScan(strategyId, async () => {
        const scanResult = await scanMarketStrategy(strategyId, snapshot, 100);
        return { asOf: scanResult.asOf, rows: scanResult.rows };
      });
      res.json(result);
    }),
  );

  // POST /api/admin/notify-entry-watch-scan — 手動觸發「近進場區」批次推播（測試用，不用等排程時間）
  api.post(
    "/admin/notify-entry-watch-scan",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { runEntryWatchPushForAllUsers } = await import("./data/entry-watch-scheduler");
      const result = await runEntryWatchPushForAllUsers();
      res.json(result);
    }),
  );

  api.get(
    "/users/:userId/watchlist",
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken, findUserById } = await import("./data/users");
            const payload = verifyToken(token);
            if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const user = findUserById(req.params.userId);
      if (!user) {
        res.status(404).json({ error: "用戶不存在" });
        return;
      }
      res.json({ symbols: user.watchlist.map((w) => w.symbol), items: user.watchlist });
    }),
  );

  api.put(
    "/users/:userId/watchlist",
    express.json(),
    wrap(async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "未登入" });
        return;
      }
      const token = authHeader.slice(7);
      const { verifyToken, findUserById, updateWatchlist } = await import("./data/users");
      const payload = verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "權杖無效或已過期" });
        return;
      }
      const { watchlist } = req.body as { watchlist: Array<{ symbol: string; groups: string[] }> };
      const user = updateWatchlist(req.params.userId, watchlist);
      if (!user) {
        res.status(404).json({ error: "用戶不存在" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // ========== 使用者自訂策略 ==========

  api.get(
    "/users/:userId/strategies",
    wrap(async (req, res) => {
      const strategies = getUserStrategies(req.params.userId);
      res.json({ strategies, count: strategies.length });
    }),
  );

  api.post(
    "/users/:userId/strategies",
    express.json(),
    wrap(async (req, res) => {
      const { name, desc, filters, triggers, invalidations } = req.body as {
        name: string;
        desc: string;
        filters: UserStrategyDef["filters"];
        triggers: UserStrategyDef["triggers"];
        invalidations: UserStrategyDef["invalidations"];
      };
      if (!name || !filters || !triggers) {
        res.status(400).json({ error: "name、filters、triggers 皆需填寫" });
        return;
      }
      const strategy = createUserStrategy(req.params.userId, { name, desc: desc ?? "", filters, triggers, invalidations: invalidations ?? { logic: "and", conditions: [] } } as any);
      if (!strategy) {
        res.status(409).json({ error: "同名策略已存在" });
        return;
      }
      res.status(201).json(strategy);
    }),
  );

  api.put(
    "/users/:userId/strategies/:strategyId",
    express.json(),
    wrap(async (req, res) => {
      const { name, desc, filters, triggers, invalidations } = req.body as Partial<Omit<UserStrategyDef, "id" | "userId" | "createdAt" | "updatedAt">>;
      const strategy = updateUserStrategy(req.params.userId, req.params.strategyId, { name, desc, filters, triggers, invalidations });
      if (!strategy) {
        res.status(404).json({ error: "策略不存在" });
        return;
      }
      res.json(strategy);
    }),
  );

  api.delete(
    "/users/:userId/strategies/:strategyId",
    wrap(async (req, res) => {
      const ok = deleteUserStrategy(req.params.userId, req.params.strategyId);
      if (!ok) {
        res.status(404).json({ error: "策略不存在" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // 回測
  api.post(
    "/backtest",
    express.json(),
    wrap(async (req, res) => {
      const { symbol, strategyId, rangeDays = 365, stopLossPct = 0.05, takeProfitRatio = 2, maxHoldDays = 20 } = req.body;
      if (!symbol || !strategyId) {
        res.status(400).json({ error: "symbol 與 strategyId 皆需填寫" });
        return;
      }
      // 取得策略（支持內建策略與用戶自訂策略）
      const userId = req.query.userId as string;
      // 先嘗試用戶策略
      let strategy = userId ? getUserStrategy(userId, strategyId) : null;
      // 若找不到，檢查是否為內建策略
      if (!strategy) {
        const builtin = STRATEGIES.find((s) => s.id === strategyId);
        if (builtin) {
          strategy = {
            id: builtin.id,
            userId: 'system',
            name: builtin.name,
            desc: builtin.desc,
            filters: { logic: 'and', conditions: [] },
            triggers: { logic: 'and', conditions: [] },
            invalidations: { logic: 'and', conditions: [] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any;
        }
      }
      if (!strategy) {
        res.status(404).json({ error: "策略不存在" });
        return;
      }
      const result = await runBacktest({
        symbol,
        strategy,
        rangeDays,
        stopLossPct,
        takeProfitRatio,
        maxHoldDays,
      });
      res.json(result);
    }),
  );

  // 批次回測（多策略 × 單一股票）
  api.post(
    "/backtest/batch",
    express.json(),
    wrap(async (req, res) => {
      const { symbol, strategyIds, rangeDays = 365 } = req.body;
      if (!symbol || !Array.isArray(strategyIds)) {
        res.status(400).json({ error: "symbol 與 strategyIds 皆需填寫" });
        return;
      }
      const userId = req.query.userId as string;
      if (!userId) {
        res.status(401).json({ error: "未授權" });
        return;
      }
      const strategies = strategyIds.map((id: string) => getUserStrategy(userId, id)).filter(Boolean);
      if (strategies.length === 0) {
        res.status(404).json({ error: "找不到任何策略" });
        return;
      }
      const results = await runBatchBacktest(symbol, strategies as any, { rangeDays });
      res.json({ symbol, results });
    }),
  );

  // ========== B5 市場狀態機 ==========

  api.get(
    "/regime",
    wrap(async (req, res) => {
      const lookback = Math.max(1, Math.min(20, parseInt(req.query.lookback as string) || 5));
      const { getMarketRegime } = await import("./data/regime");
      res.json(getMarketRegime(lookback));
    }),
  );

  api.get(
    "/regime/today",
    wrap(async (req, res) => {
      const snapshot = await getSnapshot();
      const { getTodayRegime } = await import("./data/regime");
      res.json(getTodayRegime(snapshot.summary));
    }),
  );

  // ========== B0 歷史補檔（開發測試用） ==========
  // 正式上線後 server 自動存檔，此 endpoint 僅在需要快速累積測試資料時使用

  api.post(
    "/history/seed",
    wrap(async (req, res) => {
      const { seedHistory } = await import("./data/history");
      const body = req.body as { start?: string; days?: number } | undefined;
      const start = body?.start || "2026-09-01";
      const days = Math.max(1, Math.min(60, body?.days ?? 7));
      const result = await seedHistory({ start, days });
      res.json(result);
    }),
  );

  api.get(
    "/historical/dates",
    wrap(async (_req, res) => {
      const dates = listArchiveDates();
      res.json({ dates, count: dates.length });
    }),
  );

  api.get(
    "/historical/:date",
    wrap(async (req, res) => {
      const ymd = req.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        res.status(400).json({ error: "日期格式須為 YYYY-MM-DD" });
        return;
      }
      const archive = loadArchiveDate(ymd);
      if (!archive) {
        res.status(404).json({ error: `查無 ${ymd} 的歷史資料` });
        return;
      }
      res.json({
        date: archive.meta.date,
        generatedAt: archive.meta.generatedAt,
        quotes: archive.quotes,
        institutional: Object.fromEntries(archive.institutional.entries()),
        summary: archive.summary,
      });
    }),
  );

  // ========== 匯出端點：所有資料包成一個 JSON blob，供離線 HTML 使用 ==========
  api.get(
    "/export",
    wrap(async (req, res) => {
      const dateStr = req.query.date as string | undefined;
      const snapshot = await getExportSnapshot(dateStr);
      res.json(snapshot);
    }),
  );

  api.use((_, res) => {
    res.status(404).json({ error: "not found" });
  });

  return api;
}

/* ================================================================
 * v2 散戶版 Dashboard & Signal Helpers
 * ================================================================ */

function summarizeMood(sentiment: string, totalYi: number): string {
  if (sentiment === "樂觀" || sentiment === "偏多")
    return `三大法人合計買超約 ${Math.abs(totalYi).toFixed(0)} 億，外資明顯進場，市場氣氛${sentiment === "樂觀" ? "樂觀" : "偏多"}`;
  if (sentiment === "偏空" || sentiment === "恐慌")
    return `三大法人合計賣超約 ${Math.abs(totalYi).toFixed(0)} 億，資金明顯流出，市場氣氛偏空`;
  return `三大法人進出平衡，市場觀望氣氛濃厚`;
}

function buildDashboard(snapshot: Snapshot): DashboardResponse {
  const { summary, institutional } = snapshot;
  const denom = summary.advance + summary.decline;
  const advanceRatio = denom > 0 ? summary.advance / denom : 0.5;

  let sentiment: MarketMood["sentiment"] = "中性";
  if (advanceRatio >= 0.7) sentiment = "樂觀";
  else if (advanceRatio >= 0.6) sentiment = "偏多";
  else if (advanceRatio >= 0.45) sentiment = "中性";
  else if (advanceRatio >= 0.35) sentiment = "偏空";
  else sentiment = "恐慌";

  let foreignTotal = 0, trustTotal = 0, dealerTotal = 0;
  if (institutional) {
    for (const [sym, b] of institutional) {
      const close = snapshot.bySymbol.get(sym)?.close ?? 0;
      foreignTotal += b.foreign * close;
      trustTotal += b.trust * close;
      dealerTotal += b.dealer * close;
    }
  }
  const totalYi = (foreignTotal + trustTotal + dealerTotal) / 1e8;

  const mood: MarketMood = {
    date: snapshot.asOf,
    summaryText: summarizeMood(sentiment, totalYi),
    sentiment,
    foreignFlow: Math.round(foreignTotal / 1e8),
    trustFlow: Math.round(trustTotal / 1e8),
    dealerFlow: Math.round(dealerTotal / 1e8),
    retailMood: advanceRatio > 0.6 ? "偏多" : advanceRatio < 0.4 ? "偏空" : "觀望",
  };

  const themes = buildThemeZones(snapshot);
  const topics: DashboardResponse["topics"] = themes.slice(0, 8).map((z) => ({
    id: z.id,
    name: z.name,
    changePct: z.changePct,
    flowValue: z.flowValue,
    tag: z.status === "聚焦" ? "資金集中" : z.status === "升溫" ? "熱度上升" : z.status === "退潮" ? "資金流出" : "觀察中",
    topStocks: z.topStocks.slice(0, 3),
  }));

  const topBuys = buildTopFive(institutional, snapshot, "buy");
  const topSells = buildTopFive(institutional, snapshot, "sell");

  return { asOf: snapshot.asOf, mood, topics, topBuys, topSells, sectorFlows: buildSectorFlows(snapshot) };
}

function buildTopFive(inst: Map<string, InstitutionalBreakdown> | null, snapshot: Snapshot, kind: "buy" | "sell"): TopFiveGroup {
  if (!inst) return { foreign: [], trust: [], dealer: [] };
  type Entry = { symbol: string; name: string; foreign: number; trust: number; dealer: number };
  const entries: Entry[] = [];
  for (const [sym, b] of inst) {
    const q = snapshot.bySymbol.get(sym);
    if (!q) continue;
    const close = q.close;
    entries.push({ symbol: sym, name: q.name, foreign: b.foreign * close, trust: b.trust * close, dealer: b.dealer * close });
  }
  const sorter = (a: number, b: number) => (kind === "buy" ? b - a : a - b);
  const foreign = [...entries].sort((a, b) => sorter(a.foreign, b.foreign)).slice(0, 5).map((e) => ({ symbol: e.symbol, name: e.name, flow: Math.round(e.foreign / 1e8) }));
  const trust = [...entries].sort((a, b) => sorter(a.trust, b.trust)).slice(0, 5).map((e) => ({ symbol: e.symbol, name: e.name, flow: Math.round(e.trust / 1e8) }));
  const dealer = [...entries].sort((a, b) => sorter(a.dealer, b.dealer)).slice(0, 5).map((e) => ({ symbol: e.symbol, name: e.name, flow: Math.round(e.dealer / 1e8) }));
  return { foreign, trust, dealer };
}

function computeMa(candles: Candle[], n: number): number | null {
  if (candles.length < n) return null;
  const sum = candles.slice(-n).reduce((s, c) => s + c.close, 0);
  return sum / n;
}

function deriveStatus(close: number, ma20: number | null): { status: StockSignalBrief["status"]; reason: string } {
  if (ma20 == null) return { status: "觀察中", reason: "資料不足，無法判斷趨勢" };
  if (close < ma20 * 0.97) return { status: "觀察中", reason: `股價在月線(${ma20.toFixed(0)})下方，趨勢偏弱，先觀望` };
  if (close < ma20) return { status: "觀察中", reason: `即將站上月線(${ma20.toFixed(0)})，先觀望` };
  if (close < ma20 * 1.03) return { status: "可留意", reason: `剛站上月線(${ma20.toFixed(0)})，趨勢可能轉多` };
  return { status: "條件符合", reason: `股價在月線(${ma20.toFixed(0)})上方，趨勢偏多` };
}

async function buildStockSignalsBrief(snapshot: Snapshot, symbols: string[]): Promise<StockSignalBrief[]> {
  const results: StockSignalBrief[] = [];
  const queue = [...symbols];
  const worker = async () => {
    while (queue.length > 0) {
      const sym = queue.shift();
      if (!sym) continue;
      const q = snapshot.bySymbol.get(sym);
      if (!q) {
        results.push({ symbol: sym, name: sym, close: 0, changePct: null, changeAmt: null, status: "觀察中", statusReason: "查無資料", ma20: null, industry: null });
        continue;
      }
      let ma20: number | null = null;
      for (const ySymbol of ySymbolCandidates(sym, q.market)) {
        try {
          const { candles } = await getCachedCandles(ySymbol, "6mo", "1d");
          ma20 = computeMa(candles, 20);
          break;
        } catch { /* 換下一個候選代號 */ }
      }
      const st = deriveStatus(q.close, ma20);
      // 並行抓 Pantlas 補充資料
      const pl = await fetchPantlasStock(sym).catch(() => null);
      const brief: StockSignalBrief = {
        symbol: sym, name: q.name, close: q.close, changePct: q.changePct, changeAmt: q.close - q.prevClose,
        status: st.status, statusReason: st.reason, ma20, industry: q.industry,
      };
      if (pl) {
        brief.pantlas = {
          sector: pl.sector,
          foreignNet5D: pl.foreignNet5D != null ? Math.round(pl.foreignNet5D * pl.price / 1e6) / 100 : null,
          trustNet5D: pl.trustNet5D != null ? Math.round(pl.trustNet5D * pl.price / 1e6) / 100 : null,
          pe: pl.pe,
        };
      }
      results.push(brief);
    }
  };
  // 並發上限 5，避免 Yahoo API 被淹沒
  await Promise.all(Array.from({ length: Math.min(5, Math.max(1, symbols.length)) }, worker));
  return results;
}

/**
 * 研判頁「戰法匹配度」清單——2026-09-12 改成真的接 server/data/strategies.ts 的九戰法，
 * 取代原本寫死在這裡、名字跟九戰法對不上的 4 個簡化版邏輯（順勢回調買入／突破確認／
 * 均線站穩／超跌反彈）。之前掃描頁「選戰法→跳進研判頁自動捲動強調」那個功能，
 * 就是因為兩邊戰法名字系統不一致才一直沒有真的生效，見 MEMORY-strategy-unification.md。
 *
 * 呈現原則（使用者要求）：只給「有參考性」的文字，不是把 evaluateStrategy() 完整的
 * met/missing 技術細節全部倒出來——note 只取第一個句號前的標題句，完整條件細節
 * 留在「掃描」頁的候選清單裡才展開（那裡本來就是給「比較」用的情境，這裡是給
 * 「看懂這一檔」用的情境，資訊密度不同）。
 */
function headline(note: string): string {
  const idx = note.indexOf("。");
  return idx === -1 ? note : note.slice(0, idx);
}

async function buildStrategyMatches(
  facts: ReturnType<typeof buildMarketFacts>,
  ind: IndicatorFacts | null,
  q: Quote,
  snapshot: Snapshot,
  highlightStrategyName: string | null = null,
): Promise<StrategyMatch[]> {
  const zones = buildIndustryZones(snapshot);
  const zoneStatus = zones.find((z) => z.id === q.industry)?.status ?? null;
  const flowYi = q.netBuyValue != null ? q.netBuyValue / 1e8 : null;

  // 只保留「有明確結論」的戰法：觸發（符合）或明確排除（不適用）。
  // 「等待中」沒有明確結論（不算數，過濾掉）；「資料不足」連判斷都做不了（更沒有結論，也過濾掉）。
  // 數字用 100%／0% 二元呈現，不用 met/missing 算出來的模糊比例——
  // 不適用的情況（例如「非下跌趨勢，鯨躍不接刀」）met/missing 陣列的填法不一致，算出來的比例會誤導人，
  // 不如直接用「符合=100、不適用=0」這種一看就懂的二元數字。
  //
  // 例外：使用者從「掃描」頁選了某個戰法點進來（highlightStrategyName），即使那檔股票在
  // 這個戰法上其實是「等待中」，也破例顯示——使用者是為了看這個戰法才點進來的，
  // 過濾掉會讓「掃描選戰法→跳研判頁強調」這個功能看起來像壞掉。
  return STRATEGIES.map((s): StrategyMatch | null => {
    const r = evaluateStrategy(s.id, { facts, ind, quote: q, zoneStatus, flowYi }, q.symbol);
    const isHighlightException = highlightStrategyName != null && s.name === highlightStrategyName;
    if ((r.status === "waiting" || r.status === "insufficient") && !isHighlightException) return null;
    const matchPct = r.status === "triggered" ? 100 : r.status === "waiting" ? 50 : 0;
    const status: StrategyMatch["status"] = r.status === "triggered" ? "符合" : r.status === "waiting" ? "等待中" : "不適用";
    return { name: s.name, matchPct, status, plainText: headline(r.note) };
  }).filter((m): m is StrategyMatch => m != null);
}

function buildAdvice(status: StockSignal["status"], facts: ReturnType<typeof buildMarketFacts>, ma20: number | null, close: number): string[] {
  const advice: string[] = [];
  if (status === "觀察中") {
    advice.push(`現在還不適合進場，股價在月線${ma20 ? `(${ma20.toFixed(0)})` : ""}下方或附近`);
  } else if (status === "可留意") {
    advice.push(`剛站上月線，趨勢可能轉多，可以開始留意`);
  } else if (status === "條件符合") {
    advice.push(`趨勢偏多，等回調到支撐區再考慮進場`);
  }
  if (facts?.support) {
    advice.push(`如果回調到 ${facts.support.low.toFixed(0)}–${facts.support.high.toFixed(0)} 且止跌，可以考慮`);
    advice.push(`如果跌破 ${facts.support.low.toFixed(0)}，這波漲勢可能結束，先停損觀望`);
  }
  if (facts?.resistance) {
    advice.push(`壓力區在 ${facts.resistance.low.toFixed(0)}–${facts.resistance.high.toFixed(0)}，不要追高`);
  }
  if (!facts?.support && !facts?.resistance) {
    advice.push(`目前還沒有明確的支撐／壓力區，先觀察`);
  }
  return advice;
}

/* ---------- B0 連買超天數計算 ---------- */

/**
 * 計算某檔股票各法人的連續買賣超天數。
 * 優先使用今日 snapshot；無資料則回推历史存檔（最多往前 30 天）。
 * 正數 = 連續買超，負數 = 連續賣超，0 = 無足夠歷史。
 */
function countConsecutiveDays(
  symbol: string,
  snapshot: Snapshot,
): { foreign: number; trust: number; dealer: number } {
  const todayInst = snapshot.institutional?.get(symbol);
  if (!todayInst) return { foreign: 0, trust: 0, dealer: 0 };

  const results = { foreign: 0, trust: 0, dealer: 0 };
  // 正數：從今天開始向後數「連續買超」的天數
  // 負數：從今天開始向後數「連續賣超」的天數（僅當今日為賣超時）
  const lookback = Math.min(listArchiveDates().length, 30);

  for (let i = 0; i < lookback; i++) {
    const ymd = i === 0 ? snapshot.asOf : listArchiveDates()[i];
    const archive = i === 0 ? null : loadArchiveDate(ymd);
    const dayInst = archive?.institutional.get(symbol) ?? todayInst;
    if (!dayInst) break;

    for (const key of ["foreign", "trust", "dealer"] as const) {
      const n = results[key];
      const val = dayInst[key];
      if (val > 0 && n >= 0) results[key] = n + 1;
      else if (val < 0 && n <= 0) results[key] = n - 1;
      else break; // 趨勢中斷
    }
  }
  return results;
}

async function buildStockSignal(snapshot: Snapshot, symbol: string, highlightStrategyName: string | null = null): Promise<StockSignal | null> {
  const q = snapshot.bySymbol.get(symbol);
  if (!q) return null;

  let candles: Candle[] = [];
  for (const ySymbol of ySymbolCandidates(symbol, q.market)) {
    try {
      const { candles: fetched } = await getCachedCandles(ySymbol, "2y", "1d");
      candles = fetched;
      break;
    } catch { /* 換下一個 */ }
  }
  if (candles.length < 30) return null;

  const facts = buildMarketFacts(candles);
  const ind = buildIndicatorFacts(candles);
  const ma20 = computeMa(candles, 20);
  const ma60 = computeMa(candles, 60);
  const inst = snapshot.institutional?.get(symbol);
  const st = deriveStatus(q.close, ma20);
  // 抓取 Pantlas 補充資料（async；失敗不影響主流程）
  const pantlas = await fetchPantlasStock(symbol).catch(() => null);

  return {
    symbol,
    name: q.name,
    industry: q.industry,
    close: q.close,
    changePct: q.changePct,
    changeAmt: q.close - q.prevClose,
    status: st.status,
    statusReason: st.reason,
    pricePosition: {
      current: q.close,
      ma20,
      ma60,
      support: facts?.support ? [facts.support.low, facts.support.high] : null,
      resistance: facts?.resistance ? [facts.resistance.low, facts.resistance.high] : null,
      invalidation: facts?.invalidation ?? null,
      recentSwingLow: facts?.swings.lastLow?.price ?? null,
    },
    strategies: await buildStrategyMatches(facts, ind, q, snapshot, highlightStrategyName),
    advice: buildAdvice(st.status, facts, ma20, q.close),
    institutional: {
      foreign: inst ? Math.round((inst.foreign * q.close) / 1e8) : null,
      trust: inst ? Math.round((inst.trust * q.close) / 1e8) : null,
      dealer: inst ? Math.round((inst.dealer * q.close) / 1e8) : null,
    },
    consecutiveDays: countConsecutiveDays(symbol, snapshot),
    pantlas5D: pantlas
      ? {
          foreign: pantlas.foreignNet5D != null ? Math.round(pantlas.foreignNet5D * pantlas.price / 1e6) / 100 : null,
          trust: pantlas.trustNet5D != null ? Math.round(pantlas.trustNet5D * pantlas.price / 1e6) / 100 : null,
          dealer: pantlas.dealerNet5D != null ? Math.round(pantlas.dealerNet5D * pantlas.price / 1e6) / 100 : null,
        }
      : null,
    pantlasFundamentals: pantlas
      ? {
          pe: pantlas.pe,
          pbr: pantlas.pbr,
          dividendYield: pantlas.dividendYield,
          grossMarginPercent: pantlas.grossMarginPercent,
          revenueYoY: pantlas.revenueYearOverYear,
          latestQuarter: pantlas.latestQuarter,
        }
      : null,
    asOf: snapshot.asOf,
  };
}
