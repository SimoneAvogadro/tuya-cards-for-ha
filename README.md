# Tuya Cards for HA

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

Collection of custom Lovelace cards for Home Assistant, designed for Tuya-based smart devices paired via ZHA or Zigbee2MQTT. Each card auto-discovers compatible devices by checking entity suffix patterns — no manual entity configuration needed.

## Cards included

| Card | Device | Status |
|------|--------|--------|
| `irrigation-control-card` | Tuya TS0601 irrigation valves | v1.6.0 |
| `soil-moisture-card` | Soil/air moisture + temperature sensors (ZG-303Z) | v1.0.0 |

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend** > three-dot menu > **Custom repositories**
3. Add this repository URL, category **Dashboard**
4. Search "Tuya Cards for HA" and install
5. Restart Home Assistant

A single resource (`tuya-cards.js`) registers all cards automatically.

### Manual

1. Download `tuya-cards.js` from the [latest release](../../releases/latest)
2. Copy it to `/config/www/tuya-cards.js`
3. Add the resource in **Settings > Dashboards > Resources**:
   - URL: `/local/tuya-cards.js`
   - Type: JavaScript Module

---

## Irrigation Control Card

Compact card for Tuya smart irrigation valves (TS0601 chipset). Replaces 8+ scattered entities with a single widget.

### Features

- **Dual-mode manual irrigation**: by liters (Capacity) or by time (Duration)
- **Live countdown timer** with pause/resume
- **Scheduling**: toggle repetitions, set cycle count and interval (hh:mm)
- **History**: last irrigation volume + duration + relative timestamp, collapsible start/end times
- **Auto-discovery**: from a single switch entity, builds all companion entity IDs via suffix convention
- **Visual Editor**: dropdown shows only switches with all required companion entities
- **Battery indicator**: shown if battery entity exists, hidden otherwise
- **Theme-aware**: uses HA CSS variables for automatic light/dark support

### Compatibility

Tested on **Tuya TS0601** (`_TZE200_a7sghmms`) smart irrigation valve.

Works with any Tuya irrigation valve exposing the same entity suffix pattern, regardless of Zigbee coordinator (ZHA, Zigbee2MQTT, deCONZ).

### Configuration

**Minimal (recommended):**

```yaml
type: custom:irrigation-control-card
switch: switch.tze200_a7sghmms_ts0601
name: Irrigatore 31  # optional, defaults to friendly_name
```

The card auto-discovers all companion entities from the switch name using suffix conventions.

**Legacy (explicit entities):**

```yaml
type: custom:irrigation-control-card
name: Irrigatore 31
entities:
  switch: switch.tze200_a7sghmms_ts0601
  mode: select.tze200_a7sghmms_ts0601_irrigation_mode
  target: number.tze200_a7sghmms_ts0601_irrigation_target
  cycles: number.tze200_a7sghmms_ts0601_irrigation_cycles
  interval: number.tze200_a7sghmms_ts0601_irrigation_interval
  last_duration: sensor.tze200_a7sghmms_ts0601_last_irrigation_duration
  summation: sensor.tze200_a7sghmms_ts0601_summation_delivered
  battery: sensor.tze200_a7sghmms_ts0601_battery
```

### Entity suffix mapping

Given a switch entity `switch.<PREFIX>`, the card auto-discovers:

| Key | Domain | Suffix | Required |
|-----|--------|--------|----------|
| mode | select | `_irrigation_mode` | Yes |
| target | number | `_irrigation_target` | Yes |
| cycles | number | `_irrigation_cycles` | Yes |
| interval | number | `_irrigation_interval` | Yes |
| last_duration | sensor | `_last_irrigation_duration` | Yes |
| summation | sensor | `_summation_delivered` | Yes |
| battery | sensor | `_battery` | No |
| start_time | sensor | `_irrigation_start_time` | No |
| end_time | sensor | `_irrigation_end_time` | No |

---

## Soil Moisture Card

Compact card for soil moisture, temperature and air humidity sensors. Displays all three readings in a balanced three-column layout with a colored progress bar for soil moisture.

### Features

- **Three-column layout**: soil moisture, temperature, air humidity at a glance
- **Colored progress bar**: soil moisture bar changes color based on configurable thresholds
- **Configurable thresholds**: set optimal (green) and acceptable (yellow) ranges per plant type; values outside acceptable range show red
- **Auto-discovery**: from a single `_soil_moisture` sensor entity, builds all companion entity IDs via suffix convention
- **Visual Editor**: dropdown shows only sensors with all required companion entities, plus threshold configuration
- **Battery indicator**: shown if battery entity exists, hidden otherwise
- **Theme-aware**: uses HA CSS variables for automatic light/dark support

### Compatibility

Tested on **HOBEIAN ZG-303Z** (Excellux 3-in-1) soil moisture sensor, paired via ZHA.

### Configuration

```yaml
type: custom:soil-moisture-card
entity: sensor.umidita_terreno_1_soil_moisture
name: Umidita terreno 1  # optional, defaults to friendly_name
opt_min: 40               # optional, optimal range lower bound (default 40)
opt_max: 60               # optional, optimal range upper bound (default 60)
acc_min: 20               # optional, acceptable range lower bound (default 20)
acc_max: 80               # optional, acceptable range upper bound (default 80)
```

### Threshold color logic

```
  RED    |  YELLOW  |  GREEN  |  YELLOW  |  RED
---------+----------+---------+----------+---------
  0%   acc_min   opt_min   opt_max   acc_max   100%
```

### Entity suffix mapping

Given a sensor entity `sensor.<PREFIX>_soil_moisture`, the card auto-discovers:

| Key | Domain | Suffix | Required |
|-----|--------|--------|----------|
| soil_moisture | sensor | `_soil_moisture` | Yes |
| temperature | sensor | `_temperature` | Yes |
| humidity | sensor | `_humidity` | Yes |
| battery | sensor | `_battery` | No |

---

## Technical details

- Pure **HTMLElement** with Shadow DOM (no LitElement dependency)
- Client-side countdown timer via `setInterval`
- CSS uses HA theme variables (`--primary-text-color`, `--card-background-color`, etc.)
- Each card auto-discovers its entities — extra cards for devices you don't have are simply invisible

## License

[MIT](LICENSE)
