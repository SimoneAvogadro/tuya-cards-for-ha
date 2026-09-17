/**
 * Pure-logic tests for src/cover-compact-card.js — the position/pixel
 * arithmetic of the mirrored bar, the drag threshold, the state label and the
 * entity-picker suggestion gate. Same node:vm approach as the other tests.
 *
 * The card file ends with customElements.define() + a window.customCards push,
 * so the context stubs just enough of the DOM to let it evaluate.
 *
 * Run with:  node tests/cover-compact-card.test.js
 */
"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");

const SRC = path.join(__dirname, "..", "src", "cover-compact-card.js");
const win = { customCards: [] };
const ctx = vm.createContext({
  console,
  window: win,
  navigator: { language: "it-IT" },
  localStorage: { getItem: () => null },
  customElements: { define: () => {} },
  document: { createElement: () => ({}) },
  HTMLElement: class {},
});
vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failures++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const {
  cvClampPos, cvPosOf, cvSupportsPosition, cvPosFromX, cvFillPct,
  cvIsDrag, cvIsMoving, cvStateLabel, cvSuggestFor, cvPickStubEntity,
  cvBoundaryPct, cvDisplayPos, cvFillFrom,
  cvClosedTolerance, cvIsClosed, cvEffectivePos, cvVarChain, cvStateColorVar,
  cvRememberPos, cvRecallPos, cvLabelWidth, cvSlatCount,
} = ctx;

const rect = { left: 100, width: 200 };           // bar spans x = 100 … 300
const st = (state, attrs = {}) => ({ state, attributes: attrs });
const cover = (state, pos, feat = 15) =>
  st(state, pos === null ? { supported_features: feat } : { current_position: pos, supported_features: feat });
const hass = (states, language = "it") => ({ language, states });

// ── clamping ──
test("cvClampPos rounds and clamps to 0…100", () => {
  assert.equal(cvClampPos(21.4), 21);
  assert.equal(cvClampPos(21.5), 22);
  assert.equal(cvClampPos(-3), 0);
  assert.equal(cvClampPos(140), 100);
  assert.equal(cvClampPos(0), 0);
  assert.equal(cvClampPos(100), 100);
});
test("cvClampPos returns null for non-numbers", () => {
  assert.equal(cvClampPos(NaN), null);
  assert.equal(cvClampPos(undefined), null);
  assert.equal(cvClampPos(null), null);
  assert.equal(cvClampPos("x"), null);
});

// ── reading the entity ──
test("cvPosOf reads current_position, null when absent", () => {
  assert.equal(cvPosOf(cover("open", 21)), 21);
  assert.equal(cvPosOf(cover("closed", 0)), 0);
  assert.equal(cvPosOf(cover("open", null)), null);
  assert.equal(cvPosOf(undefined), null);
});
test("cvSupportsPosition reads bit 4 of supported_features", () => {
  assert.equal(cvSupportsPosition(cover("open", 21, 15)), true);  // 1+2+4+8
  assert.equal(cvSupportsPosition(cover("open", 21, 4)), true);
  assert.equal(cvSupportsPosition(cover("open", null, 11)), false); // 1+2+8, no 4
  assert.equal(cvSupportsPosition(cover("open", null, 0)), false);
  assert.equal(cvSupportsPosition(undefined), false);
});

// ── pointer → position, mirrored bar ──
test('fill_from "right": position grows left→right (drag right = open)', () => {
  assert.equal(cvPosFromX(100, rect, "right"), 0);    // left edge  → closed
  assert.equal(cvPosFromX(300, rect, "right"), 100);  // right edge → open
  assert.equal(cvPosFromX(200, rect, "right"), 50);
  assert.equal(cvPosFromX(142, rect, "right"), 21);
});
test('fill_from "left": HA\'s current orientation, mirrored back', () => {
  assert.equal(cvPosFromX(100, rect, "left"), 100);
  assert.equal(cvPosFromX(300, rect, "left"), 0);
  assert.equal(cvPosFromX(200, rect, "left"), 50);
  assert.equal(cvPosFromX(258, rect, "left"), 21);
});
test("cvPosFromX clamps outside the bar", () => {
  assert.equal(cvPosFromX(-500, rect, "right"), 0);
  assert.equal(cvPosFromX(9999, rect, "right"), 100);
  assert.equal(cvPosFromX(-500, rect, "left"), 100);
  assert.equal(cvPosFromX(9999, rect, "left"), 0);
});
test("cvPosFromX survives a zero-width rect", () => {
  assert.equal(cvPosFromX(50, { left: 50, width: 0 }, "right"), 0);
});

