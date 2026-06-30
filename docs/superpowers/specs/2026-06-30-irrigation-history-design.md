# Irrigation history — design spec

**Date:** 2026-06-30
**Status:** Approved design (pre-implementation)
**Target version:** v2.6.0 (new feature → minor bump, tagged when the user says so)

## Goal

Keep a **reliable, persistent history of irrigation runs** (duration + liters) for each
valve, surviving HA restarts and the device dropping its DPs, and surface it in the card
**plus** feed HA's native water dashboard with aggregate consumption over time.

Two user-facing deliverables:

1. **Per-run history list** — a rolling window of recent runs (when / duration / liters /
   outcome), shown in the card behind a *second*, nested `+` expansion.
2. **Aggregate water consumption** — a cumulative `total_increasing` water sensor that
   plugs into HA's water/energy dashboard and long-term statistics (LTS), for free.

Recording covers **every** run, not only integration-driven ones: card, automations
calling the services, device actions, a bare `switch.turn_on`, the physical button, and
the firmware's own auto-off.

## Non-goals (explicitly out of scope)

- No in-card chart / mini-graph and no in-card aggregate summary — trends live in HA's
  native water dashboard (user choice).
- No paginated long-term archive browser in the card (the list is a rolling window).
- No replacement of the current "last/current irrigation" expanded view — it stays as-is
  for **live monitoring** of an in-progress run.

## Why this shape (rationale)

Today the card derives "last irrigation" from the device's **live DPs** (`start_time`,
`end_time`, `summation_delivered`, `last_irrigation_duration`). Those are device-truth:
ephemeral, RTC-based (drift), and gone after a restart or when the valve stops reporting.
For a *reliable* history the system of record must live **server-side in the integration**,
not on the device.

- **Events alone** (HA bus / logbook): great as a complementary signal, but weak as the
  archive — historical events aren't cleanly queryable by a card and the recorder purges
  them (default 10 days). → kept as a bonus hook, not the store.
- **State attributes alone**: ideal as the card's read surface (the card is already
  attribute-driven), but HA discourages large attributes in the recorder → must be capped
  and recorder-excluded.
- **`helpers.storage.Store`**: atomic, versioned, survives restart, lives outside the
  recorder DB (no bloat, no purge). → **system of record.**

Decision: **Store = archive; a dedicated sensor's `runs` attribute = card's read surface;
a `total_increasing` water sensor = HA dashboard; an event = automation hook.**

## Architecture

Recording hangs off the **valve switch entity's state**, the one signal common to *all*
run origins — not off the service tasks. The services still own *closing* the valve
(server-side timer) and only provide enrichment (mode/target/outcome/source) that the
observer reads when a run was integration-started.

```
   valve switch state change (any origin)
                 │
                 ▼
   RunLog manager  (new: history.py)
   • subscribes to async_track_state_change_event for every discovered valve switch
   • off→on : open a run (stamp start, snapshot summation baseline, persist in_flight)
   • on→off : finalize run → build record → append to Store (capped) → bump water_total
              → dispatch history_signal(switch) → fire tuya_irrigation_irrigation_completed
                 │ history_signal(switch)
        ┌────────┴─────────┐
        ▼                  ▼
 sensor._irrigation_history   sensor._irrigation_water_total
 state = last run end (ts)    state = cumulative liters
 attributes.runs = [last 50]  state_class=total_increasing, device_class=water (L)
 (runs recorder-excluded)     → HA water dashboard + LTS
        │
        ▼
 card reads attributes.runs → level-2 "+" list
```

Single recording path ⇒ no double counting; manual/direct runs land in history exactly
like integration runs.

### Component responsibilities

- **`history.py` — `IrrigationRunLog` manager** (one instance, created in
  `async_setup_entry`, stored in `hass.data[DOMAIN]["run_log"]`):
  - Owns the `Store` (load on setup, save on each append, debounced).
  - Discovers valve switches via existing `discovery.find_valve_devices` +
    `valve_switch_for_device`; (re)subscribes on `EVENT_ENTITY_REGISTRY_UPDATED`
    (same refresh pattern as `binary_sensor.py`).
  - Tracks per-switch in-flight state; finalizes records; updates `water_total_l`;
    dispatches `history_signal`; fires the completion event.
  - Exposes read accessors for the sensors: `runs_for(switch)`, `last_run(switch)`,
    `water_total(switch)`.
- **`sensor.py` — new platform** with two entities per valve, attached to the device via
  `DeviceInfo(identifiers=…, connections=…)` (same merge trick as `binary_sensor.py`):
  - `IrrigationHistorySensor`
  - `IrrigationWaterTotalSensor`
  - Both subscribe to `history_signal(switch)` and pull fresh data from the manager.
