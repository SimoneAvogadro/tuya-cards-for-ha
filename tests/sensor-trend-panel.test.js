/**
 * Pure-logic tests for src/sensor-trend-panel.js.
 *
 * No npm, no test framework. The source is evaluated in a node:vm context with
 * a stub DOM; top-level `function` declarations become properties of that
 * context, which is how the helpers get here.
 *
 * Run with:  TZ=Europe/Rome node tests/sensor-trend-panel.test.js
 */
"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");

if (process.env.TZ !== "Europe/Rome") {
  console.error("Run with TZ=Europe/Rome — these assertions are timezone-dependent.");
  process.exit(1);
}

const SRC = path.join(__dirname, "..", "src", "sensor-trend-panel.js");
const ctx = vm.createContext({
  HTMLElement: class {},
  customElements: { define() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  window: {},
  console,
  Intl,
});
vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);

// Values built inside the vm context carry that context's Object/Array
// prototypes, which strict deepEqual rejects — compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => assert.deepEqual(plain(a), plain(b));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const D = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const {
  stpPeriodStart, stpShift, stpSlots, stpBucketMs, stpFillStats, stpParseHistory,
  stpRange, stpTicks, stpIsCurrent, stpPeriodLabel, stpAxis, stpLinePath,
} = ctx;

// ── period arithmetic ──
test("day period starts at local midnight", () => {
  assert.equal(stpPeriodStart("day", D(2026, 9, 8, 22, 50)), D(2026, 9, 8));
});
test("week period starts on Monday", () => {
  // 2026-09-08 is a Tuesday → Monday 2026-09-07
  assert.equal(stpPeriodStart("week", D(2026, 9, 8, 22, 50)), D(2026, 9, 7));
  // a Sunday belongs to the week that started six days earlier
  assert.equal(stpPeriodStart("week", D(2026, 9, 13, 12)), D(2026, 9, 7));
});
test("month period starts on the 1st", () => {
  assert.equal(stpPeriodStart("month", D(2026, 9, 8)), D(2026, 9, 1));
});
test("shift crosses month and year boundaries by calendar, not ms", () => {
  assert.equal(stpShift("day", D(2026, 3, 29), 1), D(2026, 3, 30));   // DST day (23 h)
  assert.equal(stpShift("month", D(2026, 12, 1), 1), D(2027, 1, 1));
  assert.equal(stpShift("month", D(2026, 1, 1), -1), D(2025, 12, 1));
  assert.equal(stpShift("week", D(2026, 9, 7), -1), D(2026, 8, 31));
});
test("slots: 7 days in a week, month length in a month, 24 hours in a day", () => {
  assert.equal(stpSlots("week", D(2026, 9, 7)).length, 7);
  assert.equal(stpSlots("month", D(2026, 2, 1)).length, 28);
  assert.equal(stpSlots("month", D(2026, 9, 1)).length, 30);
  assert.equal(stpSlots("day", D(2026, 9, 8)).length, 24);
  assert.equal(stpSlots("day", D(2026, 3, 29)).length, 23); // DST spring forward
});
test("isCurrent compares period starts", () => {
  assert.equal(stpIsCurrent("day", D(2026, 9, 8), D(2026, 9, 8, 23)), true);
  assert.equal(stpIsCurrent("day", D(2026, 9, 7), D(2026, 9, 8, 23)), false);
  assert.equal(stpIsCurrent("month", D(2026, 9, 1), D(2026, 9, 30, 23)), true);
});

// ── recorder buckets ──
test("bucket start accepts epoch ms and ISO strings", () => {
  assert.equal(stpBucketMs(1788818400000), 1788818400000);
  assert.equal(stpBucketMs("2026-09-07T22:00:00+00:00"), 1788818400000);
  assert.equal(stpBucketMs(undefined), null);
});
test("fillStats maps buckets onto day slots and leaves gaps null", () => {
  const slots = stpSlots("week", D(2026, 9, 7));
  const buckets = [
    { start: D(2026, 9, 7), min: 18.2, max: 29.4, mean: 23.1 },
    { start: D(2026, 9, 9), min: 17.0, max: 25.0, mean: 21.0 },
    { start: D(2026, 9, 14), min: 1, max: 2, mean: 1.5 }, // next week → dropped
  ];
  const rows = stpFillStats(slots, buckets, D(2026, 9, 14));
  assert.equal(rows.length, 7);
  same(rows[0], { min: 18.2, max: 29.4, mean: 23.1 });
  assert.equal(rows[1], null);
  same(rows[2], { min: 17.0, max: 25.0, mean: 21.0 });
  assert.equal(rows[6], null);
});
test("fillStats: bucket in HA's day slot even when start is a UTC ISO string", () => {
  const slots = stpSlots("week", D(2026, 9, 7));
  // Local midnight Rome on 2026-09-08 is 2026-09-07T22:00Z.
  const rows = stpFillStats(slots, [{ start: "2026-09-07T22:00:00+00:00", min: 1, max: 2, mean: 1.5 }], D(2026, 9, 14));
  same(rows[1], { min: 1, max: 2, mean: 1.5 });
});