// ── position → fill ──
test("cvFillPct is the closed share, whatever the side", () => {
  assert.equal(cvFillPct(21), 79);
  assert.equal(cvFillPct(0), 100);   // fully closed → bar full
  assert.equal(cvFillPct(100), 0);   // fully open   → bar empty
  assert.equal(cvFillPct(null), 0);  // unknown position → nothing drawn
});

test("cvBoundaryPct puts the handle where the drag left it", () => {
  assert.equal(cvBoundaryPct(21, "right"), 21);   // handle 21% from the left
  assert.equal(cvBoundaryPct(21, "left"), 79);    // HA's orientation
  assert.equal(cvBoundaryPct(0, "right"), 0);
  assert.equal(cvBoundaryPct(100, "right"), 100);
  assert.equal(cvBoundaryPct(null, "right"), null);
});
test("cvBoundaryPct round-trips with cvPosFromX", () => {
  for (const side of ["right", "left"]) {
    for (const pos of [0, 21, 50, 79, 100]) {
      const x = rect.left + (cvBoundaryPct(pos, side) / 100) * rect.width;
      assert.equal(cvPosFromX(x, rect, side), pos, `${side} @ ${pos}`);
    }
  }
});

test("cvFillFrom defaults to right and only accepts left", () => {
  assert.equal(cvFillFrom(undefined), "right");
  assert.equal(cvFillFrom({}), "right");
  assert.equal(cvFillFrom({ fill_from: "left" }), "left");
  assert.equal(cvFillFrom({ fill_from: "nonsense" }), "right");
});

// ── icon: slats lowered from the top, as many as the cover is closed ──

const CV_SLATS = 4;   // a top-level const of the card is not visible on the vm global

test("cvSlatCount is empty when open and full when closed", () => {
  assert.equal(cvSlatCount(100), 0);
  assert.equal(cvSlatCount(0), CV_SLATS);
});

test("cvSlatCount follows the closed share, one slat per quarter", () => {
  assert.equal(cvSlatCount(75), 1);
  assert.equal(cvSlatCount(50), 2);
  assert.equal(cvSlatCount(25), 3);
});

// A shutter barely open must not look shut, and one barely closed must not
// look wide open: the rounding is what decides both.
test("cvSlatCount rounds to the nearest slat and never overflows", () => {
  assert.equal(cvSlatCount(1), CV_SLATS);
  assert.equal(cvSlatCount(5), CV_SLATS);
  assert.equal(cvSlatCount(95), 0);
  assert.equal(cvSlatCount(99), 0);
  for (let p = 0; p <= 100; p++) {
    const n = cvSlatCount(p);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= CV_SLATS, `slats out of range at ${p}`);
  }
});

// The count must never go backwards as the shutter comes down.
test("cvSlatCount is monotonic", () => {
  let prev = 0;
  for (let p = 100; p >= 0; p--) {
    const n = cvSlatCount(p);
    assert.ok(n >= prev, `slat count dropped from ${prev} to ${n} at ${p}`);
    prev = n;
  }
});

test("cvSlatCount has no answer without a position", () => {
  assert.equal(cvSlatCount(null), null);
  assert.equal(cvSlatCount(undefined), null);
  assert.equal(cvSlatCount("boh"), null);
});

// ── name column width: fixed so stacked cards get identical bars ──

test("cvLabelWidth returns null when unset, so the CSS default applies", () => {
  assert.equal(cvLabelWidth(undefined), null);
  assert.equal(cvLabelWidth({}), null);
  assert.equal(cvLabelWidth({ label_width: "" }), null);
  assert.equal(cvLabelWidth({ label_width: null }), null);
});

test("cvLabelWidth accepts a number or a bare numeric string as pixels", () => {
  assert.equal(cvLabelWidth({ label_width: 170 }), "170px");
  assert.equal(cvLabelWidth({ label_width: "170" }), "170px");
  assert.equal(cvLabelWidth({ label_width: " 170 " }), "170px");
});

test("cvLabelWidth keeps a valid CSS length as written", () => {
  assert.equal(cvLabelWidth({ label_width: "44%" }), "44%");
  assert.equal(cvLabelWidth({ label_width: "170px" }), "170px");
  assert.equal(cvLabelWidth({ label_width: "12rem" }), "12rem");
  assert.equal(cvLabelWidth({ label_width: " 44% " }), "44%");
});