- **`__init__.py`** — instantiate the manager; add `Platform.SENSOR` to `PLATFORMS`;
  service tasks stash enrichment (see below); fire nothing themselves (manager fires the
  event).
- **`const.py`** — add `history_signal(switch)`, event name, suffix/key constants, caps.

### Service-task enrichment (so integration runs get rich metadata)

`_async_begin_run` already pushes the run plan (mode/target) to the device DPs. It will
additionally stash a small **transient** dict in `hass.data[DOMAIN]["pending"][switch]` =
`{mode, target, source: "integration"}` at start (before the switch turns on). On the
off→on transition the observer folds `pending` into the **persisted** `in_flight` snapshot
it writes to the Store, then leaves `pending` in place for the run task to update. Before
`_turn_off`, the run task sets `reason` in `pending` (`completed` / `timeout` / `stopped` /
`shutdown`) and, for liters runs, the precise measured `delivered`. The observer reads and
clears `pending` on finalize; absence of `pending` ⇒ `source: "manual"`,
`reason: "auto_off"`/`"manual_off"`, liters from summation delta. (`pending` is the
transient hand-off; `in_flight` is its durable, restart-surviving copy.)

## Data model — Store `.storage/tuya_irrigation_history`

```jsonc
{
  "version": 1,
  "valves": {
    "switch.giardino_valvola": {
      "water_total_l": 1234.5,        // OUR cumulative counter (device summation resets per session)
      "in_flight": {                  // present only while a run is open; survives a restart
        "start": "2026-06-30T07:00:00+00:00",
        "summation_base": 42.0,
        "source": "integration"|"manual",
        "mode": "Duration"|"Capacity"|null,
        "target": 300|12|null
      },
      "runs": [                        // newest first, capped (RUNS_STORE_CAP = 200)
        {
          "start":     "2026-06-30T07:00:00+00:00",   // ISO 8601 UTC
          "end":       "2026-06-30T07:05:00+00:00",
          "duration_s": 300,           // end - start, wall-clock (no device RTC)
          "liters":     12.4,          // summation delta (reset-safe), or task's precise value
          "mode":       "Duration"|"Capacity"|null,
          "target":     300|12|null,
          "source":     "integration"|"manual",
          "reason":     "completed"|"stopped"|"timeout"|"shutdown"|"auto_off"|"manual_off"
        }
      ]
    }
  }
}
```

- **Caps:** `RUNS_STORE_CAP = 200` per valve in the Store; the history sensor exposes
  `RUNS_ATTR_CAP = 50` in `attributes.runs`.
- `water_total_l` is re-hydrated from the Store on startup (authoritative); `RestoreEntity`
  is a secondary fallback only.

## New entities

| entity_id | state | key attributes | classes |
|---|---|---|---|
| `sensor.<prefix>_irrigation_history` | last run `end` (timestamp) | `runs` (last 50, newest first), `run_count` | `device_class=timestamp`; `_unrecorded_attributes=frozenset({"runs"})` |
| `sensor.<prefix>_irrigation_water_total` | cumulative liters | — | `device_class=water`, `state_class=total_increasing`, `unit=L` |

- `<prefix>` = the valve switch's object_id (e.g. `switch.giardino_valvola` → `giardino_valvola`).
  Set `suggested_object_id = f"{prefix}_irrigation_history"` / `_irrigation_water_total`
  so the entity_id is deterministic and the card's existing suffix-convention finds it.
  (Fallback if naming proves fragile: card looks the sensor up via the switch's `device_id`
  in `hass.entities`.)
- `has_entity_name = True`, `translation_key`s `irrigation_history` / `irrigation_water_total`
  with en/it/zh translations.

## Measurement & edge cases (observer)

- **Duration:** `end − start` from confirmed off→on / on→off transitions. Robust; no RTC.
- **Liters:** delta of `summation_delivered`, with per-session reset handling identical to
  `_run_liters` (a decrease ⇒ counter reset, add the new value). For integration runs the
  task's precise accumulated `delivered` is used when present.
- **Grace read after off:** wait `LITERS_SETTLE ≈ 2.5 s` after the switch reports `off`
  before reading the final summation, because the device often pushes the last increment
  shortly *after* closing. Finalize liters after the grace read.
- **Run spanning an HA restart:** `in_flight` persisted at open; on startup the manager
  reloads it; the eventual `off` finalizes the record with the real `start`. If the valve
  is already `off` at startup with a stale `in_flight` (we missed the close during
  downtime), finalize best-effort with `reason="shutdown"` and `end` unknown→ now, or drop
  it — **decide in implementation, default: finalize with `end=startup_time`,
  `reason="shutdown"`**.
