# GiEX start/end time datetime sensor fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the GiEX QT06 `irrigation_start_time` / `irrigation_end_time` sensors so they use Home Assistant's local timezone (not the upstream hardcoded +04:00) and are robust to the value HA hands back at startup, eliminating the `Invalid datetime ... 'str' object has no attribute 'tzinfo'` error.

**Architecture:** The two DPs (101, 102) come from upstream `gx02_base_quirk`, which our `giex_qt06_epoch2000.py` clones. We override just those two DPs in the existing clone chain (zigpy QuirksV2 is last-registered-wins) with a local converter `_giex_time_to_dt` that builds the datetime in HA's timezone and also accepts an already-formatted datetime/ISO string (the restore case).

**Tech Stack:** Python, zigpy QuirksV2 builder (`zhaquirks`), `homeassistant.util.dt`. No automated tests in this repo (per CLAUDE.md) — verification is `py_compile` plus live checks on Home Assistant via the HA MCP after deploy + device Reconfigure + HA restart.

---

## Project reality / conventions

- File to change: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`. It currently:
  - imports `datetime`, `zigpy.types as t`, `UnitOfTime`, `TuyaMCUCluster`, `gx02_base_quirk`;
  - defines `GiexEpoch2000MCUCluster` and `_GIEX_12HRS_AS_SEC`;
  - builds a chain: `gx02_base_quirk.clone().applies_to(...)×5 .tuya_number(dp 104) .tuya_number(dp 105) .add_to_registry(replacement_cluster=GiexEpoch2000MCUCluster)`.
- Upstream (`zhaquirks/tuya/tuya_valve.py`, `gx02_base_quirk`) defines the two time DPs as:
  ```python
  .tuya_sensor(dp_id=101, attribute_name="irrigation_start_time", type=t.CharacterString,
               converter=lambda x: giex_string_to_dt(x), device_class=SensorDeviceClass.TIMESTAMP,
               translation_key="irrigation_start_time", fallback_name="Irrigation start time")
  .tuya_sensor(dp_id=102, attribute_name="irrigation_end_time", type=t.CharacterString,
               converter=lambda x: giex_string_to_dt(x), device_class=SensorDeviceClass.TIMESTAMP,
               translation_key="irrigation_end_time", fallback_name="Irrigation end time")
  ```
  with `giex_string_to_dt` hardcoding `dev_tz = timezone(timedelta(hours=4))`.
- `zhaquirks` is NOT installed on this dev box (only in the HA container), so we cannot import it here. `py_compile` only checks syntax; full import resolution happens on HA. This is expected and matches how the other quirks are verified.
- Redefining DP 101/102 in our clone chain shadows upstream because HA loads our integration's quirks after upstream zha-device-handlers and QuirksV2 is last-wins for the same `(manufacturer, model)`.

## File Structure

Single file modified: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
- Add imports: `homeassistant.util.dt as dt_util`, and `SensorDeviceClass` from `zigpy.quirks.v2.homeassistant.sensor`.
- Add a module-level converter `_giex_time_to_dt(value)`.
- Add two `.tuya_sensor(...)` overrides (dp 101, dp 102) into the existing chain, before `.add_to_registry(...)`.
- Update the module docstring.

Plus version bump (`const.py`, `manifest.json`) and README quirk-table note.

---

## Task 1: Add the timezone-aware converter and DP overrides

**Files:**
- Modify: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`

- [ ] **Step 1: Add imports**

In the import block (currently lines ~79–85), after `import datetime` add a stdlib `re` import, and after the `from zigpy...` imports add the HA dt util and the SensorDeviceClass import. The block becomes:

```python
from __future__ import annotations

import datetime
import re

import zigpy.types as t
from zigpy.quirks.v2.homeassistant import UnitOfTime
from zigpy.quirks.v2.homeassistant.sensor import SensorDeviceClass

from homeassistant.util import dt as dt_util

from zhaquirks.tuya.mcu import TuyaMCUCluster
from zhaquirks.tuya.tuya_valve import gx02_base_quirk
```

- [ ] **Step 2: Add the converter function**

Immediately after the `_GIEX_12HRS_AS_SEC = 12 * 60 * 60` line (just before the final clone chain that starts with `(` ), add:

