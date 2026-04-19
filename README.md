# Tuya Irrigation + Cards for HA

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

Custom Home Assistant integration **plus** two Lovelace cards for Tuya-based smart devices paired via ZHA or Zigbee2MQTT.

The **integration** exposes two server-side services (`irrigation_by_seconds`, `irrigation_by_liters`) that reliably open and close an irrigation valve on a timer or by delivered volume — working around buggy valve firmware (e.g. GiEX QT06 / `_TZE200_a7sghmms`) that silently ignores its own auto-off timer under ZHA.

The **cards** auto-discover compatible devices from a single entity via suffix conventions — no manual entity configuration needed.

## What's included

| Component | Purpose | Status |
|---|---|---|
| `tuya_irrigation` integration | Server-side `irrigation_by_seconds` / `irrigation_by_liters` services | v2.0.0 |
| `irrigation-control-card` | Lovelace card driving the services above | v2.0.0 |
| `soil-moisture-card` | Card for soil moisture + temperature + air humidity sensors | v1.1.2 |

## Installation (HACS)

1. Open HACS in Home Assistant.
2. Three-dot menu → **Custom repositories** → add this repository URL, category **Integration**.
3. Search "Tuya Irrigation" → **Install**.
4. **Restart Home Assistant** (required after integration install).
5. The card bundle is served automatically by the integration and auto-registered as a Lovelace resource (only in *storage* mode, the default). Hard-refresh your browser (Ctrl+Shift+R).

### Upgrading from v1.x

v1.x was distributed as a pure dashboard (Lovelace-only) HACS repo. v2.0.0 is now an integration.

1. Remove the old Lovelace resource pointing to `/hacsfiles/tuya-cards-for-ha/tuya-cards.js` or `/local/tuya-cards.js`.
2. HACS → remove the old installation.
3. Re-add this repo as **Integration** and install (see above).
4. After HA restart, the new resource `/tuya_irrigation/tuya-cards.js?v=2.0.0` will be registered automatically.
5. Existing `custom:irrigation-control-card` YAML keeps working. The cycles/interval UI is hidden for now (planned re-enablement once the integration supports scheduling).

### Manual install (YAML mode or no HACS)

1. Copy the `custom_components/tuya_irrigation/` directory into `/config/custom_components/`.
2. Restart HA.
3. If Lovelace is in YAML mode, manually add to your `resources:`:
   ```yaml
   - url: /tuya_irrigation/tuya-cards.js
     type: module
   ```

---

## Services

### `tuya_irrigation.irrigation_by_seconds`

Opens the valve, waits N seconds server-side, closes the valve. The timer runs inside Home Assistant, so it works regardless of the valve firmware's native auto-off behaviour — even with browser closed, for nightly automations.

| Field | Type | Required | Description |
|---|---|---|---|
| `switch_entity` | entity_id (switch) | yes | Valve switch to control |
| `seconds` | int [1, 43200] | yes | How long to keep the valve open |

Example (automation):
```yaml
- alias: "Irrigazione notturna"
  trigger: { platform: time, at: "22:00:00" }
  action:
    - service: tuya_irrigation.irrigation_by_seconds
      data:
        switch_entity: switch.tze200_a7sghmms_ts0601
        seconds: 600   # 10 minutes
```

### `tuya_irrigation.irrigation_by_liters`

Opens the valve, watches `sensor.<prefix>_summation_delivered`, closes when the target volume has been delivered (plus a safety timeout).

| Field | Type | Required | Description |
|---|---|---|---|
| `switch_entity` | entity_id (switch) | yes | Valve switch to control |
| `liters` | number [0.001, 10000] | yes | Target volume to deliver |
| `timeout_seconds` | int [60, 86400] | no (default 3600) | Force-close after this many seconds if volume never reached |

Example:
```yaml
- service: tuya_irrigation.irrigation_by_liters
  data:
    switch_entity: switch.tze200_a7sghmms_ts0601
    liters: 10
    timeout_seconds: 1800
```

### Behavior notes

- Calling a service on a switch that is already being irrigated **cancels** the previous task and starts a new one.
- When a task is cancelled (or HA shuts down), its `finally` block still calls `switch.turn_off` — the valve will not be left open.
- During a run, pressing the stop button on the card or calling `switch.turn_off` directly aborts the task and closes the valve cleanly.

---

## Irrigation Control Card

Compact card for Tuya smart irrigation valves. Replaces a handful of scattered entities with a single widget that drives the integration's services.

### Features

