# Design — GiEX proactive time push, Phase 1 (one-shot via bind())

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Component:** `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`

## Problem

The GiEX QT06 valve (`_TZE200_a7sghmms`, TS0601) has a poor internal RTC that
runs ~1h40 ahead. It reports `irrigation_start_time` / `irrigation_end_time` as
its own wall-clock string (live logs: device sent literal `"22:05:20"` when real
local time was `20:25`). The clock itself is wrong; we report it faithfully.

Confirmed from live ZHA debug logs: the device **never** sends a time-sync
request — not during normal use, not during a full Reconfigure/interview. The
standard Tuya mechanism (`TuyaMCUCluster.handle_set_time_request`, command 0x24
on cluster 0xEF00) is request-driven and only fires when the device asks. Our
quirk already pins the 2000 epoch but it is never exercised because the device
never requests time.

## Feasibility (researched)

CONFIRMED: proactive time push is possible and precedented.
- Upstream `handle_set_time_request(payload)` ignores the incoming `payload`
  except for a debug log; it builds the response from the current time and sends
  command `0x24` (`TUYA_SET_TIME`) as an ordinary outbound cluster command
  (`super().command(TUYA_SET_TIME, payload_rsp, expect_reply=False)`). It can
  therefore be invoked unsolicited.
- zigbee2mqtt does exactly this for GiEX valves via `onEventSetLocalTime`,
  pushing time hourly ("due to very poor clock").

Two honest caveats carried into this design:
1. **Epoch is unsettled.** Our quirk pins 2000; z2m's *working* periodic push
   uses 1970. Pushing 2000-based time may or may not move this device's clock.
2. **May not fix the start/end-time strings.** z2m issue #22848 (identical
   symptom) was closed "not planned"; those strings are device-reported. IF a
   push corrects the RTC, future strings *should* become correct — but this is
   the open empirical question Phase 1 exists to answer.

## Scope decision

Phase 1 = **one-shot push only**, to test the hypothesis cheaply before building
a periodic mechanism. Trigger = override `bind()` in the existing
`GiexEpoch2000MCUCluster` (user-chosen over a dedicated service or integration
startup push). `bind()` runs at ZHA device configure (join / Reconfigure), so
re-testing requires a device Reconfigure each time — accepted.

Out of scope for Phase 1: periodic timer, new HA service, epoch change. Those are
Phase 2, contingent on Phase 1 results.

## Design

In `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`, add an
async `bind()` override to `GiexEpoch2000MCUCluster`:

```python
async def bind(self):
    result = await super().bind()
    # The GiEX RTC drifts and the device never requests a time sync, so push it
    # proactively. handle_set_time_request ignores its payload arg (debug log
    # only) and emits command 0x24 with the current UTC+local time using this
    # class's 2000-epoch offsets. Guarded so a push failure never disturbs bind.
    try:
        self.handle_set_time_request(0)
    except Exception as err:  # pragma: no cover - defensive
        self.debug("GiEX proactive time push on bind failed: %s", err)
    return result
```

Key properties:
- Calls `super().bind()` first and returns its result unchanged — normal binding
  is never disturbed.
- The push is fully wrapped in try/except; any failure is logged at debug and
  swallowed. Consistent with the project rule "never break the integration"
  (learned from the 2.4.2 incident in the same MCU-cluster area).
- Reuses the existing, confirmed upstream send path; no new payload construction.
- Uses the 2000-epoch offsets already set on this class
  (`set_time_offset` / `set_time_local_offset`).

No other DPs, sensors, or the start/end-time converter (v2.4.4) are touched.

## Files

- **Modify:** `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
  — add the `bind()` override and a docstring note.
- **Modify:** `custom_components/tuya_irrigation/const.py` and `manifest.json`
  — version bump 2.4.4 → **2.4.5**.
- **Modify:** `README.md` "Bundled ZHA quirks" — note the proactive time push.
- **Unchanged:** services, device actions, binary_sensor, cards, other quirks.

## Risks

- Touches the TuyaMCUCluster subclass — the same delicate area that broke the
  integration in 2.4.2. Mitigation: change is additive (an override that calls
  super first), guarded, and the very first live check after deploy is
  "integration loads, no quirk import error".
- `handle_set_time_request` is a sync method that schedules a task internally
  (`create_catching_task`); calling it from within async `bind()` is fine (it
  does not need awaiting). If upstream renames it, the try/except keeps bind
  working (push silently no-ops).

## Testing (manual, real HA — no automated tests in repo)

1. **Static:** `python3 -m py_compile` of the quirk → OK.
2. **Deploy + restart HA.** CHECK #1 (safety): integration loads, no
   `DP already mapped` / no quirk import error, services + device actions present.
3. **Reconfigure** the valve device (triggers `bind()` → time push). With ZHA
   debug logging on, confirm an outbound command `0x24` on cluster `0xEF00`
   carrying a fresh timestamp appears in `ha_core_logs`.
4. **Decisive measurement:** a few minutes later, start a brief irrigation and
   read `sensor.tze200_a7sghmms_ts0601_irrigation_start_time`:
   - If it now matches real local time (±seconds) → hypothesis CONFIRMED →
     proceed to Phase 2 (periodic "infrequent" push).
   - If still ~1h40 off → epoch 2000 insufficient (try 1970 next) or firmware
     ignores the push (the z2m "not planned" case — accept and stop).
5. **Regression:** by-liters still closes at target; no battery-drain change
   (the 2000-epoch MCU behavior is unchanged, just also pushed at bind).
