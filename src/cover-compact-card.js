/**
 * Cover Compact Card for Home Assistant
 * One-row Lovelace card for covers (tapparelle / shutters / curtains)
 *
 * (unreleased) — Offline keeps the last known position. HA drops
 *          current_position when a cover goes unavailable, so the card
 *          remembers the last one it saw (in memory, mirrored to
 *          localStorage so a page reload keeps it) and still draws the bar
 *          at that position — greyed with --state-unavailable-color, no
 *          handle, not draggable — with "Offline · 23%" as the state line.
 *          The red Offline pill that replaced the bar is gone.
 * v1.1.0 — Colour: resolve the entity state colour through the same variable
 *          chain HA uses (--state-cover-<dc>-<state>-color → --state-cover-
 *          <state>-color → --state-cover-active|inactive-color → --state-
 *          active|inactive-color). v1.0.0 asked for --state-cover-open-color,
 *          which does not exist, and fell through to the amber --state-active-
 *          color. Icon and bar now go purple while open and grey once closed,
 *          like the tile card.
 *          `closed_tolerance` (default 1): many Tuya motors run all the way
 *          down and still report 1%, leaving HA "open · 1%". At or below the
 *          tolerance the card reads "Chiuso", draws the bar full, and a drag
 *          down there commands position 0.
 * v1.0.0 — Compact alternative to the tile card with the cover-position
 *          feature, which spends two rows: a nearly empty one for the name
 *          and state, and a second one for the bar. Here the name and the
 *          "Open · 21%" line stay stacked on the left and the bar takes the
 *          whole right side at full card height, halving the height.
 *          The bar is mirrored: the fill is anchored to the RIGHT edge and
 *          is as long as the closed share (100 - position), so the handle
 *          travels right to open. `fill_from: "left"` restores HA's
 *          orientation.
 *          Position is set by dragging only — a bare tap does nothing, so a
 *          mis-tap can't move a shutter. The percentage follows the finger
 *          live and the service call goes out on release.
 *          Registers `getEntitySuggestion` so the card shows up, with a live
 *          preview, in the dashboard's "by entity" card picker next to the
 *          tile variants (HA >= 2026.6; ignored, harmlessly, before that).
 *
 * Every top-level identifier is prefixed `cv`/`CV_` because build.sh
 * concatenates all of src/*.js into a single module scope.
 */

// ── i18n ──
const CV_I18N = {
  it: {
    open: "Aperto", closed: "Chiuso", opening: "In apertura", closing: "In chiusura",
    unknown: "Sconosciuto", offline: "Offline",
    editorEntity: "Tapparella", editorSelect: "— Seleziona —",
    editorHint: "Mostra solo le coperture che accettano una posizione",
    editorNoEntity: "Nessuna copertura compatibile trovata",
    editorName: "Nome (opzionale)", editorNamePh: "Nome personalizzato",
    editorNameHint: "Lascia vuoto per usare il nome dell'entità",
    editorDirection: "Verso della barra",
    editorDirRight: "Riempimento da destra (predefinito)",
    editorDirLeft: "Riempimento da sinistra (come Home Assistant)",
    editorTolerance: "Tolleranza di chiusura (%)",
    editorToleranceHint: "Sotto o pari a questa posizione la tapparella è mostrata come chiusa: molti motori Tuya riportano 1% quando sono giù del tutto",
    configError: "Seleziona una tapparella nella configurazione",
    defaultName: "Copertura",
    suggestLabel: "Tapparella compatta",
  },
  en: {
    open: "Open", closed: "Closed", opening: "Opening", closing: "Closing",
    unknown: "Unknown", offline: "Offline",
    editorEntity: "Cover", editorSelect: "— Select —",
    editorHint: "Shows only covers that accept a position",
    editorNoEntity: "No compatible cover found",
    editorName: "Name (optional)", editorNamePh: "Custom name",
    editorNameHint: "Leave empty to use the entity name",
    editorDirection: "Bar direction",
    editorDirRight: "Fill from the right (default)",
    editorDirLeft: "Fill from the left (like Home Assistant)",
    editorTolerance: "Closed tolerance (%)",
    editorToleranceHint: "At or below this position the cover reads as closed: many Tuya motors report 1% when fully down",
    configError: "Select a cover in the configuration",
    defaultName: "Cover",
    suggestLabel: "Compact cover",
  },
  zh: {
    open: "打开", closed: "关闭", opening: "正在打开", closing: "正在关闭",
    unknown: "未知", offline: "离线",
    editorEntity: "窗帘", editorSelect: "— 选择 —",
    editorHint: "仅显示支持位置设置的窗帘",
    editorNoEntity: "未找到兼容的窗帘",
    editorName: "名称（可选）", editorNamePh: "自定义名称",
    editorNameHint: "留空则使用实体名称",
    editorDirection: "进度条方向",
    editorDirRight: "从右侧填充（默认）",
    editorDirLeft: "从左侧填充（与 Home Assistant 一致）",
    editorTolerance: "关闭容差（%）",
    editorToleranceHint: "位置小于或等于该值时显示为关闭：许多涂鸦电机完全降下时仍报告 1%",
    configError: "请在配置中选择一个窗帘",
    defaultName: "窗帘",
    suggestLabel: "紧凑窗帘卡片",
  },
};
function _cvLang(hass) {
  const lang = hass?.language?.split("-")[0] || "en";
  return CV_I18N[lang] ? lang : "en";
}
function _cv(hass, key) { return (CV_I18N[_cvLang(hass)] || CV_I18N.en)[key] || CV_I18N.en[key] || key; }

