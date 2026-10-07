#!/usr/bin/env node
/**
 * =============================================================================
 *  Gold Tracker – daily data fetcher (runs in GitHub Actions, Node 20+)
 * =============================================================================
 *  Pure Node.js, zero npm dependencies (uses the built-in global fetch).
 *
 *  What it does on every run:
 *    1. DOJI Ring 9999   -> scrape today's SELL price from banggia.doji.vn
 *                           (+ merge an optional one-time backfill CSV)
 *    2. XAU/USD          -> daily close from Stooq CSV (free, no key);
 *                           fallback: Yahoo Finance GC=F (gold futures proxy)
 *    3. USD/VND          -> Vietcombank SELLING rate, per calendar day,
 *                           from VCB's public exchange-rate endpoint
 *    4. Builds the daily calendar, carries XAU and FX forward over
 *       weekends/holidays and computes `convertedGoldVndTael`.
 *    5. Writes JSON files under ../data ONLY when content actually changed,
 *       so the workflow commits nothing on "no-change" days.
 *
 *  Environment variables (all optional):
 *    HISTORY_DAYS     initial look-back window in days          (default 92)
 *    FX_REFRESH_DAYS  re-fetch the last N days of VCB rates      (default 7)
 *    BACKFILL_DAYS    force re-fetch of FX for the last N days   (default 0)
 *    DOJI_PRODUCT     product row to match (accent-insensitive)
 *                     (default "NHAN TRON 9999")
 *    XAU_FALLBACK     "yahoo" | "none"                           (default yahoo)
 * =============================================================================
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// Constants & configuration
// -----------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const BACKFILL_CSV = path.join(DATA_DIR, 'backfill', 'doji-ring.csv');

const TZ = 'Asia/Ho_Chi_Minh';
const SCHEMA_VERSION = 1;

/*
 * Unit conversion used for the international price:
 *   1 Vietnamese tael (lượng) = 37.5 g
 *   1 troy ounce               = 31.1034768 g
 *   => 1 tael = 37.5 / 31.1034768 ≈ 1.205653 troy oz
 */
const GRAMS_PER_TAEL = 37.5;
const GRAMS_PER_TROY_OZ = 31.1034768;
const OZ_PER_TAEL = GRAMS_PER_TAEL / GRAMS_PER_TROY_OZ;

/* 1 lượng (tael) = 10 chỉ. DOJI publishes in "Nghìn VND/chỉ" (thousand VND per chỉ). */
const CHI_PER_TAEL = 10;

/* Sanity band for a DOJI ring price in VND/tael – protects against parsing errors. */
const DOJI_MIN_VND_TAEL = 30_000_000;
const DOJI_MAX_VND_TAEL = 1_000_000_000;

const CONFIG = {
  historyDays: toInt(process.env.HISTORY_DAYS, 92),
  fxRefreshDays: toInt(process.env.FX_REFRESH_DAYS, 7),
  backfillDays: toInt(process.env.BACKFILL_DAYS, 0),
  dojiProduct: normalizeText(process.env.DOJI_PRODUCT || 'NHAN TRON 9999'),
  xauFallback: (process.env.XAU_FALLBACK || 'yahoo').toLowerCase(),
  dojiUrls: ['https://banggia.doji.vn/', 'https://banggia.doji.vn/gold-price'],
  stooqUrl: 'https://stooq.com/q/d/l/?s=xauusd&i=d',
  yahooUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1y&interval=1d',
  vcbApi: (d) => `https://www.vietcombank.com.vn/api/exchangerates?date=${d}`,
  vcbXml: 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx',
  requestDelayMs: 350,
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 gold-tracker-bot',
};