// The value lands in a custom property, so anything that is not a plain
// number + unit must be dropped rather than passed through.
test("cvLabelWidth rejects junk, functions and zero", () => {
  for (const v of ["auto", "44 %", "calc(50% - 10px)", "clamp(1px,2px,3px)",
                   "44%;color:red", "-20px", "0px", "0", 0, -5, NaN,
                   {}, [], true, "100vw", "px"]) {
    assert.equal(cvLabelWidth({ label_width: v }), null, `accepted ${JSON.stringify(v)}`);
  }
});

// ── what the bar shows: finger, then commanded value, then device ──
test("cvDisplayPos follows the finger while dragging", () => {
  assert.equal(cvDisplayPos(21, 60, null, 1000), 60);
  assert.equal(cvDisplayPos(21, 0, { pos: 80, at: 1000 }, 1000), 0);
});
test("cvDisplayPos holds the commanded value until the device agrees", () => {
  assert.equal(cvDisplayPos(21, null, { pos: 80, at: 1000 }, 1500), 80);
  assert.equal(cvDisplayPos(80, null, { pos: 80, at: 1000 }, 1500), 80);
});
test("cvDisplayPos gives up on the commanded value after the deadline", () => {
  assert.equal(cvDisplayPos(21, null, { pos: 80, at: 1000 }, 1000 + 8000), 21);
  assert.equal(cvDisplayPos(21, null, { pos: 80, at: 1000 }, 1000 + 7999), 80);
});
test("cvDisplayPos falls back to the device, or nothing", () => {
  assert.equal(cvDisplayPos(21, null, null, 1000), 21);
  assert.equal(cvDisplayPos(null, null, null, 1000), null);
});

// ── drag threshold: a bare tap must not move the cover ──
test("cvIsDrag needs real movement", () => {
  assert.equal(cvIsDrag(0), false);
  assert.equal(cvIsDrag(1.9), false);
  assert.equal(cvIsDrag(-1.9), false);
  assert.equal(cvIsDrag(2), true);
  assert.equal(cvIsDrag(-40), true);
});

test("cvIsMoving covers both travel states", () => {
  assert.equal(cvIsMoving("opening"), true);
  assert.equal(cvIsMoving("closing"), true);
  assert.equal(cvIsMoving("open"), false);
  assert.equal(cvIsMoving("closed"), false);
});

// ── label ──
test("cvStateLabel: open shows state and percentage", () => {
  assert.equal(cvStateLabel(hass({}), cover("open", 21), null, 0), "Aperto · 21%");
  assert.equal(cvStateLabel(hass({}, "en"), cover("open", 21), null, 0), "Open · 21%");
});
test("cvStateLabel: closed drops the redundant 0%", () => {
  assert.equal(cvStateLabel(hass({}), cover("closed", 0), null, 0), "Chiuso");
});
test("cvStateLabel: travel states keep the percentage", () => {
  assert.equal(cvStateLabel(hass({}), cover("opening", 40), null, 0), "In apertura · 40%");
  assert.equal(cvStateLabel(hass({}), cover("closing", 40), null, 0), "In chiusura · 40%");
});
test("cvStateLabel: the drag override wins over the device value", () => {
  assert.equal(cvStateLabel(hass({}), cover("open", 21), 45, 0), "Aperto · 45%");
  assert.equal(cvStateLabel(hass({}), cover("closed", 0), 45, 0), "Aperto · 45%");
  assert.equal(cvStateLabel(hass({}), cover("open", 80), 0, 0), "Chiuso");
});
test("cvStateLabel: no position → state alone", () => {
  assert.equal(cvStateLabel(hass({}), cover("open", null), null, 0), "Aperto");
});
test("cvStateLabel: offline", () => {
  assert.equal(cvStateLabel(hass({}), st("unavailable"), null, 0), "Offline");
  assert.equal(cvStateLabel(hass({}), st("unknown"), null, 0), "Sconosciuto");
  assert.equal(cvStateLabel(hass({}), undefined, null, 0), "Offline");
});
test("cvStateLabel: offline keeps the last known position", () => {
  assert.equal(cvStateLabel(hass({}), st("unavailable"), 23, 1), "Offline · 23%");
  assert.equal(cvStateLabel(hass({}), st("unavailable"), 0, 1), "Offline · Chiuso");
  // the tolerance applies to the remembered value too
  assert.equal(cvStateLabel(hass({}), st("unavailable"), 1, 1), "Offline · Chiuso");
  assert.equal(cvStateLabel(hass({}), st("unavailable"), 1, 0), "Offline · 1%");
});

