# CLAUDE.md — tuya-cards-for-ha

## What this project is

A Home Assistant custom **integration** (`tuya_irrigation`) plus two companion **Lovelace cards**, targeting Tuya-based smart devices (ZHA / Zigbee2MQTT). Distributed as a single HACS custom repository (category: Integration — HACS auto-detects from `custom_components/`).

The integration holds **no ZHA / zigpy code** (see [ZHA layer](#zha-layer-zha-tuya-quirks)). It provides two server-side services that reliably open + wait + close an irrigation valve (working around firmware bugs in e.g. GiEX QT06 / `_TZE200_a7sghmms` whose native duration timer is silently ignored under ZHA). It records a durable per-valve **irrigation history** (a run log + a cumulative water total) via new sensors and an `irrigation_completed` event, and auto-serves and auto-registers the Lovelace card bundle so users don't need to configure Lovelace resources manually.

## Repo structure

```
tuya-cards-for-ha/
├── custom_components/
│   └── tuya_irrigation/
│       ├── __init__.py           ← services + run-log manager + static path + Lovelace auto-reg + ZHA-layer service calls
│       ├── config_flow.py        ← minimal single-entry config flow (one-click enable)
│       ├── const.py
│       ├── discovery.py          ← valve auto-detection (switch + water-volume sensor, minus foreign-owned)
│       ├── binary_sensor.py      ← "Irrigazione in corso" per valve (device assoc + live run state)
│       ├── sensor.py             ← per-valve irrigation-history + water-total sensors
│       ├── history.py            ← IrrigationRunLog: switch-observer run log (Store-backed)
│       ├── device_action.py      ← device-builder actions (irrigate by liters / duration)
│       ├── manifest.json
│       ├── services.yaml
│       ├── strings.json          ← config-flow + entity UI strings (EN source)
│       ├── translations/         ← per-language overrides (en, it)
│       └── www/
│           └── tuya-cards.js     ← built bundle (copied by build.sh — DO NOT edit)
├── docs/
│   └── PLAN-integration-v2.md    ← architectural plan for v2.0
├── src/                          ← card sources, one file per card (+ shared panels)
│   ├── irrigation-control-card.js
│   ├── sensor-trend-panel.js     ← NOT a card: <sensor-trend-panel> element (day/week/month trend chart)
│   ├── signal-quality.js         ← NOT a card: shared Zigbee signal icon helpers (sq* functions) for both card headers
│   └── soil-moisture-card.js
├── tests/
│   ├── sensor-trend-panel.test.js ← pure-logic tests (node:vm, no framework)
│   └── signal-quality.test.js    ← thresholds + entity resolution of the signal icon
├── tuya-cards.js                 ← built bundle at repo root (DO NOT edit)
├── build.sh                      ← concatenates src/*.js → tuya-cards.js + copies into integration www/
├── hacs.json                     ← HACS manifest (integration type detected automatically)
├── README.md
├── LICENSE                       ← MIT
└── CLAUDE.md
```

## Build

```bash
bash build.sh
```

No dependencies. The script concatenates a header + all `src/*.js` files into `tuya-cards.js`, then copies the result into `custom_components/tuya_irrigation/www/` so the integration can serve it. Always run after modifying card sources.

## Versioning

The integration version lives in **two** places that must stay in sync: `manifest.json` (`version`) and `const.py` (`VERSION`, used for the `?v=` query string of the Lovelace resource and the startup log line). The README "What's included" table tracks the integration and each card's version (card versions are also in each card's header comment and `console.info` banner).

## Integration lifecycle

Config-flow-only, singleton entry. Enabled from Settings → Devices & Services → Add Integration → "Tuya Irrigation" (one click, no inputs). No `configuration.yaml` entry.

- `async_setup_entry(hass, entry)` in `__init__.py` creates the per-switch task registry, sets up the run-log manager (`IrrigationRunLog`) **before** forwarding the `binary_sensor` + `sensor` platforms (so its entities find a populated log on add), registers the static path `/tuya_irrigation`, defers Lovelace resource registration via `async_when_setup("lovelace", …)`, and registers the two services.
- `async_unload_entry(hass, entry)` cancels running tasks, removes services, and clears `hass.data[DOMAIN]`. Static path and Lovelace resource persist for the lifetime of the HA process (HA exposes no clean way to undo them).
- The config flow in `config_flow.py` calls `async_set_unique_id(DOMAIN) + _abort_if_unique_id_configured()` so only one entry can exist.

## Integration services

Registered in `_async_register_services` (called from `async_setup_entry`):

- `tuya_irrigation.irrigation_by_seconds(switch_entity, seconds)` — turn on, `asyncio.sleep(seconds)`, turn off. Cancellation-safe via per-switch task registry.
- `tuya_irrigation.irrigation_by_liters(switch_entity, liters, timeout_seconds?)` — turn on, monitor `sensor.<prefix>_summation_delivered` via `async_track_state_change_event`, turn off when the target volume is delivered. Two safety nets bound a run that never reaches target: a **stall watchdog** (reason `stalled`, closes after ~`LITERS_STALL_WINDOW_S` of no measured flow) and an **adaptive cap** that samples the flow rate over the first `LITERS_SAMPLE_WINDOW_S` and *tightens* the max runtime toward the estimate — bounded above by `timeout_seconds` (the ceiling, default 3600 s) and `LITERS_HARD_GUARD_S` (absolute backstop); `timeout_seconds` is a **maximum**, never extended. An anomalous close (stall / cap) or a failed valve close raises a `persistent_notification`; an **external** close (card stop button, physical button, native auto-off) ends the monitor silently with no alert.

Both services cancel any previously-running task on the same switch. The cancelled task checks `active_tasks[switch] is my_task` in its `finally` before touching the valve, so the cancellation does not disturb the new task.

Both handlers do only their mode-specific validation and then delegate to the single shared **`_async_begin_run(switch_entity, mode, target, run_coro)`** — so all three entry points (card, service call, device action) funnel through the two services, and both services funnel through one start method. `_async_begin_run` runs the start sequence in this exact order: `_cancel_existing` → `managed_switches.add` → `_async_push_run_plan` → `async_create_task(run_coro)` → `_turn_on` (valve opens **last**, after the run-plan DPs are applied, so the device stamps start/end with the target). The device **clock** is not pushed from here: the GiEX quirk in zha-tuya-quirks inserts the Tuya time frame + a 1.5 s settle in front of every valve-open DP, whatever the origin (see [ZHA layer](#zha-layer-zha-tuya-quirks)).

`_async_push_run_plan(hass, switch_entity, mode, target)` (`"Duration"`/seconds for by_seconds, `"Capacity"`/liters for by_liters) writes the device's `select.<prefix>_irrigation_mode` + `number.<prefix>_irrigation_target` via the `select`/`number` services. This is **display-only**: the device echoes the values back and computes `irrigation_end_time = start + target`, which the card reads for its device-truth progress bar. It is best-effort and fully guarded — it never blocks irrigation, and the server-side task still owns closing the valve (the firmware's native auto-off is not trusted). NOTE: this is a runtime entity write, NOT a quirk DP re-map, so it does not hit the "DP already mapped" failure mode.

Every service call also adds the switch entity to `managed_switches: set[str]` in `hass.data[DOMAIN]`. On `EVENT_HOMEASSISTANT_STOP` and on `async_unload_entry`, `_async_close_all_valves` runs a two-pass sweep: (1) cancel active timer tasks so their own `finally: turn_off` runs; (2) explicit `switch.turn_off` for every entity in `managed_switches` that HA still reports as `on`. Pass 2 is the safety net for the case where pass 1's cancellation was cut short or a prior turn-off silently failed. Logs one `Shutdown safety: closing open irrigation valve <entity>` WARNING per valve when it triggers.

## Irrigation history (run log)

`history.py` (`IrrigationRunLog`, created in `async_setup_entry`, stored in `hass.data[DOMAIN]["run_log"]`) is the **system of record** for irrigation runs. It observes each valve switch's state via `async_track_state_change_event` — the one signal common to every run origin (card, automation, bare `switch.turn_on`, physical button, firmware auto-off) — and appends each completed run to a `helpers.storage.Store` JSON (`.storage/tuya_irrigation_history`): atomic, survives restarts, and lives **outside the recorder DB** (no bloat, no purge).

Key mechanics (rationale is in the code comments):
- **off→on opens** a run (idempotent via `in_flight`); a confirmed **off schedules a finalize** after a short grace (`LITERS_SETTLE`) that only defers the final `summation_delivered` read — the real off-transition time is captured up-front in `_off_at`, so duration is never inflated by the grace.
- **Liters** = the service task's precise measured volume when present, else a reset-safe `summation_delivered` delta. **Duration** is server-measured (`end − start`), independent of the device RTC.
- **`_recover_in_flight`** on startup finalizes a run whose close was missed during downtime (reason `shutdown`) unless the switch is confirmed still on.
- A new run **force-finalizes** any still-open prior run and closes the valve first (guaranteeing a clean off→on edge), so runs are never merged and the new run is always recorded (`async_force_finalize` + the pre-open block in `_async_begin_run`).
- **`_set_pending`** enrichment (`mode`/`target`/`source` at open, `reason`/`delivered` before close) is gated on `is_running` so a late write can't resurrect a finalized run's `pending` and mislabel the next one. **`MIN_RUN_S`** discards only sub-threshold *manual* flaps (a deliberate 1 s integration run is always recorded).

`sensor.py` exposes two entities per valve, both merged into the ZHA device (same trick as `binary_sensor.py`):
- `sensor.<prefix>_irrigation_history` — state = last run's end timestamp; the `runs` attribute (last 50, `_unrecorded_attributes` so it's kept out of the recorder) is the card's read surface. `suggested_object_id` gives a deterministic id the card finds by suffix.
- `sensor.<prefix>_irrigation_water_total` — cumulative liters, `total_increasing` / `device_class: water` → HA water dashboard + long-term statistics (the device's own `summation_delivered` resets per session, so the integration keeps this total itself).

Each finalized run also fires the **un-namespaced `irrigation_completed`** event (`switch_entity`, `device_id`, `start`, `end`, `duration_s`, `liters`, `mode`, `target`, `source`, `reason`) so other irrigation integrations can adopt the same schema. Design spec: `docs/superpowers/specs/2026-06-30-irrigation-history-design.md`.

## Card rules

- **No LitElement** — pure HTMLElement with Shadow DOM only.
- **No build tools / npm** — just bash concatenation.
- **Auto-discovery** — each card discovers its entities from a single primary entity via suffix conventions.
- **CSS theming** — use HA CSS variables (`--primary-text-color`, `--card-background-color`, etc.).
- **Panels closed by default** — mobile-first compactness.
- **Labels in Italian by default**, with EN / ZH via `localStorage.selectedLanguage`.
- **Visual editor** — each card must implement `getConfigElement()` showing only compatible devices.
- **Irrigation card calls the integration's services**, never the underlying `number.set_value` + `switch.turn_on` sequence directly. A graceful banner appears if the integration is missing.
- **Switch is the single source of truth** for the running state (badge + play/stop button). The progress bar is **device-derived**, not a client `setInterval` counter: Tempo uses `end_time − start_time`, Liters uses `summation_delivered / target` (the integration writes mode/target so these are populated — see Integration services). A 1 s render tick (`_startTick`) only re-renders; values are recomputed from device state each time, so the bar survives a browser refresh, reflects automation-started runs, and never drifts. The `_startPressedAt` stale-`start_time` guard covers the ~1.5 s open delay; the "Avvio…" overlay (`_beginStarting`, 10 s watchdog) covers it visually.
- **Trend panel (soil-moisture-card)**: tapping a reading column opens `<sensor-trend-panel>` (`src/sensor-trend-panel.js`) under the readings, styled like the energy-statistics panel of `power-switch-card` in `zha-tuya-quirks`. Day = raw `history/history_during_period` line (hourly-mean statistics fallback beyond recorder retention); Week/Month = daily min/max lines + band from `recorder/statistics_during_period` (`period: "day"`, `types: [min,max,mean]`). The panel is a plain element with `setup(hass, entityId, {color, unit, decimals, clamp, keepPeriod})`, a `hass` setter and `refreshIfCurrent()` (called from the card's 60 s tick, self-rate-limited to 15 min). Its SVG is drawn in pixel coordinates (ResizeObserver) so strokes never distort; colours are plain hex because `var()` is not parsed in SVG presentation attributes. **Every top-level identifier in a shared panel is prefixed** (`stp`/`STP_`) because `build.sh` concatenates all of `src/*.js` into one module scope. Spec: `docs/superpowers/specs/2026-09-08-sensor-trend-panel-design.md`.
- **Signal quality icon** (both cards): `src/signal-quality.js` resolves the optional `lqi` / `linkquality` / `rssi` suffixes (ZHA diagnostic entities, disabled by default; Z2M `linkquality`) and renders WiFi-style arcs left of the battery. LQI (0–255) is preferred, RSSI (dBm) is the fallback; 4 levels, level 1 red, level 0 (present but unavailable) all-dim, hidden with the battery when offline, no icon when none of the entities exists. Each card lists the three suffixes in its own `SUFFIXES` table and calls `sqRead` / `sqHtml` at `_createDOM` and `sqApply` in `_update`. The helper holds only **function declarations** (no top-level `const`): it is concatenated *after* `irrigation-control-card.js`, so a `const` would still be in its temporal dead zone when that card builds its suffix table.
- **History list**: the expanded "last irrigation" view nests a second `+` that lists past runs from `sensor.<prefix>_irrigation_history`'s `runs` attribute; level-1 stays live device-DP-driven for in-run monitoring. `history` is a **non-required** suffix, so the card degrades gracefully (second `+` hidden) when the integration hasn't created the sensor. See [Irrigation history (run log)](#irrigation-history-run-log).

## Adding a new card

1. Create `src/<card-name>.js` — self-contained HTMLElement + Shadow DOM.
2. The file must end with `customElements.define(...)` and a `window.customCards.push(...)` (inside a self-invoking function that picks a localized display name from `localStorage.selectedLanguage`).
3. Run `bash build.sh`.
4. Update the "What's included" table in `README.md`.

## ZHA layer (zha-tuya-quirks)

Everything that needs ZHA or zigpy lives in the sibling repo/integration **zha-tuya-quirks** (`~/zha-tuya-quirks`, domain `zha_tuya_quirks`): the GiEX QT06 and HOBEIAN ZG-303Z quirks (moved there on 2026-09-14 with byte-identical quirk code, so entity ids did not change) and one radio helper service. This integration reaches the ZHA layer **only through that service**, via `_async_call_zha_layer(hass, service, switch_entity)` in `__init__.py`:

- `zha_tuya_quirks.keepalive_poll(entity_id)` — cache-bypassing Basic-cluster read; called by `_async_keepalive_poll` from the hourly sweep. The sweep itself (which valves, when, stagger) stays here because it needs discovery + the run log.
- **GiEX clock sync is not a service and is not called from here.** The quirk's `GiexEpoch2000MCUCluster.tuya_mcu_command` override emits the Tuya time frame + 1.5 s settle before every `on_off` = on DP, so a bare `switch.turn_on` from an automation gets a correct RTC too. `_async_begin_run` therefore has no time push and no settle any more.

Rules:
- The call is best-effort: skipped with a debug log when the service is not registered (`hass.services.has_service`), logged at DEBUG and swallowed when it raises (the startup sweep often races a ZHA reload). It must never block or fail irrigation.
- `_async_check_zha_layer` (run at the start of every keep-alive sweep, i.e. at HA start and hourly) raises the repair issue `zha_layer_missing` when a discovered valve `device_is_zha` and the keep-alive service is absent, and deletes it otherwise. Strings live under `issues` in `strings.json` / `translations/*`.
- Never import `homeassistant.components.zha`, `zigpy` or `zhaquirks` here. A new ZHA-only need (e.g. a per-DP "last report" timestamp for the soil card) goes into zha-tuya-quirks as an entity or a service, and this side consumes it by entity suffix / service name with a graceful fallback.
- Constants: `ZHA_LAYER_DOMAIN`, `ZHA_LAYER_KEEPALIVE_SERVICE`, `ZHA_LAYER_ISSUE_ID` in `const.py`.

Design note: `docs/superpowers/specs/2026-09-14-zha-layer-split-design.md`.

## HACS specifics

- No `type` field in `hacs.json` — HACS detects `custom_components/` and classifies the repo as integration.
- Single bundle `tuya-cards.js` served at `/tuya_irrigation/tuya-cards.js` serves all cards.
- Lovelace resource auto-registered when Lovelace is in `storage` mode (default). YAML-mode users must add the resource manually.
- Cards for devices the user doesn't have are simply invisible (auto-discovery).

## Testing

Pure-logic tests for the trend panel (period arithmetic, bucket filling, history parsing, axis ticks) and for the signal icon (thresholds, entity resolution) run without any dependency:

```bash
TZ=Europe/Rome node tests/sensor-trend-panel.test.js
node tests/signal-quality.test.js
```

For a visual check without HA, render the bundle in the Playwright Chromium binary (`~/.cache/ms-playwright/chromium_headless_shell-*/…/chrome-headless-shell --headless --screenshot=… --virtual-time-budget=3000 <url>`) from a small harness page that defines a mock `hass` (`states` + `callWS` returning synthetic history/statistics) and serves it over `python3 -m http.server` (module scripts can't load from `file://`).

Everything else is verified manually on a real HA instance:
- Integration loads without errors (Settings → Devices & Services → Logs).
- With zha-tuya-quirks loaded: the quirk logs `GiEX clock synced before valve open` (debug) at each open and the valve opens ~1.5 s after `switch.turn_on`; `Keep-alive read ok` hourly; the repair issue is absent. With it removed: the repair issue "Tuya ZHA integration missing" appears after the first sweep and irrigation still runs.
- Both services visible in Dev Tools → Services with proper field UI.
- `tuya_irrigation.irrigation_by_seconds` with 5s closes the valve after 5s even on a valve with broken firmware auto-off.
- Lovelace resource auto-registered at `/tuya_irrigation/tuya-cards.js?v=<VERSION>-<hash8>` (hash of the bundle content, so every rebuilt bundle gets a fresh URL and no client cache survives it).
- Cards render correctly in light and dark theme.
- Auto-discovery finds compatible devices in both visual editors.
- Browser-closed test: start a 60s irrigation → close tab → wait 90s → reopen → valve is off.
- Trend panel: tap the temperature column of a soil-moisture-card → panel opens on Day with today's line; Week/Month show min/max bands; `▶` disabled on the current period; tapping the column again closes it; tapping another column switches metric keeping the view.
- Irrigation history: after a run, `sensor.<prefix>_irrigation_history`'s `runs` attribute grows and `sensor.<prefix>_irrigation_water_total` increases; the `irrigation_completed` event fires; both survive an HA restart; the card's nested "+" lists past runs.

## Additional context

Design decisions, entity behavior details, deployment context, and user preferences are documented in the GDrive shared memory folder `AI/Claude/tuya-cards-for-ha/` using this MCP: https://github.com/SimoneAvogadro/mcp-gdrive-fileaccess

The v2.0 architectural plan lives in `docs/PLAN-integration-v2.md`.