const FILES = {
  doji: path.join(DATA_DIR, 'doji-ring.json'),
  xau: path.join(DATA_DIR, 'xau-usd.json'),
  fx: path.join(DATA_DIR, 'usd-vnd.json'),
  converted: path.join(DATA_DIR, 'converted-gold.json'),
  meta: path.join(DATA_DIR, 'meta.json'),
};

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------
function toInt(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Today's date (YYYY-MM-DD) in Hanoi time – all daily keys use Hanoi dates. */
function todayHanoi() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** ISO timestamp with +07:00 offset, e.g. 2026-10-04T17:30:12+07:00 */
function nowHanoiIso() {
  const d = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`;
}

/** Add n days to a YYYY-MM-DD string (pure calendar arithmetic in UTC). */
function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of calendar dates between two YYYY-MM-DD strings. */
function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Remove Vietnamese diacritics + uppercase, so matching is accent-insensitive. */
function normalizeText(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase();
}

/** "26,400.00" -> 26400 ; "14.350" (vi-VN thousands) handled by caller. */
function parseEnNumber(s) {
  if (s === null || s === undefined) return NaN;
  const n = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

async function fetchText(url, { retries = 3, timeoutMs = 20000, accept } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': CONFIG.userAgent, ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * attempt); // linear back-off
    }
  }
  throw lastErr;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write pretty JSON only when content differs. Returns true if written. */
async function writeJsonIfChanged(file, obj) {
  const next = `${JSON.stringify(obj, null, 2)}\n`;
  let prev = null;
  try { prev = await readFile(file, 'utf8'); } catch { /* new file */ }
  if (prev === next) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next, 'utf8');
  return true;
}

/**
 * Merge records keyed by `date`. Incoming rows replace existing rows for the
 * same date only if their value fields differ (fields in `ignore` such as
 * `capturedAt` are excluded from the comparison) – this keeps the files
 * byte-stable when nothing really changed.
 */
function upsertByDate(existing, incoming, ignore = []) {
  const strip = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !ignore.includes(k))));
  const map = new Map(existing.map((r) => [r.date, r]));
  for (const r of incoming) {
    const old = map.get(r.date);
    if (!old || strip(old) !== strip(r)) map.set(r.date, r);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Load a dataset; if it is the bundled SAMPLE file, discard its rows. */
async function loadDataset(file) {
  const json = await readJson(file, null);
  if (!json || !Array.isArray(json.data) || json.meta?.sample === true) return [];
  return json.data;
}

// -----------------------------------------------------------------------------
// 1) DOJI Ring 9999 – today's snapshot (scrape) + optional backfill CSV
// -----------------------------------------------------------------------------
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, ' ');
}

/**
 * Parse the DOJI price board.
 * The board lists rows like:
 *   "3 NHẪN TRÒN 9999 HƯNG THỊNH VƯỢNG 13,950 14,350"   (buy, sell)
 * followed later by a unit caption such as "Đơn vị: Nghìn VND/chỉ".
 *
 * Transformation to VND per tael:
 *   value_VND_tael = raw × unitMultiplier × chiMultiplier
 *     unitMultiplier = 1000 if the caption says "Nghìn" (thousand VND), else 1
 *     chiMultiplier  = 10   if the caption says "/chỉ" (1 tael = 10 chỉ), else 1
 *   Example: 14,350 (nghìn VND/chỉ) × 1000 × 10 = 143,500,000 VND/tael
 */
export function parseDojiBoard(html, productPattern = CONFIG.dojiProduct) {
  const text = normalizeText(htmlToText(html));
  const idx = text.indexOf(productPattern);
  if (idx < 0) throw new Error(`DOJI: product "${productPattern}" not found on page`);

  // First two numbers after the product name = buy, sell
  const window = text.slice(idx + productPattern.length, idx + productPattern.length + 250);
  const nums = [...window.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})/g)]
    .map((m) => Number(m[1].replace(/[.,]/g, '')));
  if (nums.length < 2) throw new Error('DOJI: could not find buy/sell numbers next to product');
  const [rawBuy, rawSell] = nums;

  // Unit caption that follows the gold table (the silver table above uses /LUONG)
  const unitMatch = text.slice(idx).match(/DON VI\s*:?\s*([A-Z ]{0,20}VN[DĐ]?\s*\/\s*[A-Z]+)/);
  const unitRaw = unitMatch ? unitMatch[1].replace(/\s+/g, ' ').trim() : null;

  let unitMultiplier;
  let chiMultiplier;
  if (unitRaw) {
    unitMultiplier = /NGHIN/.test(unitRaw) ? 1000 : 1;
    chiMultiplier = /\/\s*CHI/.test(unitRaw) ? CHI_PER_TAEL : 1;
  } else {
    // Heuristic fallback when the caption is missing:
    //  < 100,000 -> quoted in thousand VND; then if < 30M VND -> per chỉ
    unitMultiplier = rawSell < 100_000 ? 1000 : 1;
    chiMultiplier = rawSell * unitMultiplier < DOJI_MIN_VND_TAEL ? CHI_PER_TAEL : 1;
  }

  const buy = rawBuy * unitMultiplier * chiMultiplier;
  const sell = rawSell * unitMultiplier * chiMultiplier;

  if (sell < DOJI_MIN_VND_TAEL || sell > DOJI_MAX_VND_TAEL) {
    throw new Error(`DOJI: sell price ${sell} VND/tael outside sanity band – parser needs review`);
  }
  if (buy > sell) throw new Error('DOJI: buy > sell – columns may have shifted');

  return { buy, sell, sourceUnit: unitRaw || 'heuristic' };
}

async function fetchDojiToday() {
  let lastErr;
  for (const url of CONFIG.dojiUrls) {
    try {
      const html = await fetchText(url, { accept: 'text/html' });
      const p = parseDojiBoard(html);
      return {
        date: todayHanoi(),
        buy: p.buy,
        sell: p.sell, // <-- the series charted (SELL price, VND/tael)
        sourceUnit: p.sourceUnit,
        capturedAt: nowHanoiIso(),
        src: url,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Optional one-time backfill: data/backfill/doji-ring.csv
 *   date,sell[,buy]      (values in VND per tael, e.g. 2026-07-05,151400000,148400000)
 * Lines starting with # are ignored. Scraped rows always win over backfill rows.
 */
async function readDojiBackfill() {
  let csv;
  try { csv = await readFile(BACKFILL_CSV, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of csv.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || /^date/i.test(t)) continue;
    const [date, sell, buy] = t.split(/[;,]/).map((s) => s.trim());
    const s = Number(sell);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(s)) continue;
    if (s < DOJI_MIN_VND_TAEL || s > DOJI_MAX_VND_TAEL) continue; // must already be VND/tael
    rows.push({ date, buy: Number(buy) || null, sell: s, sourceUnit: 'backfill VND/tael', capturedAt: null, src: 'backfill-csv' });
  }
  return rows;
}

// -----------------------------------------------------------------------------
// 2) XAU/USD – Stooq daily close (fallback Yahoo GC=F)
// -----------------------------------------------------------------------------
/** Stooq CSV: Date,Open,High,Low,Close[,Volume] – we keep the Close (USD/oz). */
function parseStooqCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!/^Date,Open,High,Low,Close/i.test(lines[0] || '')) {
    throw new Error(`Stooq: unexpected response "${(lines[0] || '').slice(0, 80)}"`);
  }
  return lines.slice(1).map((l) => {
    const [date, , , , close] = l.split(',');
    return { date, close: Number(close), src: 'stooq' };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close) && r.close > 0);
}

/** Yahoo chart API (no key). GC=F = COMEX gold futures, used only as a proxy. */
function parseYahooChart(jsonText) {
  const j = JSON.parse(jsonText);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error('Yahoo: empty result');
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  return ts.map((t, i) => ({ date: fmt.format(new Date(t * 1000)), close: closes[i], src: 'yahoo:GC=F' }))
    .filter((x) => Number.isFinite(x.close) && x.close > 0)
    .map((x) => ({ ...x, close: Math.round(x.close * 100) / 100 }));
}

async function fetchXau() {
  try {
    return { rows: parseStooqCsv(await fetchText(CONFIG.stooqUrl)), source: 'stooq' };
  } catch (err) {
    if (CONFIG.xauFallback !== 'yahoo') throw err;
    console.warn(`  ! Stooq failed (${err.message}) – trying Yahoo GC=F fallback`);
    return { rows: parseYahooChart(await fetchText(CONFIG.yahooUrl)), source: 'yahoo:GC=F' };
  }
}

// -----------------------------------------------------------------------------
// 3) USD/VND – Vietcombank SELLING rate per calendar day
// -----------------------------------------------------------------------------
/**
 * VCB endpoint returns e.g.
 *   { "Date": "2026-10-02T00:00:00", "Data": [ { "currencyCode": "USD",
 *       "cash": "26,120.00", "transfer": "26,150.00", "sell": "26,400.00" }, ... ] }
 * Field casing has varied historically, so lookups are case-insensitive.
 */
function pick(obj, ...keys) {
  if (!obj) return undefined;
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) if (lower[k.toLowerCase()] !== undefined) return lower[k.toLowerCase()];
  return undefined;
}

async function fetchVcbForDate(date) {
  const j = JSON.parse(await fetchText(CONFIG.vcbApi(date), { accept: 'application/json' }));
  const list = pick(j, 'Data') || [];
  const usd = list.find((x) => String(pick(x, 'currencyCode')).toUpperCase() === 'USD');
  if (!usd) return null;
  const sell = parseEnNumber(pick(usd, 'sell'));
  if (!Number.isFinite(sell) || sell <= 0) return null;
  const rateDate = String(pick(j, 'Date') || date).slice(0, 10);
  return {
    date,                                   // calendar day requested (Hanoi)
    sell,                                   // <-- series used (VCB selling rate)
    transfer: parseEnNumber(pick(usd, 'transfer')) || null,
    buyCash: parseEnNumber(pick(usd, 'cash')) || null,
    rateDate,                               // date VCB says the rate belongs to
    filled: rateDate !== date,              // true when VCB returned an earlier day's rate
    src: 'vcb-api',
  };
}

/** Fallback for TODAY only: VCB XML feed <Exrate CurrencyCode="USD" Sell="26,400.00" .../> */
async function fetchVcbXmlToday() {
  const xml = await fetchText(CONFIG.vcbXml, { accept: 'application/xml' });
  const m = xml.match(/<Exrate[^>]*CurrencyCode="USD"[^>]*>/i);
  if (!m) throw new Error('VCB XML: USD row not found');
  const attr = (n) => (m[0].match(new RegExp(`${n}="([^"]+)"`, 'i')) || [])[1];
  const sell = parseEnNumber(attr('Sell'));
  if (!Number.isFinite(sell)) throw new Error('VCB XML: invalid Sell');
  const today = todayHanoi();
  return { date: today, sell, transfer: parseEnNumber(attr('Transfer')) || null, buyCash: parseEnNumber(attr('Buy')) || null, rateDate: today, filled: false, src: 'vcb-xml' };
}