```python
# Regex for the device's wall-clock report, e.g. "10:55:28".
_GIEX_HHMMSS_RE = re.compile(r"^\s*(\d{1,2}):(\d{2}):(\d{2})\s*$")


def _giex_time_to_dt(value) -> datetime.datetime | None:
    """Convert the GiEX start/end time DP to a tz-aware datetime.

    The device reports only a wall-clock "HH:MM:SS"; the upstream converter
    fabricates "today at HH:MM:SS" but hardcodes a +04:00 offset that ignores
    the HA timezone. We instead build it in HA's configured local timezone.

    We also accept an already-formatted datetime / ISO string, because at HA
    startup the persisted state value may be handed back as a string rather
    than re-running through this converter. Anything unparseable (including the
    device's initial "--:--:--") returns None.
    """
    if value is None:
        return None
    # Already a datetime (defensive): return as-is.
    if isinstance(value, datetime.datetime):
        return value
    text = str(value).strip()
    if not text or text.startswith("--"):
        return None
    # Normal device report: "HH:MM:SS" -> today (HA local tz) at that time.
    match = _GIEX_HHMMSS_RE.match(text)
    if match:
        hour, minute, second = (int(g) for g in match.groups())
        if hour > 23 or minute > 59 or second > 59:
            return None
        now_local = dt_util.now()
        return now_local.replace(
            hour=hour, minute=minute, second=second, microsecond=0
        )
    # Restore case: an already-formatted datetime/ISO string.
    parsed = dt_util.parse_datetime(text)
    if parsed is not None:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
        return parsed
    return None
```

- [ ] **Step 3: Add the two DP overrides to the clone chain**

In the final chain, insert two `.tuya_sensor(...)` calls **between** the last `.tuya_number(dp_id=105, ...)` call and the `.add_to_registry(...)` call. The end of the chain becomes:

```python
    .tuya_number(
        dp_id=105,
        attribute_name="irrigation_interval",
        type=t.uint32_t,
        min_value=0,
        max_value=_GIEX_12HRS_AS_SEC,
        step=1,
        unit=UnitOfTime.SECONDS,
        translation_key="irrigation_interval",
        fallback_name="Irrigation interval",
    )
    # Override upstream dp 101/102: build the datetime in HA's local timezone
    # (upstream hardcodes +04:00) and tolerate the string handed back on
    # restore so the timestamp sensor doesn't error at startup.
    .tuya_sensor(
        dp_id=101,
        attribute_name="irrigation_start_time",
        type=t.CharacterString,
        converter=lambda x: _giex_time_to_dt(x),
        device_class=SensorDeviceClass.TIMESTAMP,
        translation_key="irrigation_start_time",
        fallback_name="Irrigation start time",
    )
    .tuya_sensor(
        dp_id=102,
        attribute_name="irrigation_end_time",
        type=t.CharacterString,
        converter=lambda x: _giex_time_to_dt(x),
        device_class=SensorDeviceClass.TIMESTAMP,
        translation_key="irrigation_end_time",
        fallback_name="Irrigation end time",
    )
    .add_to_registry(replacement_cluster=GiexEpoch2000MCUCluster)
)
```

- [ ] **Step 4: Update the module docstring**

In the top docstring's "What this file does:" paragraph (around lines 28–34), append a sentence after the existing text describing the MCU cluster work:

Find:
```
  Subclasses `TuyaMCUCluster` with `set_time_offset` / `set_time_local_offset`
  pinned to 2000-01-01, then re-registers the upstream `gx02_base_quirk`
  with our cluster as the replacement. zigpy's QuirksV2 registry uses
  last-registered-wins for the same `(manufacturer, model)` tuple; HA loads
  `custom_quirks_path` after upstream zha-device-handlers, so our entry
  takes precedence.
```
Replace with:
```
  Subclasses `TuyaMCUCluster` with `set_time_offset` / `set_time_local_offset`
  pinned to 2000-01-01, then re-registers the upstream `gx02_base_quirk`
  with our cluster as the replacement. zigpy's QuirksV2 registry uses
  last-registered-wins for the same `(manufacturer, model)` tuple; HA loads
  `custom_quirks_path` after upstream zha-device-handlers, so our entry
  takes precedence.

  It also overrides the `irrigation_start_time` / `irrigation_end_time` DPs
  (101/102): upstream builds these timestamps with a hardcoded +04:00 offset
  and the timestamp sensor errors at HA startup when the persisted value is
  restored as a string. Our `_giex_time_to_dt` builds the datetime in HA's
  local timezone and tolerates an already-formatted string on restore.
```

- [ ] **Step 5: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py && echo OK`
Expected: `OK`
(Note: this only checks syntax; `zhaquirks`/`homeassistant` imports resolve only inside HA.)

- [ ] **Step 6: Commit**

```bash
git add custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py
git commit -m "tuya_irrigation: fix GiEX start/end time tz + restore handling"
```

---

## Task 2: Version bump

**Files:**
- Modify: `custom_components/tuya_irrigation/const.py`
- Modify: `custom_components/tuya_irrigation/manifest.json`

- [ ] **Step 1: Bump const.py**

In `custom_components/tuya_irrigation/const.py`, replace:
```python
VERSION = "2.4.1"
```
with:
```python
VERSION = "2.4.2"
```

- [ ] **Step 2: Bump manifest.json**

In `custom_components/tuya_irrigation/manifest.json`, replace:
```json
  "version": "2.4.1",