// ── Constants ──
const CV_SUPPORT_SET_POSITION = 4;   // CoverEntityFeature.SET_POSITION
// A tap must not move a shutter: the pointer has to travel this far before the
// gesture counts as a drag and a release is allowed to call the service.
const CV_DRAG_MIN_PX = 2;
// After release, keep showing the commanded position until the device reports
// it back (or this long, whichever comes first) — otherwise the bar snaps back
// to the old value for the seconds the motor takes to start moving.
const CV_PENDING_MS = 8000;
// Many Tuya roller-shutter motors (e.g. TS130F) run all the way down but send
// 1 as their final position, so HA keeps the cover "open" at 1%. Positions at
// or below the tolerance read — and are commanded — as fully closed.
const CV_DEFAULT_CLOSED_TOLERANCE = 1;
const CV_MAX_CLOSED_TOLERANCE = 10;

// ── Pure logic (unit-tested in tests/cover-compact-card.test.js) ──

function cvClampPos(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (n === null || n === undefined || n === "" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function cvPosOf(stateObj) { return cvClampPos(stateObj?.attributes?.current_position); }

function cvSupportsPosition(stateObj) {
  return !!(Number(stateObj?.attributes?.supported_features || 0) & CV_SUPPORT_SET_POSITION);
}

// Pointer x → cover position. With the default right-anchored fill the handle
// sits at `position`% from the left, so dragging right opens. `fill_from:
// "left"` is HA's orientation, where the handle sits at the closed share.
function cvPosFromX(clientX, rect, fillFrom) {
  const width = rect?.width || 0;
  if (width <= 0) return fillFrom === "left" ? 100 : 0;
  const pct = ((clientX - rect.left) / width) * 100;
  return cvClampPos(fillFrom === "left" ? 100 - pct : pct);
}

// The fill always shows how *closed* the cover is; only the anchor side moves.
function cvFillPct(position) {
  const p = cvClampPos(position);
  return p === null ? 0 : 100 - p;
}

// Where the handle sits, measured from the left edge.
function cvBoundaryPct(position, fillFrom) {
  const p = cvClampPos(position);
  if (p === null) return null;
  return fillFrom === "left" ? 100 - p : p;
}

function cvClosedTolerance(config) {
  const v = cvClampPos(config?.closed_tolerance);
  if (v === null) return CV_DEFAULT_CLOSED_TOLERANCE;
  return Math.min(v, CV_MAX_CLOSED_TOLERANCE);
}

// "Down as far as it goes" — whatever the motor's last report says.
function cvIsClosed(position, tolerance) {
  const p = cvClampPos(position);
  return p !== null && p <= (tolerance || 0);
}

// Snap a within-tolerance position to 0, for drawing and for the command, so
// the bar has no 1% sliver left and a drag to the bottom really closes.
function cvEffectivePos(position, tolerance) {
  const p = cvClampPos(position);
  if (p === null) return null;
  return cvIsClosed(p, tolerance) ? 0 : p;
}

// HA strips current_position when a cover goes unavailable, so the last known
// position has to be kept here. localStorage makes it survive a page reload,
// which is when it matters most: a cover can be offline for hours.
const CV_POS_STORE_PREFIX = "tuya-cover-pos:";

function cvRememberPos(store, entityId, position) {
  const p = cvClampPos(position);
  if (!store || !entityId || p === null) return;
  try { store.setItem(CV_POS_STORE_PREFIX + entityId, String(p)); } catch (_) { /* private mode */ }
}

function cvRecallPos(store, entityId) {
  if (!store || !entityId) return null;
  try { return cvClampPos(store.getItem(CV_POS_STORE_PREFIX + entityId)); } catch (_) { return null; }
}

function cvIsDrag(dx) { return Math.abs(dx) >= CV_DRAG_MIN_PX; }

function cvIsMoving(state) { return state === "opening" || state === "closing"; }

// What the bar and the label should show: the finger while dragging, then the
// commanded value until the device catches up, then the device itself.
function cvDisplayPos(devicePos, dragPos, pending, now) {
  if (dragPos !== null && dragPos !== undefined) return dragPos;
  if (pending && now - pending.at < CV_PENDING_MS && devicePos !== pending.pos) return pending.pos;
  return devicePos === undefined ? null : devicePos;
}

function cvStateLabel(hass, stateObj, override, tolerance) {
  const t = (k) => _cv(hass, k);
  const state = stateObj?.state;
  if (!state || state === "unavailable") {
    // `override` carries the last position we saw before the cover went away.
    const last = cvEffectivePos(override, tolerance);
    if (last === null) return t("offline");
    return `${t("offline")} · ${last === 0 ? t("closed") : `${last}%`}`;
  }
  if (state === "unknown") return t("unknown");
  // The dragged / commanded value takes over both the percentage and the word:
  // dragging to 0 reads "Closed" even while the device still reports open.
  const raw = override !== null && override !== undefined ? override : cvPosOf(stateObj);
  const pos = cvEffectivePos(raw, tolerance);
  let word;
  if (cvIsMoving(state)) word = t(state);
  else if (pos !== null) word = pos === 0 ? t("closed") : t("open");
  else word = state === "closed" ? t("closed") : t("open");
  if (pos === null || (pos === 0 && !cvIsMoving(state))) return word;
  return `${word} · ${pos}%`;
}

// ── Colour: exactly the chain Home Assistant resolves for a cover ──
// domainColorProperties() in the frontend builds
//   --state-cover-<device_class>-<state>-color, --state-cover-<state>-color,
//   --state-cover-<active|inactive>-color, --state-<active|inactive>-color
// and nests them as fallbacks. The purple lives on --state-cover-active-color;
// --state-cover-open-color does not exist, so skipping the active one lands on
// --state-active-color, which is amber.
function cvVarChain(names, fallback) {
  return names.reduceRight((acc, n) => `var(${n}, ${acc})`, fallback);
}

function cvStateColorVar(stateObj, closed) {
  const state = stateObj?.state;
  if (!state || state === "unavailable") return "var(--state-unavailable-color, #8b8da5)";
  // stateActive() in HA: a cover is active unless it is closed (or unknown).
  const shut = closed === undefined ? state === "closed" : !!closed;
  const active = !shut && state !== "unknown";
  const stateKey = shut ? "closed" : state;
  const dc = stateObj?.attributes?.device_class;
  const names = [];
  if (dc) names.push(`--state-cover-${dc}-${stateKey}-color`);
  names.push(
    `--state-cover-${stateKey}-color`,
    `--state-cover-${active ? "active" : "inactive"}-color`,
    `--state-${active ? "active" : "inactive"}-color`
  );
  return cvVarChain(names, active ? "#a476e0" : "#9e9e9e");
}

// HA >= 2026.6 calls this for the entity the user picked in the card picker's
// "by entity" tab and renders the returned config as a live preview.
function cvSuggestFor(hass, entityId) {
  if (!hass || !entityId || typeof entityId !== "string") return null;
  if (entityId.split(".")[0] !== "cover") return null;
  const stateObj = hass.states?.[entityId];
  if (!stateObj || !cvSupportsPosition(stateObj)) return null;
  return {
    label: _cv(hass, "suggestLabel"),
    config: { type: "custom:cover-compact-card", entity: entityId },
  };
}

function cvIsCandidate(hass, entityId) {
  return entityId.split(".")[0] === "cover" && cvSupportsPosition(hass.states?.[entityId]);
}

function cvFindCompatible(hass) {
  if (!hass?.states) return [];
  return Object.keys(hass.states).filter((id) => cvIsCandidate(hass, id)).sort();
}

function cvPickStubEntity(hass, entities, entitiesFallback) {
  if (!hass?.states) return "";
  for (const list of [entities, entitiesFallback]) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((id) => typeof id === "string" && cvIsCandidate(hass, id));
    if (hit) return hit;
  }
  return "";
}

function cvFillFrom(config) { return config?.fill_from === "left" ? "left" : "right"; }

// ── Shared markup ──
function cvIconSvg() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M4 12h16M4 16h16"/></svg>`;
}

