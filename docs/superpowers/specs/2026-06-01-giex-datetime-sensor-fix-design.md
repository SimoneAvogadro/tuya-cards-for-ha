# Design — Fix GiEX irrigation start/end time sensors (datetime)

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Component:** `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`

## Problem

On every Home Assistant startup the two GiEX QT06 sensors
`sensor.tze200_a7sghmms_ts0601_irrigation_start_time` and `_irrigation_end_time`
fail to be added, with:

```
ValueError: Invalid datetime: ... has timestamp device class but provides state
'2026-06-01 13:43:28.247958+04:00':<class 'str'> resulting in
''str' object has no attribute 'tzinfo''
```

At runtime (after a fresh device report) the same sensors hold a valid ISO
datetime (`2026-06-01T10:55:28+00:00`). So the value is correct when freshly
converted, but wrong (a plain string, with a +04:00 offset and microseconds)
when restored at startup.

## Root cause (investigated)

The two DPs come from the **upstream** `gx02_base_quirk` in
`zhaquirks/tuya/tuya_valve.py`, which our integration clones in
`giex_qt06_epoch2000.py` but does **not** redefine. Upstream:

- DP 101 (`irrigation_start_time`) and DP 102 (`irrigation_end_time`) are
  `type=t.CharacterString` (the device sends a wall-clock string `"HH:MM:SS"`),
  `device_class=SensorDeviceClass.TIMESTAMP`, both using
  `converter=lambda x: giex_string_to_dt(x)`.
- `giex_string_to_dt` hardcodes `dev_tz = timezone(timedelta(hours=4))`, builds
  "today at HH:MM:SS" in **+04:00** regardless of the HA locale, and returns a
  tz-aware `datetime` (or `None` for `--:--:--`).

Two independent defects, both inherited unchanged by our clone:

1. **Wrong fixed timezone (+04:00).** Hardcoded in the upstream converter;
   ignores HA's configured zone (user is +02:00). Certain.
2. **Startup `ValueError`.** The device sends `HH:MM:SS` only at runtime; on
   restart HA restores the persisted **ISO string** into the TIMESTAMP sensor.
   The evidence strongly suggests the converter does not re-run on the restored
   value, so a `str` reaches a `datetime`-typed sensor and HA raises. This restore
   path is the residual uncertainty: it cannot be confirmed offline because the
   `zhaquirks` package is not installed on the dev box (only inside the HA
   container).

Our own `giex_qt06_epoch2000.py` is not the cause; it only pins the 2000-epoch
MCU cluster and adds DPs 104/105. See [[giex-datetime-sensor-error]].

## Decisions (locked)

1. **Timezone:** reconstruct the date using **HA's configured timezone**
   (`homeassistant.util.dt.now()`), not the upstream hardcoded +04:00.
2. **Strategy:** implement approach A (override the two DPs in our clone with a
   robust converter). Deploy, **restart HA to test the startup path**, then
   decide. Do not pre-authorize the more invasive fallback.

## Approach A — override DP 101/102 in our clone

In `giex_qt06_epoch2000.py`, add two `.tuya_sensor(...)` definitions for dp_id
101 and 102 to the existing `gx02_base_quirk.clone()...add_to_registry()` chain,
each pointing at a **new local converter** `_giex_time_to_dt`. Because zigpy's
QuirksV2 registry is last-registered-wins and HA loads our quirk after upstream,
redefining these DPs in the clone chain shadows the upstream ones — no fork
needed.

`_giex_time_to_dt(value)` behavior:
- `None`/empty/`"--:--:--"` or any unparseable input → return `None`.
- Input matching `HH:MM:SS` (the normal device report) → take **today's date in
  HA's local timezone** via `dt_util.now()`, replace hour/minute/second with the
  parsed values, return that tz-aware `datetime`.
- Input that is already an ISO/datetime string (the restore case, e.g.
  `"2026-06-01 13:43:28.247958+04:00"` or `"2026-06-01T10:55:28+00:00"`) →
  parse with `dt_util.parse_datetime`; if it succeeds return the `datetime`
  (defensive against the converter running on a restored value).
- Always returns a `datetime` or `None`, never a `str`.

This guarantees correct local-time values and removes the +04:00 bug. Whether it
also silences the startup error depends on whether the converter is in the
restore path — verified empirically in testing (below).

### Out of scope for approach A
We do not change `device_class=timestamp` and do not alter the on/off, metering,
battery, mode, cycles, target, interval, or duration DPs. The 2000-epoch MCU
cluster logic is untouched.

## Files

- **Modify:** `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
  — add the `_giex_time_to_dt` helper and the two overriding `.tuya_sensor`
  entries; add needed imports (`homeassistant.util.dt as dt_util`, `re` or
  `datetime` as appropriate, `zhaquirks` sensor/device-class symbols matching the
  upstream chain). Update the module docstring to note the start/end time override.
- **Modify:** `custom_components/tuya_irrigation/manifest.json` and
  `const.py` — version bump (2.4.1 → **2.4.2**, a bugfix).
- **Modify:** `README.md` "Bundled ZHA quirks" table — note the quirk now also
  corrects the start/end time timezone + restore handling.
- **Unchanged:** services, device actions, binary_sensor, cards, other quirks.

## Fallback (only if A leaves the startup error)

If after deploy + HA restart the `ValueError` still appears, return for a focused
follow-up (approach B2): make the restored value tolerant — e.g. coerce in the
sensor's value path, or drop the `timestamp` device_class as a last resort
(B1, loses "N minutes ago" semantics). Not implemented now.

## Testing (manual, real HA — no automated tests in repo)

1. **Static:** `python3 -m py_compile` of the quirk file → OK.
2. **Deploy:** push, install on HA (manual copy or HACS once tagged), and
   **Settings → Devices → "Irrigatore 31" → Reconfigure** so the new quirk DP
   definitions take effect.
3. **Timezone fix (primary):** trigger an irrigation; confirm
   `irrigation_start_time` / `_end_time` show the correct **local** time
   (matching +02:00 wall clock), not shifted by +04:00. Verify via HA MCP
   `ha_get_state`.
4. **Startup fix (the open question):** **restart HA** and check
   Settings → System → Logs (or `ha_core_logs`) — the
   `Invalid datetime ... irrigation_start_time/end_time` error must be gone and
   both sensors must come up with a valid state (not `unavailable`/error). If the
   error persists, stop and escalate to the fallback.
5. **Card check:** the `irrigation-control-card` "ultima irrigazione" /
   start-time display renders a sensible local timestamp.
6. **Regression:** the v2.4.1 by-liters behavior and the MCU 2000-epoch fix are
   unaffected (no battery-drain regression; valve still closes at target).
