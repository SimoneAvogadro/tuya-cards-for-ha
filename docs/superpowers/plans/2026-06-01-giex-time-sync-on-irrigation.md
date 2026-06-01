# GiEX time sync on irrigation start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before opening the valve in both irrigation services, push the current time to the GiEX device so it stamps `irrigation_start_time`/`end_time` with a corrected clock — replacing the non-firing `bind()` approach.

**Architecture:** A guarded helper `_async_push_device_time(hass, switch_entity)` in `__init__.py` resolves the switch → IEEE → zigpy 0xEF00 cluster via the ZHA gateway and calls `handle_set_time_request(0)` (reusing the quirk's 2000 epoch). Both handlers call it + a ~1.5 s settle delay just before opening the valve. The dead `bind()` override is removed from the quirk.

**Tech Stack:** Python, Home Assistant `zha` integration (`get_zha_gateway`), zigpy. No automated tests in this repo — verify with `py_compile` + live checks via HA MCP.

**IMPORTANT — no version bump / no tag** (per user instruction: do not bump VERSION or tag until the user says so). Leave `const.py`/`manifest.json` version unchanged. Commit + push code only.

---

## Project reality

- `__init__.py` `_async_register_services` defines closures: `_turn_on` (267–270), `_run_seconds` (286+), `_run_liters` (~306+), `_handle_seconds` (381–400), `_handle_liters` (402–431). Both handlers end with:
  ```python
      _cancel_existing(switch_entity)
      managed_switches.add(switch_entity)
      task = hass.async_create_task(_run_<...>(...))
      active_tasks[switch_entity] = task
      await _turn_on(switch_entity)
  ```
- The valve is opened by `_turn_on` in the handler; the runner task is just the timer/volume-watcher. So the time push must precede `_turn_on`.
- Cancellation safety: inserting `await` (push+sleep) BEFORE creating the new task is safe — if an old task is being cancelled, its `finally` runs during our awaits while it is still the registered task, so it turns the valve off (which is fine, we haven't opened ours yet); we then create our task and open.
- `asyncio` and `_LOGGER` already imported. ZHA helpers must be imported LOCALLY inside the helper (ZHA may be absent / import side-effects).
- Quirk `giex_qt06_epoch2000.py` has a dead `async def bind()` override (v2.4.5) that never fires — remove it.

## File Structure

- `custom_components/tuya_irrigation/__init__.py` — new `_async_push_device_time` helper (module-level) + a `_TIME_SYNC_SETTLE = 1.5` constant; call site in both handlers.
- `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py` — remove dead `bind()`.
- `README.md` — update the giex quirk note.

---

## Task 1: Add the `_async_push_device_time` helper

**Files:**
- Modify: `custom_components/tuya_irrigation/__init__.py`

- [ ] **Step 1: Add a settle-delay constant**

After the `_LOGGER = logging.getLogger(__name__)` line (line 48) and before `PLATFORMS`, add:

```python

# Seconds to wait after pushing the device clock before opening the valve, so the
# Tuya MCU applies the pushed time before it stamps irrigation_start_time. The
# 0x24 time command is fire-and-forget (no ack), hence a fixed settle delay.
_TIME_SYNC_SETTLE = 1.5
```

- [ ] **Step 2: Add the helper function**

Add this module-level async function just above `def _async_register_services(` (line ~254, before its definition):

```python
async def _async_push_device_time(hass: HomeAssistant, switch_entity: str) -> None:
    """Best-effort: push the current time to a Tuya valve's MCU before opening it.

    The GiEX RTC drifts and the device never requests a sync, so its
    start/end-time stamps are wrong. We reach the device's zigpy 0xEF00 cluster
    via the ZHA gateway and call handle_set_time_request(0), which emits Tuya
    command 0x24 with the current time using the quirk's 2000 epoch.

    Fully guarded: any failure (ZHA absent, device not found, API drift) is
    logged and swallowed — pushing the time must never block or fail irrigation.
    """
    try:
        from homeassistant.components.zha.helpers import get_zha_gateway
        from homeassistant.helpers import device_registry as dr
        from homeassistant.helpers import entity_registry as er
        from zigpy.types import EUI64

        ent_reg = er.async_get(hass)
        entry = ent_reg.async_get(switch_entity)
        if entry is None or entry.device_id is None:
            _LOGGER.debug("Time push: no registry entry for %s", switch_entity)
            return
        dev_reg = dr.async_get(hass)
        device = dev_reg.async_get(entry.device_id)
        if device is None:
            _LOGGER.debug("Time push: no device for %s", switch_entity)
            return
        ieee_str = next(
            (c[1] for c in device.connections if c[0] == dr.CONNECTION_ZIGBEE),
            None,
        )
        if ieee_str is None:
            ieee_str = next(
                (i[1] for i in device.identifiers if i[0] == "zha"), None
            )
        if ieee_str is None:
            _LOGGER.debug("Time push: no IEEE for %s", switch_entity)
            return

        gateway = get_zha_gateway(hass)
        zha_device = gateway.get_device(EUI64.convert(ieee_str))
        cluster = zha_device.device.endpoints[1].in_clusters[0xEF00]
        cluster.handle_set_time_request(0)
        _LOGGER.info("Pushed device time to %s (ieee %s)", switch_entity, ieee_str)
    except Exception as err:  # noqa: BLE001 - best-effort, never block irrigation
        _LOGGER.warning("Time push to %s failed (non-fatal): %s", switch_entity, err)
```

- [ ] **Step 3: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/__init__.py && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add custom_components/tuya_irrigation/__init__.py
git commit -m "tuya_irrigation: add best-effort device time-push helper"
```

---

## Task 2: Call the time push before opening the valve in both handlers

**Files:**
- Modify: `custom_components/tuya_irrigation/__init__.py`

- [ ] **Step 1: Update `_handle_seconds`**

Replace:
```python
        _cancel_existing(switch_entity)
        managed_switches.add(switch_entity)
        # Create and register the task BEFORE any await, so the cancelled old
        # task (whose finally block will run during our first await) sees that
        # it is no longer the registered task and skips turning off the valve
        # that we are about to open.
        task = hass.async_create_task(_run_seconds(switch_entity, seconds))
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)
```
with:
```python
        _cancel_existing(switch_entity)
        managed_switches.add(switch_entity)
        # Sync the device clock before opening so it stamps start/end time with a
        # correct RTC. Best-effort; runs before we create our task, so a cancelled
        # old task's finally (running during these awaits) still closes the valve
        # cleanly before we open ours.
        await _async_push_device_time(hass, switch_entity)
        await asyncio.sleep(_TIME_SYNC_SETTLE)
        task = hass.async_create_task(_run_seconds(switch_entity, seconds))
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)
```

- [ ] **Step 2: Update `_handle_liters`**

Replace:
```python
        _cancel_existing(switch_entity)
        managed_switches.add(switch_entity)
        task = hass.async_create_task(
            _run_liters(switch_entity, liters, timeout_seconds, summation_entity)
        )
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)
```
with:
```python
        _cancel_existing(switch_entity)
        managed_switches.add(switch_entity)
        # Sync the device clock before opening (best-effort) — see _handle_seconds.
        await _async_push_device_time(hass, switch_entity)
        await asyncio.sleep(_TIME_SYNC_SETTLE)
        task = hass.async_create_task(
            _run_liters(switch_entity, liters, timeout_seconds, summation_entity)
        )
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)
```

- [ ] **Step 3: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/__init__.py && echo OK`
Expected: `OK`

