/**
 * Tuya Cards for Home Assistant
 * Collection of custom Lovelace cards for Tuya-based smart devices
 *
 * https://github.com/simoneavogadro/tuya-cards-for-ha
 */

// --- irrigation-control-card.js ---
/**
 * Irrigation Control Card for Home Assistant
 * Custom Lovelace card for Tuya-based smart irrigation valves (TS0601)
 * v2.9.1 — The date in the run rows collapses on a narrow card. Runs from the
 *          last few days now carry their weekday: "Lunedì 24 ago 05:30" where
 *          there is room, "Lunedì 05:30" where there isn't. The start time
 *          never collapses, and a row older than a week has no weekday to
 *          stand in for its date, so it keeps the date at every width.
 *          Pure CSS — the markup holds both parts and an @container query on
 *          the history section picks one, so resizing never re-renders rows.
 *          _smartDateTime becomes _smartDateParts + _whenHtml; the compact
 *          "ULTIMA" line adopts the same format, retiring _smartDate and the
 *          atSep i18n key.
 * v2.9.0 — Run list unified with the Sonoff valve card: the "last irrigation"
 *          detail panel (level 1) is gone, so the chevron on the compact row
 *          now opens the run list directly — one expansion instead of two.
 *          Rows keep a black background with a hairline separator, carry the
 *          start time in a fixed-width tabular column (_smartDateTime), and the
 *          compact row shows duration alongside liters. New i18n: yesterday.
 * v2.7.1 — Compact "last irrigation" line: the label is now just "Ultima" /
 *          "Last" / "上次". The full wording overflowed to two lines with a
 *          large mobile font, and the short form matches the Sonoff valve
 *          card. The expanded panel keeps the full title.
 * v2.6.0 — Irrigation history. A nested second "+" inside the expanded "last
 *          irrigation" view reveals a scrollable list of past runs (when /
 *          duration / liters / outcome), read from the integration's new
 *          sensor.<prefix>_irrigation_history `runs` attribute. The level-1 view
 *          is unchanged (live device DPs while running, for real-time
 *          monitoring); when idle it now prefers the persisted history record so
 *          the summary survives a restart and isn't 24h-gated. New i18n:
 *          history / noHistory + outcome labels (it/en/zh).
 * v2.5.1 — "Arresto…" overlay on stop, symmetric to the start overlay. Pressing
 *          stop covers the action panel (intercepting clicks) until the switch
 *          confirms off, with a 10s watchdog → "Arresto fallito". Prevents a
 *          double-tap or a tab-switch + restart from racing the close delay into
 *          an inconsistent state. i18n: stopping/stopFailed (it/en/zh).
 * v2.5.0 — Progress bar is now derived from device truth instead of a client-side
 *          setInterval counter. The integration writes the device's MODE +
 *          TARGET DPs at run start, so the device echoes them back and computes
 *          irrigation_end_time = start + target. Tempo bar uses end_time -
 *          start_time (the device's own projected end, set immediately on a
 *          duration run); a NEW liters bar uses summation_delivered / target.
 *          The switch stays the single source of truth for the running state and
 *          play/stop button; the "Avvio…" overlay covers the open delay and
 *          clears once the device reports the run. Survives a browser refresh and
 *          reflects automation-started runs (a stale-start_time guard covers the
 *          ~1.5s open gap). Fixes the v2.4.x bug where the tempo countdown/bar
 *          never appeared after the valve opened.
 * v2.2.8 — Name field: defer config-changed to the `change` event (blur/Enter)
 *          instead of firing per keystroke on `input`. v2.2.7 stopped the
 *          editor from rebuilding its own DOM, but per-keystroke
 *          config-changed still round-tripped through HA's hui-card-editor
 *          which blurred the input mid-typing. In-memory config is still
 *          updated on every keystroke so a Save click without prior blur
 *          captures the typed value.
 * v2.2.7 — Visual editor no longer steals focus while typing. HA pushes a
 *          fresh hass object to all card editors every few seconds, and the
 *          editor's set hass() was wholesale-replacing shadowRoot.innerHTML
 *          on every push — destroying the focused <input> and stealing the
 *          caret. Editor now builds its DOM once and patches values in
 *          place, skipping inputs that have focus. Mirrors the in-place
 *          update pattern already used by the main card render.
 * v2.2.6 — "Ultima irrigazione" timestamp now reflects the device-reported
 *          start_time entity instead of last_irrigation_duration.last_changed.
 *          When start_time is unavailable (e.g. paired with a quirk that
 *          doesn't emit it, or HA timestamp-class init bug), the line
 *          collapses to "nessuna" — instead of synthesising a misleading
 *          time from a sensor heartbeat that doesn't represent the actual
 *          irrigation moment.
 * v2.2.5 — Add a third "Manual" action button next to Liters/Time. It's a
 *          one-shot shortcut: opens the Time panel pre-filled with
 *          `manual_seconds` (default 300, configurable via the visual editor,
 *          range 30-1800) and starts immediately. Reuses the existing
 *          tuya_irrigation.irrigation_by_seconds service so the integration's
 *          shutdown safety sweep covers the valve too. Stop early via the
 *          standard Time-panel stop button.
 * v2.2.4 — Drop the last_updated staleness fallback: ZHA doesn't refresh
 *          last_updated for unchanged values, so a quiet but healthy valve
 *          (no irrigation, stable battery, no summation change) flipped to
 *          "Offline" after 24h. Trust HA's switch state == "unavailable"
 *          alone, matching the soil-moisture-card behavior.
 *          Cosmetic: header right side now shows status badge first, then
 *          battery on the far right.
 * v2.2.2 — Offline UI: hide the action panel entirely (Liters/Time buttons +
 *          inputs) instead of just dimming it. The buttons can't do anything
 *          when the valve is unreachable, so the dim+disabled state was just
 *          visual clutter.
 * v2.2.0 — Offline state: when the valve switch is unavailable/unknown, show a
 *          red "Offline" badge, an explanatory banner, hide battery, and disable
 *          the action buttons so calls don't fail silently.
 */

// ── i18n ──
const I18N = {
  it: {
    irrigating: "Irrigando", paused: "In pausa", off: "Spento",
    starting: "Avvio…", startFailed: "Avvio fallito",
    stopping: "Arresto…", stopFailed: "Arresto fallito",
    dispenseFor: "Eroga per:", liters: "Litri", time: "Tempo", manual: "Manuale",
    remaining: "rimanente",
    repeats: "Ripetizioni", cycles: "Cicli", cycleInterval: "Intervallo cicli",
    last: "Ultima",
    noRecent: "Nessuna irrigazione recente", none: "nessuna",
    history: "Storico", noHistory: "Nessuna corsa registrata",
    oc_completed: "Completata", oc_stopped: "Interrotta", oc_timeout: "Timeout", oc_stalled: "Nessun flusso", oc_shutdown: "Riavvio", oc_auto: "Auto", oc_manual: "Manuale",
    now: "adesso", minAgo: "${m} min fa", hoursAgo: "${h}h ${m}m fa",
    today: "oggi", yesterday: "ieri",
    editorDevice: "Dispositivo irrigazione", editorSelect: "— Seleziona —",
    editorHint: "Mostra solo i dispositivi con tutte le entità irrigazione",
    editorNoDevice: "Nessun dispositivo irrigazione compatibile",
    editorName: "Nome (opzionale)", editorNamePh: "Nome personalizzato",
    editorNameHint: "Lascia vuoto per usare il nome del dispositivo",
    editorManualSec: "Durata test manuale (secondi)",
    editorManualSecHint: "Quanto dura la prova rapida quando premi il pulsante Manuale (30–1800 s)",
    configError: "Seleziona un dispositivo irrigazione nella configurazione",
    defaultName: "Irrigazione",
    integrationMissing: "Installa l'integrazione Tuya Irrigation per abilitare il controllo",
    cardDesc: "Card compatta per valvole irrigazione Tuya con timer, pianificazione e storico",
    offline: "Offline",
    offlineMsg: "Valvola non raggiungibile — controllare batteria e segnale Zigbee",
  },
  en: {
    irrigating: "Irrigating", paused: "Paused", off: "Off",
    starting: "Starting…", startFailed: "Start failed",
    stopping: "Stopping…", stopFailed: "Stop failed",
    dispenseFor: "Dispense for:", liters: "Liters", time: "Time", manual: "Manual",
    remaining: "remaining",
    repeats: "Repeats", cycles: "Cycles", cycleInterval: "Cycle interval",
    last: "Last",
    noRecent: "No recent irrigation", none: "none",
    history: "History", noHistory: "No runs recorded",
    oc_completed: "Completed", oc_stopped: "Stopped", oc_timeout: "Timeout", oc_stalled: "No flow", oc_shutdown: "Restart", oc_auto: "Auto", oc_manual: "Manual",
    now: "just now", minAgo: "${m} min ago", hoursAgo: "${h}h ${m}m ago",
    today: "today", yesterday: "yesterday",
    editorDevice: "Irrigation device", editorSelect: "— Select —",
    editorHint: "Shows only devices with all irrigation entities",
    editorNoDevice: "No compatible irrigation device found",
    editorName: "Name (optional)", editorNamePh: "Custom name",
    editorNameHint: "Leave empty to use device name",
    editorManualSec: "Manual test duration (seconds)",
    editorManualSecHint: "How long the quick test runs when you press Manual (30–1800 s)",
    configError: "Select an irrigation device in the configuration",
    defaultName: "Irrigation",
    integrationMissing: "Install the Tuya Irrigation integration to enable control",
    cardDesc: "Compact card for Tuya irrigation valves with timer, scheduling and history",
    offline: "Offline",
    offlineMsg: "Valve unreachable — check battery and Zigbee signal",
  },
  zh: {
    irrigating: "灌溉中", paused: "已暂停", off: "关闭",
    starting: "启动中…", startFailed: "启动失败",
    stopping: "停止中…", stopFailed: "停止失败",
    dispenseFor: "灌溉方式：", liters: "升量", time: "时长", manual: "手动",
    remaining: "剩余",
    repeats: "重复", cycles: "循环次数", cycleInterval: "循环间隔",
    last: "上次",
    noRecent: "无近期灌溉记录", none: "无",
    history: "历史", noHistory: "无记录",
    oc_completed: "已完成", oc_stopped: "已停止", oc_timeout: "超时", oc_stalled: "无水流", oc_shutdown: "重启", oc_auto: "自动", oc_manual: "手动",
    now: "刚刚", minAgo: "${m}分钟前", hoursAgo: "${h}小时${m}分钟前",
    today: "今天", yesterday: "昨天",
    editorDevice: "灌溉设备", editorSelect: "— 选择 —",
    editorHint: "仅显示具有所有灌溉实体的设备",
    editorNoDevice: "未找到兼容的灌溉设备",
    editorName: "名称（可选）", editorNamePh: "自定义名称",
    editorNameHint: "留空使用设备名称",
    editorManualSec: "手动测试时长（秒）",
    editorManualSecHint: "按下手动按钮时快速测试的持续时间（30–1800 秒）",
    configError: "请在配置中选择灌溉设备",
    defaultName: "灌溉",
    integrationMissing: "请安装 Tuya Irrigation 集成以启用控制",
    cardDesc: "适用于涂鸦灌溉阀的紧凑卡片，含定时、计划和历史记录",
    offline: "离线",
    offlineMsg: "阀门无法连接 — 请检查电池和 Zigbee 信号",
  },
};
function _i18nLang(hass) {
  const lang = hass?.language?.split("-")[0] || "en";
  return I18N[lang] ? lang : "en";
}
function _t(hass, key) { return (I18N[_i18nLang(hass)] || I18N.en)[key] || I18N.en[key] || key; }
function _tf(hass, key, vars) {
  let s = _t(hass, key);
  for (const [k, v] of Object.entries(vars)) s = s.replace("${" + k + "}", v);
  return s;
}
function _numLocale(hass) { const l = hass?.language; return l || "en"; }