```
with:
```json
  "version": "2.4.2",
```

- [ ] **Step 3: Verify manifest is valid JSON**

Run: `python3 -m json.tool custom_components/tuya_irrigation/manifest.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add custom_components/tuya_irrigation/const.py custom_components/tuya_irrigation/manifest.json
git commit -m "tuya_irrigation v2.4.2: GiEX start/end time sensor fix"
```

---

## Task 3: Update README quirk table

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the giex quirk row**

In `README.md`, in the "Bundled ZHA quirks" table, find the row starting with `` | `giex_qt06_epoch2000.py` | `` and replace its "What it fixes" cell text. The current cell text is:

```
Answers the device's `commandMcuSyncTime` with a 2000-01-01 epoch (Tuya epoch) instead of the upstream 1970 default. Without this, the firmware ignores the response and re-fires `MCU_SYNC` aggressively, draining the battery in days and producing flapping `irrigation_end_time` values.
```

Replace that cell text (keep the surrounding `|` table cell delimiters and the first two columns unchanged) with:

```
Answers the device's `commandMcuSyncTime` with a 2000-01-01 epoch (Tuya epoch) instead of the upstream 1970 default. Without this, the firmware ignores the response and re-fires `MCU_SYNC` aggressively, draining the battery in days and producing flapping `irrigation_end_time` values. Also overrides the `irrigation_start_time` / `irrigation_end_time` DPs so they use Home Assistant's local timezone (upstream hardcodes +04:00) and don't throw `Invalid datetime` at startup.
```

- [ ] **Step 2: Verify the edit landed**

Run: `grep -c "use Home Assistant's local timezone" README.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note GiEX start/end time tz fix in quirks table"
```

---

## Task 4: Live verification on Home Assistant

> No code. Performed after deploying v2.4.2 to the running HA instance (manual copy
> of `custom_components/tuya_irrigation/`, or HACS once tagged) AND reconfiguring the
> device so the new DP definitions take effect. Uses HA MCP tools.

- [ ] **Step 1: Deploy + reconfigure**

Deploy the updated integration to HA. Then Settings → Devices & Services → ZHA →
device "Irrigatore 31" → ⋮ → **Reconfigure**. (QuirksV2 DP overrides are applied when
the device's quirk is (re)evaluated; a reconfigure or re-interview is the reliable way.)

- [ ] **Step 2: Timezone correctness**

Trigger an irrigation (any mode). Via HA MCP `ha_get_state` on
`sensor.tze200_a7sghmms_ts0601_irrigation_start_time` and `_irrigation_end_time`:
expect a valid ISO datetime whose wall-clock matches local time (CEST/+02:00), i.e. the
hour is NOT shifted by +04:00 vs the real start time. Confirm `device_class: timestamp`
still present.

- [ ] **Step 3: Startup error gone (the key check)**

Restart Home Assistant. Then via HA MCP `ha_core_logs` (lines 400) grep mentally for
`irrigation_start_time` / `irrigation_end_time` + `Invalid datetime`:
- Expected: **no** such error, and both sensors come up with a valid state (not stuck
  `unavailable` due to add failure).
- If the error STILL appears: stop. The converter is bypassed on the restore path;
  escalate to the fallback (drop `timestamp` device_class, or coerce in the value path)
  per the spec's Fallback section.

- [ ] **Step 4: Card check**

Open the `irrigation-control-card` for the valve: the "ultima irrigazione" / start-time
area should render a sensible local timestamp.

- [ ] **Step 5: Regression**

Confirm v2.4.1 by-liters still closes at target and no new battery-drain behavior
(the 2000-epoch MCU cluster is unchanged). A quick 3 L by-liters run closing at ~3 L is
sufficient.

---

## Self-Review notes (already applied)

- **Spec coverage:** HA-timezone reconstruction → Task 1 Step 2 (`dt_util.now()`);
  dual-format converter (HH:MM:SS + restored ISO/datetime) → Task 1 Step 2; DP 101/102
  override via last-wins clone chain → Task 1 Step 3; version bump → Task 2; README
  quirk-table note → Task 3; live test incl. the startup-error open question + fallback
  trigger → Task 4. All spec sections mapped.
- **Type/name consistency:** `_giex_time_to_dt` defined in Task 1 Step 2 and referenced
  in Step 3; `dt_util`, `SensorDeviceClass`, `re` imported in Step 1 and all used in
  Step 2/3; version string `2.4.2` consistent across const + manifest.
- **No placeholders:** every code step contains complete content.
- **Known limitation (stated, not a gap):** whether Step 3 silences the startup error
  depends on the restore path inside `zhaquirks`, which cannot be confirmed offline;
  Task 4 Step 3 verifies it empirically and routes to the spec fallback if needed.