// ── raw history ──
test("parseHistory keeps numeric states, orders by time, holds the last value to now", () => {
  const start = D(2026, 9, 8), end = D(2026, 9, 9), now = D(2026, 9, 8, 22, 50);
  const arr = [
    { s: "23.1", lu: start / 1000 },
    { s: "unavailable", lu: D(2026, 9, 8, 3) / 1000 },
    { s: "23.4", lu: D(2026, 9, 8, 6) / 1000 },
    { s: "27.5", lu: D(2026, 9, 8, 15) / 1000 },
  ];
  const pts = stpParseHistory(arr, start, end, now);
  same(pts.map((p) => p.v), [23.1, 23.4, 27.5, 27.5]);
  assert.equal(pts[0].t, start);
  assert.equal(pts[pts.length - 1].t, now);
});
test("parseHistory: a past day is held until the day's end, not beyond", () => {
  const start = D(2026, 9, 1), end = D(2026, 9, 2), now = D(2026, 9, 8, 22);
  const pts = stpParseHistory([{ s: "20", lu: D(2026, 9, 1, 12) / 1000 }], start, end, now);
  assert.equal(pts[pts.length - 1].t, end);
  assert.equal(pts.length, 2);
});
test("parseHistory: empty / non-numeric input gives no points", () => {
  same(stpParseHistory([], 0, 1, 2), []);
  same(stpParseHistory([{ s: "unknown", lu: 0 }], 0, 1000, 2000), []);
});

// ── range & ticks ──
test("range over values ignores nulls", () => {
  same(stpRange([22.6, null, 27.5, 24.5]), { min: 22.6, max: 27.5, mean: (22.6 + 27.5 + 24.5) / 3 });
  assert.equal(stpRange([null]), null);
});
test("ticks pick a nice step and enclose the data", () => {
  const t = stpTicks(22.6, 27.5, false);
  assert.ok(t.lo <= 22.6 && t.hi >= 27.5);
  assert.ok(t.ticks.length >= 3 && t.ticks.length <= 5, `got ${t.ticks.length} ticks`);
  assert.equal(t.ticks[0], t.lo);
  assert.equal(t.ticks[t.ticks.length - 1], t.hi);
});
test("ticks: flat series still spans a visible band", () => {
  const t = stpTicks(50, 50, true);
  assert.ok(t.hi > t.lo);
});
test("ticks: percent metrics are clamped to 0–100", () => {
  const t = stpTicks(97, 100, true);
  assert.ok(t.hi <= 100);
  const u = stpTicks(0, 3, true);
  assert.ok(u.lo >= 0);
});

// ── labels ──
test("period labels come from Intl in the requested language", () => {
  assert.match(stpPeriodLabel("day", D(2026, 9, 8), "it"), /8 set 2026/);
  assert.match(stpPeriodLabel("month", D(2026, 9, 1), "en"), /September 2026/);
  assert.match(stpPeriodLabel("week", D(2026, 9, 7), "en"), /Sep 7.*Sep 13 2026/);
});
test("axis: day marks 00/06/12/18, month marks first/mid/last", () => {
  const day = stpAxis("day", stpSlots("day", D(2026, 9, 8)), "it");
  same(day.map((x) => x.text), ["00", "06", "12", "18"]);
  const month = stpAxis("month", stpSlots("month", D(2026, 9, 1)), "it");
  same(month.map((x) => x.text), ["1", "15", "30"]);
  assert.equal(stpAxis("week", stpSlots("week", D(2026, 9, 7)), "it").length, 7);
});

// ── SVG path ──
test("linePath breaks the line at null points", () => {
  const p = stpLinePath([{ x: 0, y: 10 }, { x: 10, y: 20 }, null, { x: 20, y: 5 }, { x: 30, y: 8 }]);
  assert.equal(p, "M0 10L10 20M20 5L30 8");
  assert.equal(stpLinePath([null, { x: 1, y: 1 }]), "M1 1");
  assert.equal(stpLinePath([]), "");
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