const SUFFIXES = {
  mode:          { domain: "select", suffix: "_irrigation_mode" },
  target:        { domain: "number", suffix: "_irrigation_target" },
  cycles:        { domain: "number", suffix: "_irrigation_cycles" },
  interval:      { domain: "number", suffix: "_irrigation_interval" },
  last_duration: { domain: "sensor", suffix: "_last_irrigation_duration" },
  summation:     { domain: "sensor", suffix: "_summation_delivered" },
  battery:       { domain: "sensor", suffix: "_battery" },
  start_time:    { domain: "sensor", suffix: "_irrigation_start_time" },
  end_time:      { domain: "sensor", suffix: "_irrigation_end_time" },
  history:       { domain: "sensor", suffix: "_irrigation_history" },
};
const REQUIRED = ["mode", "target", "cycles", "interval", "last_duration", "summation"];

function buildEntities(sw) {
  const p = sw.replace("switch.", "");
  const e = { switch: sw };
  for (const [k, d] of Object.entries(SUFFIXES)) e[k] = `${d.domain}.${p}${d.suffix}`;
  return e;
}
function isCompatible(sw, hass) {
  const p = sw.replace("switch.", "");
  return REQUIRED.every(k => { const d = SUFFIXES[k]; return hass.states[`${d.domain}.${p}${d.suffix}`] !== undefined; });
}
function findCompatible(hass) {
  return Object.keys(hass.states).filter(e => e.startsWith("switch.")).filter(e => isCompatible(e, hass));
}