- [ ] **Step 4: Confirm both call sites present**

Run: `grep -c "_async_push_device_time(hass, switch_entity)" custom_components/tuya_irrigation/__init__.py`
Expected: `3` (1 definition call inside the function is NOT counted by name match of the call form; actually: 1 def line + 2 call sites). Accept `2` call sites: `grep -c "await _async_push_device_time" custom_components/tuya_irrigation/__init__.py` → expected `2`.

- [ ] **Step 5: Commit**

```bash
git add custom_components/tuya_irrigation/__init__.py
git commit -m "tuya_irrigation: sync device clock before opening valve (both services)"
```

---

## Task 3: Remove the dead `bind()` override from the quirk

**Files:**
- Modify: `custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`

- [ ] **Step 1: Remove the bind() method**

In `GiexEpoch2000MCUCluster`, delete the entire `async def bind(self):` method block (the method added in v2.4.5, from `async def bind(self):` through its `return result`). Keep the class docstring and the two `set_time_offset` / `set_time_local_offset` attributes. Also trim the docstring paragraph that describes the bind-time push (the paragraph starting "It also pushes the time PROACTIVELY at bind"), replacing it with a one-line note:

```
    The actual proactive time push now happens from the integration's services
    just before opening the valve (see _async_push_device_time), because ZHA does
    not call bind() on this manufacturer-specific 0xEF00 cluster.
```