- **Zigbee dropout:** only a *confirmed* `off` ends a run; `unavailable`/`unknown` are
  ignored (run continues). An `on` arriving from `unavailable` does not start a second run
  if one is already open.
- **Debounce:** ignore sub-second on→off→on flaps below a small `MIN_RUN_S` (e.g. 2 s) to
  avoid spurious zero-length records from toggling.
- **source / reason:** from the pending enrichment dict when present, else
  `manual`/`auto_off`.

## Event

`tuya_irrigation_irrigation_completed` fired by the manager on each finalized run:

```jsonc
{
  "switch_entity": "switch.giardino_valvola",
  "device_id": "…",
  "start": "…", "end": "…",
  "duration_s": 300, "liters": 12.4,
  "mode": "Duration", "target": 300,
  "source": "integration", "reason": "completed"
}
```

Visible in the logbook; enables automations ("notify when irrigation done").

## Card changes (`src/irrigation-control-card.js`)

Two-level expansion — **the current behavior is preserved**:

- **Level 0 (compact):** "Ultima irrigazione" one-liner + `+` — unchanged.
- **Level 1 (first `+`, `_histExpanded`):** the existing detailed view of the
  **last/current** irrigation (live volume, duration, start/end) — unchanged, still
  device-DP-derived so it updates live during a run. A **new nested `+` button** is added
  at the bottom of this view.
- **Level 2 (second `+`, new `_histListExpanded`):** a scrollable list of completed runs
  read from `sensor.<prefix>_irrigation_history` `attributes.runs`. Each row: smart date
  (reuse `_smartDate`) · duration (`_fd`) · liters (`_fmtVolShortNum`) · outcome icon.

Separation: level 1 = live/last run (device truth); level 2 = completed history (our
Store). No regression to the live-monitoring view.

Discovery: add `history: { domain: "sensor", suffix: "_irrigation_history" }` to
`SUFFIXES`, but **not** to `REQUIRED` — if the (updated) integration isn't present the
second `+` simply doesn't appear (graceful degradation). The card does not need
`water_total` (that's for HA's dashboard).

i18n: add keys for the history list (e.g. `history`, `noHistory`, outcome labels
`completed`/`stopped`/`timeout`/`auto`/`manual`) in it/en/zh; labels baked at first render
(per the no-live-language-switch convention).

Run `bash build.sh` after editing the card source.

## Files

**New**
- `custom_components/tuya_irrigation/history.py` — `IrrigationRunLog` manager + Store.
- `custom_components/tuya_irrigation/sensor.py` — the two sensor entities.

**Changed**
- `custom_components/tuya_irrigation/__init__.py` — create manager, add `Platform.SENSOR`,
  stash service enrichment.
- `custom_components/tuya_irrigation/const.py` — `history_signal`, event name, suffix/key
  constants, caps, settle constants.
- `custom_components/tuya_irrigation/translations/*.json` + `strings.json` — entity names.
- `src/irrigation-control-card.js` — two-level expansion + history list + i18n.
- `tuya-cards.js` + `custom_components/tuya_irrigation/www/tuya-cards.js` — via `build.sh`.
- `README.md` — document the history feature, the two new sensors, and the event.
- `const.py`/`manifest.json` version → `2.6.0` (when the user says to tag).

## Testing / verification (manual — no automated tests in this project)

- Integration loads; two new sensors appear on each valve device.
- Run via card (seconds + liters), via `switch.turn_on` directly, and via the physical
  button → each produces exactly one history record with correct duration/liters/source/reason.
- `attributes.runs` populates; card level-2 list shows them; survives a browser refresh.
- `sensor.<prefix>_irrigation_water_total` increases by the delivered liters; appears in
  HA's water dashboard / LTS.
- Restart HA mid-run → run still finalized after restart with the real start; history and
  water_total persist across restart.
- `tuya_irrigation_irrigation_completed` shows in the logbook with the right payload.
- Recorder DB not bloated: `runs` attribute excluded from the recorder.
- Light/dark theme render OK.

## Open questions / risks

1. **Stale `in_flight` on startup** (valve closed during downtime): finalize with
   `reason="shutdown"` & `end=startup_time`, or discard? Default: finalize.
2. **Entity_id determinism** under user-renamed switches — suffix convention vs device
   lookup. Default: `suggested_object_id`; device-lookup fallback if needed.
3. **Multiple switches per device** — current discovery uses the first switch; history is
   per-switch, consistent with the rest of the integration.