// ── Editor ──
// v2.2.7: build the DOM once, then update values in place. HA pushes a fresh
// `hass` object every few seconds (state updates); the old implementation
// replaced shadowRoot.innerHTML on every push, which destroyed the currently
// focused <input> and stole the caret mid-typing. Same anti-pattern that was
// fixed in the main card render — applied here too. Focused inputs are never
// overwritten (so the config-changed → setConfig round-trip can't reset the
// caret either). Labels are baked at first build per [[feedback_no_live_lang_switch]].
class IrrigationControlCardEditor extends HTMLElement {
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
    const t = (k) => _t(this._hass, k);
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
    <label>${t("editorDevice")}</label>
    <div id="sw-wrap">
      <select id="sw"></select>
      <div class="hint">${t("editorHint")}</div>
    </div>
    <div id="sw-empty" class="empty" hidden>${t("editorNoDevice")}</div>
  </div>
  <div class="row">
    <label>${t("editorName")}</label>
    <input type="text" id="nm" placeholder="${t("editorNamePh")}">
    <div class="hint">${t("editorNameHint")}</div>
  </div>
  <div class="row">
    <label>${t("editorManualSec")}</label>
    <input type="number" id="ms" min="30" max="1800" step="30">
    <div class="hint">${t("editorManualSecHint")}</div>
  </div>
</div>`;
    const r = this.shadowRoot;
    this._el = {
      sw: r.getElementById("sw"),
      swWrap: r.getElementById("sw-wrap"),
      swEmpty: r.getElementById("sw-empty"),
      nm: r.getElementById("nm"),
      ms: r.getElementById("ms"),
    };
    this._el.sw.addEventListener("change", e => {
      this._config = { ...this._config, switch: e.target.value };
      this._fire();
    });
    // Update the in-memory config on every keystroke so a Save click that
    // doesn't blur the input first still captures the typed value — but only
    // fire config-changed on `change` (blur/Enter). Firing per keystroke
    // round-trips through HA's hui-card-editor and ends up blurring the
    // input mid-typing, even though our _update() respects activeElement.
    this._el.nm.addEventListener("input", e => {
      if (e.target.value) this._config = { ...this._config, name: e.target.value };
      else { const { name, ...rest } = this._config; this._config = rest; }
    });
    this._el.nm.addEventListener("change", () => this._fire());
    this._el.ms.addEventListener("change", e => {
      const v = parseInt(e.target.value);
      if (Number.isFinite(v) && v >= 30 && v <= 1800) this._config = { ...this._config, manual_seconds: v };
      else { const { manual_seconds, ...rest } = this._config; this._config = rest; }
      this._fire();
    });
    this._domBuilt = true;
  }

  _update() {
    if (!this._hass) return;
    if (!this._domBuilt) this._buildDom();
    const compat = findCompatible(this._hass);
    const cur = this._config.switch || "";
    const nm = this._config.name || "";
    const ms = String(this._config.manual_seconds ?? 300);
    const ae = this.shadowRoot.activeElement;
    const hasCompat = compat.length > 0;

    this._el.swWrap.hidden = !hasCompat;
    this._el.swEmpty.hidden = hasCompat;

    if (hasCompat) {
      // Only rebuild <option>s when the compat set actually changed — avoids
      // clobbering an open dropdown on every HA state push.
      const key = compat.join("|");
      if (key !== this._lastCompatKey) {
        const t = (k) => _t(this._hass, k);
        const opts = [`<option value="">${t("editorSelect")}</option>`];
        for (const s of compat) {
          const n = this._hass.states[s]?.attributes?.friendly_name || s;
          opts.push(`<option value="${s}">${n}</option>`);
        }
        this._el.sw.innerHTML = opts.join("");
        this._lastCompatKey = key;
      }
      if (ae !== this._el.sw && this._el.sw.value !== cur) this._el.sw.value = cur;
    }

    // Never overwrite an input the user is currently editing — that's what
    // resets the caret and makes the dialog feel "rebuilt".
    if (ae !== this._el.nm && this._el.nm.value !== nm) this._el.nm.value = nm;
    if (ae !== this._el.ms && this._el.ms.value !== ms) this._el.ms.value = ms;
  }

  _fire() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
}
customElements.define("irrigation-control-card-editor", IrrigationControlCardEditor);

// ── Main Card ──
class IrrigationControlCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._config = null; this._entities = null;
    this._mode = null;
    // Render tick: while the valve is open we re-render once a second so the
    // device-derived countdown/progress bar advances. The displayed values come
    // from device truth (start_time/end_time/summation_delivered), not from this
    // timer, so the bar never drifts and self-corrects on every hass update.
    this._tick = null; this._startPressedAt = 0;
    // "Starting…" overlay state: shown between pressing play and the switch
    // actually turning on (the integration delays the open ~1.5s for clock sync).
    this._starting = false; this._startKind = null; this._startTotalSec = 0;
    this._failed = false; this._startTimer = null;
    // "Arresto…" overlay state: shown between pressing stop and the switch
    // actually turning off, so the controls can't be mis-operated (double-tap or
    // navigate-and-restart) into an inconsistent state during the close delay.
    this._stopping = false; this._stopFailed = false; this._stopTimer = null;
    this._inputLitri = 1; this._inputMin = 0; this._inputSec = 0;
    this._userEditedLitri = false; this._userEditedTempo = false;
    this._histOpen = false;
    this._histListSig = "";
    this._domCreated = false;
    this._el = {};
  }

  static getConfigElement() { return document.createElement("irrigation-control-card-editor"); }
  static getStubConfig() { return { switch: "", name: "", manual_seconds: 300 }; }

  setConfig(config) {
    if (config.entities?.switch) this._entities = config.entities;
    else if (config.switch) this._entities = buildEntities(config.switch);
    else throw new Error(_t(this._hass, "configError"));
    this._configName = config.name || "";
    // Quick-test duration for the Manual shortcut button. Clamped to a sane
    // range so a typo can't fire a 5-hour irrigation. Default 5 min covers
    // sprinkler tests; user can stop early via the Tempo panel's stop button.
    const rawManual = parseInt(config.manual_seconds);
    this._manualSec = (Number.isFinite(rawManual) && rawManual >= 30 && rawManual <= 1800) ? rawManual : 300;
    this._config = config;
    this._domCreated = false;
    if (this._hass) this._render();
  }

  _getName() {
    if (this._configName) return this._configName;
    const sw = this._hass?.states[this._entities.switch];
    return sw?.attributes?.friendly_name || _t(this._hass, "defaultName");
  }

  set hass(hass) {
    const old = this._hass; this._hass = hass;
    const wasOn = old?.states[this._entities.switch]?.state === "on";
    const isOn = hass?.states[this._entities.switch]?.state === "on";
    const firstLoad = old === null;
    if (isOn) {
      // Valve is open (by us, by an automation, or already running on (re)load).
      // The switch is the single source of truth. Reflect the device's run mode
      // in the open panel only on the rising edge / first load, so the user can
      // still close a panel mid-run without it snapping back.
      if (!wasOn || firstLoad) this._reflectRunMode();
      this._startTick();
      this._maybeClearStarting();
    } else {
      if (wasOn) { this._clearStarting(); this._clearStopping(); this._userEditedTempo = false; this._startPressedAt = 0; }
      this._stopTick();
      // Only sync inputs from the device when idle and not mid-start, so a
      // transient unknown/stale value can't disturb the inputs.
      if (!this._starting) this._syncFromEntities();
    }
    this._render();
  }

  _syncFromEntities() {
    // The device target holds seconds in Duration mode and liters in Capacity
    // mode (the integration writes it at run start). Fill each input only from
    // the matching mode, so a tempo target can't land in the liters box or
    // vice-versa.
    const modeRaw = this._sv(this._entities.mode);
    const t = this._nv(this._entities.target);
    if (modeRaw === "Capacity" && !this._userEditedLitri && t > 0) this._inputLitri = t;
    if (modeRaw === "Duration" && !this._userEditedTempo && t > 0) {
      this._inputMin = Math.floor(t / 60); this._inputSec = Math.round(t % 60);
    }
  }

  getCardSize() { return 5; }
  _sv(eid) { if (!eid || !this._hass?.states[eid]) return "unavailable"; return this._hass.states[eid].state; }
  _nv(eid) { const v = parseFloat(this._sv(eid)); return isNaN(v) ? 0 : v; }
  // Parse a timestamp-state entity (e.g. irrigation_start_time / _end_time)
  // as a Date. Returns null when the entity is missing, unavailable, or its
  // state isn't a valid timestamp. Used to drive the "ultima irrigazione"
  // line: if the device hasn't reported a real start timestamp, the line
  // collapses to "nessuna" rather than synthesising one from sensor
  // last_changed (which would be a heartbeat proxy, not the real time).
  _tsDate(eid) {
    const s = this._hass?.states[eid];
    if (!s || s.state === "unavailable" || s.state === "unknown" || s.state === "none" || !s.state) return null;
    const d = new Date(s.state);
    return isNaN(d.getTime()) ? null : d;
  }
  _isOn() { return this._sv(this._entities.switch) === "on"; }
  // Trust HA's authoritative availability signal. ZHA's own sweep flips the
  // switch entity to "unavailable" when the device stops responding. We
  // deliberately do NOT add a last_updated staleness check: ZHA doesn't
  // refresh last_updated for unchanged values, so a quiet healthy valve
  // (no irrigation, stable battery) would false-positive as offline.
  _isOffline() {
    const s = this._hass?.states[this._entities.switch];
    if (!s) return true;
    return s.state === "unavailable" || s.state === "unknown" || s.state === "none";
  }
  async _svc(d, s, data) { await this._hass.callService(d, s, data); }

  // ── DOM helpers ──
  _txt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  _setInput(el, v) { const s = String(v); if (el && el.value !== s) el.value = s; }
  _cls(el, cls, on) { if (el) el.classList.toggle(cls, !!on); }
  _esc(v) { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // innerHTML twin of _txt for the one cell that carries markup (the compact
  // "when" line). dataset.v is the change guard — comparing innerHTML back is
  // unreliable once the browser has normalised it.
  _html(el, v) { if (el && el.dataset.v !== v) { el.dataset.v = v; el.innerHTML = v; } }

  _isEditingGroup(group) {
    const ae = this.shadowRoot.activeElement;
    if (!ae || ae.tagName !== "INPUT") return false;
    switch (group) {
      case "litri": return ae.id === "vl";
      case "tempo": return ae.id === "t-min" || ae.id === "t-sec";
      case "interval": return ae.id === "iv-hh" || ae.id === "iv-mm";
      default: return false;
    }
  }

  _selectMode(m) {
    this._mode = this._mode === m ? null : m;
    if (!this._mode) { this._userEditedLitri = false; this._userEditedTempo = false; }
    this._render();
  }

  // v2.0.0: irrigation actions delegate to the tuya_irrigation integration.
  // The integration runs the timer/volume loop server-side, so the valve is
  // reliably closed even when this card is not open in a browser.
  _integrationAvailable() {
    return !!(this._hass?.services?.tuya_irrigation?.irrigation_by_seconds);
  }

  // ── "Starting…" overlay lifecycle ──
  // The integration delays the valve open (~1.5s) to sync the device clock, so
  // there's a gap between pressing play and the switch turning on. We cover that
  // gap with an overlay and a 10s watchdog; the switch turning on (handled in
  // `set hass`) clears it, a timeout marks it failed.
  _beginStarting(kind, totalSec) {
    this._starting = true; this._startKind = kind; this._startTotalSec = totalSec;
    this._startPressedAt = Date.now();
    this._failed = false;
    if (this._startTimer) clearTimeout(this._startTimer);
    this._startTimer = setTimeout(() => this._startTimedOut(), 10000);
    this._render();
  }
  _startTimedOut() {
    this._startTimer = null;
    if (!this._starting) return;
    // Switch never turned on within 10s — surface "failed" briefly, then clear.
    this._failed = true; this._render();
    setTimeout(() => {
      this._starting = false; this._failed = false; this._startKind = null; this._render();
    }, 1800);
  }
  _clearStarting() {
    if (this._startTimer) { clearTimeout(this._startTimer); this._startTimer = null; }
    this._starting = false; this._failed = false; this._startKind = null;
  }

  // ── "Arresto…" overlay lifecycle ──
  // Symmetric to the start overlay: covers the controls from pressing stop until
  // the switch confirms off (handled in `set hass`). The overlay intercepts
  // clicks, so a double-tap or a tab switch + restart can't race the close.
  _beginStopping() {
    this._clearStarting();
    this._stopping = true; this._stopFailed = false;
    if (this._stopTimer) clearTimeout(this._stopTimer);
    this._stopTimer = setTimeout(() => this._stopTimedOut(), 10000);
    this._render();
  }
  _stopTimedOut() {
    this._stopTimer = null;
    if (!this._stopping) return;
    // Switch never turned off within 10s — surface "failed" briefly, then clear.
    this._stopFailed = true; this._render();
    setTimeout(() => {
      this._stopping = false; this._stopFailed = false; this._render();
    }, 1800);
  }
  _clearStopping() {
    if (this._stopTimer) { clearTimeout(this._stopTimer); this._stopTimer = null; }
    this._stopping = false; this._stopFailed = false;
  }

  async _startLitri() {
    const v = this._inputLitri; if (v <= 0) return;
    if (this._isOffline() || this._starting || this._stopping) return;
    if (!this._integrationAvailable()) { console.warn("[irrigation-control-card] tuya_irrigation integration not installed"); return; }
    this._beginStarting("litri", 0);
    await this._svc("tuya_irrigation", "irrigation_by_liters", {
      switch_entity: this._entities.switch,
      liters: v,
    });
  }
  async _stopLitri() {
    this._beginStopping();
    await this._svc("switch", "turn_off", { entity_id: this._entities.switch });
  }

  async _toggleTimer() {
    if (this._isOffline() || this._starting || this._stopping) return;
    // Switch is the source of truth: on → stop, off → start.
    if (this._isOn()) await this._stopTimerIrr();
    else await this._startTimerIrr();
  }
  async _startTimerIrr() {
    const tot = this._inputMin * 60 + this._inputSec; if (tot <= 0) return;
    if (!this._integrationAvailable()) { console.warn("[irrigation-control-card] tuya_irrigation integration not installed"); return; }
    // Show the overlay immediately; the countdown begins only once the switch
    // actually turns on (see `set hass`). The close is handled server-side.
    this._beginStarting("tempo", tot);
    await this._svc("tuya_irrigation", "irrigation_by_seconds", {
      switch_entity: this._entities.switch,
      seconds: tot,
    });
  }
  async _stopTimerIrr() {
    // Stopping an integration-managed run = turn_off, which triggers the
    // integration's finally block and closes the valve cleanly. The "Arresto…"
    // overlay covers the controls until the switch confirms off (handled in
    // `set hass`), which also resets the UI to idle.
    this._beginStopping();
    await this._svc("switch", "turn_off", { entity_id: this._entities.switch });
  }
  // One-shot shortcut: opens the Tempo panel, fills it with `_manualSec`,
  // and starts immediately. The "Manual" button has no persistent active
  // state — once clicked, the user is in Tempo mode and can stop early via
  // the standard Tempo stop button.
  async _startManual() {
    if (this._isOffline() || this._starting || this._stopping) return;
    if (!this._integrationAvailable()) { console.warn("[irrigation-control-card] tuya_irrigation integration not installed"); return; }
    const tot = this._manualSec;
    this._mode = "tempo";
    this._inputMin = Math.floor(tot / 60);
    this._inputSec = tot % 60;
    this._userEditedTempo = true;
    this._beginStarting("tempo", tot);
    await this._svc("tuya_irrigation", "irrigation_by_seconds", {
      switch_entity: this._entities.switch,
      seconds: tot,
    });
  }

  // ── Render tick (device-truth progress) ──
  // While the valve is open we re-render every second so the countdown digits and
  // progress bar advance. The values are derived from the device's start_time /
  // end_time / summation_delivered on each render, so they survive a browser
  // refresh, reflect automation-started runs, and never drift.
  _startTick() { if (this._tick) return; this._tick = setInterval(() => this._render(), 1000); }
  _stopTick() { if (this._tick) { clearInterval(this._tick); this._tick = null; } }

  // Which kind of run is active, from the device's irrigation mode (written by
  // the integration at run start). Falls back to our own _startKind during the
  // brief open delay before the device echoes the mode back.
  _runKind() {
    const m = this._sv(this._entities.mode);
    if (m === "Capacity") return "litri";
    if (m === "Duration") return "tempo";
    return this._startKind || null;
  }
  _reflectRunMode() {
    if (this._mode !== null) return;   // don't yank a panel the user opened
    const kind = this._runKind();
    if (kind) this._mode = kind;
  }
  _maybeClearStarting() {
    if (!this._starting) return;
    const kind = this._runKind();
    if (kind === "litri") { this._clearStarting(); return; }
    if (kind === "tempo" && this._tempoProgress()) { this._clearStarting(); return; }
    // else: device hasn't reported the run yet — keep the overlay; the 10s
    // watchdog set in _beginStarting still fires if it never does.
  }
  // Tempo progress from the device clock. The valve sets end_time = start + target
  // immediately on a duration run, so we use end_time - start_time as the total
  // (falling back to the target seconds, then to our requested duration). Guards
  // against a stale start_time during the ~1.5s open delay by using our own press
  // time until the device reports a fresh one.
  _tempoProgress() {
    let start = this._tsDate(this._entities.start_time);
    if (this._startPressedAt && (!start || start.getTime() < this._startPressedAt - 5000)) {
      start = new Date(this._startPressedAt);
    }
    if (!start) return null;
    let total;
    const end = this._tsDate(this._entities.end_time);
    if (end && end.getTime() > start.getTime()) total = Math.round((end.getTime() - start.getTime()) / 1000);
    else { const tgt = this._nv(this._entities.target); total = tgt > 0 ? tgt : this._startTotalSec; }
    if (!total || total <= 0) return null;
    const remaining = Math.max(0, total - Math.floor((Date.now() - start.getTime()) / 1000));
    return { remaining, total, pct: Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) };
  }
  // Liters progress from the live summation_delivered vs the target (liters).
  _litriProgress() {
    let target = this._nv(this._entities.target);
    if (target <= 0) target = this._inputLitri;
    if (target <= 0) return null;
    const delivered = Math.max(0, this._nv(this._entities.summation));
    return { delivered, target, pct: Math.max(0, Math.min(100, Math.round((delivered / target) * 100))) };
  }
  // Unified running view used by both the initial DOM and the selective update.
  _runView() {
    const isOn = this._isOn();
    const kind = isOn ? this._runKind() : null;
    return {
      isOn, kind,
      tp: kind === "tempo" ? this._tempoProgress() : null,
      lp: kind === "litri" ? this._litriProgress() : null,
    };
  }

  async _toggleSchedule() { const c = this._nv(this._entities.cycles); await this._svc("number", "set_value", { entity_id: this._entities.cycles, value: c <= 1 ? 2 : 0 }); }
  async _adjCycles(d) { const nv = Math.max(2, Math.min(100, this._nv(this._entities.cycles) + d)); await this._svc("number", "set_value", { entity_id: this._entities.cycles, value: nv }); }
  async _setIv() {
    const hh = parseInt(this._el.ivHh?.value) || 0;
    const mm = parseInt(this._el.ivMm?.value) || 0;
    if (this._entities.interval) await this._svc("number", "set_value", { entity_id: this._entities.interval, value: hh * 3600 + mm * 60 });
  }

  _ago(date) {
    if (!date) return null; const d = Date.now() - date.getTime();
    if (d < 0 || d > 86400000) return null;
    const m = Math.floor(d / 60000);
    if (m < 1) return _t(this._hass, "now");
    if (m < 60) return _tf(this._hass, "minAgo", { m });
    return _tf(this._hass, "hoursAgo", { h: Math.floor(m / 60), m: m % 60 });
  }
  _fd(s) { s = Math.round(s); if (s < 60) return `${s} s`; const m = Math.floor(s / 60), r = s % 60; if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m} min`; return `${Math.floor(m / 60)}h ${m % 60}m`; }
  // Date + start time as parts, so a narrow card can drop the date (see
  // _whenHtml and the @container rule). Kept identical in the other card.
  //   today            → oggi   ·  —            · 06:30
  //   yesterday        → ieri   ·  —            · 06:30
  //   2-6 days ago     → Lunedì ·  24 ago       · 06:30
  //   older, same year →   —    ·  24 ago       · 06:30
  //   previous years   →   —    ·  24 ago 2024  · 06:30
  // The day-count branches are tested BEFORE the year one, so a five-day-old
  // run either side of New Year reads "Domenica 28 dic 06:30": the year would
  // be noise on a run that recent.
  _smartDateParts(date) {
    if (!date || isNaN(date.getTime())) return null;
    const now = new Date();
    const locale = this._hass?.language || _i18nLang(this._hass);
    const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);
    const tm = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    // Calendar-day difference, not elapsed hours: 23:50 → 00:10 is "yesterday".
    const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
    if (days === 0) return { wd: _t(this._hass, "today"), dt: null, tm };
    if (days === 1) return { wd: _t(this._hass, "yesterday"), dt: null, tm };
    // Stops at 6: the seventh day back carries today's own weekday name.
    const wd = (days >= 2 && days <= 6)
      ? cap(date.toLocaleDateString(locale, { weekday: "long" })) : null;
    const opts = date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
    return { wd, dt: date.toLocaleDateString(locale, opts), tm };
  }
  // The parts as spans. `opt` marks the cell a narrow card may drop, and it is
  // set ONLY when a weekday is there to stand in for the date — an older row
  // has no weekday, so it keeps its date at every width rather than being left
  // with a bare "06:30".
  _whenHtml(date) {
    const p = this._smartDateParts(date);
    if (!p) return "";
    let out = p.wd ? `<span>${this._esc(p.wd)}</span>` : "";
    if (p.dt) out += `<span${p.wd ? ' class="opt"' : ""}>${this._esc(p.dt)}</span>`;
    return out + `<span>${this._esc(p.tm)}</span>`;
  }
  // "17m 13s · 100 L" for the compact row. The "Litri:" label is gone: the unit
  // already says it, and this line has to survive a large mobile font on one
  // line. Either half may be missing (a duration run records no liters).
  _summaryText(dur, vol) {
    const d = (dur != null && dur > 0) ? this._fd(dur) : "";
    const v = (vol != null) ? `${this._fmtVolShortNum(vol)} L` : "";
    return d && v ? `${d} · ${v}` : (d || v);
  }
  _fmtVolShortNum(v) {
    const n = Number(v) || 0;
    return n.toLocaleString(_numLocale(this._hass), { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  _p2(n) { return String(Math.round(n)).padStart(2, "0"); }

  _toggleHist() {
    this._histOpen = !this._histOpen;
    this._render();
  }

  // Recorded runs from the integration's history sensor (newest first). Empty
  // when the (updated) integration isn't present — the second "+" then hides.
  _histRuns() {
    const e = this._entities;
    if (!e.history) return [];
    const runs = this._hass?.states[e.history]?.attributes?.runs;
    return Array.isArray(runs) ? runs : [];
  }

  // View model for the "last irrigation" summary (level 1). Volume/duration tick
  // from the device DPs while a run is live (real-time monitoring); the absolute
  // wall-clock times, however, are NEVER taken from the device start/end_time DPs:
  // the GiEX RTC free-runs on UTC (hours off from local) and the MCU time-push
  // doesn't reliably correct it, so those DPs are right as a *duration delta*
  // (they drive the progress bar) but wrong as an absolute clock. Absolute times
  // are sourced, in order: the live switch-on transition (server time), the
  // finalized run-log record (dt_util timestamps, tz-correct, restart-proof), and
  // — only when no run-log exists at all (older integration / history sensor
  // absent) — the device DP as a last resort so the panel still shows something.
  _histVM() {
    const e = this._entities;
    const running = this._isOn();
    const runs = this._histRuns();
    const lastRec = runs[0] || null;
    let vol = this._nv(e.summation);
    let dur = this._nv(e.last_duration);
    let whenDate = null, startISO = null, endISO = null;
    if (running) {
      // Live run: start = the moment HA saw the switch turn on (server truth).
      const sw = this._hass?.states[e.switch];
      const onISO = (sw && sw.state === "on") ? sw.last_changed : null;
      whenDate = onISO ? new Date(onISO) : this._tsDate(e.start_time);
      startISO = onISO || this._sv(e.start_time);
      // Projected end (tempo): the device end-start delta is tz-shift-invariant,
      // so add it to the true server start. Liters has no fixed end → left blank.
      const ds = this._tsDate(e.start_time), de = this._tsDate(e.end_time);
      if (whenDate && ds && de && de.getTime() > ds.getTime()) {
        endISO = new Date(whenDate.getTime() + (de.getTime() - ds.getTime())).toISOString();
      }
      // Elapsed so far, not last_duration: that DP still holds the PREVIOUS
      // run's length, which would read as this run's next to its live volume.
      if (whenDate) dur = Math.max(0, (Date.now() - whenDate.getTime()) / 1000);
    } else if (lastRec) {
      // Idle: the finalized run-log record is the system of record.
      vol = (lastRec.liters != null) ? lastRec.liters : 0;
      dur = (lastRec.duration_s != null) ? lastRec.duration_s : 0;
      whenDate = lastRec.start ? new Date(lastRec.start) : null;
      startISO = lastRec.start || null; endISO = lastRec.end || null;
    } else {
      // No run-log at all → fall back to the (possibly tz-shifted) device DPs.
      whenDate = this._tsDate(e.start_time);
      startISO = this._sv(e.start_time); endISO = this._sv(e.end_time);
    }
    const hasData = running || !!lastRec || (whenDate != null && this._ago(whenDate) !== null);
    return { running, hasHist: runs.length > 0, vol, dur, whenDate, startISO, endISO, hasData };
  }

  _outcomeClass(r) {
    const reason = r && r.reason;
    if (reason === "completed") return "ok";
    if (reason === "timeout" || reason === "stalled" || reason === "shutdown") return "warn";
    return "neutral";
  }
  _outcomeLabel(r) {
    const map = { completed: "oc_completed", stopped: "oc_stopped", timeout: "oc_timeout", stalled: "oc_stalled", shutdown: "oc_shutdown", auto_off: "oc_auto", manual_off: "oc_manual" };
    return _t(this._hass, map[r && r.reason] || "oc_completed");
  }

  // One run-list row. Same markup and column order as the Sonoff valve card,
  // which inserts an extra .hl-ch cell for the line that ran.
  _histRowHtml(r) {
    // start is null on a run recovered across a restart — end still places it.
    const when = this._whenHtml(new Date(r.start || r.end));
    const dur = (r.duration_s != null) ? this._fd(r.duration_s) : "";
    const vol = (r.liters != null) ? `${this._fmtVolShortNum(r.liters)} L` : "—";
    return `<div class="hl-row" title="${this._esc(this._outcomeLabel(r))}">`
      + `<span class="hl-dot ${this._outcomeClass(r)}"></span>`
      + `<span class="hl-when">${when}</span>`
      + `<span class="hl-dur">${this._esc(dur)}</span>`
      + `<span class="hl-vol">${this._esc(vol)}</span>`
      + `</div>`;
  }

  // Build the run list. Only builds when open; a signature guard avoids
  // rebuilding the innerHTML on every 1s render tick.
  _renderHistList() {
    const el = this._el.histList;
    if (!el || !this._histOpen) return;
    const runs = this._histRuns();
    const sig = runs.length + "|" + ((runs[0] && runs[0].start) || "") + "|" + ((runs[0] && runs[0].end) || "");
    if (sig === this._histListSig && el.dataset.built === "1") return;
    this._histListSig = sig;
    if (!runs.length) {
      el.innerHTML = `<div class="hl-empty">${_t(this._hass, "noHistory")}</div>`;
      el.dataset.built = "1";
      return;
    }
    el.innerHTML = runs.map((r) => this._histRowHtml(r)).join("");
    el.dataset.built = "1";
  }

  // ── Render dispatcher ──
  _render() {
    if (!this._hass || !this._entities) return;
    if (!this._domCreated) {
      this._createDOM();
      this._domCreated = true;
    } else {
      this._update();
    }
  }

  // ── Initial full DOM creation (runs once) ──
  _createDOM() {
    const e = this._entities;
    const isOn = this._isOn();
    const batt = this._nv(e.battery);
    const hasBatt = this._hass.states[e.battery] !== undefined;
    const cyc = this._nv(e.cycles); const schedOn = cyc > 1;
    const ivS = this._nv(e.interval);
    const ivH = Math.floor(ivS / 3600), ivM = Math.floor((ivS % 3600) / 60);
    const name = this._getName();
    const vm = this._histVM();
    const dur = vm.dur, vol = vm.vol;
    const hasData = vm.hasData;

    const { tp, lp } = this._runView();
    const tempoActive = !!tp, litriActive = !!lp;
    let tM, tS;
    if (tp) { tM = Math.floor(tp.remaining / 60); tS = tp.remaining % 60; }
    else { tM = this._inputMin; tS = this._inputSec; }

    const t = (k) => _t(this._hass, k);
    const offline = this._isOffline();
    let bTxt, bCls;
    if (offline) { bTxt = t("offline"); bCls = "badge offline"; }
    else if (isOn) { bTxt = t("irrigating"); bCls = "badge active"; }
    else { bTxt = t("off"); bCls = "badge off"; }

    const pP = tp ? tp.pct : 0;
    const lpP = lp ? lp.pct : 0;
    const litriLabel = lp ? `${this._fmtVolShortNum(lp.delivered)} / ${this._fmtVolShortNum(lp.target)} L` : "";
    const modeOpen = this._mode !== null;
    const PL = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="white"/></svg>`;
    const PA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

    this.shadowRoot.innerHTML = `
<style>
:host{--accent:#2ecc8b;--accent-dim:rgba(46,204,139,.12);--accent-hover:#27b67a;--blue:#4a90d9;--blue-dim:rgba(74,144,217,.12);--blue-text:#6aabf0;--danger:#e25555;--tm:var(--primary-text-color,#e8e8f0);--ts:var(--secondary-text-color,#8b8da5);--th:var(--disabled-text-color,#5c5e76);--bd:var(--divider-color,rgba(255,255,255,.06));--sep:var(--bd)}
ha-card{overflow:hidden}
.ch{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px}
.hl{display:flex;align-items:center;gap:10px}
.di{width:32px;height:32px;border-radius:8px;background:var(--accent-dim);display:flex;align-items:center;justify-content:center}
.tt{font-size:15px;font-weight:600;color:var(--tm)}
.hr{display:flex;align-items:center;gap:10px}
.bt{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--th);font-family:monospace}
.bs{width:18px;height:10px;border:1.2px solid var(--th);border-radius:2px;position:relative;overflow:hidden}
.bf{position:absolute;inset:1px;background:var(--accent);border-radius:1px}
.bp{width:2px;height:5px;background:var(--th);border-radius:0 1px 1px 0;margin-left:-1px}
.badge{font-size:11px;font-weight:500;padding:3px 10px;border-radius:20px;transition:all .3s}
.badge.off{background:var(--bd);color:var(--th)}
.badge.active{background:var(--accent-dim);color:var(--accent)}
.badge.paused{background:rgba(234,179,8,.12);color:#eab308}
.badge.offline{background:rgba(226,85,85,.15);color:var(--danger);font-weight:600}
.cb{padding:6px 16px 14px}
.sc{margin-bottom:16px}.sc:last-child{margin-bottom:0}
.dv{height:1px;background:var(--bd);margin:0 0 16px;display:none}
.dv.vi{display:block}
.ar{display:flex;gap:8px}
.ab{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 12px;border-radius:8px;border:1px solid var(--bd);background:transparent;cursor:pointer;font-size:13px;font-weight:500;color:var(--ts);font-family:inherit;transition:all .15s}
.ab:hover{background:var(--bd);color:var(--tm)}.ab.ac{border-color:rgba(74,144,217,.4);background:var(--blue-dim);color:var(--blue-text)}
.ip{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s ease,margin-top .2s;margin-top:0}.ip>*{overflow:hidden}.ip.vi{grid-template-rows:1fr;margin-top:8px}
.ir{display:flex;gap:8px;align-items:center;padding-top:2px}
.nw{flex:1;display:flex;align-items:center;border:1px solid var(--bd);border-radius:8px;overflow:hidden;transition:border-color .15s}.nw:focus-within{border-color:rgba(74,144,217,.5)}
.ni{flex:1;padding:10px 12px;border:none;background:transparent;font-size:20px;font-weight:500;color:var(--tm);text-align:center;outline:none;font-family:monospace}
.ut{padding:0 14px;font-size:13px;font-weight:600;color:var(--th);background:var(--bd);align-self:stretch;display:flex;align-items:center;border-left:1px solid var(--bd)}
.tg{flex:1;display:flex;align-items:center;border:1px solid var(--bd);border-radius:8px;overflow:hidden;transition:border-color .15s}.tg:focus-within{border-color:rgba(74,144,217,.5)}.tg.cd{border-color:rgba(46,204,139,.4)}
.ti{width:50%;text-align:center;padding:10px 4px;border:none;background:transparent;outline:none;font-size:20px;font-weight:500;color:var(--tm);font-family:monospace}.ti.ct{color:var(--accent)}.ti:disabled{opacity:.7}
.tp{font-size:20px;font-weight:500;color:var(--th);user-select:none;flex-shrink:0}.tp.ct{color:var(--accent)}
.fh{font-size:10px;color:var(--th);text-align:center;min-width:50px}
.gb{width:44px;height:44px;border-radius:50%;flex-shrink:0;border:none;background:var(--accent);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;box-shadow:0 2px 12px rgba(46,204,139,.25)}.gb:hover{background:var(--accent-hover)}.gb:active{transform:scale(.93)}
@keyframes pg{0%,100%{box-shadow:0 0 0 0 rgba(226,85,85,.3)}50%{box-shadow:0 0 0 6px rgba(226,85,85,0)}}
.gb.rn{animation:pg 1.2s infinite;background:var(--danger);box-shadow:0 2px 12px rgba(226,85,85,.3)}
.gb.rs{box-shadow:0 0 0 3px var(--accent-dim),0 2px 12px rgba(46,204,139,.25)}
.pw{height:3px;border-radius:2px;background:var(--bd);margin-top:6px;overflow:hidden;opacity:0;transition:opacity .2s}.pw.vi{opacity:1}
.pb{height:100%;border-radius:2px;background:var(--accent);transition:width .3s linear}
.rp{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s ease,margin-top .2s;margin-top:0}.rp>*{overflow:hidden}.rp.vi{grid-template-rows:1fr;margin-top:12px}
/* v2.0.0: Cycles / interval / repeats UI temporarily hidden. The DOM + event
   handlers are kept intact so the feature can be re-enabled as soon as the
   tuya_irrigation integration gains scheduling support. To re-enable, remove
   the next line. */
.rp{display:none !important}
.sh{display:flex;align-items:center;justify-content:space-between}
.st{font-size:13px;font-weight:500;color:var(--ts)}
.to{width:44px;height:24px;border-radius:12px;background:var(--bd);cursor:pointer;position:relative;transition:background .25s}.to.on{background:var(--accent)}
.tk{width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:left .25s cubic-bezier(.4,0,.2,1);box-shadow:0 1px 4px rgba(0,0,0,.2)}.to.on .tk{left:22px}
.sg{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:8px}
.sf{background:var(--bd);border-radius:8px;padding:10px 12px;min-width:0}
.fl{font-size:10px;color:var(--th);margin-bottom:6px;letter-spacing:.02em}
.sp{display:inline-flex;align-items:center}
.sb{width:30px;height:30px;border:1px solid var(--bd);background:transparent;cursor:pointer;font-size:15px;color:var(--ts);display:flex;align-items:center;justify-content:center;font-family:inherit;transition:all .1s}.sb:hover{color:var(--tm)}.sb:first-child{border-radius:6px 0 0 6px}.sb:last-child{border-radius:0 6px 6px 0}
.sv{width:38px;height:30px;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:var(--tm);font-family:monospace}
.str{display:flex;align-items:center}
.ss{width:38px;text-align:center;padding:5px 4px;border:1px solid var(--bd);background:transparent;border-radius:4px;outline:none;font-size:14px;font-weight:500;color:var(--tm);font-family:monospace;transition:border-color .15s}.ss:focus{border-color:rgba(74,144,217,.5)}
.sep{font-size:13px;color:var(--th);padding:0 4px;user-select:none}
.sht{font-size:9px;color:var(--th);margin-top:4px;letter-spacing:.05em}
/* The history section is the query container for the collapsing date. It sits
   on this wrapper and not on :host or ha-card because a plain block's inline
   size is always parent-determined, so inline-size containment can never
   collapse it — a card dropped into a shrink-to-fit context could. */
.hsec{container-type:inline-size}
.hist-compact{display:flex;align-items:center;gap:8px;padding:2px 0;min-height:24px}
.hist-compact-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--th);flex-shrink:0}
.hist-when{flex:1;min-width:0;display:flex;gap:4px;align-items:baseline;overflow:hidden;font-size:12px;color:var(--tm);font-weight:500;white-space:nowrap}
.hist-when.none{color:var(--ts);font-weight:400;font-style:italic}
.hist-sum{font-size:11px;color:var(--tm);font-family:monospace;white-space:nowrap;flex-shrink:0}
.hist-toggle{background:none;border:none;color:var(--th);cursor:pointer;padding:2px 4px;flex-shrink:0;display:none;line-height:0;transition:transform .2s}
.hist-toggle.open{transform:rotate(90deg)}
.hist-toggle svg{display:block}
.hist-list{margin-top:6px;max-height:200px;overflow-y:auto;display:none;flex-direction:column}
.hist-list.vi{display:flex}
.hl-row{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid var(--sep)}
.hl-row:last-child{border-bottom:none}
/* Hairline derived from the secondary text colour: --divider-color alone is
   ~12% white in HA's dark theme and all but vanishes as a 1px rule on black.
   Guarded so browsers without color-mix keep the (fainter) --bd fallback. */
@supports (color:color-mix(in srgb,red 50%,transparent)){.hl-row{border-bottom-color:color-mix(in srgb,var(--ts) 28%,transparent)}}
.hl-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--th)}
.hl-dot.ok{background:var(--accent)}
.hl-dot.warn{background:#eab308}
.hl-dot.neutral{background:var(--th)}
.hl-when{display:flex;gap:1ch;font-size:11px;color:var(--tm);font-family:monospace;white-space:nowrap;flex-shrink:0}
.hl-dur{margin-left:auto;font-size:11px;color:var(--ts);font-family:monospace;white-space:nowrap;min-width:56px;text-align:right}
.hl-vol{font-size:11px;color:var(--tm);font-family:monospace;white-space:nowrap;min-width:46px;text-align:right}
.hl-empty{font-size:12px;color:var(--th);text-align:center;padding:10px;font-style:italic}
/* Mobile-first: the date hides by default and comes back when the section is
   wide enough for weekday + date + time. Failing closed is the safe direction
   — the short form never overflows. 360px is the one hand-tuned constant:
   the widest Sonoff row ("Mercoledì 24 ago 05:30" + line + duration +
   litres) needs ~338px of section width, and the section is the card minus
   .cb's 32px of horizontal padding. */
.hl-when>.opt,.hist-when>.opt{display:none}
@container (min-width:360px){.hl-when>.opt,.hist-when>.opt{display:inline}}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=number]{-moz-appearance:textfield}
.intg-missing{background:rgba(226,85,85,.12);color:var(--danger);border:1px solid rgba(226,85,85,.3);border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:12px;text-align:center;display:none}
.intg-missing.vi{display:block}
#action-sec{position:relative}
.start-ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(1.5px);border-radius:10px;z-index:5;font-size:14px;font-weight:600;color:#fff;letter-spacing:.3px}
.start-ov.vi{display:flex}
.start-ov.failed{color:var(--danger)}
.off-banner{background:rgba(226,85,85,.12);color:var(--danger);border:1px solid rgba(226,85,85,.3);border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:12px;display:none;align-items:center;gap:8px}
.off-banner.vi{display:flex}
.off-banner svg{flex-shrink:0}
/* Hide action panel entirely when offline: the buttons can't do anything. */
.sc.disabled{display:none}
</style>
<ha-card>
  <div class="ch">
    <div class="hl">
      <div class="di"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"/></svg></div>
      <span class="tt">${name}</span>
    </div>
    <div class="hr">
      <span class="${bCls}">${bTxt}</span>
      ${hasBatt ? `<div class="bt" id="bt-wrap" style="display:${offline?"none":"flex"}"><div class="bs"><div class="bf" style="width:${Math.min(100,batt)}%"></div></div><div class="bp"></div><span class="batt-pct">${Math.round(batt)}%</span></div>` : ""}
    </div>
  </div>
  <div class="cb">
    <div class="intg-missing ${this._integrationAvailable()?"":"vi"}" id="intg-missing">${t("integrationMissing")}</div>
    <div class="off-banner ${this._isOffline()?"vi":""}" id="off-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
      <span>${t("offlineMsg")}</span>
    </div>
    <div class="sc ${this._isOffline()?"disabled":""}" id="action-sec">
      <div class="ar">
        <button class="ab ${this._mode==="litri"?"ac":""}" id="bl"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"/></svg>${t("liters")}</button>
        <button class="ab ${this._mode==="tempo"?"ac":""}" id="bt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${t("time")}</button>
        <button class="ab" id="bm" title="${this._manualSec >= 60 ? Math.round(this._manualSec/60)+'′' : this._manualSec+'″'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>${t("manual")}</button>
      </div>
      <div class="ip ${this._mode==="litri"?"vi":""}" id="ip-litri"><div>
        <div class="ir">
          <div class="nw"><input type="number" inputmode="numeric" pattern="[0-9]*" class="ni" id="vl" value="${Math.round(this._inputLitri)}" min="1" max="999"><div class="ut">L</div></div>
          <button class="gb ${isOn&&this._mode==="litri"?"rn":""}" id="gl">${isOn&&this._mode==="litri"?PA:PL}</button>
        </div>
        <div class="fh" id="litri-fh" style="display:${litriActive?"block":"none"}">${litriLabel}</div>
        <div class="pw ${litriActive?"vi":""}" id="litri-pw"><div class="pb" id="litri-bar" style="width:${lpP}%"></div></div>
      </div></div>
      <div class="ip ${this._mode==="tempo"?"vi":""}" id="ip-tempo"><div>
        <div class="ir">
          <div class="tg ${tempoActive?"cd":""}">
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="ti ${tempoActive?"ct":""}" id="t-min" value="${this._p2(tM)}" min="0" max="59" ${tempoActive?"disabled":""}>
            <span class="tp ${tempoActive?"ct":""}">:</span>
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="ti ${tempoActive?"ct":""}" id="t-sec" value="${this._p2(tS)}" min="0" max="59" ${tempoActive?"disabled":""}>
          </div>
          <div class="fh">${tempoActive?t("remaining"):"mm : ss"}</div>
          <button class="gb ${isOn?"rn":""}" id="gt">${isOn?PA:PL}</button>
        </div>
        <div class="pw ${tempoActive?"vi":""}"><div class="pb" id="progress-bar" style="width:${pP}%"></div></div>
      </div></div>
      <div class="rp ${modeOpen?"vi":""}"><div>
        <div class="sh">
          <span class="st">${t("repeats")}</span>
          <div class="to ${schedOn?"on":""}" id="sto"><div class="tk"></div></div>
        </div>
        <div class="sg" id="sched-grid" style="display:${schedOn?"grid":"none"}">
          <div class="sf"><div class="fl">${t("cycles")}</div><div class="sp"><button class="sb" id="cm">\u2212</button><div class="sv">${Math.round(cyc)}</div><button class="sb" id="cp">+</button></div></div>
          <div class="sf"><div class="fl">${t("cycleInterval")}</div><div class="str"><input type="number" inputmode="numeric" pattern="[0-9]*" class="ss" id="iv-hh" value="${this._p2(ivH)}" min="0" max="12"><span class="sep">:</span><input type="number" inputmode="numeric" pattern="[0-9]*" class="ss" id="iv-mm" value="${this._p2(ivM)}" min="0" max="59"></div><div class="sht">hh : mm</div></div>
        </div>
      </div></div>
      <div class="start-ov ${(this._starting||this._stopping)?"vi":""} ${(this._failed||this._stopFailed)?"failed":""}" id="start-ov"><span id="start-ov-txt">${this._stopping?(this._stopFailed?t("stopFailed"):t("stopping")):(this._failed?t("startFailed"):t("starting"))}</span></div>
    </div>
    <div class="dv ${modeOpen?"vi":""}" id="divider"></div>
    <div class="sc hsec" style="margin-bottom:0">
      <div class="hist-compact" id="hist-compact">
        <span class="hist-compact-label">${t("last")}</span>
        <span class="hist-when ${hasData?"":"none"}" id="hist-when">${hasData?this._whenHtml(vm.whenDate):this._esc(": "+t("none"))}</span>
        <span class="hist-sum" id="hist-sum">${hasData?this._summaryText(dur,vol):""}</span>
        <button class="hist-toggle" id="hist-toggle" title="${t("history")}" style="display:${vm.hasHist?"block":"none"}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="hist-list" id="hist-list"></div>
    </div>
  </div>
</ha-card>`;
    this._cacheEls();
    this._bindEvents();
    this._renderHistList();
  }

  _cacheEls() {
    const r = this.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const q = (sel) => r.querySelector(sel);
    this._el = {
      tt: q(".tt"), bf: q(".bf"), battPct: q(".batt-pct"), badge: q(".badge"),
      battWrap: $("bt-wrap"),
      bl: $("bl"), bt: $("bt"), bm: $("bm"),
      ipLitri: $("ip-litri"), ipTempo: $("ip-tempo"),
      vl: $("vl"), gl: $("gl"),
      tg: q(".tg"), tMin: $("t-min"), tSec: $("t-sec"), tp: q(".tp"),
      fh: q("#ip-tempo .fh"), gt: $("gt"), pw: q("#ip-tempo .pw"), bar: $("progress-bar"),
      litriFh: $("litri-fh"), litriPw: $("litri-pw"), litriBar: $("litri-bar"),
      rp: q(".rp"), sto: $("sto"), schedGrid: $("sched-grid"),
      svDisp: q(".sv"), ivHh: $("iv-hh"), ivMm: $("iv-mm"),
      histWhen: $("hist-when"), histSum: $("hist-sum"),
      divider: $("divider"),
      intgMissing: $("intg-missing"),
      offBanner: $("off-banner"),
      actionSec: $("action-sec"),
      startOv: $("start-ov"), startOvTxt: $("start-ov-txt"),
      histToggle: $("hist-toggle"), histList: $("hist-list"),
    };
  }

  _bindEvents() {
    const el = this._el;
    el.bl?.addEventListener("click", () => this._selectMode("litri"));
    el.bt?.addEventListener("click", () => this._selectMode("tempo"));
    el.bm?.addEventListener("click", () => this._startManual());
    el.gl?.addEventListener("click", () => { if (this._starting || this._stopping) return; if (this._isOn() && this._mode === "litri") this._stopLitri(); else this._startLitri(); });
    el.gt?.addEventListener("click", () => this._toggleTimer());
    el.vl?.addEventListener("change", ev => { this._inputLitri = Math.max(1, Math.min(999, parseInt(ev.target.value) || 1)); this._userEditedLitri = true; });
    el.tMin?.addEventListener("change", ev => { this._inputMin = Math.max(0, Math.min(59, parseInt(ev.target.value) || 0)); this._userEditedTempo = true; });
    el.tSec?.addEventListener("change", ev => { this._inputSec = Math.max(0, Math.min(59, parseInt(ev.target.value) || 0)); this._userEditedTempo = true; });
    el.sto?.addEventListener("click", () => this._toggleSchedule());
    this.shadowRoot.getElementById("cm")?.addEventListener("click", () => this._adjCycles(-1));
    this.shadowRoot.getElementById("cp")?.addEventListener("click", () => this._adjCycles(1));
    el.ivHh?.addEventListener("change", () => this._setIv());
    el.ivMm?.addEventListener("change", () => this._setIv());
    el.histToggle?.addEventListener("click", () => this._toggleHist());
  }

  // ── Selective DOM update (runs on every subsequent hass update) ──
  _update() {
    const e = this._entities;
    const isOn = this._isOn();
    const batt = this._nv(e.battery);
    const cyc = this._nv(e.cycles); const schedOn = cyc > 1;
    const ivS = this._nv(e.interval);
    const ivH = Math.floor(ivS / 3600), ivM = Math.floor((ivS % 3600) / 60);
    const name = this._getName();
    const vm = this._histVM();
    const dur = vm.dur, vol = vm.vol;
    const hasData = vm.hasData;

    const { tp, lp } = this._runView();
    const tempoActive = !!tp, litriActive = !!lp;
    let tM, tS;
    if (tp) { tM = Math.floor(tp.remaining / 60); tS = tp.remaining % 60; }
    else { tM = this._inputMin; tS = this._inputSec; }

    const t = (k) => _t(this._hass, k);
    const el = this._el;
    const PL = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="white"/></svg>`;
    const PA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

    // ── Header ──
    this._txt(el.tt, name);
    const offline = this._isOffline();
    if (el.battWrap) el.battWrap.style.display = offline ? "none" : "flex";
    if (!offline) {
      if (el.bf) el.bf.style.width = Math.min(100, batt) + "%";
      if (el.battPct) this._txt(el.battPct, Math.round(batt) + "%");
    }

    let bTxt, bCls;
    if (offline) { bTxt = t("offline"); bCls = "offline"; }
    else if (isOn) { bTxt = t("irrigating"); bCls = "active"; }
    else { bTxt = t("off"); bCls = "off"; }
    if (el.badge) { this._txt(el.badge, bTxt); el.badge.className = "badge " + bCls; }

    // ── Offline banner + action panel gating ──
    this._cls(el.offBanner, "vi", offline);
    this._cls(el.actionSec, "disabled", offline);

    // ── Mode buttons ──
    this._cls(el.bl, "ac", this._mode === "litri");
    this._cls(el.bt, "ac", this._mode === "tempo");
    this._cls(el.ipLitri, "vi", this._mode === "litri");
    this._cls(el.ipTempo, "vi", this._mode === "tempo");

    // ── Litri ──
    if (!this._isEditingGroup("litri")) {
      this._setInput(el.vl, Math.round(this._inputLitri));
    }
    const litriRunning = isOn && this._mode === "litri";
    this._cls(el.gl, "rn", litriRunning);
    if (el.gl) el.gl.innerHTML = litriRunning ? PA : PL;
    this._cls(el.litriPw, "vi", litriActive);
    if (el.litriBar) el.litriBar.style.width = (lp ? lp.pct : 0) + "%";
    if (el.litriFh) {
      el.litriFh.style.display = litriActive ? "block" : "none";
      if (lp) this._txt(el.litriFh, `${this._fmtVolShortNum(lp.delivered)} / ${this._fmtVolShortNum(lp.target)} L`);
    }

    // ── Tempo ──
    if (!this._isEditingGroup("tempo")) {
      this._setInput(el.tMin, this._p2(tM));
      this._setInput(el.tSec, this._p2(tS));
    }
    this._cls(el.tg, "cd", tempoActive);
    this._cls(el.tMin, "ct", tempoActive);
    this._cls(el.tSec, "ct", tempoActive);
    this._cls(el.tp, "ct", tempoActive);
    if (tempoActive) { el.tMin?.setAttribute("disabled", ""); el.tSec?.setAttribute("disabled", ""); }
    else { el.tMin?.removeAttribute("disabled"); el.tSec?.removeAttribute("disabled"); }
    if (el.fh) this._txt(el.fh, tempoActive ? t("remaining") : "mm : ss");
    // Button is switch-driven (single source of truth): on → stop, off → play.
    if (el.gt) {
      this._cls(el.gt, "rn", isOn);
      el.gt.innerHTML = isOn ? PA : PL;
    }
    this._cls(el.pw, "vi", tempoActive);
    if (el.bar) el.bar.style.width = (tp ? tp.pct : 0) + "%";

    // ── "Avvio…" / "Arresto…" overlay ──
    this._cls(el.startOv, "vi", this._starting || this._stopping);
    this._cls(el.startOv, "failed", this._failed || this._stopFailed);
    if (el.startOvTxt) {
      this._txt(el.startOvTxt, this._stopping
        ? (this._stopFailed ? t("stopFailed") : t("stopping"))
        : (this._failed ? t("startFailed") : t("starting")));
    }

    // ── Integration availability banner ──
    this._cls(el.intgMissing, "vi", !this._integrationAvailable());

    // ── Repeats (show/hide via CSS) ──
    const modeOpen = this._mode !== null;
    this._cls(el.rp, "vi", modeOpen);
    this._cls(el.divider, "vi", modeOpen);
    this._cls(el.sto, "on", schedOn);
    if (el.schedGrid) el.schedGrid.style.display = schedOn ? "grid" : "none";
    if (el.svDisp) this._txt(el.svDisp, String(Math.round(cyc)));
    if (!this._isEditingGroup("interval")) {
      this._setInput(el.ivHh, this._p2(ivH));
      this._setInput(el.ivMm, this._p2(ivM));
    }

    // ── History: compact summary + the run list behind the chevron ──
    if (el.histWhen) {
      this._html(el.histWhen, hasData ? this._whenHtml(vm.whenDate) : this._esc(": " + t("none")));
      this._cls(el.histWhen, "none", !hasData);
    }
    this._txt(el.histSum, hasData ? this._summaryText(dur, vol) : "");
    // The chevron appears only when the integration's history sensor has runs,
    // so the card degrades gracefully when the sensor is absent.
    if (el.histToggle) el.histToggle.style.display = vm.hasHist ? "block" : "none";
    const histOpen = vm.hasHist && this._histOpen;
    this._cls(el.histToggle, "open", histOpen);
    this._cls(el.histList, "vi", histOpen);
    this._renderHistList();
  }

  disconnectedCallback() { this._stopTick(); }
}