// ── remembering the position across an outage (HA drops current_position) ──
const fakeStore = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};
test("cvRememberPos / cvRecallPos round-trip", () => {
  const s0 = fakeStore();
  cvRememberPos(s0, "cover.bagno", 23);
  assert.equal(cvRecallPos(s0, "cover.bagno"), 23);
  assert.equal(cvRecallPos(s0, "cover.altra"), null);
  assert.equal([...s0.m.keys()][0], "tuya-cover-pos:cover.bagno");
});
test("cvRememberPos ignores a missing position, so an outage cannot erase it", () => {
  const s0 = fakeStore();
  cvRememberPos(s0, "cover.bagno", 23);
  cvRememberPos(s0, "cover.bagno", null);
  cvRememberPos(s0, "cover.bagno", undefined);
  assert.equal(cvRecallPos(s0, "cover.bagno"), 23);
});
test("storage that throws or is absent degrades to no memory", () => {
  const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => cvRememberPos(boom, "cover.bagno", 23));
  assert.equal(cvRecallPos(boom, "cover.bagno"), null);
  assert.equal(cvRecallPos(null, "cover.bagno"), null);
  assert.doesNotThrow(() => cvRememberPos(null, "cover.bagno", 23));
});
test("a garbage stored value is ignored", () => {
  const s0 = fakeStore();
  s0.m.set("tuya-cover-pos:cover.bagno", "boh");
  assert.equal(cvRecallPos(s0, "cover.bagno"), null);
});
test("the bar still draws the remembered position while offline", () => {
  assert.equal(cvFillPct(cvEffectivePos(23, 1)), 77);
  assert.ok(cvStateColorVar(st("unavailable"), undefined).includes("--state-unavailable-color"));
});

// ── closed tolerance: the TS130F parks at 1% and HA still calls it open ──
test("cvClosedTolerance defaults to 1 and clamps", () => {
  assert.equal(cvClosedTolerance(undefined), 1);
  assert.equal(cvClosedTolerance({}), 1);
  assert.equal(cvClosedTolerance({ closed_tolerance: 0 }), 0);
  assert.equal(cvClosedTolerance({ closed_tolerance: 4 }), 4);
  assert.equal(cvClosedTolerance({ closed_tolerance: "3" }), 3);
  assert.equal(cvClosedTolerance({ closed_tolerance: 99 }), 10);
  assert.equal(cvClosedTolerance({ closed_tolerance: -5 }), 0);
  assert.equal(cvClosedTolerance({ closed_tolerance: "" }), 1);
});
test("cvIsClosed treats within-tolerance as shut", () => {
  assert.equal(cvIsClosed(0, 1), true);
  assert.equal(cvIsClosed(1, 1), true);
  assert.equal(cvIsClosed(2, 1), false);
  assert.equal(cvIsClosed(1, 0), false);
  assert.equal(cvIsClosed(4, 4), true);
  assert.equal(cvIsClosed(null, 1), false);
});
test("cvEffectivePos snaps the sliver away", () => {
  assert.equal(cvEffectivePos(1, 1), 0);
  assert.equal(cvEffectivePos(2, 1), 2);
  assert.equal(cvEffectivePos(21, 1), 21);
  assert.equal(cvEffectivePos(null, 1), null);
});
test("a cover parked at 1% reads Chiuso, and the bar is full", () => {
  assert.equal(cvStateLabel(hass({}), cover("open", 1), null, 1), "Chiuso");
  assert.equal(cvFillPct(cvEffectivePos(1, 1)), 100);
  // with the tolerance off it stays honest to HA
  assert.equal(cvStateLabel(hass({}), cover("open", 1), null, 0), "Aperto · 1%");
});
test("the tolerance does not swallow a real opening", () => {
  assert.equal(cvStateLabel(hass({}), cover("open", 2), null, 1), "Aperto · 2%");
});

