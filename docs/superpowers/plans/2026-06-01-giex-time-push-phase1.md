# GiEX proactive time push — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push the current time to the GiEX QT06 valve once, at ZHA device configure time, by overriding `bind()` on the existing `GiexEpoch2000MCUCluster`, to test whether a proactive push corrects the device's drifting RTC.

**Architecture:** Add an async `bind()` override to the quirk's `TuyaMCUCluster` subclass that calls `super().bind()` then invokes the upstream `handle_set_time_request(0)` (which ignores its payload arg and emits command 0x24 with the current UTC+local time using this class's 2000 epoch). The push is fully guarded so it can never disturb binding or break the integration.

**Tech Stack:** Python, zigpy QuirksV2 / `zhaquirks.tuya.mcu.TuyaMCUCluster`. No automated tests in this repo (per CLAUDE.md) — verification is `python3 -m py_compile` plus live checks on Home Assistant via the HA MCP after deploy + restart + device Reconfigure.

---

## Project reality / conventions

- File: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`. It defines
  `class GiexEpoch2000MCUCluster(TuyaMCUCluster)` (lines ~111–116) with
  `set_time_offset` / `set_time_local_offset` set to the 2000 epoch. Below it,
  `_GIEX_12HRS_AS_SEC` and the `gx02_base_quirk.clone()...add_to_registry()` chain.
- The class currently has only the two class attributes and no methods.
- Upstream `TuyaMCUCluster.handle_set_time_request(payload)` (in
  `zhaquirks/tuya/mcu/__init__.py`) ignores `payload` except for a debug log, builds a
  `TuyaTimePayload` from current time minus `set_time_offset`/`set_time_local_offset`,
  and sends command `0x24` via `create_catching_task(super().command(...))`. It is a
  **sync** method that schedules its own task — safe to call without await.
- `zhaquirks` is NOT importable on this dev box; `py_compile` only checks syntax.
  Full import resolution and behavior are verified on HA.
- HARD lesson (v2.4.2): this MCU-cluster area broke the whole integration once. Keep the
  change additive and guarded; first live check after deploy is "integration loads".

## File Structure

Single behavioral change: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
— add a `bind()` override to `GiexEpoch2000MCUCluster` + a docstring note. Plus version
bump (`const.py`, `manifest.json`) and a README quirk-table note.

---

## Task 1: Add the guarded `bind()` time push

**Files:**
- Modify: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`

- [ ] **Step 1: Add the `bind()` override to the class**

Replace this exact block (lines ~111–116):

```python
class GiexEpoch2000MCUCluster(TuyaMCUCluster):
    """TuyaMCUCluster that answers MCU set_time using the 2000-01-01 epoch
    that the GiEX QT06 firmware family expects, instead of 1970-01-01."""

    set_time_offset = _TUYA_EPOCH_UTC
    set_time_local_offset = _TUYA_EPOCH_LOCAL
```

with:

```python
class GiexEpoch2000MCUCluster(TuyaMCUCluster):
    """TuyaMCUCluster that answers MCU set_time using the 2000-01-01 epoch
    that the GiEX QT06 firmware family expects, instead of 1970-01-01.

    It also pushes the time PROACTIVELY at bind (device configure / join /
    Reconfigure). The GiEX RTC drifts badly and this firmware never sends a
    time-sync request on its own, so the request-driven upstream response never
    fires. `handle_set_time_request` ignores its payload argument (debug log
    only) and emits command 0x24 with the current UTC+local time using the
    2000-epoch offsets above, so we can invoke it unsolicited.
    """

    set_time_offset = _TUYA_EPOCH_UTC
    set_time_local_offset = _TUYA_EPOCH_LOCAL

    async def bind(self):
        """Bind as usual, then proactively push the current time to the device."""
        result = await super().bind()
        # Guarded: a push failure must never disturb binding or break the
        # integration (cf. the v2.4.2 MCU-cluster incident). handle_set_time_request
        # is sync and schedules its own send task, so it is not awaited.
        try:
            self.handle_set_time_request(0)
            self.debug("GiEX proactive time push sent on bind")
        except Exception as err:  # pragma: no cover - defensive
            self.debug("GiEX proactive time push on bind failed: %s", err)
        return result
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Confirm the clone chain is untouched (no DP changes)**

Run: `grep -c "tuya_sensor\|tuya_number" custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
Expected: `2` (the two existing `.tuya_number` calls for dp 104/105; no `tuya_sensor` re-map).

- [ ] **Step 4: Commit**