customElements.define("irrigation-control-card", IrrigationControlCard);
window.customCards = window.customCards || [];
// Localized picker name based on browser language, with English term in parentheses
// so searches in either the local language or English both match.
(function () {
  // Prefer HA's stored language choice, fall back to browser language, then English
  const raw = (function () {
    try { return localStorage.getItem("selectedLanguage"); } catch (_) { return null; }
  })() || navigator.language || "en";
  const lang = raw.replace(/^"|"$/g, "").split("-")[0];
  const pickerName = {
    it: "Irrigazione (Irrigation Control)",
    zh: "灌溉控制 (Irrigation Control)",
    en: "Irrigation Control Card",
  }[lang] || "Irrigation Control Card";
  const pickerDesc = {
    it: "Card compatta per valvole irrigazione Tuya con timer, pianificazione e storico",
    zh: "适用于涂鸦灌溉阀的紧凑卡片，含定时、计划和历史记录",
    en: "Compact card for Tuya irrigation valves with timer, scheduling and history",
  }[lang] || "Compact card for Tuya irrigation valves with timer, scheduling and history";
  window.customCards.push({ type: "irrigation-control-card", name: pickerName, description: pickerDesc, preview: true });
})();
console.info("%c IRRIGATION-CONTROL-CARD %c v2.9.1 ", "color:white;background:#2ecc8b;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px;", "color:#2ecc8b;background:#1a1c2e;font-weight:bold;padding:2px 6px;border-radius:0 4px 4px 0;");
// --- soil-moisture-card.js ---
/**
 * Soil Moisture Card for Home Assistant
 * Custom Lovelace card for soil moisture / temperature / humidity sensors (ZG-303Z)
 * v1.3.2 — Name field: defer config-changed to the `change` event (blur/Enter)
 *          instead of firing per keystroke on `input`. v1.3.1 stopped the
 *          editor from rebuilding its own DOM, but per-keystroke
 *          config-changed still round-tripped through HA's hui-card-editor
 *          which blurred the input mid-typing. In-memory config is still
 *          updated on every keystroke so a Save click without prior blur
 *          captures the typed value.
 * v1.3.1 — Visual editor no longer steals focus while typing. HA pushes a
 *          fresh hass object to all card editors every few seconds, and the
 *          editor's set hass() was wholesale-replacing shadowRoot.innerHTML
 *          on every push — destroying the focused <input> and stealing the
 *          caret. Editor now builds its DOM once and patches values in
 *          place, skipping inputs that have focus.
 * v1.3.0 — Offline detection rewritten + UI aligned with irrigation card.
 *          Detection: trust HA's state == "unavailable" signal (no more
 *          last_updated staleness threshold — false-positives on stable
 *          readings since ZHA doesn't refresh last_updated for unchanged
 *          values), plus a "ghost zeros" guard for dead-battery firmware
 *          that keeps reporting cached zeros (battery + soil + air all 0%
 *          → offline).
 *          UI: red "Offline" pill badge in the header (same position and
 *          styling as irrigation-control-card), red banner replacing the
 *          readings, battery hidden — instead of the previous "wifi-off
 *          icon + last seen N ago" row.
 * v1.2.0 — Offline state: detect unavailable/stale entities and replace the
 *          three-column readout with a single "Offline · last seen N ago" row.
 */