// ── colour: the exact variable chain HA resolves for a cover ──
test("cvVarChain nests fallbacks left to right", () => {
  assert.equal(cvVarChain(["--a"], "#000"), "var(--a, #000)");
  assert.equal(cvVarChain(["--a", "--b"], "#000"), "var(--a, var(--b, #000))");
});
test("an open cover resolves to --state-cover-active-color (the purple)", () => {
  const c = cvStateColorVar(cover("open", 21), false);
  assert.equal(c,
    "var(--state-cover-open-color, var(--state-cover-active-color, var(--state-active-color, #a476e0)))");
  // the v1.0.0 bug: skipping the cover-active step lands on the amber
  assert.ok(c.includes("--state-cover-active-color"));
});
test("a device_class gets its own first step, like HA", () => {
  const dc = { state: "open", attributes: { device_class: "curtain", current_position: 21, supported_features: 15 } };
  assert.equal(cvStateColorVar(dc, false),
    "var(--state-cover-curtain-open-color, var(--state-cover-open-color, var(--state-cover-active-color, var(--state-active-color, #a476e0))))");
});
test("closed resolves to the inactive chain", () => {
  assert.equal(cvStateColorVar(cover("closed", 0), true),
    "var(--state-cover-closed-color, var(--state-cover-inactive-color, var(--state-inactive-color, #9e9e9e)))");
});
test("a cover parked at 1% goes grey with the tolerance on", () => {
  assert.equal(cvStateColorVar(cover("open", 1), true),
    "var(--state-cover-closed-color, var(--state-cover-inactive-color, var(--state-inactive-color, #9e9e9e)))");
});
test("travel states stay active; unavailable and unknown do not", () => {
  assert.ok(cvStateColorVar(cover("closing", 60), false).includes("--state-cover-closing-color"));
  assert.ok(cvStateColorVar(cover("closing", 60), false).includes("--state-cover-active-color"));
  assert.equal(cvStateColorVar(st("unavailable"), undefined), "var(--state-unavailable-color, #8b8da5)");
  assert.ok(cvStateColorVar(st("unknown"), false).includes("--state-inactive-color"));
});

// ── entity-picker suggestion (HA >= 2026.6 getEntitySuggestion) ──
test("cvSuggestFor offers the card for a positionable cover", () => {
  const h = hass({ "cover.bagno": cover("open", 21) });
  const s = cvSuggestFor(h, "cover.bagno");
  assert.equal(s.config.type, "custom:cover-compact-card");
  assert.equal(s.config.entity, "cover.bagno");
  assert.ok(s.label);
});
test("cvSuggestFor stays silent for everything else", () => {
  const h = hass({
    "cover.noPos": cover("open", null, 11),
    "light.l": st("on"),
    "switch.s": st("on", { supported_features: 15 }),
  });
  assert.equal(cvSuggestFor(h, "cover.noPos"), null);
  assert.equal(cvSuggestFor(h, "light.l"), null);
  assert.equal(cvSuggestFor(h, "switch.s"), null);
  assert.equal(cvSuggestFor(h, "cover.missing"), null);
  assert.equal(cvSuggestFor(h, undefined), null);
  assert.equal(cvSuggestFor(undefined, "cover.noPos"), null);
});
test("cvSuggestFor still offers an unavailable cover that declares the feature", () => {
  const h = hass({ "cover.off": st("unavailable", { supported_features: 15 }) });
  assert.ok(cvSuggestFor(h, "cover.off"));
});

// ── stub config ──
test("cvPickStubEntity takes the first positionable cover it is offered", () => {
  const h = hass({
    "light.l": st("on"),
    "cover.noPos": cover("open", null, 11),
    "cover.good": cover("open", 21),
    "cover.other": cover("closed", 0),
  });
  assert.equal(cvPickStubEntity(h, ["light.l", "cover.noPos", "cover.good"]), "cover.good");
  assert.equal(cvPickStubEntity(h, ["light.l"], ["cover.other"]), "cover.other");
  assert.equal(cvPickStubEntity(h, [], []), "");
  assert.equal(cvPickStubEntity(undefined, undefined, undefined), "");
});

// ── registration ──
test("the card registers itself with a getEntitySuggestion hook", () => {
  const entry = win.customCards.find((c) => c.type === "cover-compact-card");
  assert.ok(entry, "card not pushed to window.customCards");
  assert.equal(entry.preview, true);
  assert.equal(typeof entry.getEntitySuggestion, "function");
  const h = hass({ "cover.bagno": cover("open", 21) });
  assert.equal(entry.getEntitySuggestion(h, "cover.bagno").config.entity, "cover.bagno");
  assert.equal(entry.getEntitySuggestion(h, "cover.nope"), null);
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