// ── Visual editor ──
class CoverCompactCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._domBuilt = false;
    this._el = {};
    this._lastCompatKey = "";
  }
  set hass(h) { this._hass = h; this._update(); }
  setConfig(c) { this._config = { ...c }; this._update(); }

  _buildDom() {
    const t = (k) => _cv(this._hass, k);
    this.shadowRoot.innerHTML = `
<style>
.editor{padding:16px;font-family:var(--paper-font-body1_-_font-family,sans-serif)}
.row{margin-bottom:16px}
label{display:block;font-size:12px;font-weight:500;color:var(--secondary-text-color);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
select,input[type="text"],input[type="number"]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--divider-color,rgba(255,255,255,.06));background:var(--card-background-color,#232640);color:var(--primary-text-color);font-size:14px;font-family:monospace;outline:none;box-sizing:border-box}
select:focus,input:focus{border-color:#4a90d9}
.hint{font-size:11px;color:var(--disabled-text-color,#5c5e76);margin-top:4px}
.empty{font-size:13px;color:var(--disabled-text-color);padding:12px;text-align:center;background:var(--divider-color,rgba(255,255,255,.06));border-radius:8px}
[hidden]{display:none!important}
</style>
<div class="editor">
  <div class="row">
    <label>${t("editorEntity")}</label>
    <div id="en-wrap">
      <select id="en"></select>
      <div class="hint">${t("editorHint")}</div>
    </div>
    <div id="en-empty" class="empty" hidden>${t("editorNoEntity")}</div>
  </div>
  <div class="row">
    <label>${t("editorName")}</label>
    <input type="text" id="nm" placeholder="${t("editorNamePh")}">
    <div class="hint">${t("editorNameHint")}</div>
  </div>
  <div class="row">
    <label>${t("editorDirection")}</label>
    <select id="dir">
      <option value="right">${t("editorDirRight")}</option>
      <option value="left">${t("editorDirLeft")}</option>
    </select>
  </div>
  <div class="row">
    <label>${t("editorTolerance")}</label>
    <input type="number" id="tol" min="0" max="${CV_MAX_CLOSED_TOLERANCE}">
    <div class="hint">${t("editorToleranceHint")}</div>
  </div>
</div>`;
    const r = this.shadowRoot;
    this._el = {
      en: r.getElementById("en"),
      enWrap: r.getElementById("en-wrap"),
      enEmpty: r.getElementById("en-empty"),
      nm: r.getElementById("nm"),
      dir: r.getElementById("dir"),
      tol: r.getElementById("tol"),
    };
    this._el.en.addEventListener("change", (e) => {
      this._config = { ...this._config, entity: e.target.value };
      this._fire();
    });
    // Same focus-safe contract as the other editors: keep the in-memory config
    // current on every keystroke, but only fire config-changed on blur/Enter —
    // firing per keystroke round-trips through hui-card-editor and blurs the
    // input mid-typing.
    this._el.nm.addEventListener("input", (e) => {
      if (e.target.value) this._config = { ...this._config, name: e.target.value };
      else { const { name, ...rest } = this._config; this._config = rest; }
    });
    this._el.nm.addEventListener("change", () => this._fire());
    this._el.dir.addEventListener("change", (e) => {
      if (e.target.value === "left") this._config = { ...this._config, fill_from: "left" };
      else { const { fill_from, ...rest } = this._config; this._config = rest; }
      this._fire();
    });
    this._el.tol.addEventListener("change", (e) => {
      const v = cvClosedTolerance({ closed_tolerance: e.target.value });
      if (v === CV_DEFAULT_CLOSED_TOLERANCE) { const { closed_tolerance, ...rest } = this._config; this._config = rest; }
      else this._config = { ...this._config, closed_tolerance: v };
      this._fire();
    });
    this._domBuilt = true;
  }

  _update() {
    if (!this._hass) return;
    if (!this._domBuilt) this._buildDom();
    const compat = cvFindCompatible(this._hass);
    const cur = this._config.entity || "";
    const nm = this._config.name || "";
    const dir = cvFillFrom(this._config);
    const ae = this.shadowRoot.activeElement;
    const hasCompat = compat.length > 0;

    this._el.enWrap.hidden = !hasCompat;
    this._el.enEmpty.hidden = hasCompat;

    if (hasCompat) {
      const key = compat.join("|");
      if (key !== this._lastCompatKey) {
        const t = (k) => _cv(this._hass, k);
        const opts = [`<option value="">${t("editorSelect")}</option>`];
        for (const id of compat) {
          const n = this._hass.states[id]?.attributes?.friendly_name || id;
          opts.push(`<option value="${id}">${n}</option>`);
        }
        this._el.en.innerHTML = opts.join("");
        this._lastCompatKey = key;
      }
      if (ae !== this._el.en && this._el.en.value !== cur) this._el.en.value = cur;
    }
    if (ae !== this._el.nm && this._el.nm.value !== nm) this._el.nm.value = nm;
    if (ae !== this._el.dir && this._el.dir.value !== dir) this._el.dir.value = dir;
    const tol = String(cvClosedTolerance(this._config));
    if (ae !== this._el.tol && this._el.tol.value !== tol) this._el.tol.value = tol;
  }

  _fire() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
}
customElements.define("cover-compact-card-editor", CoverCompactCardEditor);

