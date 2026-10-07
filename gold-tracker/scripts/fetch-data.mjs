#!/usr/bin/env node
/**
 * =============================================================================
 *  Gold Tracker – data fetcher (runs in GitHub Actions, Node 20+)
 * =============================================================================
 *  Pure Node.js, zero npm dependencies (uses the built-in global fetch).
 *
 *  DATA MODEL: "frozen history + daily append"
 *  ------------------------------------------------------------------
 *  • History starts on START_DATE = 2026-06-11 (first day giavang24k stores).
 *  • Every stored day is FROZEN: once a date exists in a dataset it is NEVER
 *    overwritten or deleted by later runs.
 *  • Runs only ADD dates that are missing (today + any days missed by failed
 *    runs = "catch-up").
 *
 *  MODES (env MODE)
 *  ------------------------------------------------------------------
 *  seed    One-time initial load.
 *            DOJI : data/seed/doji-nhan-1y.json (pasted API response) or,
 *                   if that file is absent, GET .../doji-nhan?range=1y
 *            XAU  : Stooq daily closes from START_DATE
 *            FX   : Vietcombank selling rate for every day from START_DATE
 *          Refuses to run if real data already exists, unless FORCE=true.
 *  append  Daily run (default, used by the cron schedule).
 *            DOJI : GET .../doji-nhan?range=7d  (falls back to range=1y only
 *                   when the gap since the last stored day is > 7 days)
 *            XAU  : Stooq – add completed daily bars not yet stored
 *            FX   : Vietcombank – add missing days (last CATCHUP_DAYS days)
 *
 *  SOURCES
 *    DOJI Nhẫn tròn 9999 (Hưng Thịnh Vượng) – giavang24k.com (sell close, VND/lượng)
 *    XAU/USD  – Stooq xauusd daily close (fallback Yahoo GC=F), USD/troy oz
 *    USD/VND  – Vietcombank selling rate, VND per USD
 *
 *  Environment variables (all optional):
 *    MODE          "append" | "seed"                         (default append)
 *    FORCE         "true" to allow seed over existing data   (default false)
 *    CATCHUP_DAYS  how far back append mode looks for gaps   (default 31)
 *    XAU_FALLBACK  "yahoo" | "none"                          (default yahoo)
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
const SEED_FILE = path.join(DATA_DIR, 'seed', 'doji-nhan-1y.json');

const TZ = 'Asia/Ho_Chi_Minh';
const SCHEMA_VERSION = 2;
export const START_DATE = '2026-06-11'; // first day of giavang24k history

/*
 * Unit conversion used for the international price:
 *   1 Vietnamese tael (lượng) = 37.5 g
 *   1 troy ounce               = 31.1034768 g
 *   => 1 tael = 37.5 / 31.1034768 ≈ 1.205653 troy oz
 */
const GRAMS_PER_TAEL = 37.5;
const GRAMS_PER_TROY_OZ = 31.1034768;
const OZ_PER_TAEL = GRAMS_PER_TAEL / GRAMS_PER_TROY_OZ;

/* Sanity band for a DOJI ring price in VND/tael – protects against unit errors. */
const DOJI_MIN_VND_TAEL = 30_000_000;
const DOJI_MAX_VND_TAEL = 1_000_000_000;

