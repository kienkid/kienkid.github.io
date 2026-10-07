/* =============================================================================
   Gold Tracker – front-end (pure client-side, GitHub Pages compatible)
   -----------------------------------------------------------------------------
   Reads:  ./data/doji-ring.json, ./data/xau-usd.json, ./data/usd-vnd.json,
           ./data/converted-gold.json (optional – recomputed if missing),
           ./data/meta.json (optional – last-updated + source status)
   Draws:  Chart 1  DOJI sell vs converted international price (VND/tael)
           Chart 2  XAU/USD (USD per troy ounce)
           Chart 3  USD/VND (Vietcombank selling)
           Chart 4  DOJI premium (VND and %)
   Paths are RELATIVE ("./data/…") so the page works from /gold-tracker/.
   ============================================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const DATA_BASE = './data/';
  const GRAMS_PER_TAEL = 37.5;          // 1 lượng (tael) = 37.5 g
  const GRAMS_PER_TROY_OZ = 31.1034768; // 1 troy ounce   = 31.1034768 g
  const THEME_KEY = 'gt-theme';
  const RANGE_KEY = 'gt-range';

  // Number formatters – Vietnamese grouping (15.200.000) as agreed
  const fmtVnd = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  const fmtUsd = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
  const fmtMillion = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const $ = (id) => document.getElementById(id);
  const charts = {};
  let state = null; // processed data, kept for re-render on theme/range change

  // ---------------------------------------------------------------------------
  // Date helpers (dates are plain "YYYY-MM-DD" strings, Hanoi calendar days)
  // ---------------------------------------------------------------------------
  const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dateRange = (from, to) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  /** "2026-10-04" -> "04/10" (axis) or "04/10/2026" (tooltip) */
  const fmtDate = (iso, withYear = false) => {
    const [y, m, d] = iso.split('-');
    return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
  };
  const fmtTimestamp = (iso) => {
    if (!iso) return '–';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // dd/MM/yyyy, HH:mm in Hanoi time, regardless of the visitor's timezone
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(d) + ' (GMT+7)';
  };

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  /** Fetch JSON with a cache-buster (GitHub Pages caches files ~10 minutes). */
  async function fetchJson(name) {
    const res = await fetch(`${DATA_BASE}${name}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Error(`${name}: invalid JSON`);
    }
  }

  /** Basic structural validation: { data: [ { date: 'YYYY-MM-DD', <field>: number } ] } */
  function validateSeries(json, name, field) {
    if (!json || !Array.isArray(json.data)) throw new Error(`${name}: missing "data" array`);
    return json.data
      .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(Number(r[field])))
      .map((r) => ({ ...r, [field]: Number(r[field]) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Client-side fallback for converted-gold.json – same logic as the
   * GitHub Actions script (scripts/fetch-data.mjs → buildConverted):
   *
   *   For every calendar day D:
   *     XAU(D) = close on D, else last close before D  (carry-forward, xauFilled)
   *     FX(D)  = VCB sell on D, else last rate before D (carry-forward, fxFilled)
   *     convertedGoldVndTael(D) = XAU(D) × FX(D) × 37.5 / 31.1034768
   *       USD/oz × VND/USD = VND/oz ; × (37.5 g / 31.1034768 g) oz-per-tael = VND/tael
   */
  function computeConverted(xau, fx) {
    if (!xau.length || !fx.length) return [];
    const start = xau[0].date < fx[0].date ? xau[0].date : fx[0].date;
    const end = xau.at(-1).date > fx.at(-1).date ? xau.at(-1).date : fx.at(-1).date;
    const xauMap = new Map(xau.map((r) => [r.date, r.close]));
    const fxMap = new Map(fx.map((r) => [r.date, r]));
    const out = [];
    let lastXau = null;
    let lastFx = null;
    for (const date of dateRange(start, end)) {
      let xauFilled = true;
      if (xauMap.has(date)) { lastXau = xauMap.get(date); xauFilled = false; }
      let fxFilled = true;
      if (fxMap.has(date)) { lastFx = fxMap.get(date).sell; fxFilled = Boolean(fxMap.get(date).filled); }
      if (lastXau === null || lastFx === null) continue;
      out.push({
        date,
        value: Math.round(lastXau * lastFx * GRAMS_PER_TAEL / GRAMS_PER_TROY_OZ),
        xauUsdOz: lastXau, usdVnd: lastFx, xauFilled, fxFilled,
      });
    }
    return out;
  }

  async function loadAll() {
    // Required datasets fail hard; optional ones degrade gracefully.
    const [dojiR, xauR, fxR, convR, metaR] = await Promise.allSettled([
      fetchJson('doji-ring.json'),
      fetchJson('xau-usd.json'),
      fetchJson('usd-vnd.json'),
      fetchJson('converted-gold.json'),
      fetchJson('meta.json'),
    ]);

    const required = [[dojiR, 'doji-ring.json'], [xauR, 'xau-usd.json'], [fxR, 'usd-vnd.json']];
    const failed = required.filter(([r]) => r.status === 'rejected').map(([r]) => r.reason.message);
    if (failed.length) throw new Error(`Could not load required data: ${failed.join('; ')}`);

    const doji = validateSeries(dojiR.value, 'doji-ring.json', 'sell');
    const xau = validateSeries(xauR.value, 'xau-usd.json', 'close');
    const fx = validateSeries(fxR.value, 'usd-vnd.json', 'sell');

    let converted;
    const warnings = [];
    if (convR.status === 'fulfilled' && Array.isArray(convR.value.convertedGoldVndTael)) {
      converted = convR.value.convertedGoldVndTael;
    } else {
      converted = computeConverted(xau, fx); // fallback – identical formula
      warnings.push('converted-gold.json unavailable – converted price was computed in the browser.');
    }

    const meta = metaR.status === 'fulfilled' ? metaR.value : null;
    const isSample = [dojiR, xauR, fxR].some((r) => r.value?.meta?.sample) || meta?.sample;

    return { doji, xau, fx, converted, meta, isSample, warnings };
  }

  // ---------------------------------------------------------------------------
  // Transformation: align every series to one daily calendar
  // ---------------------------------------------------------------------------
  /**
   * Builds parallel arrays indexed by calendar day so all charts share the
   * same x-axis. DOJI gaps stay null (no scrape that day → gap, spanned by the
   * line); XAU/FX come from the converted series which already carries values
   * forward and flags filled points.
   *
   * Premium per day (only where DOJI exists):
   *   diffVnd = DOJI_sell − converted
   *   diffPct = diffVnd / converted × 100
   */
  function buildState(raw) {
    const all = [raw.doji, raw.xau, raw.fx, raw.converted].flat().map((r) => r.date).sort();
    if (!all.length) throw new Error('Data files are empty – run the "Update gold data" workflow first.');
    const labels = dateRange(all[0], all.at(-1));

    const dojiMap = new Map(raw.doji.map((r) => [r.date, r]));
    const convMap = new Map(raw.converted.map((r) => [r.date, r]));

    const rows = labels.map((date) => {
      const d = dojiMap.get(date);
      const c = convMap.get(date);
      const dojiSell = d ? d.sell : null;
      const conv = c ? c.value : null;
      const diffVnd = dojiSell !== null && conv !== null ? dojiSell - conv : null;
      return {
        date,
        dojiSell,
        dojiBuy: d?.buy ?? null,
        converted: conv,
        xau: c ? c.xauUsdOz : null,
        fx: c ? c.usdVnd : null,
        xauFilled: c ? c.xauFilled : false,
        fxFilled: c ? c.fxFilled : false,
        diffVnd,
        diffPct: diffVnd !== null ? (diffVnd / conv) * 100 : null,
      };
    });

    // If converted is empty (e.g. FX missing) still show raw XAU/FX series
    if (!raw.converted.length) {
      const xMap = new Map(raw.xau.map((r) => [r.date, r.close]));
      const fMap = new Map(raw.fx.map((r) => [r.date, r.sell]));
      rows.forEach((r) => { r.xau = xMap.get(r.date) ?? null; r.fx = fMap.get(r.date) ?? null; });
    }
    return { ...raw, rows };
  }

  /** Slice rows to the selected range (last N calendar days, or all). */
  function sliceRows(rows, range) {
    if (range === 'all') return rows;
    const end = rows.at(-1).date;
    const start = addDays(end, -Number(range));
    return rows.filter((r) => r.date >= start);
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function setTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
    const icon = $('themeToggle').querySelector('i');
    icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
    if (state) renderCharts(); // re-read CSS variables
  }

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------
  function baseOptions({ yTitle, yTick, tooltipLabel, tooltipFooter }) {
    const grid = cssVar('--gt-grid');
    const text = cssVar('--gt-text');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      // index mode + intersect:false => one tooltip shows ALL series for the hovered day
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: text, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(items[0].label, true),
            label: tooltipLabel,
            ...(tooltipFooter ? { footer: tooltipFooter } : {}),
          },
        },
      },
      scales: {
        x: {
          ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, callback(v) { return fmtDate(this.getLabelForValue(v)); } },
          grid: { color: grid },
        },
        y: {
          title: { display: Boolean(yTitle), text: yTitle, color: text },
          ticks: { color: text, callback: yTick },
          grid: { color: grid },
        },
      },
    };
  }

  const lineDataset = (label, data, color, extra = {}) => ({
    label, data,
    borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: true,
    ...extra,
  });

  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), config);
  }

  function renderCharts() {
    const range = document.querySelector('input[name="range"]:checked').value;
    const rows = sliceRows(state.rows, range);
    const labels = rows.map((r) => r.date);
    const millions = (v) => `${fmtMillion.format(v / 1e6)} tr`;

    // ---- Chart 1: DOJI vs converted (same axis, VND/tael) -------------------
    makeChart('chartCompare', {
      type: 'line',
      data: {
        labels,
        datasets: [
          lineDataset('DOJI Ring 9999 – sell', rows.map((r) => r.dojiSell), cssVar('--gt-doji')),
          lineDataset('International (converted)', rows.map((r) => r.converted), cssVar('--gt-world'), { borderDash: [6, 4] }),
        ],
      },
      options: baseOptions({
        yTitle: 'VND / tael',
        yTick: millions,
        tooltipLabel: (ctx) => {
          if (ctx.raw === null) return `${ctx.dataset.label}: n/a`;
          const r = rows[ctx.dataIndex];
          const filled = ctx.datasetIndex === 1 && (r.xauFilled || r.fxFilled) ? ' (carried forward)' : '';
          return `${ctx.dataset.label}: ${fmtVnd.format(ctx.raw)} ₫${filled}`;
        },
        tooltipFooter: (items) => {
          const r = rows[items[0].dataIndex];
          if (r.diffVnd === null) return '';
          return `Gap: ${r.diffVnd >= 0 ? '+' : ''}${fmtVnd.format(r.diffVnd)} ₫ (${fmtPct.format(r.diffPct)}%)\n`
            + `XAU ${fmtUsd.format(r.xau)} $/oz × ${fmtVnd.format(r.fx)} ₫/$`;
        },
      }),
    });

    // ---- Chart 4: premium (bars = VND, line = %) ----------------------------
    const pos = cssVar('--gt-premium-pos');
    const neg = cssVar('--gt-premium-neg');
    const premOpts = baseOptions({
      yTitle: 'VND / tael',
      yTick: millions,
      tooltipLabel: (ctx) => {
        if (ctx.raw === null) return `${ctx.dataset.label}: n/a`;
        return ctx.dataset.yAxisID === 'y1'
          ? `${ctx.dataset.label}: ${fmtPct.format(ctx.raw)}%`
          : `${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${fmtVnd.format(ctx.raw)} ₫`;
      },
    });
    premOpts.scales.y1 = {
      position: 'right',
      title: { display: true, text: '%', color: cssVar('--gt-text') },
      ticks: { color: cssVar('--gt-text'), callback: (v) => `${fmtMillion.format(v)}%` },
      grid: { drawOnChartArea: false },
    };
    makeChart('chartPremium', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar', label: 'Premium (VND)', yAxisID: 'y',
            data: rows.map((r) => r.diffVnd),
            backgroundColor: rows.map((r) => (r.diffVnd !== null && r.diffVnd < 0 ? neg : pos)),
            borderWidth: 0, order: 2,
          },
          lineDataset('Premium (%)', rows.map((r) => (r.diffPct === null ? null : Math.round(r.diffPct * 100) / 100)), cssVar('--gt-premium-line'), { type: 'line', yAxisID: 'y1', order: 1 }),
        ],
      },
      options: premOpts,
    });

    // ---- Chart 2: XAU/USD ----------------------------------------------------
    makeChart('chartXau', {
      type: 'line',
      data: { labels, datasets: [lineDataset('XAU/USD', rows.map((r) => r.xau), cssVar('--gt-xau'), { fill: false })] },
      options: baseOptions({
        yTitle: 'USD / troy oz',
        yTick: (v) => fmtVnd.format(v),
        tooltipLabel: (ctx) => (ctx.raw === null ? 'n/a'
          : `XAU/USD: ${fmtUsd.format(ctx.raw)} $/oz${rows[ctx.dataIndex].xauFilled ? ' (carried forward)' : ''}`),
      }),
    });

    // ---- Chart 3: USD/VND ----------------------------------------------------
    makeChart('chartFx', {
      type: 'line',
      data: { labels, datasets: [lineDataset('USD/VND (VCB sell)', rows.map((r) => r.fx), cssVar('--gt-fx'), { stepped: 'before', tension: 0 })] },
      options: baseOptions({
        yTitle: 'VND / USD',
        yTick: (v) => fmtVnd.format(v),
        tooltipLabel: (ctx) => (ctx.raw === null ? 'n/a'
          : `USD/VND: ${fmtVnd.format(ctx.raw)} ₫${rows[ctx.dataIndex].fxFilled ? ' (carried forward)' : ''}`),
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------------
  /** Latest non-null value of `key` and its change vs the previous non-null value. */
  function latestWithChange(rows, key) {
    const pts = rows.filter((r) => r[key] !== null && r[key] !== undefined);
    if (!pts.length) return null;
    const last = pts.at(-1);
    const prev = pts.length > 1 ? pts.at(-2) : null;
    const change = prev ? last[key] - prev[key] : null;
    return { date: last.date, value: last[key], change, changePct: prev ? (change / prev[key]) * 100 : null };
  }

  function kpiCard({ label, color, valueText, sub, change, changeText }) {
    const col = document.createElement('div');
    col.className = 'col-6 col-lg';
    const dir = change === null || change === 0 ? 'text-body-secondary' : change > 0 ? 'text-up' : 'text-down';
    const arrow = change === null || change === 0 ? '' : change > 0 ? '▲ ' : '▼ ';
    col.innerHTML = `
      <div class="card shadow-sm gt-card gt-kpi h-100"><div class="card-body">
        <div class="gt-kpi-label text-body-secondary"><span class="gt-dot"></span><span class="lbl"></span></div>
        <div class="gt-kpi-value mt-1"></div>
        <div class="gt-kpi-sub chg ${dir}"></div>
        <div class="gt-kpi-sub text-body-secondary sub"></div>
      </div></div>`;
    col.querySelector('.gt-dot').style.background = color;
    col.querySelector('.lbl').textContent = label;
    col.querySelector('.gt-kpi-value').textContent = valueText;
    col.querySelector('.chg').textContent = changeText ? arrow + changeText : '';
    col.querySelector('.sub').textContent = sub;
    return col;
  }

  function renderKpis() {
    const wrap = $('kpis');
    wrap.replaceChildren();
    const rows = state.rows;
    // Day-over-day changes use the RAW series (real observations only), so
    // carried-forward weekend values never show a misleading 0 change.
    const doji = latestWithChange(state.doji, 'sell');
    const conv = latestWithChange(rows, 'converted');
    const prem = latestWithChange(rows, 'diffVnd');
    const xau = latestWithChange(state.xau, 'close');
    const fx = latestWithChange(state.fx.filter((r) => !r.filled), 'sell');
    const pctTxt = (k) => (k.changePct === null ? '' : ` (${fmtPct.format(k.changePct)}%)`);

    if (doji) wrap.append(kpiCard({ label: 'DOJI Ring 9999 sell', color: cssVar('--gt-doji'), valueText: `${fmtVnd.format(doji.value)} ₫`, sub: `VND/tael · ${fmtDate(doji.date, true)}`, change: doji.change, changeText: doji.change === null ? '' : `${fmtVnd.format(Math.abs(doji.change))}${pctTxt(doji)}` }));
    if (conv) wrap.append(kpiCard({ label: 'International (converted)', color: cssVar('--gt-world'), valueText: `${fmtVnd.format(conv.value)} ₫`, sub: `VND/tael · ${fmtDate(conv.date, true)}`, change: conv.change, changeText: conv.change === null ? '' : `${fmtVnd.format(Math.abs(conv.change))}${pctTxt(conv)}` }));
    if (prem) {
      const r = rows.find((x) => x.date === prem.date);
      wrap.append(kpiCard({ label: 'DOJI premium', color: cssVar('--gt-premium-line'), valueText: `${prem.value >= 0 ? '+' : ''}${fmtVnd.format(prem.value)} ₫`, sub: `${fmtPct.format(r.diffPct)}% vs world · ${fmtDate(prem.date, true)}`, change: null, changeText: '' }));
    }
    if (xau) wrap.append(kpiCard({ label: 'XAU/USD', color: cssVar('--gt-xau'), valueText: `${fmtUsd.format(xau.value)} $`, sub: `per troy oz · ${fmtDate(xau.date, true)}`, change: xau.change, changeText: xau.change === null ? '' : `${fmtUsd.format(Math.abs(xau.change))}${pctTxt(xau)}` }));
    if (fx) wrap.append(kpiCard({ label: 'USD/VND (VCB sell)', color: cssVar('--gt-fx'), valueText: `${fmtVnd.format(fx.value)} ₫`, sub: `per USD · ${fmtDate(fx.date, true)}`, change: fx.change, changeText: fx.change === null ? '' : `${fmtVnd.format(Math.abs(fx.change))}${pctTxt(fx)}` }));
  }

  // ---------------------------------------------------------------------------
  // Alerts / status
  // ---------------------------------------------------------------------------
  function showAlert(type, html, { retry = false } = {}) {
    const div = document.createElement('div');
    div.className = `alert alert-${type} d-flex flex-wrap align-items-center justify-content-between gap-2`;
    div.setAttribute('role', 'alert');
    const span = document.createElement('span');
    span.textContent = html; // textContent – never inject untrusted HTML
    div.append(span);
    if (retry) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-danger';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => { $('alerts').replaceChildren(); init(); });
      div.append(btn);
    }
    $('alerts').append(div);
  }

  function renderStatus() {
    const meta = state.meta;
    const ts = fmtTimestamp(meta?.lastUpdated);
    $('lastUpdated').textContent = ts;
    $('lastUpdatedNav').textContent = meta?.lastUpdated ? `Updated ${ts}` : '';
    $('dataCounts').textContent = `${state.doji.length} DOJI · ${state.xau.length} XAU · ${state.fx.length} FX data points`;

    if (state.isSample) {
      showAlert('warning', 'Showing SAMPLE data. Run the "Update gold data" workflow (Actions tab → Run workflow) to load real prices.');
    }
    state.warnings.forEach((w) => showAlert('info', w));

    // Per-source status from the last workflow run
    const names = { doji: 'DOJI', xau: 'XAU/USD', fx: 'USD/VND' };
    Object.entries(meta?.sources || {}).forEach(([k, s]) => {
      if (s.status === 'error') {
        const last = s.lastSuccess ? ` Last successful update: ${fmtTimestamp(s.lastSuccess)}.` : '';
        showAlert('danger', `${names[k] || k} source failed on the last run: ${s.message}.${last} Showing the most recent stored data.`);
      } else if (s.status === 'partial') {
        showAlert('secondary', `${names[k] || k}: partially updated (${s.message}).`);
      }
    });

    // Staleness check: warn if data is more than 3 days old
    const lastDate = state.rows.at(-1)?.date;
    if (lastDate) {
      const ageDays = (Date.now() - new Date(`${lastDate}T00:00:00+07:00`).getTime()) / 86_400_000;
      if (ageDays > 3) showAlert('warning', `Latest data point is ${Math.floor(ageDays)} days old (${fmtDate(lastDate, true)}). Check the GitHub Actions workflow.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    $('loading').classList.remove('d-none');
    $('content').classList.add('d-none');
    try {
      if (typeof Chart === 'undefined') throw new Error('Chart.js failed to load (CDN blocked or offline).');
      const raw = await loadAll();
      state = buildState(raw);
      renderStatus();
      renderKpis();
      $('content').classList.remove('d-none'); // show before drawing so canvases have size
      renderCharts();
    } catch (err) {
      console.error(err);
      showAlert('danger', `Unable to display the dashboard: ${err.message}`, { retry: true });
    } finally {
      $('loading').classList.add('d-none');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle
    const current = document.documentElement.getAttribute('data-bs-theme') || 'light';
    $('themeToggle').querySelector('i').className = current === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
    $('themeToggle').addEventListener('click', () => {
      setTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark');
      if (state) renderKpis();
    });

    // Range selector (remembered between visits)
    try {
      const savedRange = localStorage.getItem(RANGE_KEY);
      const input = savedRange && document.querySelector(`input[name="range"][value="${savedRange}"]`);
      if (input) input.checked = true;
    } catch { /* ignore */ }
    $('rangeGroup').addEventListener('change', (e) => {
      try { localStorage.setItem(RANGE_KEY, e.target.value); } catch { /* ignore */ }
      if (state) renderCharts();
    });

    init();
  });
})();