// ── i18n ──
const SM_I18N = {
  it: {
    soil: "Terreno", temperature: "Temperatura", humidity: "Aria",
    editorDevice: "Sensore umidità suolo", editorSelect: "— Seleziona —",
    editorHint: "Mostra solo i sensori con temperatura, umidità suolo e aria",
    editorNoDevice: "Nessun sensore compatibile trovato",
    editorName: "Nome (opzionale)", editorNamePh: "Nome personalizzato",
    editorNameHint: "Lascia vuoto per usare il nome del dispositivo",
    editorThresholds: "Soglie umidità suolo (%)",
    editorOptMin: "Ottimale min", editorOptMax: "Ottimale max",
    editorAccMin: "Accettabile min", editorAccMax: "Accettabile max",
    configError: "Seleziona un sensore umidità suolo nella configurazione",
    defaultName: "Umidità suolo",
    cardDesc: "Card compatta per sensori umidità suolo, temperatura e umidità aria",
    offline: "Offline",
    offlineMsg: "Sensore non raggiungibile — controllare batteria e segnale Zigbee",
  },
  en: {
    soil: "Soil", temperature: "Temperature", humidity: "Air",
    editorDevice: "Soil moisture sensor", editorSelect: "— Select —",
    editorHint: "Shows only sensors with temperature, soil moisture and air humidity",
    editorNoDevice: "No compatible sensor found",
    editorName: "Name (optional)", editorNamePh: "Custom name",
    editorNameHint: "Leave empty to use device name",
    editorThresholds: "Soil moisture thresholds (%)",
    editorOptMin: "Optimal min", editorOptMax: "Optimal max",
    editorAccMin: "Acceptable min", editorAccMax: "Acceptable max",
    configError: "Select a soil moisture sensor in the configuration",
    defaultName: "Soil moisture",
    cardDesc: "Compact card for soil moisture, temperature and air humidity sensors",
    offline: "Offline",
    offlineMsg: "Sensor unreachable — check battery and Zigbee signal",
  },
  zh: {
    soil: "土壤", temperature: "温度", humidity: "空气",
    editorDevice: "土壤湿度传感器", editorSelect: "— 选择 —",
    editorHint: "仅显示具有温度、土壤湿度和空气湿度的传感器",
    editorNoDevice: "未找到兼容的传感器",
    editorName: "名称（可选）", editorNamePh: "自定义名称",
    editorNameHint: "留空使用设备名称",
    editorThresholds: "土壤湿度阈值 (%)",
    editorOptMin: "最佳最小值", editorOptMax: "最佳最大值",
    editorAccMin: "可接受最小值", editorAccMax: "可接受最大值",
    configError: "请在配置中选择土壤湿度传感器",
    defaultName: "土壤湿度",
    cardDesc: "土壤湿度、温度和空气湿度传感器紧凑卡片",
    offline: "离线",
    offlineMsg: "传感器无法连接 — 请检查电池和 Zigbee 信号",
  },
};
function _smLang(hass) {
  const lang = hass?.language?.split("-")[0] || "en";
  return SM_I18N[lang] ? lang : "en";
}
function _sm(hass, key) { return (SM_I18N[_smLang(hass)] || SM_I18N.en)[key] || SM_I18N.en[key] || key; }
function _smLocale(hass) { return hass?.language || "en"; }

