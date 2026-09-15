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

// ── device fallback (entity registry) ──
// hass.entities is the frontend's entity-registry display map
// (entity_id → { entity_id, device_id, … }). When the suffix-derived ids do
// not exist, the signal entities are looked up on the anchor entity's device.
const reg = (m) => Object.fromEntries(Object.entries(m).map(([eid, dev]) => [eid, { entity_id: eid, device_id: dev }]));
test("device fallback: signal entities with another prefix on the anchor's device", () => {
  const hass = {
    states: { "switch.giardino_valve": st("off"), "sensor.sonoff_swv_lqi": st("144"), "sensor.sonoff_swv_rssi": st("-64") },
    entities: reg({ "switch.giardino_valve": "d1", "sensor.sonoff_swv_lqi": "d1", "sensor.sonoff_swv_rssi": "d1" }),
  };
  const r = sqRead(hass, { lqi: "sensor.giardino_valve_lqi", rssi: "sensor.giardino_valve_rssi" }, "switch.giardino_valve");
  assert.equal(r.present, true);
  assert.equal(r.lqi, 144);
  assert.equal(r.rssi, -64);
  assert.equal(r.level, 2);
});
test("device fallback: suffix match wins when it exists", () => {
  const hass = {
    states: { "switch.v": st("off"), "sensor.v_lqi": st("200"), "sensor.other_lqi": st("50") },
    entities: reg({ "switch.v": "d1", "sensor.v_lqi": "d1", "sensor.other_lqi": "d1" }),
  };
  const r = sqRead(hass, { lqi: "sensor.v_lqi" }, "switch.v");
  assert.equal(r.lqi, 200);
});
test("device fallback: entities on other devices are ignored", () => {
  const hass = {
    states: { "switch.v": st("off"), "sensor.x_lqi": st("200") },
    entities: reg({ "switch.v": "d1", "sensor.x_lqi": "d2" }),
  };
  const r = sqRead(hass, { lqi: "sensor.v_lqi" }, "switch.v");
  assert.equal(r.present, false);
});
test("device fallback: registry entry without a state (disabled) is ignored", () => {
  const hass = {
    states: { "switch.v": st("off") },
    entities: reg({ "switch.v": "d1", "sensor.x_lqi": "d1" }),
  };
  const r = sqRead(hass, { lqi: "sensor.v_lqi" }, "switch.v");
  assert.equal(r.present, false);
});
test("device fallback: Z2M linkquality is found by device too", () => {
  const hass = {
    states: { "sensor.probe_soil_moisture": st("40"), "sensor.z2m_thing_linkquality": st("210") },
    entities: reg({ "sensor.probe_soil_moisture": "d1", "sensor.z2m_thing_linkquality": "d1" }),
  };
  const r = sqRead(hass, { linkquality: "sensor.probe_linkquality" }, "sensor.probe_soil_moisture");
  assert.equal(r.level, 4);
});
test("device fallback: no hass.entities / unknown anchor is tolerated", () => {
  assert.equal(sqRead({ states: {} }, ids, "switch.v").present, false);
  assert.equal(sqRead({ states: {}, entities: {} }, ids, "switch.v").present, false);
  assert.equal(sqRead({ states: {}, entities: reg({ "switch.v": "d1" }) }, ids, undefined).present, false);
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