const CONFIG = {
  mode: (process.env.MODE || 'append').toLowerCase(),
  force: String(process.env.FORCE || 'false').toLowerCase() === 'true',
  catchupDays: toInt(process.env.CATCHUP_DAYS, 31),
  xauFallback: (process.env.XAU_FALLBACK || 'yahoo').toLowerCase(),
  dojiApi: (range) => `https://giavang24k.com/api/history/doji-nhan?range=${range}`,
  stooqUrl: 'https://stooq.com/q/d/l/?s=xauusd&i=d',
  yahooUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1y&interval=1d',
  vcbApi: (d) => `https://www.vietcombank.com.vn/api/exchangerates?date=${d}`,
  vcbXml: 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx',
  requestDelayMs: 350,
  // Standard desktop browser User-Agent (agreed: plain GET, browser UA)
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
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
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Date (YYYY-MM-DD) in Hanoi time for a Date object – all keys use Hanoi dates. */
function hanoiDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** ISO timestamp with +07:00 offset, e.g. 2026-10-04T21:00:12+07:00 */
function nowHanoiIso() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
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

/** "26,400.00" -> 26400 */
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
        headers: {
          'User-Agent': CONFIG.userAgent,
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
          ...(accept ? { Accept: accept } : {}),
        },
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
 * FROZEN-HISTORY MERGE.
 * Adds only rows whose `date` is not already stored. Existing rows are never
 * replaced – this is what keeps history from 11 Jun 2026 static.
 * Returns { rows, added } where `added` lists the newly inserted dates.
 */
export function appendOnly(existing, incoming) {
  const have = new Set(existing.map((r) => r.date));
  const added = [];
  const rows = [...existing];
  for (const r of incoming) {
    if (!isIsoDate(r.date) || r.date < START_DATE || have.has(r.date)) continue;
    have.add(r.date);
    rows.push(r);
    added.push(r.date);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, added: added.sort() };
}

/** Load a dataset; bundled SAMPLE files are discarded (treated as empty). */
async function loadDataset(file) {
  const json = await readJson(file, null);
  if (!json || !Array.isArray(json.data) || json.meta?.sample === true) return [];
  return json.data.filter((r) => isIsoDate(r.date) && r.date >= START_DATE);
}

// -----------------------------------------------------------------------------
// 1) DOJI Nhẫn tròn 9999 – giavang24k.com
// -----------------------------------------------------------------------------
/**
 * Expected response (range=1y, kind=daily):
 *   { "productKey": "doji-nhan", "range": "1y", "kind": "daily",
 *     "points": [ { "day": "2026-06-11",
 *                   "buy":  { "open":…, "high":…, "low":…, "close": 133400000 },
 *                   "sell": { "open":…, "high":…, "low":…, "close": 138400000 },
 *                   "spreadAvg": 5000000 }, … ] }
 *
 * Transformation to one record per Hanoi calendar day:
 *   date = point.day                       (already "YYYY-MM-DD")
 *   sell = point.sell.close                (VND per lượng – charted series)
 *   buy  = point.buy.close                 (VND per lượng)
 *
 * Defensive handling in case range=7d returns INTRADAY points instead of daily
 * candles (no "day" field, but a timestamp such as "t"/"time"/"ts"):
 *   date = Hanoi date of the timestamp; points are grouped per date and the
 *   LAST point of the day is kept as that day's close.
 *
 * Unit guard: if a value looks like million VND (e.g. 143.5) it is × 1,000,000.
 */
export function parseGiavang24k(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const points = Array.isArray(obj) ? obj : obj?.points;
  if (!Array.isArray(points)) throw new Error('giavang24k: response has no "points" array');

  const toVnd = (v) => {
    const n = Number(typeof v === 'object' && v !== null ? v.close : v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1000 ? Math.round(n * 1_000_000) : Math.round(n); // million VND guard
  };
  const tsOf = (p) => p.t ?? p.time ?? p.ts ?? p.timestamp ?? p.at ?? null;

  const byDate = new Map(); // date -> { record, order }
  points.forEach((p, i) => {
    let date = isIsoDate(p.day) ? p.day : isIsoDate(p.date) ? p.date : null;
    let order = i;
    if (!date) {
      const ts = tsOf(p);
      if (ts === null) return;
      const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
      if (!Number.isFinite(ms)) return;
      date = hanoiDate(new Date(ms));
      order = ms;
    }
    const sell = toVnd(p.sell);
    if (sell === null) return;
    if (sell < DOJI_MIN_VND_TAEL || sell > DOJI_MAX_VND_TAEL) {
      throw new Error(`giavang24k: sell ${sell} on ${date} outside sanity band – unit changed?`);
    }
    const buy = toVnd(p.buy);
    const rec = {
      date,
      sell,                                    // <-- charted series, VND/lượng
      buy,
      spreadAvg: Number.isFinite(Number(p.spreadAvg)) ? Number(p.spreadAvg) : null,
      src: 'giavang24k',
    };
    const prev = byDate.get(date);
    if (!prev || order >= prev.order) byDate.set(date, { rec, order }); // last point of day wins
  });

  return [...byDate.values()].map((v) => v.rec).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDojiRange(range) {
  const text = await fetchText(CONFIG.dojiApi(range), { accept: 'application/json' });
  return parseGiavang24k(text);
}

/** Seed: pasted file first (exactly what you copied from the browser), else the API. */
async function loadDojiSeed() {
  try {
    const text = await readFile(SEED_FILE, 'utf8');
    return { rows: parseGiavang24k(text), from: 'data/seed/doji-nhan-1y.json' };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`seed file invalid: ${err.message}`);
    return { rows: await fetchDojiRange('1y'), from: 'API range=1y' };
  }
}

/**
 * Append: range=7d covers the last 7 days. If the last stored day is older
 * than that window (several failed runs), also pull range=1y to close the gap.
 * Days after "today" (Hanoi) are ignored.
 */
async function fetchDojiAppend(existing, today) {
  let rows = await fetchDojiRange('7d');
  const last = existing.at(-1)?.date || START_DATE;
  const windowStart = rows[0]?.date;
  let usedRange = '7d';
  if (!windowStart || addDays(last, 1) < windowStart) {
    rows = [...await fetchDojiRange('1y'), ...rows];
    usedRange = '7d+1y';
  }
  return { rows: rows.filter((r) => r.date <= today), usedRange };
}

// -----------------------------------------------------------------------------
// 2) XAU/USD – Stooq daily close (fallback Yahoo GC=F)  [unchanged sources]
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
  }).filter((r) => isIsoDate(r.date) && Number.isFinite(r.close) && r.close > 0);
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