// ── Entity discovery ──
const SM_SUFFIXES = {
  soil_moisture: { domain: "sensor", suffix: "_soil_moisture" },
  temperature:   { domain: "sensor", suffix: "_temperature" },
  humidity:      { domain: "sensor", suffix: "_humidity" },
  battery:       { domain: "sensor", suffix: "_battery" },
};
const SM_REQUIRED = ["soil_moisture", "temperature", "humidity"];

function smBuildEntities(primary) {
  const p = primary.replace("sensor.", "").replace(/_soil_moisture$/, "");
  const e = {};
  for (const [k, d] of Object.entries(SM_SUFFIXES)) e[k] = `${d.domain}.${p}${d.suffix}`;
  return e;
}
function smIsCompatible(primaryId, hass) {
  const p = primaryId.replace("sensor.", "").replace(/_soil_moisture$/, "");
  return SM_REQUIRED.every(k => {
    const d = SM_SUFFIXES[k];
    return hass.states[`${d.domain}.${p}${d.suffix}`] !== undefined;
  });
}
function smFindCompatible(hass) {
  return Object.keys(hass.states)
    .filter(e => e.startsWith("sensor.") && e.endsWith("_soil_moisture"))
    .filter(e => smIsCompatible(e, hass));
}

// ── Threshold color logic ──
function smColor(value, optMin, optMax, accMin, accMax) {
  if (value >= optMin && value <= optMax) return "green";
  if (value >= accMin && value <= accMax) return "yellow";
  return "red";
}