// ── Main card ──
class CoverCompactCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._domCreated = false;
    this._el = {};
    // Drag state. _dragStartX is non-null between pointerdown and pointerup;
    // _dragPos only becomes a number once the movement passed the threshold.
    this._dragStartX = null;
    this._dragging = false;
    this._dragPos = null;
    this._pending = null;   // {pos, at} — commanded value, until the device agrees
    this._pendingTimer = null;
    this._lastPos = null;   // last position seen while the cover was reachable
  }

  static getConfigElement() { return document.createElement("cover-compact-card-editor"); }
  static getStubConfig(hass, entities, entitiesFallback) {
    return { entity: cvPickStubEntity(hass, entities, entitiesFallback) };
  }

  setConfig(config) {
    if (!config || !config.entity || config.entity.split(".")[0] !== "cover") {
      throw new Error(_cv(this._hass, "configError"));
    }
    this._config = { ...config };
    this._domCreated = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }

  set hass(h) {
    this._hass = h;
    if (!this._config) return;
    if (!this._domCreated) { this._createDOM(); this._domCreated = true; }
    else { this._update(); }
  }

  getCardSize() { return 1; }

  disconnectedCallback() {
    if (this._pendingTimer) { clearTimeout(this._pendingTimer); this._pendingTimer = null; }
  }

  _stateObj() { return this._hass?.states?.[this._config.entity]; }

  _store() { try { return window.localStorage; } catch (_) { return null; } }

  _name() {
    if (this._config.name) return this._config.name;
    return this._stateObj()?.attributes?.friendly_name || _cv(this._hass, "defaultName");
  }

  _isOffline() {
    const s = this._stateObj();
    return !s || s.state === "unavailable";
  }

  _canControl() {
    return !this._isOffline() && cvSupportsPosition(this._stateObj());
  }

  _createDOM() {
    this.shadowRoot.innerHTML = `
<style>
:host{--cv-accent:var(--state-cover-open-color,var(--state-active-color,#a476e0));--cv-track:rgba(127,127,127,.22);--cv-tm:var(--primary-text-color,#e8e8f0);--cv-ts:var(--secondary-text-color,#8b8da5);--danger:#e25555}
ha-card{overflow:hidden}
.row{display:flex;align-items:stretch;gap:12px;padding:10px 12px}
.left{display:flex;align-items:center;gap:10px;min-width:0;flex:0 1 auto}
.di{width:36px;height:36px;flex:0 0 36px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--cv-accent);background:color-mix(in srgb,var(--cv-accent) 16%,transparent);cursor:pointer;transition:color .3s,background .3s}
.txt{min-width:0;cursor:pointer}
.nm{font-size:13px;font-weight:600;color:var(--cv-tm);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stt{font-size:12px;color:var(--cv-ts);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{position:relative;flex:1 1 45%;min-width:100px;align-self:stretch;border-radius:10px;background:var(--cv-track);overflow:hidden;cursor:ew-resize;touch-action:pan-y;-webkit-tap-highlight-color:transparent}
.fill{position:absolute;top:0;bottom:0;background:var(--cv-accent);transition:width .35s ease,left .35s ease,right .35s ease}
.knob{position:absolute;top:6px;bottom:6px;width:4px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.18);transition:left .35s ease}
.bar.dragging{cursor:grabbing}
.bar.dragging .fill,.bar.dragging .knob{transition:none}
.bar.locked{cursor:default}
:host(.offline) .stt{color:var(--danger)}
:host(.offline) .bar{cursor:default}
[hidden]{display:none!important}
</style>
<ha-card>
  <div class="row">
    <div class="left">
      <div class="di" id="icon">${cvIconSvg()}</div>
      <div class="txt" id="txt">
        <div class="nm" id="nm"></div>
        <div class="stt" id="stt"></div>
      </div>
    </div>
    <div class="bar" id="bar"><div class="fill" id="fill"></div><div class="knob" id="knob"></div></div>
  </div>
</ha-card>`;
    const r = this.shadowRoot;
    this._el = {
      icon: r.getElementById("icon"), txt: r.getElementById("txt"),
      nm: r.getElementById("nm"), stt: r.getElementById("stt"),
      bar: r.getElementById("bar"), fill: r.getElementById("fill"),
      knob: r.getElementById("knob"),
    };
    const moreInfo = () => this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: this._config.entity }, bubbles: true, composed: true,
    }));
    this._el.icon.addEventListener("click", moreInfo);
    this._el.txt.addEventListener("click", moreInfo);
    this._el.bar.addEventListener("pointerdown", (e) => this._onDown(e));
    this._el.bar.addEventListener("pointermove", (e) => this._onMove(e));
    this._el.bar.addEventListener("pointerup", (e) => this._onUp(e));
    this._el.bar.addEventListener("pointercancel", () => this._onCancel());
    this._update();
  }

  // ── Drag: no tap. The service call goes out on release, once. ──
  _onDown(ev) {
    if (!this._canControl()) return;
    this._dragStartX = ev.clientX;
    this._dragging = false;
    this._dragPos = null;
    try { this._el.bar.setPointerCapture(ev.pointerId); } catch (_) { /* older browsers */ }
  }

  _onMove(ev) {
    if (this._dragStartX === null) return;
    if (!this._dragging) {
      if (!cvIsDrag(ev.clientX - this._dragStartX)) return;
      this._dragging = true;
      this._el.bar.classList.add("dragging");
    }
    this._dragPos = cvPosFromX(ev.clientX, this._el.bar.getBoundingClientRect(), cvFillFrom(this._config));
    this._update();
  }

  _onUp(ev) {
    if (this._dragStartX === null) return;
    const dragged = this._dragging;
    const pos = this._dragPos;
    this._endGesture(ev);
    if (!dragged || pos === null) { this._update(); return; }   // a bare tap moves nothing
    const target = cvEffectivePos(pos, cvClosedTolerance(this._config));
    this._pending = { pos: target, at: Date.now() };
    this._hass.callService("cover", "set_cover_position", { entity_id: this._config.entity, position: target });
    // The device usually reports back well before the deadline; this only
    // guarantees the optimistic value can't get stuck on screen.
    if (this._pendingTimer) clearTimeout(this._pendingTimer);
    this._pendingTimer = setTimeout(() => { this._pending = null; this._update(); }, CV_PENDING_MS + 100);
    this._update();
  }

  _onCancel() { this._endGesture(null); this._update(); }

  _endGesture(ev) {
    if (ev) { try { this._el.bar.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ } }
    this._dragStartX = null;
    this._dragging = false;
    this._dragPos = null;
    this._el.bar.classList.remove("dragging");
  }

  _update() {
    if (!this._el.bar) return;
    const s = this._stateObj();
    const offline = this._isOffline();
    const fillFrom = cvFillFrom(this._config);
    const tol = cvClosedTolerance(this._config);
    let devicePos = cvPosOf(s);
    if (devicePos !== null) {
      this._lastPos = devicePos;
      cvRememberPos(this._store(), this._config.entity, devicePos);
    } else if (offline) {
      // HA drops current_position on unavailable: fall back to what we saw last,
      // then to what a previous page load stored.
      if (this._lastPos === null) this._lastPos = cvRecallPos(this._store(), this._config.entity);
      devicePos = this._lastPos;
    }
    if (this._pending && devicePos === this._pending.pos) this._pending = null;
    const raw = cvDisplayPos(devicePos, this._dragPos, this._pending, Date.now());
    const shown = cvEffectivePos(raw, tol);

    this.classList.toggle("offline", offline);
    this._txt(this._el.nm, this._name());
    this._txt(this._el.stt, cvStateLabel(
      this._hass, s,
      offline ? raw : (this._dragPos !== null ? this._dragPos : (this._pending ? raw : null)),
      tol));
    // Icon and bar follow the entity's state colour, same chain as HA's tile:
    // purple while open, grey once closed, --state-unavailable-color offline.
    this.style.setProperty("--cv-accent", cvStateColorVar(s, shown === null ? undefined : shown === 0));

    this._el.bar.classList.toggle("locked", !this._canControl());
    const fill = cvFillPct(shown);
    const boundary = cvBoundaryPct(shown, fillFrom);
    this._el.fill.style.width = `${fill}%`;
    this._el.fill.style.left = fillFrom === "left" ? "0" : "auto";
    this._el.fill.style.right = fillFrom === "left" ? "auto" : "0";
    this._el.knob.hidden = boundary === null || offline;
    // clamp so the handle stays fully inside the bar at 0% and 100%
    if (boundary !== null) this._el.knob.style.left = `clamp(0px, calc(${boundary}% - 2px), calc(100% - 4px))`;
  }

  _txt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
}