```bash
git add custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py
git commit -m "tuya_irrigation: proactively push time to GiEX valve on bind"
```

---

## Task 2: Version bump

**Files:**
- Modify: `custom_components/tuya_irrigation/const.py`
- Modify: `custom_components/tuya_irrigation/manifest.json`

- [ ] **Step 1: Bump const.py**

In `custom_components/tuya_irrigation/const.py`, replace:
```python
VERSION = "2.4.4"
```
with:
```python
VERSION = "2.4.5"
```

- [ ] **Step 2: Bump manifest.json**

In `custom_components/tuya_irrigation/manifest.json`, replace:
```json
  "version": "2.4.4",
```
with:
```json
  "version": "2.4.5",
```

- [ ] **Step 3: Verify manifest is valid JSON**

Run: `python3 -m json.tool custom_components/tuya_irrigation/manifest.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add custom_components/tuya_irrigation/const.py custom_components/tuya_irrigation/manifest.json
git commit -m "tuya_irrigation v2.4.5: proactive GiEX time push (phase 1)"
```

---

## Task 3: README quirk-table note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append to the giex quirk row**

In `README.md`, in the "Bundled ZHA quirks" table, find the row for
`` `giex_qt06_epoch2000.py` `` whose cell currently ends with:

```
and tolerate the value restored at startup. |
```

Replace that ending with:

```
and tolerate the value restored at startup. Additionally pushes the current time to the device on bind (the GiEX RTC drifts and never requests a sync), an experimental fix for its wrong internal clock. |
```

- [ ] **Step 2: Verify the edit landed**

Run: `grep -c "pushes the current time to the device on bind" README.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note proactive GiEX time push in quirks table"
```

---

## Task 4: Live verification on Home Assistant

> No code. Performed after deploying v2.4.5 (manual copy of
> `custom_components/tuya_irrigation/` or HACS once tagged) and restarting HA.
> ZHA debug logging for `zhaquirks.tuya` should still be enabled from the prior
> diagnostic session; if not, enable it via `logger.set_level`.

- [ ] **Step 1: Safety check #1 — integration loads**

Via HA MCP `ha_render_template`: confirm `installed_version` reflects the new build,
the valve `switch` and `binary_sensor.irrigatore_31_irrigating` exist, and via
`ha_core_logs` there is **no** quirk import error and **no** `DP already mapped`.
If the integration is down, STOP and roll back (revert to v2.4.4).

- [ ] **Step 2: Trigger bind via Reconfigure**

In HA UI: Settings → Devices & Services → ZHA → "Irrigatore 31" → ⋮ → **Reconfigure**.

- [ ] **Step 3: Confirm the time push went out**

Via `ha_core_logs` (large tail; save+grep): look for the debug line
`GiEX proactive time push sent on bind`, and/or an outbound cluster `0xEF00`
(cluster_id 61184) command `0x24` packet to the valve carrying a fresh timestamp,
around the Reconfigure time.

- [ ] **Step 4: Decisive measurement**

A few minutes after the push, start a brief irrigation (by time, ~30 s) and read
`sensor.tze200_a7sghmms_ts0601_irrigation_start_time` via `ha_get_state`:
- **If it matches real local time (±seconds)** → hypothesis CONFIRMED. The proactive
  push corrects the RTC. Proceed to design Phase 2 (periodic "infrequent" push).
- **If still ~1h40 off** → either the 2000 epoch is not accepted (Phase 2 candidate:
  try 1970 epoch) or the firmware ignores the push (the z2m "not planned" case —
  accept and stop). Record which in memory.

- [ ] **Step 5: Regression**

Confirm a by-liters run still closes at target and the integration shows no new
errors. The 2000-epoch response behavior is unchanged; we only added a push at bind.

---

## Self-Review notes (already applied)

- **Spec coverage:** one-shot push via `bind()` override → Task 1; guarded so it can't
  break binding/integration → Task 1 Step 1 (try/except + super() first); reuse upstream
  send path with 2000 epoch → Task 1; version bump → Task 2; README note → Task 3;
  live test incl. safety check, push confirmation, decisive measurement, and the
  epoch/"not planned" branch → Task 4. All spec sections mapped.
- **Type/name consistency:** `GiexEpoch2000MCUCluster`, `handle_set_time_request`,
  `set_time_offset`/`set_time_local_offset` match the spec and existing class; version
  `2.4.5` consistent across const + manifest.
- **No placeholders:** every code step contains complete content.
- **Scope:** Phase 1 only (no periodic timer, no new service, no epoch change) — matches
  the approved spec.
