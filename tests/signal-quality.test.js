/**
 * Pure-logic tests for src/signal-quality.js (the shared Zigbee signal-quality
 * icon used by both cards). Same node:vm approach as sensor-trend-panel.test.js.
 *
 * Run with:  node tests/signal-quality.test.js
 */
"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");

const SRC = path.join(__dirname, "..", "src", "signal-quality.js");
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failures++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const { sqLevel, sqRead, sqTitle, sqSvg } = ctx;
const hassWith = (states) => ({ states });
const st = (state, attrs = {}) => ({ state, attributes: attrs });
const ids = { lqi: "sensor.v_lqi", linkquality: "sensor.v_linkquality", rssi: "sensor.v_rssi" };

// ── level thresholds ──
test("LQI thresholds → 4 levels", () => {
  assert.equal(sqLevel(255, null), 4);
  assert.equal(sqLevel(200, null), 4);
  assert.equal(sqLevel(199, null), 3);
  assert.equal(sqLevel(150, null), 3);
  assert.equal(sqLevel(149, null), 2);
  assert.equal(sqLevel(100, null), 2);
  assert.equal(sqLevel(99, null), 1);
  assert.equal(sqLevel(0, null), 1);
});
test("RSSI thresholds → 4 levels", () => {
  assert.equal(sqLevel(null, -38), 4);
  assert.equal(sqLevel(null, -60), 4);
  assert.equal(sqLevel(null, -61), 3);
  assert.equal(sqLevel(null, -70), 3);
  assert.equal(sqLevel(null, -71), 2);
  assert.equal(sqLevel(null, -80), 2);
  assert.equal(sqLevel(null, -81), 1);
});
test("LQI wins over RSSI when both are present", () => {
  assert.equal(sqLevel(120, -38), 2);
});
test("no numeric value → level 0", () => {
  assert.equal(sqLevel(null, null), 0);
  assert.equal(sqLevel(NaN, undefined), 0);
});

// ── entity resolution ──
test("no signal entity at all → not present", () => {
  const r = sqRead(hassWith({ "sensor.v_battery": st("90") }), ids);
  assert.equal(r.present, false);
  assert.equal(r.level, 0);
});
test("ZHA lqi + rssi", () => {
  const r = sqRead(hassWith({ "sensor.v_lqi": st("120"), "sensor.v_rssi": st("-70", { unit_of_measurement: "dBm" }) }), ids);
  assert.equal(r.present, true);
  assert.equal(r.lqi, 120);
  assert.equal(r.rssi, -70);
  assert.equal(r.level, 2);
});
test("Z2M linkquality only", () => {
  const r = sqRead(hassWith({ "sensor.v_linkquality": st("248") }), ids);
  assert.equal(r.present, true);
  assert.equal(r.lqi, 248);
  assert.equal(r.rssi, null);
  assert.equal(r.level, 4);
});
test("rssi only (lqi disabled) falls back to RSSI", () => {
  const r = sqRead(hassWith({ "sensor.v_rssi": st("-85") }), ids);
  assert.equal(r.present, true);
  assert.equal(r.level, 1);
});
test("unavailable entity → present but level 0", () => {
  const r = sqRead(hassWith({ "sensor.v_lqi": st("unavailable") }), ids);
  assert.equal(r.present, true);
  assert.equal(r.lqi, null);
  assert.equal(r.level, 0);
});
test("missing id keys are tolerated", () => {
  const r = sqRead(hassWith({ "sensor.v_lqi": st("200") }), { lqi: "sensor.v_lqi" });
  assert.equal(r.level, 4);
});

// ── title ──
test("title lists the raw values that exist", () => {
  assert.equal(sqTitle({ lqi: 120, rssi: -70 }), "LQI 120 · RSSI -70 dBm");
  assert.equal(sqTitle({ lqi: 248, rssi: null }), "LQI 248");
  assert.equal(sqTitle({ lqi: null, rssi: -70 }), "RSSI -70 dBm");
  assert.equal(sqTitle({ lqi: null, rssi: null }), "");
});

// ── markup ──
test("svg carries four level classes a1..a4", () => {
  const s = sqSvg();
  for (const c of ["a1", "a2", "a3", "a4"]) assert.ok(s.includes(`class="${c}"`), `missing ${c}`);
  assert.ok(s.startsWith("<svg"));
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