/**
 * Only COMPLETED daily bars are stored (date < today in Hanoi).
 * Reason: at 21:00 Hanoi the international session for "today" is still
 * trading; storing its partial close would freeze a wrong value forever.
 * Today's converted price therefore uses yesterday's close (xauFilled=true);
 * the real close is appended on the next run.
 */
async function fetchXau(today) {
  let rows;
  let source = 'stooq';
  try {
    rows = parseStooqCsv(await fetchText(CONFIG.stooqUrl));
  } catch (err) {
    if (CONFIG.xauFallback !== 'yahoo') throw err;
    console.warn(`  ! Stooq failed (${err.message}) – trying Yahoo GC=F fallback`);
    rows = parseYahooChart(await fetchText(CONFIG.yahooUrl));
    source = 'yahoo:GC=F';
  }
  return { rows: rows.filter((r) => r.date >= START_DATE && r.date < today), source };
}

// -----------------------------------------------------------------------------
// 3) USD/VND – Vietcombank SELLING rate per calendar day  [unchanged source]
// -----------------------------------------------------------------------------
function pick(obj, ...keys) {
  if (!obj) return undefined;
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) if (lower[k.toLowerCase()] !== undefined) return lower[k.toLowerCase()];
  return undefined;
}

/**
 * VCB endpoint returns e.g.
 *   { "Date": "2026-10-02T00:00:00", "Data": [ { "currencyCode": "USD",
 *       "cash": "26,120.00", "transfer": "26,150.00", "sell": "26,400.00" }, … ] }
 */
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
async function fetchVcbXmlToday(today) {
  const xml = await fetchText(CONFIG.vcbXml, { accept: 'application/xml' });
  const m = xml.match(/<Exrate[^>]*CurrencyCode="USD"[^>]*>/i);
  if (!m) throw new Error('VCB XML: USD row not found');
  const attr = (n) => (m[0].match(new RegExp(`${n}="([^"]+)"`, 'i')) || [])[1];
  const sell = parseEnNumber(attr('Sell'));
  if (!Number.isFinite(sell)) throw new Error('VCB XML: invalid Sell');
  return { date: today, sell, transfer: parseEnNumber(attr('Transfer')) || null, buyCash: parseEnNumber(attr('Buy')) || null, rateDate: today, filled: false, src: 'vcb-xml' };
}