async function fetchFx(existing, windowStart, today) {
  const have = new Set(existing.map((r) => r.date));
  const refreshFrom = addDays(today, -Math.max(CONFIG.fxRefreshDays, CONFIG.backfillDays));
  // Fetch: (a) every day missing in the window, (b) the most recent N days (revisions)
  const dates = dateRange(windowStart, today).filter((d) => !have.has(d) || d >= refreshFrom);

  const rows = [];
  const errors = [];
  for (const d of dates) {
    try {
      const r = await fetchVcbForDate(d);
      if (r) rows.push(r);
    } catch (err) {
      errors.push(`${d}: ${err.message}`);
    }
    await sleep(CONFIG.requestDelayMs); // be polite to the bank's server
  }
  if (!rows.some((r) => r.date === today)) {
    try { rows.push(await fetchVcbXmlToday()); } catch (err) { errors.push(`xml: ${err.message}`); }
  }
  return { rows, errors, requested: dates.length };
}

// -----------------------------------------------------------------------------
// 4) Derived series: convertedGoldVndTael + DOJI premium
// -----------------------------------------------------------------------------
/**
 * Build a gap-free daily calendar and compute, for every day D:
 *
 *   XAU_USD_Oz(D) = Stooq close on D, or the last close before D (carry-forward,
 *                   flagged xauFilled=true) – gold does not trade on weekends.
 *   USD_VND(D)    = VCB selling rate on D, or the last rate before D
 *                   (carry-forward, flagged fxFilled=true).
 *
 *   Gold_VND_Tael(D) = XAU_USD_Oz × USD_VND × 37.5 / 31.1034768
 *                      └── USD/oz ──┘ └VND/USD┘ └── oz per tael ──┘
 *                    = VND per tael (rounded to the nearest đồng)
 *
 *   Premium(D) (only where a DOJI sell price exists for D):
 *     diffVnd = DOJI_sell − Gold_VND_Tael
 *     diffPct = diffVnd / Gold_VND_Tael × 100
 *
 * NOTE: the converted value excludes import duties, VAT, fabrication and
 * dealer margin – the premium therefore reflects all local frictions.
 */
