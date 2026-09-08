/**
 * Sensor Trend Panel for Home Assistant
 * An expandable trend panel for any numeric measurement sensor (temperature,
 * humidity, soil moisture…): Day / Week / Month views with a period navigator,
 * in the shape of the energy-statistics panel of power-switch-card
 * (zha-tuya-quirks).
 *
 *   Day    → the recorded trend of the value (one line), from the raw history
 *            the more-info dialog also plots; falls back to hourly mean
 *            statistics for days older than the recorder's retention.
 *   Week / Month → two lines, the daily min and max, with a band between them,
 *            from long-term statistics (never purged).
 *
 * Not a Lovelace card — a plain custom element (<sensor-trend-panel>) driven by
 * a host card through setup(hass, entityId, opts). It knows nothing about its
 * host. Every top-level identifier is prefixed `stp` / `STP_` because build.sh
 * concatenates all of src/*.js into one module scope.
 *
 * Pure HTMLElement + Shadow DOM (no LitElement, no build tools).
 */

// ── Pure period arithmetic ──
// Declared as top-level `function` so tests/sensor-trend-panel.test.js can reach
// them from a node:vm context. Calendar constructors everywhere, never
// millisecond addition, so DST and month lengths take care of themselves.

function stpPeriodStart(view, anchorMs) {
  const a = new Date(anchorMs);
  const y = a.getFullYear(), m = a.getMonth(), d = a.getDate();
  if (view === "day") return new Date(y, m, d).getTime();
  if (view === "week") {
    const dow = (new Date(y, m, d).getDay() + 6) % 7; // 0 = Monday
    return new Date(y, m, d - dow).getTime();
  }
  return new Date(y, m, 1).getTime();
}

function stpShift(view, periodStartMs, delta) {
  const s = new Date(periodStartMs);
  const y = s.getFullYear(), m = s.getMonth(), d = s.getDate();
  if (view === "day") return new Date(y, m, d + delta).getTime();
  if (view === "week") return new Date(y, m, d + 7 * delta).getTime();
  return new Date(y, m + delta, 1).getTime();
}

function stpSlots(view, periodStartMs) {
  const end = stpShift(view, periodStartMs, 1);
  const out = [];
  if (view === "day") {
    // Deliberately millisecond-stepped: a DST day is 23 or 25 hours long and
    // must produce that many slots, matching what the recorder returns.
    for (let t = periodStartMs; t < end; t += 3600000) out.push(t);
    return out;
  }
  const s = new Date(periodStartMs);
  const y = s.getFullYear(), m = s.getMonth(), d = s.getDate();
  for (let i = 0; ; i++) {
    const t = new Date(y, m, d + i).getTime();
    if (t >= end) break;
    out.push(t);
  }
  return out;
}

function stpIsCurrent(view, periodStartMs, nowMs) {
  return stpPeriodStart(view, nowMs) === periodStartMs;
}

function stpBucketMs(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return isNaN(t) ? null : t;
}

// Map recorder buckets onto slots. The recorder omits buckets with no data, so
// slots are filled by position — a bucket lands in the last slot starting at or
// before it — and anything outside [slots[0], endMs) is dropped. Slots without
// a bucket stay null so the lines break there instead of dropping to zero.
function stpFillStats(slots, buckets, endMs) {
  const out = new Array(slots.length).fill(null);
  if (!Array.isArray(buckets) || slots.length === 0) return out;
  const limit = typeof endMs === "number" ? endMs : Infinity;
  for (const b of buckets) {
    const t = stpBucketMs(b && b.start);
    if (t === null || t < slots[0] || t >= limit) continue;
    let idx = -1;
    for (let k = 0; k < slots.length; k++) {
      if (slots[k] <= t) idx = k;
      else break;
    }
    if (idx < 0) continue;
    const min = typeof b.min === "number" ? b.min : null;
    const max = typeof b.max === "number" ? b.max : null;
    const mean = typeof b.mean === "number" ? b.mean : null;
    if (min === null && max === null && mean === null) continue;
    out[idx] = { min, max, mean };
  }
  return out;
}

