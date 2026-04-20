/**
 * Irrigation Control Card for Home Assistant
 * Custom Lovelace card for Tuya-based smart irrigation valves (TS0601)
 * v2.0.0 — Delegates open/wait/close to the tuya_irrigation custom integration (server-side timer).
 *          Cycles/interval scheduling UI is hidden; the DOM is kept for future re-enablement.
 */

// ── i18n ──
const I18N = {
  it: {
    irrigating: "Irrigando", paused: "In pausa", off: "Spento",
    dispenseFor: "Eroga per:", liters: "Litri", time: "Tempo",
    remaining: "rimanente",
    repeats: "Ripetizioni", cycles: "Cicli", cycleInterval: "Intervallo cicli",
    lastIrrigation: "Ultima irrigazione", duration: "Durata",
    start: "Inizio", end: "Fine", noRecent: "Nessuna irrigazione recente", none: "nessuna",
    now: "adesso", minAgo: "${m} min fa", hoursAgo: "${h}h ${m}m fa",
    atSep: " alle ",
    editorDevice: "Dispositivo irrigazione", editorSelect: "— Seleziona —",
    editorHint: "Mostra solo i dispositivi con tutte le entità irrigazione",
    editorNoDevice: "Nessun dispositivo irrigazione compatibile",
    editorName: "Nome (opzionale)", editorNamePh: "Nome personalizzato",
    editorNameHint: "Lascia vuoto per usare il nome del dispositivo",
    configError: "Seleziona un dispositivo irrigazione nella configurazione",
    defaultName: "Irrigazione",
    integrationMissing: "Installa l'integrazione Tuya Irrigation per abilitare il controllo",
    cardDesc: "Card compatta per valvole irrigazione Tuya con timer, pianificazione e storico",
  },
  en: {
    irrigating: "Irrigating", paused: "Paused", off: "Off",
    dispenseFor: "Dispense for:", liters: "Liters", time: "Time",
    remaining: "remaining",
    repeats: "Repeats", cycles: "Cycles", cycleInterval: "Cycle interval",
    lastIrrigation: "Last irrigation", duration: "Duration",
    start: "Start", end: "End", noRecent: "No recent irrigation", none: "none",
    now: "just now", minAgo: "${m} min ago", hoursAgo: "${h}h ${m}m ago",
    atSep: " at ",
    editorDevice: "Irrigation device", editorSelect: "— Select —",
    editorHint: "Shows only devices with all irrigation entities",
    editorNoDevice: "No compatible irrigation device found",
    editorName: "Name (optional)", editorNamePh: "Custom name",
    editorNameHint: "Leave empty to use device name",
    configError: "Select an irrigation device in the configuration",
    defaultName: "Irrigation",
    integrationMissing: "Install the Tuya Irrigation integration to enable control",
    cardDesc: "Compact card for Tuya irrigation valves with timer, scheduling and history",
  },
  zh: {
    irrigating: "灌溉中", paused: "已暂停", off: "关闭",
    dispenseFor: "灌溉方式：", liters: "升量", time: "时长",
    remaining: "剩余",
    repeats: "重复", cycles: "循环次数", cycleInterval: "循环间隔",
    lastIrrigation: "上次灌溉", duration: "持续时间",
    start: "开始", end: "结束", noRecent: "无近期灌溉记录", none: "无",
    now: "刚刚", minAgo: "${m}分钟前", hoursAgo: "${h}小时${m}分钟前",
    atSep: " ",
    editorDevice: "灌溉设备", editorSelect: "— 选择 —",
    editorHint: "仅显示具有所有灌溉实体的设备",
    editorNoDevice: "未找到兼容的灌溉设备",
    editorName: "名称（可选）", editorNamePh: "自定义名称",
    editorNameHint: "留空使用设备名称",
    configError: "请在配置中选择灌溉设备",
    defaultName: "灌溉",
    integrationMissing: "请安装 Tuya Irrigation 集成以启用控制",
    cardDesc: "适用于涂鸦灌溉阀的紧凑卡片，含定时、计划和历史记录",
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
class IrrigationControlCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._hass = null; }
  set hass(h) { this._hass = h; this._render(); }
  setConfig(c) { this._config = { ...c }; this._render(); }
  _render() {
    if (!this._hass) return;
    const compat = findCompatible(this._hass);
    const cur = this._config.switch || "";
    const nm = this._config.name || "";
    const t = (k) => _t(this._hass, k);
    this.shadowRoot.innerHTML = `
<style>
.editor{padding:16px;font-family:var(--paper-font-body1_-_font-family,sans-serif)}
.row{margin-bottom:16px}
label{display:block;font-size:12px;font-weight:500;color:var(--secondary-text-color);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
select,input[type="text"]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--divider-color,rgba(255,255,255,.06));background:var(--card-background-color,#232640);color:var(--primary-text-color);font-size:14px;font-family:monospace;outline:none;box-sizing:border-box}
select:focus,input:focus{border-color:#4a90d9}
.hint{font-size:11px;color:var(--disabled-text-color,#5c5e76);margin-top:4px}
.empty{font-size:13px;color:var(--disabled-text-color);padding:12px;text-align:center;background:var(--divider-color,rgba(255,255,255,.06));border-radius:8px}
</style>
<div class="editor">
  <div class="row">
    <label>${t("editorDevice")}</label>
    ${compat.length > 0 ? `<select id="sw"><option value="">${t("editorSelect")}</option>${compat.map(s => {
      const n = this._hass.states[s]?.attributes?.friendly_name || s;
      return `<option value="${s}" ${s===cur?"selected":""}>${n}</option>`;
    }).join("")}</select><div class="hint">${t("editorHint")}</div>` : `<div class="empty">${t("editorNoDevice")}</div>`}
  </div>
  <div class="row">
    <label>${t("editorName")}</label>
    <input type="text" id="nm" value="${nm}" placeholder="${t("editorNamePh")}">
    <div class="hint">${t("editorNameHint")}</div>
  </div>
</div>`;
    this.shadowRoot.getElementById("sw")?.addEventListener("change", e => { this._config = { ...this._config, switch: e.target.value }; this._fire(); });
    this.shadowRoot.getElementById("nm")?.addEventListener("input", e => { if (e.target.value) this._config = { ...this._config, name: e.target.value }; else { const { name, ...r } = this._config; this._config = r; } this._fire(); });
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
    this._mode = null; this._timerState = "idle";
    this._remainingSec = 0; this._totalSec = 0; this._timerInterval = null;
    this._weStarted = false;
    this._inputLitri = 0; this._inputMin = 0; this._inputSec = 0;
    this._userEditedLitri = false; this._userEditedTempo = false;
    this._histExpanded = false;
    this._domCreated = false;
    this._el = {};
  }

  static getConfigElement() { return document.createElement("irrigation-control-card-editor"); }
  static getStubConfig() { return { switch: "", name: "" }; }

  setConfig(config) {
    if (config.entities?.switch) this._entities = config.entities;
    else if (config.switch) this._entities = buildEntities(config.switch);
    else throw new Error(_t(this._hass, "configError"));
    this._configName = config.name || "";
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
    if (old && this._weStarted && this._timerState === "running") {
      if (old.states[this._entities.switch]?.state === "on" && hass.states[this._entities.switch]?.state !== "on") {
        // v2.0.0: the integration closed the valve (timer expired or stop pressed).
        // Reset the UI to idle instead of "paused" — there is nothing to resume.
        this._stopCountdown(); this._timerState = "idle"; this._weStarted = false; this._userEditedTempo = false;
      }
    }
    if (this._timerState === "idle") this._syncFromEntities();
    this._render();
  }

  _syncFromEntities() {
    const t = this._nv(this._entities.target);
    if (!this._userEditedLitri) this._inputLitri = t > 0 ? t : 1;
    if (!this._userEditedTempo) { this._inputMin = Math.floor(t / 60); this._inputSec = Math.round(t % 60); }
  }

  getCardSize() { return 5; }
  _sv(eid) { if (!eid || !this._hass?.states[eid]) return "unavailable"; return this._hass.states[eid].state; }
  _nv(eid) { const v = parseFloat(this._sv(eid)); return isNaN(v) ? 0 : v; }
  _lc(eid) { const s = this._hass?.states[eid]; return s ? new Date(s.last_changed) : null; }
  _isOn() { return this._sv(this._entities.switch) === "on"; }
  async _svc(d, s, data) { await this._hass.callService(d, s, data); }

  // ── DOM helpers ──
  _txt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  _setInput(el, v) { const s = String(v); if (el && el.value !== s) el.value = s; }
  _cls(el, cls, on) { if (el) el.classList.toggle(cls, !!on); }

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

  async _startLitri() {
    const v = this._inputLitri; if (v <= 0) return;
    if (!this._integrationAvailable()) { console.warn("[irrigation-control-card] tuya_irrigation integration not installed"); return; }
    await this._svc("tuya_irrigation", "irrigation_by_liters", {
      switch_entity: this._entities.switch,
      liters: v,
    });
  }
  async _stopLitri() { await this._svc("switch", "turn_off", { entity_id: this._entities.switch }); }

  async _toggleTimer() {
    if (this._timerState === "idle") await this._startTimerIrr();
    else if (this._timerState === "running") await this._pauseTimerIrr();
    else if (this._timerState === "paused") await this._resumeTimerIrr();
  }
  async _startTimerIrr() {
    const tot = this._inputMin * 60 + this._inputSec; if (tot <= 0) return;
    if (!this._integrationAvailable()) { console.warn("[irrigation-control-card] tuya_irrigation integration not installed"); return; }
    this._totalSec = tot; this._remainingSec = tot;
    await this._svc("tuya_irrigation", "irrigation_by_seconds", {
      switch_entity: this._entities.switch,
      seconds: tot,
    });
    // Client-side countdown is for visual feedback only; the actual close
    // is handled server-side by the integration.
    this._weStarted = true; this._timerState = "running"; this._startCountdown(); this._render();
  }
  async _pauseTimerIrr() {
    // Pausing an integration-managed task is not resumable: pressing the
    // running button just fires turn_off, which triggers the integration's
    // finally block and closes the valve cleanly. We treat this as a full stop.
    await this._svc("switch", "turn_off", { entity_id: this._entities.switch });
    this._resetTimer();
  }
  async _resumeTimerIrr() {
    // No-op: with the integration in charge, "paused" state is effectively
    // "stopped". Starting a new irrigation requires pressing play again.
    this._resetTimer();
  }

  _startCountdown() {
    this._stopCountdown();
    this._timerInterval = setInterval(() => {
      this._remainingSec--;
      if (this._remainingSec <= 0) { this._remainingSec = 0; this._resetTimer(); return; }
      this._tickUI();
    }, 1000);
  }
  _stopCountdown() { if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; } }
  _resetTimer() { this._stopCountdown(); this._timerState = "idle"; this._weStarted = false; this._userEditedTempo = false; this._render(); }
  _tickUI() {
    const mm = Math.floor(this._remainingSec / 60), ss = this._remainingSec % 60;
    this._setInput(this._el.tMin, this._p2(mm));
    this._setInput(this._el.tSec, this._p2(ss));
    if (this._el.bar) this._el.bar.style.width = (this._totalSec > 0 ? Math.round((this._remainingSec / this._totalSec) * 100) : 0) + "%";
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

  // Smart absolute date formatter for the compact "last irrigation" line.
  //   today         → "10:35"
  //   this week     → "Martedì 12 alle 10:35"
  //   older, same year → "12 mar"
  //   previous year(s) → "12 mar 2024"
  _smartDate(date) {
    if (!date || isNaN(date.getTime())) return null;
    const now = new Date();
    const locale = this._hass?.language || _i18nLang(this._hass);
    const cap = (s) => s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (sameDay) return time;
    const diffDays = (now.getTime() - date.getTime()) / 86400000;
    const at = _t(this._hass, "atSep");
    if (diffDays >= 0 && diffDays < 7) {
      const wd = cap(date.toLocaleDateString(locale, { weekday: "long" }));
      return `${wd} ${date.getDate()}${at}${time}`;
    }
    if (date.getFullYear() === now.getFullYear()) {
      return cap(date.toLocaleDateString(locale, { day: "numeric", month: "short" }));
    }
    return cap(date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }));
  }
  _fd(s) { s = Math.round(s); if (s < 60) return `${s} s`; const m = Math.floor(s / 60), r = s % 60; if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m} min`; return `${Math.floor(m / 60)}h ${m % 60}m`; }
  _fmtVol(v) {
    const n = Number(v) || 0;
    return n.toLocaleString(_numLocale(this._hass), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " L";
  }
  _fmtVolShort(v) {
    const n = Number(v) || 0;
    return n.toLocaleString(_numLocale(this._hass), { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " L";
  }
  _buildHistSummary(ago, smart, vol) {
    if (ago === null) return `: ${_t(this._hass, "none")}`;
    return `: ${smart}, ${this._fmtVolShort(vol)}`;
  }
  _p2(n) { return String(Math.round(n)).padStart(2, "0"); }

  _fmtLocalTime(val) {
    if (!val || val === "unavailable" || val === "unknown") return null;
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return null; }
  }

  _toggleHist() {
    this._histExpanded = !this._histExpanded;
    this._render();
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
    const dur = this._nv(e.last_duration);
    const vol = this._nv(e.summation);
    const ago = this._ago(this._lc(e.last_duration));
    const name = this._getName();
    const stLocal = this._fmtLocalTime(this._sv(e.start_time));
    const etLocal = this._fmtLocalTime(this._sv(e.end_time));
    const hasStEt = !!(stLocal && etLocal);

    let tM, tS;
    if (this._timerState !== "idle") { tM = Math.floor(this._remainingSec / 60); tS = this._remainingSec % 60; }
    else { tM = this._inputMin; tS = this._inputSec; }

    const t = (k) => _t(this._hass, k);
    let bTxt, bCls;
    if (this._timerState === "paused") { bTxt = t("paused"); bCls = "badge paused"; }
    else if (isOn) { bTxt = t("irrigating"); bCls = "badge active"; }
    else { bTxt = t("off"); bCls = "badge off"; }

    const pP = this._timerState !== "idle" && this._totalSec > 0 ? Math.round((this._remainingSec / this._totalSec) * 100) : 0;
    const modeOpen = this._mode !== null;
    const PL = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="white"/></svg>`;
    const PA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

    this.shadowRoot.innerHTML = `
<style>
:host{--accent:#2ecc8b;--accent-dim:rgba(46,204,139,.12);--accent-hover:#27b67a;--blue:#4a90d9;--blue-dim:rgba(74,144,217,.12);--blue-text:#6aabf0;--danger:#e25555;--tm:var(--primary-text-color,#e8e8f0);--ts:var(--secondary-text-color,#8b8da5);--th:var(--disabled-text-color,#5c5e76);--bd:var(--divider-color,rgba(255,255,255,.06))}
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
.cb{padding:6px 16px 14px}
.sc{margin-bottom:16px}.sc:last-child{margin-bottom:0}
.sl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--th);margin-bottom:8px}
.sl-inline{text-transform:none;font-weight:400;letter-spacing:normal;color:var(--ts);margin-left:4px}
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
.hrow{display:flex;align-items:center;gap:12px;padding:4px 0}
.hi{width:36px;height:36px;border-radius:8px;background:var(--bd);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.hn{flex:1;min-width:0}
.hlb{font-size:12px;color:var(--th)}
.hv{font-size:15px;font-weight:500;color:var(--tm)}
.htx{font-size:11px;color:var(--th);white-space:nowrap;font-family:monospace}
.exp-btn{background:none;border:1px solid var(--bd);border-radius:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--th);font-size:14px;font-family:monospace;transition:all .15s;flex-shrink:0;margin-left:6px;padding:0;line-height:1}
.exp-btn:hover{color:var(--ts);border-color:var(--ts)}
.exp-btn.open{color:var(--blue-text);border-color:rgba(74,144,217,.4)}
.hist-compact{display:flex;align-items:center;gap:6px;padding:2px 0;min-height:24px}
.hist-compact-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--th);flex-shrink:0}
.hist-summary{flex:1;min-width:0;font-size:12px;color:var(--tm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hist-summary.none{color:var(--ts);font-weight:400;font-style:italic}
.hist-detail{margin-top:6px}
.detail-row{display:flex;align-items:center;gap:8px;padding:4px 0 0 48px}
.detail-label{font-size:11px;color:var(--th);min-width:36px}
.detail-val{font-size:13px;font-weight:500;color:var(--tm);font-family:monospace}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=number]{-moz-appearance:textfield}
.intg-missing{background:rgba(226,85,85,.12);color:var(--danger);border:1px solid rgba(226,85,85,.3);border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:12px;text-align:center;display:none}
.intg-missing.vi{display:block}
</style>
<ha-card>
  <div class="ch">
    <div class="hl">
      <div class="di"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"/></svg></div>
      <span class="tt">${name}</span>
    </div>
    <div class="hr">
      ${hasBatt ? `<div class="bt"><div class="bs"><div class="bf" style="width:${Math.min(100,batt)}%"></div></div><div class="bp"></div><span class="batt-pct">${Math.round(batt)}%</span></div>` : ""}
      <span class="${bCls}">${bTxt}</span>
    </div>
  </div>
  <div class="cb">
    <div class="intg-missing ${this._integrationAvailable()?"":"vi"}" id="intg-missing">${t("integrationMissing")}</div>
    <div class="sc">
      <div class="ar">
        <button class="ab ${this._mode==="litri"?"ac":""}" id="bl"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"/></svg>${t("liters")}</button>
        <button class="ab ${this._mode==="tempo"?"ac":""}" id="bt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${t("time")}</button>
      </div>
      <div class="ip ${this._mode==="litri"?"vi":""}" id="ip-litri"><div>
        <div class="ir">
          <div class="nw"><input type="number" inputmode="numeric" pattern="[0-9]*" class="ni" id="vl" value="${Math.round(this._inputLitri)}" min="1" max="999"><div class="ut">L</div></div>
          <button class="gb ${isOn&&this._mode==="litri"?"rn":""}" id="gl">${isOn&&this._mode==="litri"?PA:PL}</button>
        </div>
      </div></div>
      <div class="ip ${this._mode==="tempo"?"vi":""}" id="ip-tempo"><div>
        <div class="ir">
          <div class="tg ${this._timerState==="running"?"cd":""}">
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="ti ${this._timerState!=="idle"?"ct":""}" id="t-min" value="${this._p2(tM)}" min="0" max="59" ${this._timerState!=="idle"?"disabled":""}>
            <span class="tp ${this._timerState!=="idle"?"ct":""}">:</span>
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="ti ${this._timerState!=="idle"?"ct":""}" id="t-sec" value="${this._p2(tS)}" min="0" max="59" ${this._timerState!=="idle"?"disabled":""}>
          </div>
          <div class="fh">${this._timerState!=="idle"?t("remaining"):"mm : ss"}</div>
          <button class="gb ${this._timerState==="running"?"rn":this._timerState==="paused"?"rs":""}" id="gt">${this._timerState==="running"?PA:PL}</button>
        </div>
        <div class="pw ${this._timerState!=="idle"?"vi":""}"><div class="pb" id="progress-bar" style="width:${pP}%"></div></div>
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
    </div>
    <div class="dv ${modeOpen?"vi":""}" id="divider"></div>
    <div class="sc" style="margin-bottom:0">
      <div class="hist-compact" id="hist-compact" style="display:${this._histExpanded&&ago!==null?"none":"flex"}">
        <span class="hist-compact-label">${t("lastIrrigation")}</span>
        <span class="hist-summary ${ago===null?"none":""}" id="hist-summary">${this._buildHistSummary(ago, this._smartDate(this._lc(e.last_duration)), vol)}</span>
        <button class="exp-btn" id="hexp-compact" style="display:${ago!==null?"flex":"none"}">+</button>
      </div>
      <div class="hist-expanded" id="hist-expanded" style="display:${this._histExpanded&&ago!==null?"block":"none"}">
        <div class="sl">${t("lastIrrigation")}</div>
        <div class="hrow">
          <div class="hi"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--th)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2C12 2 5 9 5 14a7 7 0 0014 0c0-5-7-12-7-12z"/></svg></div>
          <div class="hn">
            <div class="hv">${this._fmtVol(vol)}</div>
            <div class="hlb">${t("duration")}: ${this._fd(dur)}</div>
          </div>
          <span class="htx">${ago || ""}</span>
          <button class="exp-btn open" id="hexp">\u2212</button>
        </div>
        <div class="hist-detail" id="hist-detail" style="display:${hasStEt?"block":"none"}">
          <div class="detail-row"><span class="detail-label">${t("start")}</span><span class="detail-val" id="dv-start">${stLocal || ""}</span></div>
          <div class="detail-row"><span class="detail-label">${t("end")}</span><span class="detail-val" id="dv-end">${etLocal || ""}</span></div>
        </div>
      </div>
    </div>
  </div>
</ha-card>`;
    this._cacheEls();
    this._bindEvents();
  }

  _cacheEls() {
    const r = this.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const q = (sel) => r.querySelector(sel);
    this._el = {
      tt: q(".tt"), bf: q(".bf"), battPct: q(".batt-pct"), badge: q(".badge"),
      bl: $("bl"), bt: $("bt"),
      ipLitri: $("ip-litri"), ipTempo: $("ip-tempo"),
      vl: $("vl"), gl: $("gl"),
      tg: q(".tg"), tMin: $("t-min"), tSec: $("t-sec"), tp: q(".tp"),
      fh: q(".fh"), gt: $("gt"), pw: q(".pw"), bar: $("progress-bar"),
      rp: q(".rp"), sto: $("sto"), schedGrid: $("sched-grid"),
      svDisp: q(".sv"), ivHh: $("iv-hh"), ivMm: $("iv-mm"),
      histCompact: $("hist-compact"), histExpanded: $("hist-expanded"),
      histSummary: $("hist-summary"), histDetail: $("hist-detail"),
      divider: $("divider"),
      intgMissing: $("intg-missing"),
      hv: q(".hv"), hlb: q(".hlb"), htx: q(".htx"),
      expBtn: $("hexp"), expBtnCompact: $("hexp-compact"),
      dvStart: $("dv-start"), dvEnd: $("dv-end"),
    };
  }

  _bindEvents() {
    const el = this._el;
    el.bl?.addEventListener("click", () => this._selectMode("litri"));
    el.bt?.addEventListener("click", () => this._selectMode("tempo"));
    el.gl?.addEventListener("click", () => { if (this._isOn() && this._mode === "litri") this._stopLitri(); else this._startLitri(); });
    el.gt?.addEventListener("click", () => this._toggleTimer());
    el.vl?.addEventListener("change", ev => { this._inputLitri = Math.max(1, Math.min(999, parseInt(ev.target.value) || 1)); this._userEditedLitri = true; });
    el.tMin?.addEventListener("change", ev => { this._inputMin = Math.max(0, Math.min(59, parseInt(ev.target.value) || 0)); this._userEditedTempo = true; });
    el.tSec?.addEventListener("change", ev => { this._inputSec = Math.max(0, Math.min(59, parseInt(ev.target.value) || 0)); this._userEditedTempo = true; });
    el.sto?.addEventListener("click", () => this._toggleSchedule());
    this.shadowRoot.getElementById("cm")?.addEventListener("click", () => this._adjCycles(-1));
    this.shadowRoot.getElementById("cp")?.addEventListener("click", () => this._adjCycles(1));
    el.ivHh?.addEventListener("change", () => this._setIv());
    el.ivMm?.addEventListener("change", () => this._setIv());
    el.expBtn?.addEventListener("click", () => this._toggleHist());
    el.expBtnCompact?.addEventListener("click", () => this._toggleHist());
  }

  // ── Selective DOM update (runs on every subsequent hass update) ──
  _update() {
    const e = this._entities;
    const isOn = this._isOn();
    const batt = this._nv(e.battery);
    const cyc = this._nv(e.cycles); const schedOn = cyc > 1;
    const ivS = this._nv(e.interval);
    const ivH = Math.floor(ivS / 3600), ivM = Math.floor((ivS % 3600) / 60);
    const dur = this._nv(e.last_duration);
    const vol = this._nv(e.summation);
    const ago = this._ago(this._lc(e.last_duration));
    const name = this._getName();
    const stLocal = this._fmtLocalTime(this._sv(e.start_time));
    const etLocal = this._fmtLocalTime(this._sv(e.end_time));
    const hasStEt = !!(stLocal && etLocal);

    let tM, tS;
    if (this._timerState !== "idle") { tM = Math.floor(this._remainingSec / 60); tS = this._remainingSec % 60; }
    else { tM = this._inputMin; tS = this._inputSec; }

    const t = (k) => _t(this._hass, k);
    const el = this._el;
    const PL = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="white"/></svg>`;
    const PA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

    // ── Header ──
    this._txt(el.tt, name);
    if (el.bf) el.bf.style.width = Math.min(100, batt) + "%";
    if (el.battPct) this._txt(el.battPct, Math.round(batt) + "%");

    let bTxt, bCls;
    if (this._timerState === "paused") { bTxt = t("paused"); bCls = "paused"; }
    else if (isOn) { bTxt = t("irrigating"); bCls = "active"; }
    else { bTxt = t("off"); bCls = "off"; }
    if (el.badge) { this._txt(el.badge, bTxt); el.badge.className = "badge " + bCls; }

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

    // ── Tempo ──
    if (!this._isEditingGroup("tempo")) {
      this._setInput(el.tMin, this._p2(tM));
      this._setInput(el.tSec, this._p2(tS));
    }
    const timerActive = this._timerState !== "idle";
    this._cls(el.tg, "cd", this._timerState === "running");
    this._cls(el.tMin, "ct", timerActive);
    this._cls(el.tSec, "ct", timerActive);
    this._cls(el.tp, "ct", timerActive);
    if (timerActive) { el.tMin?.setAttribute("disabled", ""); el.tSec?.setAttribute("disabled", ""); }
    else { el.tMin?.removeAttribute("disabled"); el.tSec?.removeAttribute("disabled"); }
    if (el.fh) this._txt(el.fh, timerActive ? t("remaining") : "mm : ss");
    if (el.gt) {
      el.gt.className = "gb" + (this._timerState === "running" ? " rn" : this._timerState === "paused" ? " rs" : "");
      el.gt.innerHTML = this._timerState === "running" ? PA : PL;
    }
    this._cls(el.pw, "vi", timerActive);
    const pP = timerActive && this._totalSec > 0 ? Math.round((this._remainingSec / this._totalSec) * 100) : 0;
    if (el.bar) el.bar.style.width = pP + "%";

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

    // ── History: three states (empty / compact / expanded) ──
    const hasData = ago !== null;
    const showExpanded = this._histExpanded && hasData;
    const smart = this._smartDate(this._lc(e.last_duration));
    if (el.histCompact) el.histCompact.style.display = showExpanded ? "none" : "flex";
    if (el.histExpanded) el.histExpanded.style.display = showExpanded ? "block" : "none";
    if (el.histSummary) {
      this._txt(el.histSummary, this._buildHistSummary(ago, smart, vol));
      this._cls(el.histSummary, "none", !hasData);
    }
    if (el.expBtnCompact) el.expBtnCompact.style.display = hasData ? "flex" : "none";
    if (hasData) {
      this._txt(el.hv, this._fmtVol(vol));
      this._txt(el.hlb, t("duration") + ": " + this._fd(dur));
      this._txt(el.htx, ago);
      if (el.histDetail) el.histDetail.style.display = hasStEt ? "block" : "none";
      if (hasStEt) {
        this._txt(el.dvStart, stLocal);
        this._txt(el.dvEnd, etLocal);
      }
    }
  }

  disconnectedCallback() { this._stopCountdown(); }
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
console.info("%c IRRIGATION-CONTROL-CARD %c v2.0.0 ", "color:white;background:#2ecc8b;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px;", "color:#2ecc8b;background:#1a1c2e;font-weight:bold;padding:2px 6px;border-radius:0 4px 4px 0;");