/** Fetch ONLY dates that are not stored yet (seed: since START_DATE; append: last CATCHUP_DAYS). */
async function fetchFxMissing(existing, today, mode) {
  const have = new Set(existing.map((r) => r.date));
  const from = mode === 'seed' ? START_DATE
    : [START_DATE, addDays(today, -CONFIG.catchupDays)].sort().at(-1);
  const dates = dateRange(from, today).filter((d) => !have.has(d));

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
  if (dates.includes(today) && !rows.some((r) => r.date === today)) {
    try { rows.push(await fetchVcbXmlToday(today)); } catch (err) { errors.push(`xml: ${err.message}`); }
  }
  return { rows, errors, requested: dates.length };
}

// -----------------------------------------------------------------------------
// 4) Derived series: convertedGoldVndTael + DOJI premium
// -----------------------------------------------------------------------------
/**
 * Build a gap-free daily calendar from START_DATE and compute, for every day D:
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
 * This file is DERIVED: it is fully recomputed from the frozen raw datasets on
 * every run, so it is deterministic. The only value that can change is the
 * most recent day(s) flagged xauFilled/fxFilled, when the real observation for
 * that day is appended on the next run.
 *
 * NOTE: the converted value excludes import duties, VAT, fabrication and
 * dealer margin – the premium therefore reflects all local frictions.
 */