customElements.define("cover-compact-card", CoverCompactCard);
window.customCards = window.customCards || [];
// Localized picker name based on browser language, with the English term in
// parentheses so searches in either language match.
(function () {
  const raw = (function () {
    try { return localStorage.getItem("selectedLanguage"); } catch (_) { return null; }
  })() || navigator.language || "en";
  const lang = raw.replace(/^"|"$/g, "").split("-")[0];
  const pickerName = {
    it: "Tapparella compatta (Compact Cover)",
    zh: "紧凑窗帘 (Compact Cover)",
    en: "Compact Cover / Shutter",
  }[lang] || "Compact Cover / Shutter";
  const pickerDesc = {
    it: "Card a riga singola per tapparelle: nome e stato a sinistra, barra di posizione a tutta altezza a destra",
    zh: "单行窗帘卡片：左侧名称与状态，右侧为整高位置条",
    en: "Single-row cover card: name and state on the left, full-height position bar on the right",
  }[lang] || "Single-row cover card: name and state on the left, full-height position bar on the right";
  window.customCards.push({
    type: "cover-compact-card",
    name: pickerName,
    description: pickerDesc,
    preview: true,
    // HA >= 2026.6: puts the card, with a live preview, in the "by entity" tab
    // of the card picker whenever the picked entity is a positionable cover.
    getEntitySuggestion: (hass, entityId) => cvSuggestFor(hass, entityId),
  });
})();
console.info("%c COVER-COMPACT-CARD %c v1.1.0 ", "color:white;background:#a476e0;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px;", "color:#a476e0;background:#1a1c2e;font-weight:bold;padding:2px 6px;border-radius:0 4px 4px 0;");