// Raw history (history/history_during_period, compressed format {s, lu} with lu
// in seconds; the full {state, last_updated} shape is accepted too). Numeric
// states only, clamped to [startMs, endMs]; the last value is held until
// min(nowMs, endMs) because a sensor keeps its value until the next report —
// exactly what HA's own graph draws.
function stpParseHistory(arr, startMs, endMs, nowMs) {
  const pts = [];
  if (!Array.isArray(arr)) return pts;
  for (const it of arr) {
    if (!it) continue;
    const raw = it.s !== undefined ? it.s : it.state;
    const v = parseFloat(raw);
    if (!isFinite(v)) continue;
    let t = typeof it.lu === "number" ? it.lu * 1000 : stpBucketMs(it.last_updated);
    if (t === null) continue;
    if (t < startMs) t = startMs;
    if (t > endMs) continue;
    pts.push({ t, v });
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length) {
    const holdTo = Math.min(nowMs, endMs);
    const last = pts[pts.length - 1];
    if (last.t < holdTo) pts.push({ t: holdTo, v: last.v });
  }
  return pts;
}

function stpRange(values) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const v of values) {
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; n++;
  }
  return n ? { min, max, mean: sum / n } : null;
}

// "Nice" y-axis: a step from a fixed ladder so that 3–5 gridlines enclose the
// data. Flat series get one step of headroom; percent metrics stay in 0–100.
function stpTicks(min, max, clamp) {
  const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  let span = max - min;
  if (!(span > 0)) span = clamp ? 2 : 1;
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) { if (span / s <= 4) { step = s; break; } }
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  if (clamp) {
    if (lo < 0) lo = 0;
    if (hi > 100) hi = 100;
    if (hi <= lo) { if (lo >= 100) lo = 100 - step; else hi = lo + step; }
  }
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks, step };
}

// ── Labels ──
// Month and weekday names come from Intl, never from hardcoded lists.

function stpPeriodLabel(view, periodStartMs, lang) {
  const d = new Date(periodStartMs);
  if (view === "day") {
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(d);
  }
  if (view === "month") {
    return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(d);
  }
  const last = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
  const f = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });
  return `${f.format(d)} – ${f.format(last)} ${last.getFullYear()}`;
}