- **Dual-mode manual irrigation**: by liters or by seconds — both dispatched server-side via the integration.
- **Live countdown**: visual feedback while the integration's server-side timer runs.
- **History**: last irrigation volume + duration + relative timestamp, collapsible start/end times.
- **Auto-discovery**: from a single switch entity, builds all companion entity IDs via suffix convention.
- **Visual editor**: dropdown shows only switches with all required companion entities.
- **Battery indicator**: shown if battery entity exists.
- **Integration-missing banner**: the card warns if the `tuya_irrigation` integration is not installed.
- **Theme-aware**: uses HA CSS variables for automatic light/dark support.

The cycles/interval scheduling UI is temporarily hidden in v2.0; the code and entity discovery are preserved and will be re-enabled once the integration gains a scheduling service.

### Compatibility

Tested on **Tuya TS0601** (`_TZE200_a7sghmms`, GiEX QT06) smart irrigation valve. Works with any Tuya irrigation valve exposing the same entity suffix pattern, regardless of Zigbee coordinator (ZHA, Zigbee2MQTT, deCONZ).

### Configuration

```yaml
type: custom:irrigation-control-card
switch: switch.tze200_a7sghmms_ts0601
name: Irrigatore 31  # optional, defaults to friendly_name
```

### Entity suffix mapping

Given a switch entity `switch.<PREFIX>`, the card auto-discovers:

| Key | Domain | Suffix | Required |
|-----|--------|--------|----------|
| mode | select | `_irrigation_mode` | Yes |
| target | number | `_irrigation_target` | Yes |
| cycles | number | `_irrigation_cycles` | Yes (discovered but UI hidden) |
| interval | number | `_irrigation_interval` | Yes (discovered but UI hidden) |
| last_duration | sensor | `_last_irrigation_duration` | Yes |
| summation | sensor | `_summation_delivered` | Yes |
| battery | sensor | `_battery` | No |
| start_time | sensor | `_irrigation_start_time` | No |
| end_time | sensor | `_irrigation_end_time` | No |

---

## Soil Moisture Card

Compact card for soil moisture, temperature and air humidity sensors. Displays all three readings in a balanced three-column layout with a colored progress bar for soil moisture.

### Features

- **Three-column layout**: soil moisture, temperature, air humidity at a glance.
- **Colored progress bar**: soil moisture changes color based on configurable thresholds.
- **Configurable thresholds**: optimal (green) and acceptable (yellow) ranges per plant; outside acceptable = red.
- **Auto-discovery**: from a single `_soil_moisture` sensor, builds all companion entities.
- **Visual editor** with threshold configuration.
- **Battery indicator** (if available).

### Compatibility

Tested on **HOBEIAN ZG-303Z** (Excellux 3-in-1) soil moisture sensor, paired via ZHA.

### Configuration

```yaml
type: custom:soil-moisture-card
entity: sensor.umidita_terreno_1_soil_moisture
name: Umidita terreno 1
opt_min: 40
opt_max: 60
acc_min: 20
acc_max: 80
```

### Threshold color logic

```
  RED    |  YELLOW  |  GREEN  |  YELLOW  |  RED
---------+----------+---------+----------+---------
  0%   acc_min   opt_min   opt_max   acc_max   100%
```

### Entity suffix mapping

| Key | Domain | Suffix | Required |
|-----|--------|--------|----------|
| soil_moisture | sensor | `_soil_moisture` | Yes |
| temperature | sensor | `_temperature` | Yes |
| humidity | sensor | `_humidity` | Yes |
| battery | sensor | `_battery` | No |

---

## Technical details

- **Integration**: pure-Python `custom_components/tuya_irrigation/`, no external dependencies. Uses `async_register_static_paths` + `StaticPathConfig` (compatible with HA ≥ 2024.1).
- **Cards**: pure `HTMLElement` with Shadow DOM (no LitElement dependency). Bundle concatenated by `bash build.sh`.
- **Theming**: HA CSS variables (`--primary-text-color`, `--card-background-color`, etc.).
- **Localization**: IT / EN / ZH via `localStorage.selectedLanguage`.

## Development

```bash
# Rebuild the card bundle (concatenates src/*.js and copies into the integration's www/)
bash build.sh

# The integration reloads are HA-side: restart HA or call the "Reload" action
# on the integration from Developer Tools → YAML configuration.
```

Plan doc for the v2.0 architecture: [`docs/PLAN-integration-v2.md`](docs/PLAN-integration-v2.md).

## License

[MIT](LICENSE)