export function buildConverted(doji, xau, fx) {
  const lastDates = [doji.at(-1)?.date, xau.at(-1)?.date, fx.at(-1)?.date].filter(Boolean).sort();
  if (!lastDates.length) return { convertedGoldVndTael: [], premium: [] };

  const xauMap = new Map(xau.map((r) => [r.date, r.close]));
  const fxMap = new Map(fx.map((r) => [r.date, r]));
  const dojiMap = new Map(doji.map((r) => [r.date, r.sell]));

  const converted = [];
  const premium = [];
  let lastXau = null;
  let lastFx = null;

  for (const date of dateRange(START_DATE, lastDates.at(-1))) {
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
  const mode = CONFIG.mode;
  if (!['seed', 'append'].includes(mode)) throw new Error(`Unknown MODE "${mode}" (use seed | append)`);

  const today = hanoiDate();
  const prevMeta = await readJson(FILES.meta, {});
  const status = {};
  console.log(`Gold Tracker ${mode.toUpperCase()} – Hanoi date ${today}, history from ${START_DATE}`);

  let doji = await loadDataset(FILES.doji);
  let xau = await loadDataset(FILES.xau);
  let fx = await loadDataset(FILES.fx);

  // Seed protection: never silently rebuild a populated history
  if (mode === 'seed' && (doji.length || xau.length || fx.length) && !CONFIG.force) {
    console.error('Seed refused: real data already exists. Re-run with force=true to add missing days only.');
    process.exit(1);
  }

  // ---- DOJI (giavang24k) ----------------------------------------------------
  console.log('• DOJI Nhẫn tròn 9999 (giavang24k)');
  try {
    let incoming;
    let how;
    if (mode === 'seed') {
      const s = await loadDojiSeed();
      incoming = s.rows.filter((r) => r.date <= today);
      how = s.from;
    } else {
      const a = await fetchDojiAppend(doji, today);
      incoming = a.rows;
      how = `range=${a.usedRange}`;
    }
    const capturedAt = nowHanoiIso();
    const res = appendOnly(doji, incoming.map((r) => ({ ...r, capturedAt })));
    doji = res.rows;
    status.doji = {
      status: 'ok', lastSuccess: nowHanoiIso(), source: 'giavang24k',
      message: res.added.length ? `${how}: added ${res.added.length} day(s) (${res.added[0]} → ${res.added.at(-1)})` : `${how}: no new days`,
    };
    console.log(`  ✓ ${status.doji.message}`);
  } catch (err) {
    status.doji = { status: 'error', lastSuccess: prevMeta?.sources?.doji?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- XAU/USD --------------------------------------------------------------
  console.log('• XAU/USD');
  try {
    const { rows, source } = await fetchXau(today);
    const res = appendOnly(xau, rows);
    xau = res.rows;
    status.xau = {
      status: 'ok', lastSuccess: nowHanoiIso(), source,
      message: `${source}: added ${res.added.length} day(s)${res.added.length ? ` (${res.added[0]} → ${res.added.at(-1)})` : ''}`,
    };
    console.log(`  ✓ ${status.xau.message}`);
  } catch (err) {
    status.xau = { status: 'error', lastSuccess: prevMeta?.sources?.xau?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- USD/VND --------------------------------------------------------------
  console.log('• USD/VND (Vietcombank selling)');
  try {
    const { rows, errors, requested } = await fetchFxMissing(fx, today, mode);
    if (!rows.length && requested) throw new Error(`no VCB rows returned (${errors.slice(0, 3).join(' | ')})`);
    const res = appendOnly(fx, rows);
    fx = res.rows;
    status.fx = {
      status: errors.length ? 'partial' : 'ok',
      lastSuccess: nowHanoiIso(),
      message: `added ${res.added.length}/${requested} missing day(s)${errors.length ? `, ${errors.length} errors` : ''}`,
    };
    console.log(`  ✓ ${status.fx.message}`);
  } catch (err) {
    status.fx = { status: 'error', lastSuccess: prevMeta?.sources?.fx?.lastSuccess || null, message: err.message };
    console.error(`  ✗ ${err.message}`);
  }

  // ---- Derived --------------------------------------------------------------
  const derived = buildConverted(doji, xau, fx);

  const datasetMeta = (extra) => ({ schemaVersion: SCHEMA_VERSION, sample: false, timezone: TZ, startDate: START_DATE, frozen: true, ...extra });
  const written = await Promise.all([
    writeJsonIfChanged(FILES.doji, { meta: datasetMeta({ dataset: 'doji-ring', product: 'DOJI Nhẫn tròn 9999 (Hưng Thịnh Vượng)', field: 'sell', unit: 'VND/tael', source: 'giavang24k.com – /api/history/doji-nhan' }), data: doji }),
    writeJsonIfChanged(FILES.xau, { meta: datasetMeta({ dataset: 'xau-usd', field: 'close', unit: 'USD/troy oz', source: 'stooq.com (xauusd), fallback Yahoo GC=F' }), data: xau }),
    writeJsonIfChanged(FILES.fx, { meta: datasetMeta({ dataset: 'usd-vnd', field: 'sell', unit: 'VND per USD', source: 'Vietcombank selling rate' }), data: fx }),
    writeJsonIfChanged(FILES.converted, {
      meta: {
        ...datasetMeta({
          dataset: 'converted-gold',
          unit: 'VND/tael',
          formula: 'XAU_USD_Oz × USD_VND × 37.5 / 31.1034768',
          ozPerTael: Number(OZ_PER_TAEL.toFixed(6)),
          notes: 'Derived file, recomputed each run from the frozen raw datasets. Weekend/holiday gaps carried forward (xauFilled / fxFilled = true).',
        }),
        frozen: false,
      },
      convertedGoldVndTael: derived.convertedGoldVndTael,
      premium: derived.premium,
    }),
  ]);

  const anyDataChanged = written.some(Boolean);
  const statusChanged = JSON.stringify(Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v.status])))
    !== JSON.stringify(Object.fromEntries(Object.entries(prevMeta.sources || {}).map(([k, v]) => [k, v.status])));

  if (anyDataChanged || statusChanged || prevMeta.sample || mode === 'seed') {
    await writeJsonIfChanged(FILES.meta, {
      schemaVersion: SCHEMA_VERSION,
      sample: false,
      lastUpdated: nowHanoiIso(),
      lastMode: mode,
      timezone: TZ,
      startDate: START_DATE,
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
