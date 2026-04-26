/**
 * Soil Moisture Card for Home Assistant
 * Custom Lovelace card for soil moisture / temperature / humidity sensors (ZG-303Z)
 * v1.1.3 — Swap soil/air sources: soil column reads _humidity, air column reads _soil_moisture
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
class SoilMoistureCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._hass = null; }
  set hass(h) { this._hass = h; this._render(); }
  setConfig(c) { this._config = { ...c }; this._render(); }
  _render() {
    if (!this._hass) return;
    const compat = smFindCompatible(this._hass);
    const cur = this._config.entity || "";
    const nm = this._config.name || "";
    const oMin = this._config.opt_min ?? 40;
    const oMax = this._config.opt_max ?? 60;
    const aMin = this._config.acc_min ?? 20;
    const aMax = this._config.acc_max ?? 80;
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
  <div class="row">
    <label>${t("editorThresholds")}</label>
    <div class="thr-grid">
      <div><div class="thr-label">${t("editorAccMin")}</div><input type="number" id="acc-min" value="${aMin}" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorAccMax")}</div><input type="number" id="acc-max" value="${aMax}" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorOptMin")}</div><input type="number" id="opt-min" value="${oMin}" min="0" max="100"></div>
      <div><div class="thr-label">${t("editorOptMax")}</div><input type="number" id="opt-max" value="${oMax}" min="0" max="100"></div>
    </div>
  </div>
</div>`;
    this.shadowRoot.getElementById("sw")?.addEventListener("change", e => { this._config = { ...this._config, entity: e.target.value }; this._fire(); });
    this.shadowRoot.getElementById("nm")?.addEventListener("input", e => { if (e.target.value) this._config = { ...this._config, name: e.target.value }; else { const { name, ...r } = this._config; this._config = r; } this._fire(); });
    for (const [id, key] of [["opt-min","opt_min"],["opt-max","opt_max"],["acc-min","acc_min"],["acc-max","acc_max"]]) {
      this.shadowRoot.getElementById(id)?.addEventListener("change", e => {
        const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
        this._config = { ...this._config, [key]: v };
        this._fire();
      });
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

    this.shadowRoot.innerHTML = `
<style>
:host{--sm-green:#2ecc8b;--sm-yellow:#eab308;--sm-red:#e25555;--tm:var(--primary-text-color,#e8e8f0);--ts:var(--secondary-text-color,#8b8da5);--th:var(--disabled-text-color,#5c5e76);--bd:var(--divider-color,rgba(255,255,255,.06))}
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
.cb{padding:6px 16px 14px}
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center}
.col-label{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--th);margin-bottom:4px}
.col-value{font-size:18px;font-weight:600;color:var(--tm);font-family:monospace;line-height:1.2}
.col-unit{font-size:11px;font-weight:400;color:var(--ts)}
.bar-wrap{height:4px;border-radius:2px;background:var(--bd);margin-top:6px;overflow:hidden}
.bar-fill{height:100%;border-radius:2px;transition:width .4s ease,background .3s}
</style>
<ha-card>
  <div class="ch">
    <div class="hl">
      <div class="di" id="icon" style="background:${cc.dim}"><svg width="18" height="18" viewBox="0 0 24 24" fill="${cc.text}"><path d="M12 2.5S5 10 5 15a7 7 0 0014 0c0-5-7-12.5-7-12.5zm-1 15c-2.5-.3-4.5-2.3-4.7-4.8-.1-.4.2-.7.5-.7s.6.2.7.6c.2 1.9 1.7 3.4 3.6 3.6.4 0 .6.3.6.7s-.3.6-.7.6z"/></svg></div>
      <span class="tt">${name}</span>
    </div>
    <div class="hr">
      ${hasBatt ? `<div class="bt"><div class="bs"><div class="bf" style="width:${Math.min(100,batt)}%"></div></div><div class="bp"></div><span class="batt-pct">${Math.round(batt)}%</span></div>` : ""}
    </div>
  </div>
  <div class="cb">
    <div class="cols">
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
      icon: r.getElementById("icon"),
      iconSvg: r.querySelector("#icon svg"),
      vSoil: r.getElementById("v-soil"),
      barSoil: r.getElementById("bar-soil"),
      vTemp: r.getElementById("v-temp"),
      vHum: r.getElementById("v-hum"),
    };
  }

  _update() {
    const e = this._entities;
    // Sources swapped: see note in _createDOM.
    const soil = this._nv(e.humidity);
    const temp = this._nv(e.temperature);
    const hum = this._nv(e.soil_moisture);
    const batt = this._nv(e.battery);
    const name = this._getName();
    const loc = _smLocale(this._hass);
    const tc = this._thresholdColor(soil);
    const cc = this._colorCSS(tc);
    const el = this._el;

    this._txt(el.tt, name);
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
console.info("%c SOIL-MOISTURE-CARD %c v1.1.3 ", "color:white;background:#2ecc8b;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px;", "color:#2ecc8b;background:#1a1c2e;font-weight:bold;padding:2px 6px;border-radius:0 4px 4px 0;");