// ── Editor ──
// v1.3.1: build DOM once, patch values in place. HA pushes a fresh `hass`
// object to all card editors every few seconds; the previous set hass()
// replaced shadowRoot.innerHTML wholesale, destroying the focused <input>
// and stealing the caret. Now editor mirrors the irrigation editor pattern:
// _buildDom() runs once, _update() refreshes values without touching the
// tree and skips any input that currently has focus.
const SM_THRESHOLD_FIELDS = [
  ["acc-min", "acc_min", 20],
  ["acc-max", "acc_max", 80],
  ["opt-min", "opt_min", 40],
  ["opt-max", "opt_max", 60],
];
class SoilMoistureCardEditor extends HTMLElement {
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
    const t = (k) => _sm(this._hass, k);
    this.shadowRoot.innerHTML = `
<style>
.editor{padding:16px;font-family:var(--paper-font-body1_-_font-family,sans-serif)}
.row{margin-bottom:16px}
label{display:block;font-size:12px;font-weight:500;color:var(--secondary-text-color);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
select,input[type="text"]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--divider-color,rgba(255,255,255,.06));background:var(--card-background-color,#232640);color:var(--primary-text-color);font-size:14px;font-family:monospace;outline:none;box-sizing:border-box}
select:focus,input:focus{border-color:#4a90d9}
.hint{font-size:11px;color:var(--disabled-text-color,#5c5e76);margin-top:4px}
.empty{font-size:13px;color:var(--disabled-text-color);padding:12px;text-align:center;background:var(--divider-color,rgba(255,255,255,.06));border-radius:8px}
.thr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.thr-grid input[type="number"]{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color,rgba(255,255,255,.06));background:var(--card-background-color,#232640);color:var(--primary-text-color);font-size:14px;font-family:monospace;outline:none;box-sizing:border-box}
.thr-grid input:focus{border-color:#4a90d9}
.thr-label{font-size:11px;color:var(--disabled-text-color,#5c5e76);margin-bottom:4px}
[hidden]{display:none!important}
</style>
<div class="editor">
  <div class="row">
    <label>${t("editorDevice")}</label>
    <div id="sw-wrap">
      <select id="sw"></select>
      <div class="hint">${t("editorHint")}</div>
    </div>
    <div id="sw-empty" class="empty" hidden>${t("editorNoDevice")}</div>
  </div>
  <div class="row">
    <label>${t("editorName")}</label>
    <input type="text" id="nm" placeholder="${t("editorNamePh")}">
    <div class="hint">${t("editorNameHint")}</div>
  </div>
  <div class="row">
    <label>${t("editorThresholds")}</label>
    <div class="thr-grid">
      <div><div class="thr-label">${t("editorAccMin")}</div><input type="number" id="acc-min" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorAccMax")}</div><input type="number" id="acc-max" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorOptMin")}</div><input type="number" id="opt-min" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorOptMax")}</div><input type="number" id="opt-max" min="0" max="100"></div>
    </div>
  </div>
</div>`;
    const r = this.shadowRoot;
    this._el = {
      sw: r.getElementById("sw"),
      swWrap: r.getElementById("sw-wrap"),
      swEmpty: r.getElementById("sw-empty"),
      nm: r.getElementById("nm"),
    };
    for (const [id] of SM_THRESHOLD_FIELDS) this._el[id] = r.getElementById(id);

    this._el.sw.addEventListener("change", e => {
      this._config = { ...this._config, entity: e.target.value };
      this._fire();
    });
    // Update the in-memory config on every keystroke so a Save click that
    // doesn't blur the input first still captures the typed value — but only
    // fire config-changed on `change` (blur/Enter). Firing per keystroke
    // round-trips through HA's hui-card-editor and ends up blurring the
    // input mid-typing, even though our _update() respects activeElement.
    this._el.nm.addEventListener("input", e => {
      if (e.target.value) this._config = { ...this._config, name: e.target.value };
      else { const { name, ...rest } = this._config; this._config = rest; }
    });
    this._el.nm.addEventListener("change", () => this._fire());
    for (const [id, key] of SM_THRESHOLD_FIELDS) {
      this._el[id].addEventListener("change", e => {
        const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
        this._config = { ...this._config, [key]: v };
        this._fire();
      });
    }
    this._domBuilt = true;
  }

  _update() {
    if (!this._hass) return;
    if (!this._domBuilt) this._buildDom();
    const compat = smFindCompatible(this._hass);
    const cur = this._config.entity || "";
    const nm = this._config.name || "";
    const ae = this.shadowRoot.activeElement;
    const hasCompat = compat.length > 0;

    this._el.swWrap.hidden = !hasCompat;
    this._el.swEmpty.hidden = hasCompat;

    if (hasCompat) {
      const key = compat.join("|");
      if (key !== this._lastCompatKey) {
        const t = (k) => _sm(this._hass, k);
        const opts = [`<option value="">${t("editorSelect")}</option>`];
        for (const s of compat) {
          const n = this._hass.states[s]?.attributes?.friendly_name || s;
          opts.push(`<option value="${s}">${n}</option>`);
        }
        this._el.sw.innerHTML = opts.join("");
        this._lastCompatKey = key;
      }
      if (ae !== this._el.sw && this._el.sw.value !== cur) this._el.sw.value = cur;
    }

    if (ae !== this._el.nm && this._el.nm.value !== nm) this._el.nm.value = nm;
    for (const [id, key, dflt] of SM_THRESHOLD_FIELDS) {
      const el = this._el[id];
      const val = String(this._config[key] ?? dflt);
      if (ae !== el && el.value !== val) el.value = val;
    }
  }

  _fire() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
}
customElements.define("soil-moisture-card-editor", SoilMoistureCardEditor);