export function buildConverted(doji, xau, fx) {
  const firstDates = [doji[0]?.date, xau[0]?.date, fx[0]?.date].filter(Boolean).sort();
  const lastDates = [doji.at(-1)?.date, xau.at(-1)?.date, fx.at(-1)?.date].filter(Boolean).sort();
  if (!firstDates.length) return { convertedGoldVndTael: [], premium: [] };

  const xauMap = new Map(xau.map((r) => [r.date, r.close]));
  const fxMap = new Map(fx.map((r) => [r.date, r]));
  const dojiMap = new Map(doji.map((r) => [r.date, r.sell]));

  const converted = [];
  const premium = [];
  let lastXau = null;
  let lastFx = null;

  for (const date of dateRange(firstDates[0], lastDates.at(-1))) {
    // --- carry-forward logic -------------------------------------------------
    let xauFilled = true;
    if (xauMap.has(date)) { lastXau = xauMap.get(date); xauFilled = false; }

    let fxFilled = true;
    if (fxMap.has(date)) { lastFx = fxMap.get(date).sell; fxFilled = Boolean(fxMap.get(date).filled); }

    if (lastXau === null || lastFx === null) continue; // not enough history yet

    // --- core formula ----------------------------------------------------------
    const value = Math.round(lastXau * lastFx * GRAMS_PER_TAEL / GRAMS_PER_TROY_OZ);

    converted.push({ date, value, xauUsdOz: lastXau, usdVnd: lastFx, xauFilled, fxFilled });

    if (dojiMap.has(date)) {
      const dojiSell = dojiMap.get(date);
      const diffVnd = dojiSell - value;
      premium.push({ date, dojiSell, converted: value, diffVnd, diffPct: Math.round((diffVnd / value) * 10000) / 100 });
    }
  }
  return { convertedGoldVndTael: converted, premium };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  const today = todayHanoi();
  const prevMeta = await readJson(FILES.meta, {});
  const status = {};
  console.log(`Gold Tracker update – Hanoi date ${today}`);

  // Load existing (sample files are ignored so the first run starts clean)
  let doji = await loadDataset(FILES.doji);
  let xau = await loadDataset(FILES.xau);
  let fx = await loadDataset(FILES.fx);

  // Window start: keep everything already stored; new history goes back HISTORY_DAYS
  const defaultStart = addDays(today, -CONFIG.historyDays);
  const earliest = (rows) => (rows[0]?.date && rows[0].date < defaultStart ? rows[0].date : defaultStart);

  // ---- DOJI -----------------------------------------------------------------
  console.log('• DOJI Ring 9999');
  try {
    const backfill = await readDojiBackfill();
    // backfill first, so that scraped rows (existing + today) override it
    doji = upsertByDate(backfill.filter((b) => !doji.some((d) => d.date === b.date)), doji);
    const snap = await fetchDojiToday();
    doji = upsertByDate(doji, [snap], ['capturedAt']);
    status.doji = { status: 'ok', lastSuccess: nowHanoiIso(), message: `sell ${snap.sell.toLocaleString('en-US')} VND/tael (${snap.sourceUnit})`, backfillRows: backfill.length };
    console.log(`  ✓ ${status.doji.message}`);
  } catch (err) {
    status.doji = { status: 'error', lastSuccess: prevMeta?.sources?.doji?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- XAU/USD --------------------------------------------------------------
  console.log('• XAU/USD');
  try {
    const { rows, source } = await fetchXau();
    const start = earliest(xau);
    // Re-ingest the whole window so provider revisions are picked up
    xau = upsertByDate(xau, rows.filter((r) => r.date >= start && r.date <= today));
    const last = xau.at(-1);
    status.xau = { status: 'ok', lastSuccess: nowHanoiIso(), message: `${source}: last close ${last?.close} on ${last?.date}`, source };
    console.log(`  ✓ ${status.xau.message}`);
  } catch (err) {
    status.xau = { status: 'error', lastSuccess: prevMeta?.sources?.xau?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- USD/VND --------------------------------------------------------------
  console.log('• USD/VND (Vietcombank selling)');
  try {
    const { rows, errors, requested } = await fetchFx(fx, earliest(fx), today);
    if (!rows.length && requested) throw new Error(`no VCB rows returned (${errors.slice(0, 3).join(' | ')})`);
    fx = upsertByDate(fx, rows);
    status.fx = {
      status: errors.length ? 'partial' : 'ok',
      lastSuccess: nowHanoiIso(),
      message: `${rows.length}/${requested} days fetched${errors.length ? `, ${errors.length} errors` : ''}`,
    };
    console.log(`  ✓ ${status.fx.message}`);
  } catch (err) {
    status.fx = { status: 'error', lastSuccess: prevMeta?.sources?.fx?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- Derived --------------------------------------------------------------
  const derived = buildConverted(doji, xau, fx);

  const datasetMeta = (extra) => ({ schemaVersion: SCHEMA_VERSION, sample: false, timezone: TZ, ...extra });
  const written = await Promise.all([
    writeJsonIfChanged(FILES.doji, { meta: datasetMeta({ dataset: 'doji-ring', product: 'DOJI Nhẫn Tròn 9999 Hưng Thịnh Vượng', field: 'sell', unit: 'VND/tael', source: 'https://banggia.doji.vn' }), data: doji }),
    writeJsonIfChanged(FILES.xau, { meta: datasetMeta({ dataset: 'xau-usd', field: 'close', unit: 'USD/troy oz', source: 'stooq.com (xauusd), fallback Yahoo GC=F' }), data: xau }),
    writeJsonIfChanged(FILES.fx, { meta: datasetMeta({ dataset: 'usd-vnd', field: 'sell', unit: 'VND per USD', source: 'Vietcombank selling rate' }), data: fx }),
    writeJsonIfChanged(FILES.converted, {
      meta: datasetMeta({
        dataset: 'converted-gold',
        unit: 'VND/tael',
        formula: 'XAU_USD_Oz × USD_VND × 37.5 / 31.1034768',
        ozPerTael: Number(OZ_PER_TAEL.toFixed(6)),
        notes: 'Weekend/holiday gaps carried forward from the last available value (xauFilled / fxFilled = true).',
      }),
      convertedGoldVndTael: derived.convertedGoldVndTael,
      premium: derived.premium,
    }),
  ]);

  const anyDataChanged = written.some(Boolean);
  const statusChanged = JSON.stringify(Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v.status])))
    !== JSON.stringify(Object.fromEntries(Object.entries(prevMeta.sources || {}).map(([k, v]) => [k, v.status])));

  if (anyDataChanged || statusChanged || prevMeta.sample) {
    await writeJsonIfChanged(FILES.meta, {
      schemaVersion: SCHEMA_VERSION,
      sample: false,
      lastUpdated: nowHanoiIso(),
      timezone: TZ,
      sources: status,
      counts: { doji: doji.length, xau: xau.length, fx: fx.length, converted: derived.convertedGoldVndTael.length },
    });
  }

  console.log(anyDataChanged ? 'Data changed – files written.' : 'No data change.');

  // Fail the workflow only if EVERY source failed (partial failures are shown in the UI)
  if (Object.values(status).every((s) => s.status === 'error')) {
    console.error('All sources failed.');
    process.exit(1);
  }
}

// Allow importing parse/compute functions in tests without running main()
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
