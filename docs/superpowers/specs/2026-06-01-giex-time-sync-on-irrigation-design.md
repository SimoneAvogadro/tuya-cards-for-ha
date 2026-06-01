# Design — GiEX time sync on irrigation start

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Component:** `custom_components/tuya_irrigation/__init__.py` (+ quirk cleanup)

## Problem

The GiEX QT06 valve (`_TZE200_a7sghmms`) has a drifting RTC (~1h40 ahead) and
never requests a time sync, so its `irrigation_start_time` / `irrigation_end_time`
are wrong. The previous attempt (v2.4.5) to push time via a `bind()` override on
the `TuyaMCUCluster` subclass did NOT work: ZHA does not call `bind()` on the
manufacturer-specific 0xEF00 cluster. Verified live — no push frame ever went
out, and start_time stayed ~1h39 ahead. See [[tuya-mcu-bind-not-called]].

## Approach

Push the time from the integration's own service code, **right before opening the
valve**, in both runners (`_run_seconds` and `_run_liters`). This is a
deterministic, observable, need-based trigger that bypasses the non-firing
`bind()` entirely and corrects the RTC exactly when it matters (just before the
device stamps start_time).

## Decisions (locked)

1. **Both services** push time (seconds and liters), for symmetric correct
   start/end stamps.
2. **~1.5 s delay** between the time push and `turn_on`, so the MCU applies the
   pushed time before stamping start_time (the 0x24 command is fire-and-forget,
   no ack to await).
3. **No version bump, no tag** — per [[no-version-bump-until-tag]]. Commit + push
   only; the user triggers the tag (and the bump rides with it) once verified.
4. **Epoch stays 2000** (single-sourced in the quirk). If the experiment fails,
   the known next lever is trying epoch 1970 — NOT done now.

## Components

### New helper `_async_push_device_time(hass, switch_entity)` in `__init__.py`
- Resolve `switch_entity → ieee`: `entity_registry.async_get(switch_entity)` →
  `.device_id` → `device_registry.async_get(device_id)` → IEEE from
  `device.connections` where `conn[0] == CONNECTION_ZIGBEE` (fallback:
  `identifiers` with domain `"zha"`).
- Get the cluster: `get_zha_gateway(hass)` (from
  `homeassistant.components.zha.helpers`) → `gateway.get_device(EUI64.convert(ieee))`
  → `.device.endpoints[1].in_clusters[0x EF00]`.
- Call `cluster.handle_set_time_request(0)` — reuses the quirk's 2000-epoch
  `set_time_offset`, emits Tuya command 0x24 (sync, schedules its own send).
- **Fully guarded:** all imports are local (ZHA may be absent); any exception →
  log at debug/warning and return. The push is best-effort and must NEVER block
  or fail the irrigation. Endpoint hardcoded to 1 (confirmed for this family).
- Fallback (only if the direct path raises): the public service
  `zha.issue_zigbee_cluster_command` (ieee, endpoint_id=1, cluster_id=0xEF00,
  command=0x24, command_type="server", params={"time": <8-byte payload>},
  manufacturer=-1). Documented in the plan; implemented as the except-branch.

### Quirk cleanup
Remove the dead `bind()` override from `GiexEpoch2000MCUCluster` in
`giex_qt06_epoch2000.py` (it never fires). The class returns to just the two
epoch class-attributes. Keep the docstring note about the 2000 epoch; drop the
bind paragraph.

### Wiring in the two runners
In `_run_seconds` and `_run_liters`, immediately before `await _turn_on(...)`:
```python
await _async_push_device_time(hass, switch_entity)
await asyncio.sleep(1.5)
await _turn_on(switch_entity)
```
This sits inside the already-guarded runner task and does not affect the existing
task-identity cancellation logic.

## Files

- **Modify:** `custom_components/tuya_irrigation/__init__.py` — add
  `_async_push_device_time`; call it + sleep before `_turn_on` in both runners.
- **Modify:** `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py` —
  remove the dead `bind()` override.
- **Modify:** `README.md` "Bundled ZHA quirks" — replace the "pushes on bind" note
  with "syncs the device clock at the start of each irrigation".
- **Unchanged:** `const.py` / `manifest.json` version (no bump now), services'
  open/wait/close logic, by-liters fix, datetime converter, cards, other quirks.

## Risks

- **ZHA internals fragility** (`gateway.get_device(...).device.endpoints[...]`):
  mitigated by try/except + the public-service fallback; worst case the push
  silently no-ops and the valve still opens.
- **1.5 s delay** before open: trivial; push never blocks the open.
- **MCU-cluster area** (cf. v2.4.2 breakage): the new logic lives in `__init__.py`,
  not the quirk; the quirk is only *simplified* (bind removed). First live check
  after deploy is "integration loads".
- **Epoch may be wrong (2000 vs 1970):** acknowledged; verification step decides.

## Testing (manual, real HA — no automated tests in repo)

1. **Static:** `python3 -m py_compile` of both modified files → OK.
2. **Deploy + restart HA.** CHECK #1: integration loads, services + device actions
   present, no quirk import error. If down → roll back.
3. **Start a brief by-time irrigation** (~30 s) — no Reconfigure needed.
4. Via `ha_core_logs` (debug on): confirm the time push went out — an outbound
   cluster 0xEF00 command 0x24 to the valve around the irrigation start, and/or
   no exception from `_async_push_device_time`.
5. **Decisive measurement:** read
   `sensor.tze200_a7sghmms_ts0601_irrigation_start_time`:
   - matches real local time (±seconds) → hypothesis CONFIRMED; the clock is now
     corrected on every irrigation. Tell the user; they decide on tagging.
   - still ~1h40 off → next lever is epoch 1970, or accept the z2m "not planned"
     reality. Record the outcome in memory.
6. **Regression:** by-liters still closes at target; the ~1.5 s delay aside, open/
   close timing unaffected; no new errors.