- [ ] **Step 2: Verify it compiles and bind() is gone**

Run: `python3 -m py_compile custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py && echo OK`
Expected: `OK`
Run: `grep -c "async def bind" custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
Expected: `0`

- [ ] **Step 3: Confirm clone chain still intact**

Run: `grep -c "tuya_number\|add_to_registry" custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py`
Expected: `3` (two `.tuya_number` + one `.add_to_registry`).

- [ ] **Step 4: Commit**

```bash
git add custom_components/tuya_irrigation/quirks/giex_qt06_epoch2000.py
git commit -m "tuya_irrigation: remove dead bind() time push (never fired on 0xEF00)"
```

---

## Task 4: Update README quirk note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the bind note**

In the `giex_qt06_epoch2000.py` row of the "Bundled ZHA quirks" table, find:
```
Additionally pushes the current time to the device on bind (the GiEX RTC drifts and never requests a sync), an experimental fix for its wrong internal clock.
```
Replace with:
```
The integration also syncs the device clock (Tuya 0x24) at the start of each irrigation, since the GiEX RTC drifts and never requests a sync — an experimental fix for its wrong internal start/end-time stamps.
```

- [ ] **Step 2: Verify**

Run: `grep -c "syncs the device clock (Tuya 0x24) at the start" README.md`
Expected: `1`

- [ ] **Step 3: Commit + push**

```bash
git add README.md
git commit -m "docs: note clock sync at irrigation start in quirks table"
git push origin main
```

---

## Task 5: Live verification on Home Assistant

> No code. After deploying the updated `custom_components/tuya_irrigation/` to HA and
> restarting. ZHA debug logging for `zhaquirks.tuya` should still be on. NO version
> bump / tag — report results; the user decides on tagging.

- [ ] **Step 1: Safety check #1**

Via HA MCP `ha_render_template` + `ha_core_logs`: integration loads (services +
device actions present), no quirk import error, no `DP already mapped`. If down → roll back.

- [ ] **Step 2: Start a brief by-time irrigation (~30 s)**

No Reconfigure needed. Trigger `tuya_irrigation.irrigation_by_seconds` (or the device
action) with seconds≈30 on `switch.tze200_a7sghmms_ts0601`.

- [ ] **Step 3: Confirm the push went out**

Via `ha_core_logs`: expect `Pushed device time to switch.tze200_a7sghmms_ts0601 ...`
(our INFO log) and/or an outbound cluster 0xEF00 command 0x24 to the valve right
before it opens. If instead `Time push ... failed (non-fatal)` appears, read the error
and decide (likely the ZHA gateway/cluster path needs adjustment → the public-service
fallback, or fix the attribute path).

- [ ] **Step 4: Decisive measurement**

Read `sensor.tze200_a7sghmms_ts0601_irrigation_start_time`:
- matches real local time (±seconds) → CONFIRMED; clock corrected on every irrigation.
  Tell the user; they decide whether to tag (and then we bump the version).
- still ~1h40 off → next lever: epoch 1970 (change the quirk's `set_time_offset`), or
  accept the z2m "not planned" reality. Record the outcome in memory.

- [ ] **Step 5: Regression**

By-liters still closes at target (do a 3 L run); the ~1.5 s pre-open delay aside,
open/close timing and cancellation behave; no new errors in the log.

---

## Self-Review notes (already applied)

- **Spec coverage:** helper via gateway + handle_set_time_request → Task 1; both
  services push + 1.5 s settle → Task 2; dead bind() removed → Task 3; README → Task 4;
  live test incl. safety check + decisive measurement + epoch/“not planned” branch →
  Task 5. No version bump / tag anywhere (per instruction). All mapped.
- **Type/name consistency:** `_async_push_device_time(hass, switch_entity)`,
  `_TIME_SYNC_SETTLE`, `get_zha_gateway`, `EUI64.convert`, cluster `0xEF00`,
  `handle_set_time_request(0)` consistent across tasks.
- **No placeholders:** every code step is complete.
- **Cancellation safety:** Task 2 places the awaits before task creation; reasoning
  documented in the spec and the inline comment.
