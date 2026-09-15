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

// Device fallback for the suffix convention. The cards derive
// `sensor.<prefix>_lqi` from their primary entity, but a device whose entities
// carry different prefixes (e.g. a valve driven by a companion quirk whose
// entities are named after the *area*, while ZHA's own lqi/rssi keep the
// device prefix, or a renamed entity) never matches that way. For every
// signal key whose suffix-derived id has no state, look the entity up on the
// anchor entity's device through the entity-registry display map the frontend
// already ships in `hass.entities` (entity_id → { device_id, … }). Only
// entities that also have a state are accepted, so a disabled diagnostic
// entity keeps the icon hidden exactly as before. Returns a new ids object.
function sqResolve(hass, ids, anchor) {
  // Local, not top-level: this file holds only function declarations (TDZ, see header).
  const SQ_SUFFIX = { lqi: "_lqi", linkquality: "_linkquality", rssi: "_rssi" };
  const has = (eid) => !!eid && hass?.states?.[eid] !== undefined;
  const out = { ...(ids || {}) };
  const missing = Object.keys(SQ_SUFFIX).filter(k => !has(out[k]));
  if (!missing.length) return out;
  const reg = hass?.entities;
  const dev = anchor && reg ? reg[anchor]?.device_id : null;
  if (!dev) return out;
  for (const ent of Object.values(reg)) {
    if (!ent || ent.device_id !== dev) continue;
    const eid = ent.entity_id;
    if (typeof eid !== "string" || !eid.startsWith("sensor.")) continue;
    for (const k of missing) {
      if (eid.endsWith(SQ_SUFFIX[k]) && has(eid)) out[k] = eid;
    }
  }
  return out;
}

// ids: { lqi, linkquality, rssi } entity ids (any may be missing); `anchor` is
// the card's primary entity, used by sqResolve to find the signal entities on
// the same device when the suffix-derived ids do not exist.
// Returns { present, lqi, rssi, level, title }. `present` is true when at least
// one of the entities exists in hass.states — that decides whether the icon is
// rendered at all; `level` 0 with `present` true means the entity is there but
// currently has no numeric value (unavailable / unknown).
function sqRead(hass, rawIds, anchor) {
  const has = (eid) => !!eid && hass?.states?.[eid] !== undefined;
  const ids = sqResolve(hass, rawIds, anchor);
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
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path class="a4" d="M2 8.82a15 15 0 0 1 20 0"/>` +
    `<path class="a3" d="M5 12.86a10 10 0 0 1 14 0"/>` +
    `<path class="a2" d="M8.5 16.43a5 5 0 0 1 7 0"/>` +
    `<circle class="a1" cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/>` +
    `</svg>`;
}

// CSS for the `.sq` wrapper, embedded by each card next to its battery rules.
// Unlit arcs are drawn opaque in the bar-track grey (--bd, the empty part of
// the soil-moisture bar) rather than faded, so the whole glyph keeps its
// shape; lit arcs take the wrapper's currentColor (--th, the same grey as the
// column labels). Level 1 turns the lit part red.
function sqCss() {
  return `.sq{display:flex;align-items:center;color:var(--th)}
.sq svg{display:block}
.sq .a2,.sq .a3,.sq .a4{stroke:var(--bd)}
.sq .a1{fill:var(--bd)}
.sq[data-level="1"] .a1,
.sq[data-level="2"] .a1,
.sq[data-level="3"] .a1,
.sq[data-level="4"] .a1{fill:currentColor}
.sq[data-level="2"] .a2,
.sq[data-level="3"] .a2,.sq[data-level="3"] .a3,
.sq[data-level="4"] .a2,.sq[data-level="4"] .a3,.sq[data-level="4"] .a4{stroke:currentColor}
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