function stpSlotLabel(view, slotMs, lang) {
  const d = new Date(slotMs);
  if (view === "day") {
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

function stpAxis(view, slots, lang) {
  if (!slots.length) return [];
  if (view === "day") {
    const out = [];
    for (let i = 0; i < slots.length; i++) {
      const h = new Date(slots[i]).getHours();
      if (h % 6 === 0) out.push({ i, text: String(h).padStart(2, "0") });
    }
    return out;
  }
  if (view === "week") {
    const f = new Intl.DateTimeFormat(lang, { weekday: "narrow" });
    return slots.map((t, i) => ({ i, text: f.format(new Date(t)) }));
  }
  const idx = [0, Math.floor((slots.length - 1) / 2), slots.length - 1];
  return [...new Set(idx)].map((i) => ({ i, text: String(new Date(slots[i]).getDate()) }));
}

// SVG path through pixel points; a null breaks the line.
function stpLinePath(points) {
  let d = "", pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    const x = Math.round(p.x * 10) / 10, y = Math.round(p.y * 10) / 10;
    d += (pen ? "L" : "M") + x + " " + y;
    pen = true;
  }
  return d;
}

// ── i18n ──
const STP_I18N = {
  it: {
    day: "Giorno", week: "Settimana", month: "Mese",
    noData: "Nessun dato", loading: "Caricamento…", avg: "media",
    prev: "Periodo precedente", next: "Periodo successivo",
  },
  en: {
    day: "Day", week: "Week", month: "Month",
    noData: "No data", loading: "Loading…", avg: "avg",
    prev: "Previous period", next: "Next period",
  },
  zh: {
    day: "日", week: "周", month: "月",
    noData: "无数据", loading: "加载中…", avg: "平均",
    prev: "上一时段", next: "下一时段",
  },
};
function stpLang(hass) {
  const l = (hass && hass.language ? hass.language : "en").split("-")[0];
  return STP_I18N[l] ? l : "en";
}
function stpT(hass, key) {
  const pack = STP_I18N[stpLang(hass)] || STP_I18N.en;
  return pack[key] || STP_I18N.en[key] || key;
}
function stpNum(hass, v, frac) {
  try {
    return Number(v).toLocaleString((hass && hass.language) || "en", {
      maximumFractionDigits: frac, minimumFractionDigits: frac,
    });
  } catch (_) {
    return String(v);
  }
}
function stpEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Element ──
const STP_VIEWS = ["day", "week", "month"];
const STP_TTL = 15 * 60 * 1000;   // how long the current period stays cached
const STP_H = 110;                // chart height (px), like the energy panel
const STP_PAD = { l: 34, r: 8, t: 6, b: 6 };

class SensorTrendPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._entity = null;
    this._opts = { color: "#4a90d9", unit: "", decimals: 1, clamp: false };
    this._view = "day";
    this._anchor = null;   // ms inside the displayed period
    this._data = null;     // see _load()
    this._sel = null;      // selected point / slot index, or null
    this._loading = false;
    this._seq = 0;         // guards against out-of-order responses
    this._cache = new Map();
    this._built = false;
    this._el = {};
    this._ro = null;
    this._width = 0;
  }

  // Bind the panel to a sensor. Opens on the Day view at "now" unless the host
  // asks to keep the current view/period (switching metric while open).
  setup(hass, entityId, opts) {
    this._hass = hass;
    const o = opts || {};
    if (this._entity !== entityId) this._cache.clear();
    this._entity = entityId;
    this._opts = {
      color: o.color || "#4a90d9",
      unit: o.unit || "",
      decimals: typeof o.decimals === "number" ? o.decimals : 1,
      clamp: !!o.clamp,
    };
    if (!(o.keepPeriod && this._anchor !== null)) {
      this._view = "day";
      this._anchor = Date.now();
    }
    this._sel = null;
    this._data = null;
    // Set before the first paint: without it the panel flashes "no data" for a
    // frame before _load() gets a chance to mark itself busy.
    this._loading = true;
    this._render();
    this._load();
  }

  set hass(h) { this._hass = h; }

  // Called by the host card's periodic tick: only the period containing "now"
  // can be stale, and it is refreshed at most every STP_TTL.
  refreshIfCurrent() {
    if (!this._entity || this._anchor === null) return;
    const start = stpPeriodStart(this._view, this._anchor);
    if (!stpIsCurrent(this._view, start, Date.now())) return;
    const cached = this._cache.get(`${this._view}|${start}`);
    if (cached && Date.now() - cached.at < STP_TTL) return;
    this._load();
  }

  connectedCallback() {
    if (typeof ResizeObserver === "function" && !this._ro) {
      this._ro = new ResizeObserver(() => {
        const w = this._el.chart ? this._el.chart.clientWidth : 0;
        if (w && w !== this._width) { this._width = w; this._renderChart(); }
      });
      if (this._el.chart) this._ro.observe(this._el.chart);
    }
  }
  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  async _load() {
    if (!this._hass || !this._entity || this._anchor === null) return;
    const view = this._view;
    const start = stpPeriodStart(view, this._anchor);
    const end = stpShift(view, start, 1);
    const key = `${view}|${start}`;
    const cached = this._cache.get(key);
    const stale = cached && stpIsCurrent(view, start, Date.now()) && Date.now() - cached.at > STP_TTL;
    if (cached && !stale) {
      this._data = cached;
      this._loading = false;
      this._render();
      return;
    }
    const seq = ++this._seq;
    this._loading = true;
    this._render();
    let data;
    try {
      data = view === "day" ? await this._loadDay(start, end) : await this._loadStats(view, start, end);
    } catch (_) {
      // recorder unavailable, or the sensor has no history yet.
      data = { kind: view === "day" ? "line" : "band", slots: stpSlots(view, start), points: [], rows: [], range: null, hasData: false };
    }
    if (seq !== this._seq) return; // a newer request superseded this one
    data.view = view;
    data.start = start;
    data.end = end;
    data.at = Date.now();
    this._data = data;
    this._cache.set(key, data);
    this._loading = false;
    this._render();
  }

  // Day: raw recorded states. Older than the recorder's retention (10 days by
  // default) nothing comes back, so fall back to hourly mean statistics.
  async _loadDay(start, end) {
    const now = Date.now();
    const res = await this._hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(Math.min(end, now)).toISOString(),
      entity_ids: [this._entity],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    let points = stpParseHistory(res && res[this._entity], start, end, now);
    if (points.length < 2) {
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        statistic_ids: [this._entity],
        period: "hour",
        types: ["mean"],
      });
      const buckets = (st && st[this._entity]) || [];
      const hourly = [];
      for (const b of buckets) {
        const t = stpBucketMs(b && b.start);
        if (t === null || t < start || t >= end || typeof b.mean !== "number") continue;
        hourly.push({ t: t + 1800000, v: b.mean }); // centre of the hour
      }
      hourly.sort((a, b) => a.t - b.t);
      if (hourly.length >= points.length) points = hourly;
    }
    const range = stpRange(points.map((p) => p.v));
    return { kind: "line", slots: stpSlots("day", start), points, rows: [], range, hasData: !!range };
  }

  // Week / Month: daily min / max / mean from long-term statistics.
  async _loadStats(view, start, end) {
    const res = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: [this._entity],
      period: "day",
      types: ["min", "max", "mean"],
    });
    const slots = stpSlots(view, start);
    const rows = stpFillStats(slots, (res && res[this._entity]) || [], end);
    const lo = stpRange(rows.map((r) => r && r.min));
    const hi = stpRange(rows.map((r) => r && r.max));
    const mean = stpRange(rows.map((r) => r && r.mean));
    const range = lo && hi ? { min: lo.min, max: hi.max, mean: mean ? mean.mean : (lo.min + hi.max) / 2 } : null;
    return { kind: "band", slots, points: [], rows, range, hasData: !!range };
  }

  _setView(view) {
    if (this._view === view) return;
    this._view = view;
    this._anchor = Date.now();
    this._sel = null;
    this._load();
  }

  _step(delta) {
    const start = stpPeriodStart(this._view, this._anchor);
    this._anchor = stpShift(this._view, start, delta);
    this._sel = null;
    this._load();
  }

  _build() {
    const hass = this._hass;
    this.shadowRoot.innerHTML = `
<style>
:host{ display:block; }
.wrap{ padding:4px 14px 12px; }
.tabs{ display:flex; gap:2px; background:var(--divider-color,rgba(120,120,120,.16));
  border-radius:9px; padding:2px; margin-bottom:12px; }
.tab{ flex:1 1 0; min-width:0; border:none; cursor:pointer; padding:6px 4px;
  border-radius:7px; background:transparent; color:var(--secondary-text-color);
  font-size:12px; font-family:inherit; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; transition:background .15s ease,color .15s ease; }
.tab.sel{ background:var(--card-background-color,#232640); color:var(--primary-text-color); font-weight:500; }
.head{ display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:10px; }
.total{ font-size:20px; font-weight:500; color:var(--primary-text-color); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.total .u{ font-size:12px; font-weight:400; color:var(--secondary-text-color); margin-left:3px; }
.total .lbl{ font-size:13px; font-weight:400; color:var(--secondary-text-color); margin-right:6px; }
.avg{ font-size:12px; color:var(--secondary-text-color); white-space:nowrap; flex-shrink:0; }
.chart{ position:relative; height:${STP_H + 14}px; }
.chart svg{ display:block; width:100%; height:${STP_H}px; overflow:visible; cursor:pointer;
  touch-action:manipulation; }
.grid{ stroke:var(--divider-color,rgba(120,120,120,.2)); stroke-width:1; }
.ylbl{ font-size:10px; fill:var(--disabled-text-color,#5c5e76); }
.band{ opacity:.14; }
.line{ fill:none; stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
.line.min{ opacity:.55; }
.mark{ stroke:var(--secondary-text-color,#8b8da5); stroke-width:1; stroke-dasharray:3 3; }
.dot{ stroke:var(--card-background-color,#232640); stroke-width:1.5; }
.axis{ position:relative; height:14px; margin-top:4px; }
.axis span{ position:absolute; transform:translateX(-50%); font-size:10px;
  color:var(--disabled-text-color,#5c5e76); white-space:nowrap; }
.empty{ height:${STP_H}px; display:flex; align-items:center; justify-content:center;
  font-size:12px; color:var(--disabled-text-color,#5c5e76); }
.nav{ display:flex; align-items:center; justify-content:center; gap:4px; margin-top:10px; }
.nav button{ border:none; background:transparent; cursor:pointer; padding:4px 8px;
  color:var(--secondary-text-color); border-radius:6px; line-height:0; }
.nav button:disabled{ opacity:.28; cursor:default; }
.nav .lbl{ min-width:130px; text-align:center; font-size:13px; color:var(--primary-text-color); }
.nav svg{ display:block; }
</style>
<div class="wrap">
  <div class="tabs" id="tabs"></div>
  <div class="head">
    <div class="total" id="total"></div>
    <div class="avg" id="avg"></div>
  </div>
  <div class="chart" id="chart"></div>
  <div class="nav">
    <button id="prev" type="button" title="${stpT(hass, "prev")}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
    <div class="lbl" id="lbl"></div>
    <button id="next" type="button" title="${stpT(hass, "next")}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
  </div>
</div>`;
    const r = this.shadowRoot;
    this._el = {
      tabs: r.getElementById("tabs"),
      total: r.getElementById("total"),
      avg: r.getElementById("avg"),
      chart: r.getElementById("chart"),
      prev: r.getElementById("prev"),
      next: r.getElementById("next"),
      lbl: r.getElementById("lbl"),
    };
    for (const v of STP_VIEWS) {
      const b = document.createElement("button");
      b.className = "tab";
      b.type = "button";
      b.dataset.view = v;
      b.textContent = stpT(hass, v);
      b.addEventListener("click", () => this._setView(v));
      this._el.tabs.appendChild(b);
    }
    this._el.prev.addEventListener("click", () => this._step(-1));
    this._el.next.addEventListener("click", () => this._step(1));
    this._el.chart.addEventListener("click", (e) => this._onChartClick(e));
    if (this._ro) this._ro.observe(this._el.chart);
    this._built = true;
  }

  _fmt(v) { return stpNum(this._hass, v, this._opts.decimals); }
  _unitHtml() { return this._opts.unit ? `<span class="u">${stpEsc(this._opts.unit)}</span>` : ""; }

  _render() {
    if (!this._hass || !this._entity) return;
    if (!this._built) this._build();
    const hass = this._hass;
    const lang = stpLang(hass);
    const start = stpPeriodStart(this._view, this._anchor);

    for (const b of this._el.tabs.children) {
      b.classList.toggle("sel", b.dataset.view === this._view);
    }

    const d = this._data;
    const showing = d && d.view === this._view && d.start === start;
    if (this._loading && !showing) {
      this._el.total.textContent = stpT(hass, "loading");
      this._el.avg.textContent = "";
    } else if (!showing || !d.hasData) {
      this._el.total.textContent = stpT(hass, "noData");
      this._el.avg.textContent = "";
    } else if (this._sel !== null && d.kind === "line" && d.points[this._sel]) {
      const p = d.points[this._sel];
      this._el.total.innerHTML =
        `<span class="lbl">${stpSlotLabel("day", p.t, lang)}</span>${this._fmt(p.v)}${this._unitHtml()}`;
      this._el.avg.textContent = "";
    } else if (this._sel !== null && d.kind === "band" && d.rows[this._sel]) {
      const r = d.rows[this._sel];
      const lo = r.min !== null ? r.min : r.mean, hi = r.max !== null ? r.max : r.mean;
      this._el.total.innerHTML =
        `<span class="lbl">${stpSlotLabel(this._view, d.slots[this._sel], lang)}</span>` +
        `${this._fmt(lo)} – ${this._fmt(hi)}${this._unitHtml()}`;
      this._el.avg.textContent = "";
    } else {
      this._el.total.innerHTML = `${this._fmt(d.range.min)} – ${this._fmt(d.range.max)}${this._unitHtml()}`;
      this._el.avg.textContent = `${stpT(hass, "avg")} ${this._fmt(d.range.mean)}${this._opts.unit ? " " + this._opts.unit : ""}`;
    }

    this._el.lbl.textContent = stpPeriodLabel(this._view, start, lang);
    this._el.next.disabled = stpIsCurrent(this._view, start, Date.now());
    this._renderChart();
  }

  // Pixel geometry shared by the chart and the tap handler.
  _geom() {
    const w = this._width || (this._el.chart && this._el.chart.clientWidth) || 300;
    const x0 = STP_PAD.l, x1 = Math.max(x0 + 20, w - STP_PAD.r);
    const y0 = STP_PAD.t, y1 = STP_H - STP_PAD.b;
    return { w, x0, x1, y0, y1 };
  }
  _xOfTime(t, g) {
    const d = this._data;
    return g.x0 + ((t - d.start) / (d.end - d.start)) * (g.x1 - g.x0);
  }
  _xOfSlot(i, g) {
    const n = this._data.slots.length || 1;
    return g.x0 + ((i + 0.5) / n) * (g.x1 - g.x0);
  }

  _renderChart() {
    const c = this._el.chart;
    if (!c) return;
    const d = this._data;
    const start = stpPeriodStart(this._view, this._anchor);
    const showing = d && d.view === this._view && d.start === start;
    if (!showing || !d.hasData) {
      c.innerHTML = `<div class="empty">${stpT(this._hass, this._loading ? "loading" : "noData")}</div>`;
      return;
    }
    const g = this._geom();
    const ticks = stpTicks(d.range.min, d.range.max, this._opts.clamp);
    const yOf = (v) => g.y1 - ((v - ticks.lo) / (ticks.hi - ticks.lo)) * (g.y1 - g.y0);
    const color = this._opts.color;
    const frac = ticks.step < 1 ? 1 : 0;
    let svg = "";

    // gridlines + y labels
    for (const tv of ticks.ticks) {
      const y = Math.round(yOf(tv) * 10) / 10;
      svg += `<line class="grid" x1="${g.x0}" y1="${y}" x2="${g.x1}" y2="${y}"/>`;
      svg += `<text class="ylbl" x="${g.x0 - 5}" y="${y + 3.5}" text-anchor="end">${stpNum(this._hass, tv, frac)}</text>`;
    }

    let markX = null, markDots = [];
    if (d.kind === "line") {
      const pts = d.points.map((p) => ({ x: this._xOfTime(p.t, g), y: yOf(p.v) }));
      svg += `<path class="line" d="${stpLinePath(pts)}" stroke="${color}"/>`;
      if (this._sel !== null && pts[this._sel]) {
        markX = pts[this._sel].x;
        markDots = [pts[this._sel]];
      }
    } else {
      const maxPts = [], minPts = [];
      let band = "";
      // The band is drawn per contiguous run so gaps stay open.
      let run = [];
      const flush = () => {
        if (run.length) {
          const top = run.map((p) => `${p.x.toFixed(1)} ${p.hi.toFixed(1)}`);
          const bottom = run.slice().reverse().map((p) => `${p.x.toFixed(1)} ${p.lo.toFixed(1)}`);
          band += `<path class="band" d="M${top.join("L")}L${bottom.join("L")}Z" fill="${color}"/>`;
        }
        run = [];
      };
      d.rows.forEach((r, i) => {
        if (!r) { maxPts.push(null); minPts.push(null); flush(); return; }
        const lo = r.min !== null ? r.min : r.mean, hi = r.max !== null ? r.max : r.mean;
        const x = this._xOfSlot(i, g);
        const p = { x, lo: yOf(lo), hi: yOf(hi) };
        maxPts.push({ x, y: p.hi });
        minPts.push({ x, y: p.lo });
        run.push(p);
      });
      flush();
      svg += band;
      svg += `<path class="line min" d="${stpLinePath(minPts)}" stroke="${color}"/>`;
      svg += `<path class="line" d="${stpLinePath(maxPts)}" stroke="${color}"/>`;
      // A lone day (no neighbours) has no line to show: mark it with dots.
      d.rows.forEach((r, i) => {
        if (!r) return;
        const alone = !d.rows[i - 1] && !d.rows[i + 1];
        if (alone) { markDots.push(maxPts[i]); if (minPts[i].y !== maxPts[i].y) markDots.push(minPts[i]); }
      });
      if (this._sel !== null && d.rows[this._sel]) {
        markX = maxPts[this._sel].x;
        markDots = [maxPts[this._sel], minPts[this._sel]];
      }
    }
    if (markX !== null) {
      svg += `<line class="mark" x1="${markX.toFixed(1)}" y1="${g.y0}" x2="${markX.toFixed(1)}" y2="${g.y1}"/>`;
    }
    for (const p of markDots) {
      svg += `<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}"/>`;
    }

    const axis = stpAxis(this._view, d.slots, stpLang(this._hass)).map((t) => {
      const x = d.kind === "line" ? this._xOfTime(d.slots[t.i], g) : this._xOfSlot(t.i, g);
      return `<span style="left:${x.toFixed(1)}px">${t.text}</span>`;
    }).join("");

    c.innerHTML = `<svg viewBox="0 0 ${g.w} ${STP_H}" width="${g.w}" height="${STP_H}" preserveAspectRatio="none">${svg}</svg><div class="axis">${axis}</div>`;
  }

  // Tap: select the nearest point (Day) or day (Week/Month); second tap deselects.
  _onChartClick(e) {
    const d = this._data;
    if (!d || !d.hasData) return;
    const svg = this._el.chart.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const g = this._geom();
    let best = -1, bestDist = Infinity;
    if (d.kind === "line") {
      d.points.forEach((p, i) => {
        const dist = Math.abs(this._xOfTime(p.t, g) - x);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
    } else {
      d.rows.forEach((r, i) => {
        if (!r) return;
        const dist = Math.abs(this._xOfSlot(i, g) - x);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
    }
    if (best < 0) return;
    this._sel = this._sel === best ? null : best;
    this._render();
  }
}

customElements.define("sensor-trend-panel", SensorTrendPanel);
