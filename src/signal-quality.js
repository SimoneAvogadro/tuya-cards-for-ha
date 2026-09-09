/**
 * Signal Quality helper (shared by both cards)
 * Resolves a device's Zigbee signal-quality entities and renders a small
 * WiFi-style arcs icon (three arcs + dot) for the card header, to the left of
 * the battery indicator.
 *
 * ZHA exposes `sensor.<prefix>_lqi` (0–255) and `sensor.<prefix>_rssi` (dBm),
 * both diagnostic and disabled by default; Zigbee2MQTT exposes
 * `sensor.<prefix>_linkquality` (same 0–255 LQI scale). LQI is preferred
 * because it is the metric both coordinators share; RSSI is only a fallback
 * for when it is the sole entity the user enabled. When none of the three
 * entities exists the icon is simply not rendered.
 *
 * Not a card. Every top-level identifier is prefixed `sq` because
 * build.sh concatenates all of src/*.js into one module scope.
 */

// The three entity suffixes are listed in each card's own SUFFIXES table
// (as optional keys `lqi`, `linkquality`, `rssi`) rather than exported from
// here: this file is concatenated after irrigation-control-card.js, so a
// top-level const of ours would still be in its temporal dead zone when that
// card builds its table. Only function declarations live here.

// 4 = excellent … 1 = weak, 0 = no reading. LQI first, RSSI as fallback.
function sqLevel(lqi, rssi) {
  if (Number.isFinite(lqi)) {
    if (lqi >= 200) return 4;
    if (lqi >= 150) return 3;
    if (lqi >= 100) return 2;
    return 1;
  }
  if (Number.isFinite(rssi)) {
    if (rssi >= -60) return 4;
    if (rssi >= -70) return 3;
    if (rssi >= -80) return 2;
    return 1;
  }
  return 0;
}

function sqNum(hass, eid) {
  if (!eid) return null;
  const s = hass?.states?.[eid];
  if (!s) return null;
  const v = parseFloat(s.state);
  return Number.isFinite(v) ? v : null;
}

// ids: { lqi, linkquality, rssi } entity ids (any may be missing).
// Returns { present, lqi, rssi, level, title }. `present` is true when at least
// one of the entities exists in hass.states — that decides whether the icon is
// rendered at all; `level` 0 with `present` true means the entity is there but
// currently has no numeric value (unavailable / unknown).
function sqRead(hass, ids) {
  const has = (eid) => !!eid && hass?.states?.[eid] !== undefined;
  const present = has(ids?.lqi) || has(ids?.linkquality) || has(ids?.rssi);
  const lqi = sqNum(hass, ids?.lqi) ?? sqNum(hass, ids?.linkquality);
  const rssi = sqNum(hass, ids?.rssi);
  const level = present ? sqLevel(lqi, rssi) : 0;
  return { present, lqi, rssi, level, title: sqTitle({ lqi, rssi }) };
}

function sqTitle(info) {
  const parts = [];
  if (Number.isFinite(info?.lqi)) parts.push(`LQI ${Math.round(info.lqi)}`);
  if (Number.isFinite(info?.rssi)) parts.push(`RSSI ${Math.round(info.rssi)} dBm`);
  return parts.join(" · ");
}

// The icon: dot (a1) + three arcs (a2..a4). Same geometry as the wifi-off
// glyph in the cards' offline banner, without the slash. Stroked in
// currentColor so the wrapper's `color` drives it; CSS on the wrapper's
// data-level lights up the arcs.
function sqSvg() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path class="a4" d="M2 8.82a15 15 0 0 1 20 0"/>` +
    `<path class="a3" d="M5 12.86a10 10 0 0 1 14 0"/>` +
    `<path class="a2" d="M8.5 16.43a5 5 0 0 1 7 0"/>` +
    `<circle class="a1" cx="12" cy="20" r="1.4" fill="currentColor" stroke="none"/>` +
    `</svg>`;
}

// CSS for the `.sq` wrapper, embedded by each card next to its battery rules.
// Arcs above the current level stay faint; level 1 turns the whole icon red.
function sqCss() {
  return `.sq{display:flex;align-items:center;color:var(--th)}
.sq svg{display:block}
.sq .a1,.sq .a2,.sq .a3,.sq .a4{opacity:.22}
.sq[data-level="1"] .a1,
.sq[data-level="2"] .a1,.sq[data-level="2"] .a2,
.sq[data-level="3"] .a1,.sq[data-level="3"] .a2,.sq[data-level="3"] .a3,
.sq[data-level="4"] .a1,.sq[data-level="4"] .a2,.sq[data-level="4"] .a3,.sq[data-level="4"] .a4{opacity:1}
.sq[data-level="1"]{color:var(--danger)}`;
}

// Initial markup for the header. `display` mirrors the battery's offline hiding.
function sqHtml(info, hidden) {
  return `<div class="sq" id="sq-wrap" data-level="${info.level}" title="${info.title}" style="display:${hidden ? "none" : "flex"}">${sqSvg()}</div>`;
}

// In-place update on every hass push (no re-render of the tree).
function sqApply(wrap, info, hidden) {
  if (!wrap) return;
  wrap.style.display = hidden ? "none" : "flex";
  if (wrap.dataset.level !== String(info.level)) wrap.dataset.level = String(info.level);
  if (wrap.title !== info.title) wrap.title = info.title;
}
