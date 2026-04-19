# Plan — v2.0: `tuya_irrigation` custom integration + auto-registered card

**Status**: approved, in implementation.
**Target release**: v2.0.0 (breaking change, HACS type moves from "dashboard" to "integration").

## Context

The irrigation card currently orchestrates a 4-step service call sequence and runs a client-side `setInterval` countdown, assuming the valve firmware will auto-stop. Testing on `_TZE200_a7sghmms` (GiEX QT06) revealed the firmware silently ignores `irrigation_target` under ZHA — the valve runs forever unless something explicitly calls `switch.turn_off`.

For nightly automations (browser closed), the timer/volume logic must live server-side inside HA. We therefore restructure the project from a Lovelace-only package into a Python custom integration that:

1. Exposes two services (`irrigation_by_seconds`, `irrigation_by_liters`) implementing `open → wait → close` server-side.
2. Serves the Lovelace bundle (`tuya-cards.js`) and auto-registers it as a Lovelace module resource — users only install the integration.
3. Continues to ship both cards (irrigation + soil-moisture) from the same bundle.

The cycles/interval scheduling UI is **hidden (not removed)** — DOM stays, `display:none` + code comment mark it as temporarily disabled until the integration gains scheduling support.

## Repository layout (after change)

```
tuya-cards-for-ha/
├── custom_components/
│   └── tuya_irrigation/
│       ├── __init__.py           # integration entry, services, static paths, resource auto-reg
│       ├── const.py              # DOMAIN, VERSION, URL_BASE, JSMODULES
│       ├── manifest.json         # dependencies: ["frontend", "http"]
│       ├── services.yaml         # service schema for Dev Tools UI
│       └── www/
│           └── tuya-cards.js     # copied by build.sh
├── docs/
│   └── PLAN-integration-v2.md    # this doc
├── src/
│   ├── irrigation-control-card.js
│   └── soil-moisture-card.js
├── tuya-cards.js                 # built bundle (root copy kept for back-compat + manual install)
├── build.sh
├── hacs.json                     # now integration-detected
├── README.md
└── CLAUDE.md
```

## Integration design

### `manifest.json`

```json
{
  "domain": "tuya_irrigation",
  "name": "Tuya Irrigation",
  "version": "2.0.0",
  "documentation": "https://github.com/SimoneAvogadro/tuya-cards-for-ha",
  "dependencies": ["frontend", "http"],
  "codeowners": ["@SimoneAvogadro"],
  "iot_class": "local_push",
  "config_flow": false
}
```

### `const.py`

```python
DOMAIN = "tuya_irrigation"
VERSION = "2.0.0"
URL_BASE = "/tuya_irrigation"
JSMODULES = [{"filename": "tuya-cards.js", "version": VERSION}]
```

### `__init__.py` — responsibilities

- **`async_setup(hass, config)`**:
  - `await hass.http.async_register_static_paths([StaticPathConfig(URL_BASE, www_dir, False)])` (modern async API — the deprecated `register_static_path` is removed in HA 2025.7)
  - If `hass.data["lovelace"].mode == "storage"`: iterate `hass.data["lovelace"].resources` and create/update the module resource at `{URL_BASE}/tuya-cards.js?v={VERSION}`
  - Register the two services
  - Return `True`

- **`irrigation_by_seconds(call)`**:
  - Cancel any running task for `switch_entity` (DOMAIN-level dict keyed by entity_id)
  - `await switch.turn_on(switch_entity)`
  - Spawn `hass.async_create_task(_run(seconds))`:
    ```python
    try:
        await asyncio.sleep(seconds)
    finally:
        await switch.turn_off(switch_entity)  # fires even on cancel
    ```

- **`irrigation_by_liters(call)`**:
  - `summation_entity = f"sensor.{switch_entity[7:]}_summation_delivered"`
  - Record `start_volume`; compute `target = start + liters`
  - Cancel any running task for this switch
  - `await switch.turn_on(switch_entity)`
  - Spawn task with `async_track_state_change_event` listener on `summation_entity`, plus `asyncio.wait_for(event, timeout=timeout_seconds or 3600)`. `finally: unsub(); turn_off`

- **Teardown**: cancel all running tasks.

### `services.yaml`