// ── Main Card ──
class SoilMoistureCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._config = null; this._entities = null;
    this._domCreated = false;
    this._el = {};
  }

  static getConfigElement() { return document.createElement("soil-moisture-card-editor"); }
  static getStubConfig() { return { entity: "", name: "" }; }

  setConfig(config) {
    if (!config.entity) throw new Error(_sm(this._hass, "configError"));
    this._entities = smBuildEntities(config.entity);
    this._configName = config.name || "";
    this._optMin = config.opt_min ?? 40;
    this._optMax = config.opt_max ?? 60;
    this._accMin = config.acc_min ?? 20;
    this._accMax = config.acc_max ?? 80;
    this._config = config;
    this._domCreated = false;
    if (this._hass) this._render();
  }

  // We trust HA's own "unavailable" signal: ZHA already runs an availability
  // sweep that flips entities to unavailable when the device stops responding.
  // No last_updated staleness check — soil moisture and indoor temperature
  // stay flat for hours by design, and ZHA doesn't refresh last_updated for
  // unchanged values, so a staleness threshold would false-positive.
  // Plus a "ghost zeros" guard: a dead-battery device sometimes keeps
  // reporting cached zeros indefinitely; if battery + soil + air humidity
  // are all exactly 0%, treat as offline.
  _isOffline() {
    const e = this._entities;
    const s = this._hass?.states[e.soil_moisture];
    if (!s) return true;
    if (s.state === "unavailable" || s.state === "unknown" || s.state === "none") return true;

    const battSt = this._hass?.states[e.battery];
    const soilSt = this._hass?.states[e.humidity];
    const humSt = this._hass?.states[e.soil_moisture];
    if (battSt && soilSt && humSt) {
      const batt = parseFloat(battSt.state);
      const soil = parseFloat(soilSt.state);
      const hum = parseFloat(humSt.state);
      if (batt === 0 && soil === 0 && hum === 0) return true;
    }
    return false;
  }

  _getName() {
    if (this._configName) return this._configName;
    const sm = this._hass?.states[this._entities.soil_moisture];
    if (sm?.attributes?.friendly_name) {
      return sm.attributes.friendly_name.replace(/ soil moisture$/i, "").replace(/ Soil moisture$/i, "");
    }
    return _sm(this._hass, "defaultName");
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() { return 3; }

  _sv(eid) { if (!eid || !this._hass?.states[eid]) return "unavailable"; return this._hass.states[eid].state; }
  _nv(eid) { const v = parseFloat(this._sv(eid)); return isNaN(v) ? 0 : v; }

  _txt(el, v) { if (el && el.textContent !== v) el.textContent = v; }

  _thresholdColor(value) {
    return smColor(value, this._optMin, this._optMax, this._accMin, this._accMax);
  }

  _colorCSS(color) {
    switch (color) {
      case "green": return { text: "var(--sm-green, #2ecc8b)", bar: "var(--sm-green, #2ecc8b)", dim: "rgba(46,204,139,.15)" };
      case "yellow": return { text: "var(--sm-yellow, #eab308)", bar: "var(--sm-yellow, #eab308)", dim: "rgba(234,179,8,.15)" };
      case "red": return { text: "var(--sm-red, #e25555)", bar: "var(--sm-red, #e25555)", dim: "rgba(226,85,85,.15)" };
    }
  }

  _render() {
    if (!this._hass || !this._entities) return;
    if (!this._domCreated) { this._createDOM(); this._domCreated = true; }
    else { this._update(); }
  }

  _createDOM() {
    const e = this._entities;
    // NOTE: sources intentionally swapped — this device reports soil moisture
    // under the _humidity suffix and air humidity under _soil_moisture.
    const soil = this._nv(e.humidity);
    const temp = this._nv(e.temperature);
    const hum = this._nv(e.soil_moisture);
    const batt = this._nv(e.battery);
    const hasBatt = this._hass.states[e.battery] !== undefined;
    const name = this._getName();
    const loc = _smLocale(this._hass);
    const t = (k) => _sm(this._hass, k);
    const tc = this._thresholdColor(soil);
    const cc = this._colorCSS(tc);
    const offline = this._isOffline();

    this.shadowRoot.innerHTML = `
<style>
:host{--sm-green:#2ecc8b;--sm-yellow:#eab308;--sm-red:#e25555;--danger:#e25555;--tm:var(--primary-text-color,#e8e8f0);--ts:var(--secondary-text-color,#8b8da5);--th:var(--disabled-text-color,#5c5e76);--bd:var(--divider-color,rgba(255,255,255,.06))}
ha-card{overflow:hidden}
.ch{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px}
.hl{display:flex;align-items:center;gap:10px}
.di{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background .3s}
.di svg{transition:fill .3s}
.tt{font-size:14px;font-weight:600;color:var(--tm)}
.hr{display:flex;align-items:center;gap:10px}
.bt{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--th);font-family:monospace}
.bs{width:18px;height:10px;border:1.2px solid var(--th);border-radius:2px;position:relative;overflow:hidden}
.bf{position:absolute;inset:1px;background:var(--sm-green);border-radius:1px}
.bp{width:2px;height:5px;background:var(--th);border-radius:0 1px 1px 0;margin-left:-1px}
.badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(226,85,85,.15);color:var(--danger)}
.cb{padding:6px 16px 14px}
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center}
.col-label{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--th);margin-bottom:4px}
.col-value{font-size:18px;font-weight:600;color:var(--tm);font-family:monospace;line-height:1.2}
.col-unit{font-size:11px;font-weight:400;color:var(--ts)}
.bar-wrap{height:4px;border-radius:2px;background:var(--bd);margin-top:6px;overflow:hidden}
.bar-fill{height:100%;border-radius:2px;transition:width .4s ease,background .3s}
.off-banner{background:rgba(226,85,85,.12);color:var(--danger);border:1px solid rgba(226,85,85,.3);border-radius:8px;padding:10px 12px;font-size:12px;align-items:center;gap:8px}
.off-banner svg{flex-shrink:0}
</style>
<ha-card>
  <div class="ch">
    <div class="hl">
      <div class="di" id="icon" style="background:${cc.dim}"><svg width="18" height="18" viewBox="0 0 24 24" fill="${cc.text}"><path d="M12 2.5S5 10 5 15a7 7 0 0014 0c0-5-7-12.5-7-12.5zm-1 15c-2.5-.3-4.5-2.3-4.7-4.8-.1-.4.2-.7.5-.7s.6.2.7.6c.2 1.9 1.7 3.4 3.6 3.6.4 0 .6.3.6.7s-.3.6-.7.6z"/></svg></div>
      <span class="tt">${name}</span>
    </div>
    <div class="hr" id="hr">
      ${hasBatt ? `<div class="bt" id="bt-wrap" style="display:${offline?"none":"flex"}"><div class="bs"><div class="bf" style="width:${Math.min(100,batt)}%"></div></div><div class="bp"></div><span class="batt-pct">${Math.round(batt)}%</span></div>` : ""}
      <span class="badge" id="off-badge" style="display:${offline?"inline-block":"none"}">${t("offline")}</span>
    </div>
  </div>
  <div class="cb">
    <div class="off-banner" id="off-banner" style="display:${offline?"flex":"none"}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
      <span>${t("offlineMsg")}</span>
    </div>
    <div class="cols" id="cols-view" style="display:${offline?"none":"grid"}">
      <div class="col" id="col-soil">
        <div class="col-label">${t("soil")}</div>
        <div class="col-value" id="v-soil" style="color:${cc.text}">${soil.toLocaleString(loc, {maximumFractionDigits:0})}%</div>
        <div class="bar-wrap"><div class="bar-fill" id="bar-soil" style="width:${Math.min(100,soil)}%;background:${cc.bar}"></div></div>
      </div>
      <div class="col" id="col-temp">
        <div class="col-label">${t("temperature")}</div>
        <div class="col-value" id="v-temp">${temp.toLocaleString(loc, {minimumFractionDigits:1,maximumFractionDigits:1})} °C</div>
      </div>
      <div class="col" id="col-hum">
        <div class="col-label">${t("humidity")}</div>
        <div class="col-value" id="v-hum">${hum.toLocaleString(loc, {maximumFractionDigits:0})}%</div>
      </div>
    </div>
  </div>
</ha-card>`;
    this._cacheEls();
  }

  _cacheEls() {
    const r = this.shadowRoot;
    this._el = {
      tt: r.querySelector(".tt"),
      bf: r.querySelector(".bf"),
      battPct: r.querySelector(".batt-pct"),
      battWrap: r.getElementById("bt-wrap"),
      icon: r.getElementById("icon"),
      iconSvg: r.querySelector("#icon svg"),
      colsView: r.getElementById("cols-view"),
      offBadge: r.getElementById("off-badge"),
      offBanner: r.getElementById("off-banner"),
      vSoil: r.getElementById("v-soil"),
      barSoil: r.getElementById("bar-soil"),
      vTemp: r.getElementById("v-temp"),
      vHum: r.getElementById("v-hum"),
    };
  }

  _update() {
    const e = this._entities;
    const el = this._el;
    const name = this._getName();
    this._txt(el.tt, name);

    const offline = this._isOffline();
    if (el.colsView) el.colsView.style.display = offline ? "none" : "grid";
    if (el.offBanner) el.offBanner.style.display = offline ? "flex" : "none";
    if (el.offBadge) el.offBadge.style.display = offline ? "inline-block" : "none";
    if (el.battWrap) el.battWrap.style.display = offline ? "none" : "flex";

    if (offline) {
      // Dim the header icon to gray when offline so the visual cue carries.
      if (el.icon) el.icon.style.background = "var(--bd)";
      if (el.iconSvg) el.iconSvg.setAttribute("fill", "var(--th)");
      return;
    }

    // Sources swapped: see note in _createDOM.
    const soil = this._nv(e.humidity);
    const temp = this._nv(e.temperature);
    const hum = this._nv(e.soil_moisture);
    const batt = this._nv(e.battery);
    const loc = _smLocale(this._hass);
    const tc = this._thresholdColor(soil);
    const cc = this._colorCSS(tc);

    if (el.bf) el.bf.style.width = Math.min(100, batt) + "%";
    if (el.battPct) this._txt(el.battPct, Math.round(batt) + "%");

    if (el.icon) el.icon.style.background = cc.dim;
    if (el.iconSvg) el.iconSvg.setAttribute("fill", cc.text);

    if (el.vSoil) {
      const soilTxt = soil.toLocaleString(loc, {maximumFractionDigits:0}) + "%";
      this._txt(el.vSoil, soilTxt);
      el.vSoil.style.color = cc.text;
    }
    if (el.barSoil) {
      el.barSoil.style.width = Math.min(100, soil) + "%";
      el.barSoil.style.background = cc.bar;
    }

    if (el.vTemp) {
      this._txt(el.vTemp, temp.toLocaleString(loc, {minimumFractionDigits:1,maximumFractionDigits:1}) + " °C");
    }
    if (el.vHum) {
      this._txt(el.vHum, hum.toLocaleString(loc, {maximumFractionDigits:0}) + "%");
    }
  }
}

customElements.define("soil-moisture-card", SoilMoistureCard);
window.customCards = window.customCards || [];
// Localized picker name based on browser language, with English term in parentheses
// so searches in either the local language or English both match.
(function () {
  // Prefer HA's stored language choice, fall back to browser language, then English
  const raw = (function () {
    try { return localStorage.getItem("selectedLanguage"); } catch (_) { return null; }
  })() || navigator.language || "en";
  const lang = raw.replace(/^"|"$/g, "").split("-")[0];
  const pickerName = {
    it: "Umidità Terreno (Soil Moisture)",
    zh: "土壤湿度 (Soil Moisture)",
    en: "Soil Moisture / Humidity Sensor",
  }[lang] || "Soil Moisture / Humidity Sensor";
  const pickerDesc = {
    it: "Card compatta per sensori umidità terreno, temperatura e umidità aria",
    zh: "土壤湿度、温度和空气湿度传感器紧凑卡片",
    en: "Compact card for soil moisture, temperature and air humidity sensors",
  }[lang] || "Compact card for soil moisture, temperature and air humidity sensors";
  window.customCards.push({ type: "soil-moisture-card", name: pickerName, description: pickerDesc, preview: true });
})();
console.info("%c SOIL-MOISTURE-CARD %c v1.3.0 ", "color:white;background:#2ecc8b;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px;", "color:#2ecc8b;background:#1a1c2e;font-weight:bold;padding:2px 6px;border-radius:0 4px 4px 0;");