```yaml
irrigation_by_seconds:
  name: Irrigation By Seconds
  description: Open the valve, wait N seconds, close it. Works regardless of valve firmware.
  fields:
    switch_entity:
      name: Valve
      required: true
      selector: { entity: { domain: switch } }
    seconds:
      name: Seconds
      required: true
      selector: { number: { min: 1, max: 43200, unit_of_measurement: s } }

irrigation_by_liters:
  name: Irrigation By Liters
  description: Open the valve, monitor summation_delivered, close when target volume reached.
  fields:
    switch_entity:
      name: Valve
      required: true
      selector: { entity: { domain: switch } }
    liters:
      name: Liters
      required: true
      selector: { number: { min: 1, max: 10000, unit_of_measurement: L } }
    timeout_seconds:
      name: Safety timeout (seconds)
      required: false
      default: 3600
      selector: { number: { min: 60, max: 86400, unit_of_measurement: s } }
```

## Card changes (`src/irrigation-control-card.js`)

1. **Hide cycles/interval section** via CSS — add `display: none !important;` on `.rp`; keep all DOM, SUFFIXES, and setConfig entries intact so existing YAML configs do not break. Add a code comment above the `.rp` template noting the temporary disablement.

2. **Rewire start actions** to call the new services:
   - `_startLitri()` → `callService("tuya_irrigation", "irrigation_by_liters", { switch_entity, liters })`
   - `_startTimerIrr()` → `callService("tuya_irrigation", "irrigation_by_seconds", { switch_entity, seconds })` + client-side countdown for visual feedback
   - Pause/resume: disabled for now (integration tasks are not resumable). The big button during an active irrigation fires `switch.turn_off`; the integration's `finally` closes the valve cleanly.

3. **Client-side countdown**: keep `setInterval` for UI only; `_resetTimer()` no longer calls `turn_off` (integration does it). Reset UI when switch state transitions to `off` in the `hass` setter.

4. **Graceful degradation**: in `setConfig`, check if `hass.services["tuya_irrigation"]?.irrigation_by_seconds` exists. If not, render a hint: "Install the Tuya Irrigation integration to enable irrigation control".

5. **Version bump**: card header `v2.0.0`.

## Files changed

| File | Action |
|---|---|
| `custom_components/tuya_irrigation/__init__.py` | CREATE |
| `custom_components/tuya_irrigation/const.py` | CREATE |
| `custom_components/tuya_irrigation/manifest.json` | CREATE |
| `custom_components/tuya_irrigation/services.yaml` | CREATE |
| `src/irrigation-control-card.js` | MODIFY (hide repeats, rewire to services, v2.0.0) |
| `build.sh` | MODIFY (copy bundle into integration `www/`) |
| `hacs.json` | MODIFY (integration detection) |
| `README.md` | MODIFY (new install flow, migration notes) |
| `CLAUDE.md` | MODIFY (updated repo structure) |

## Reuse notes

- `SUFFIXES`, `buildEntities`, `isCompatible`, `findCompatible` helpers (card lines 73–98): kept as-is — entity auto-discovery logic unchanged.
- `_svc()` helper (line 199) already wraps `hass.callService` — reused for the two new service calls; no new plumbing needed.
- i18n object `I18N` (lines 8–60): already covers IT/EN/ZH. Add keys `integrationMissing` for the degradation hint.

## Verification (manual, real HA instance)

1. Install via HACS → custom repo → **Integration** → Install → Restart HA.
2. Settings → Devices & Services: no errors for `tuya_irrigation` in Logs.
3. Settings → Dashboards → Resources: `/tuya_irrigation/tuya-cards.js?v=2.0.0` present as Module.
4. Dev Tools → Services: `tuya_irrigation.irrigation_by_seconds` and `.irrigation_by_liters` both visible with proper field UI.
5. Call `irrigation_by_seconds` with `seconds: 5` from Dev Tools → valve opens, closes after 5s (even with broken firmware auto-off — this is the key test).
6. Add the card to a dashboard → Time mode works, cycles/interval section hidden, Liters mode works.
7. **Browser-closed test**: start a 60s irrigation → close tab → wait 90s → reopen → valve is off.
8. **Timeout test**: `liters: 999`, `timeout_seconds: 20` → valve closes after 20s, warning in HA log.
9. **Cancellation test**: start a 60s irrigation → fire a new 5s one on the same switch → first is cancelled, 5s runs cleanly.
10. Soil-moisture card still works (served from the same bundle).

## Future work (out of scope)

- Re-enable cycles/interval via a `schedule` service that loops `irrigation_by_seconds` N times.
- Persist active-task state so HA restart mid-irrigation can at least close the valve.
- Config flow UI (currently zero-config).
