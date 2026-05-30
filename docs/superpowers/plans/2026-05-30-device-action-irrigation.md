# Device action "Irriga per litri / per tempo" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two device actions ("Irriga per litri", "Irriga per tempo") appear automatically in the device-first automation builder for any ZHA irrigation valve, calling the existing `tuya_irrigation` services under the hood.

**Architecture:** The integration auto-detects valve devices (a device that has both a `switch.*` entity and a `sensor.*` with `device_class` ∈ {volume, water}). For each valve it creates a `binary_sensor` "Irrigazione in corso" attached to the existing ZHA device — this both anchors the integration to the device (so HA offers its device actions) and gives live feedback during the server-side timer. A `device_action.py` module exposes the two actions and translates them into the existing services. A dispatcher signal keeps the binary_sensor in sync with the running task.

**Tech Stack:** Home Assistant custom integration (Python), `voluptuous`, HA helpers (`entity_registry`, `device_registry`, `dispatcher`, `selector`). No automated test harness exists in this repo (per CLAUDE.md: "No automated tests. Verify manually on a real HA instance"), so each task is verified with static checks (`python3 -m py_compile`, JSON validation) and the integration is verified live on Home Assistant via the HA MCP after deployment.

---

## Project reality / conventions to follow

- `custom_components/tuya_irrigation/__init__.py` is services-only today: it builds `hass.data[DOMAIN] = {"active_tasks": {...}, "managed_switches": set()}`, registers two services via closures in `_async_register_services`, and forwards **no** entity platforms yet.
- `const.py` holds `DOMAIN`, `VERSION`, service/attr constants, `SUMMATION_SUFFIX`.
- The live valve is device_id `182268ccf1234c07824785906064cf1a`, switch `switch.tze200_a7sghmms_ts0601`, volume sensor `sensor.tze200_a7sghmms_ts0601_summation_delivered` (`device_class=volume`, `unit=L`). The `presa_contatore_cantina` socket has an `energy/kWh` summation sensor and MUST stay excluded.
- This repo is the source/dev tree. The running HA loads the integration from its own config dir (currently git commit `a533476`). "Live verification" steps assume the new code has been deployed to HA (HACS update or manual copy) and the integration reloaded.

## File Structure

- **Create** `custom_components/tuya_irrigation/discovery.py` — pure valve-detection helpers shared by the binary_sensor platform and device_action module.
- **Create** `custom_components/tuya_irrigation/binary_sensor.py` — the "Irrigazione in corso" anchor entity + platform setup.
- **Create** `custom_components/tuya_irrigation/device_action.py` — the three HA device-automation hooks.
- **Modify** `custom_components/tuya_irrigation/const.py` — new constants, version bump, `running_signal()` helper.
- **Modify** `custom_components/tuya_irrigation/__init__.py` — forward the `binary_sensor` platform, dispatch running signals on task start/stop.
- **Modify** `custom_components/tuya_irrigation/manifest.json` — version bump.
- **Modify** `custom_components/tuya_irrigation/strings.json`, `translations/en.json`, `translations/it.json` — device_automation + entity strings.
- **Modify** `README.md` — document the device actions, detection rule, and the binary_sensor.

---

## Task 1: Constants — version bump, action keys, signal helper

**Files:**
- Modify: `custom_components/tuya_irrigation/const.py`

- [ ] **Step 1: Add the new constants and helper**

Replace the whole content of `custom_components/tuya_irrigation/const.py` with:

```python
"""Constants for the Tuya Irrigation integration."""

DOMAIN = "tuya_irrigation"
VERSION = "2.4.0"

# URL under which the integration serves static files (bundled Lovelace card JS).
URL_BASE = f"/{DOMAIN}"

# JS modules bundled and auto-registered as Lovelace resources.
JSMODULES = [
    {"filename": "tuya-cards.js", "version": VERSION},
]

# Service names.
SERVICE_IRRIGATION_BY_SECONDS = "irrigation_by_seconds"
SERVICE_IRRIGATION_BY_LITERS = "irrigation_by_liters"

# Service attribute keys.
ATTR_SWITCH_ENTITY = "switch_entity"
ATTR_SECONDS = "seconds"
ATTR_LITERS = "liters"
ATTR_TIMEOUT_SECONDS = "timeout_seconds"

# Default safety timeout for liters mode (1 hour).
DEFAULT_LITERS_TIMEOUT = 3600

# Entity suffix used to discover the water-delivered counter sensor from a switch entity_id.
SUMMATION_SUFFIX = "_summation_delivered"

# A device qualifies as an irrigation valve if it has a switch entity AND a
# sensor entity whose device_class is one of these (water volume meter).
VALVE_VOLUME_DEVICE_CLASSES = frozenset({"volume", "water"})

# Maximum seconds the "by seconds" service accepts (mirrors SECONDS_SCHEMA).
MAX_IRRIGATION_SECONDS = 43200

# device_action type identifiers.
ACTION_IRRIGATE_LITERS = "irrigate_liters"
ACTION_IRRIGATE_SECONDS = "irrigate_seconds"

# device_action extra-field config keys.
CONF_LITERS = "liters"
CONF_DURATION = "duration"


def running_signal(switch_entity: str) -> str:
    """Dispatcher signal name carrying the running state for a valve's switch."""
    return f"{DOMAIN}_running_{switch_entity}"
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/const.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add custom_components/tuya_irrigation/const.py
git commit -m "tuya_irrigation: add device-action constants + running signal helper"
```

---

## Task 2: Valve detection helpers (`discovery.py`)

**Files:**
- Create: `custom_components/tuya_irrigation/discovery.py`

- [ ] **Step 1: Create the helper module**

Create `custom_components/tuya_irrigation/discovery.py` with:

```python
"""Auto-detection of irrigation valve devices.

A device is treated as an irrigation valve when it exposes BOTH:
  * at least one `switch.*` entity (the valve), and
  * at least one `sensor.*` entity whose device_class is in
    VALVE_VOLUME_DEVICE_CLASSES (a water-volume meter).

This keeps energy-metering sockets (device_class=energy) out of scope while
matching real flow-metering valves such as the GiEX QT06.
"""
from __future__ import annotations

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import VALVE_VOLUME_DEVICE_CLASSES


@callback
def _device_class_of(hass: HomeAssistant, entry: er.RegistryEntry) -> str | None:
    """Best-effort device_class for a registry entry.

    Prefers the registry values (available even when the entity has no live
    state yet), falling back to the live state attribute.
    """
    dc = entry.device_class or entry.original_device_class
    if dc:
        return dc
    state = hass.states.get(entry.entity_id)
    if state is not None:
        return state.attributes.get("device_class")
    return None


@callback
def find_valve_devices(hass: HomeAssistant) -> set[str]:
    """Return the set of device_ids that look like irrigation valves."""
    ent_reg = er.async_get(hass)
    by_device: dict[str, list[er.RegistryEntry]] = {}
    for entry in ent_reg.entities.values():
        if entry.device_id is None:
            continue
        by_device.setdefault(entry.device_id, []).append(entry)

    valves: set[str] = set()
    for device_id, entries in by_device.items():
        has_switch = any(e.domain == "switch" for e in entries)
        if not has_switch:
            continue
        has_volume = any(
            e.domain == "sensor"
            and _device_class_of(hass, e) in VALVE_VOLUME_DEVICE_CLASSES
            for e in entries
        )
        if has_volume:
            valves.add(device_id)
    return valves


@callback
def valve_switch_for_device(hass: HomeAssistant, device_id: str) -> str | None:
    """Return the first switch entity_id on a device, or None.

    A valve device is expected to have exactly one switch; if it has several
    the first (registry order) is used.
    """
    ent_reg = er.async_get(hass)
    for entry in er.async_entries_for_device(
        ent_reg, device_id, include_disabled_entities=True
    ):
        if entry.domain == "switch":
            return entry.entity_id
    return None


@callback
def device_is_valve(hass: HomeAssistant, device_id: str) -> bool:
    """Whether a given device_id qualifies as an irrigation valve."""
    return device_id in find_valve_devices(hass)
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/discovery.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add custom_components/tuya_irrigation/discovery.py
git commit -m "tuya_irrigation: add valve auto-detection helpers"
```

---

## Task 3: `binary_sensor.py` anchor platform

**Files:**
- Create: `custom_components/tuya_irrigation/binary_sensor.py`

- [ ] **Step 1: Create the platform**

Create `custom_components/tuya_irrigation/binary_sensor.py` with:

```python
"""'Irrigazione in corso' binary sensor for each detected irrigation valve.

This entity has two jobs:
  1. It attaches the tuya_irrigation integration to the valve's (ZHA) device by
     reusing that device's identifiers/connections. That association is what
     makes HA offer this integration's device actions for the valve.
  2. It reflects the live state of the server-side irrigation timer, which is
     otherwise invisible. State is driven by a per-switch dispatcher signal sent
     from the services in __init__.py.
"""
from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, running_signal
from .discovery import find_valve_devices, valve_switch_for_device


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create an 'Irrigazione in corso' entity per detected valve, now and later."""
    dev_reg = dr.async_get(hass)
    added_switches: set[str] = set()

    @callback
    def _add_new_valves() -> None:
        new_entities: list[IrrigationRunningBinarySensor] = []
        for device_id in find_valve_devices(hass):
            switch_entity = valve_switch_for_device(hass, device_id)
            if switch_entity is None or switch_entity in added_switches:
                continue
            device = dev_reg.async_get(device_id)
            if device is None:
                continue
            added_switches.add(switch_entity)
            new_entities.append(
                IrrigationRunningBinarySensor(device, switch_entity)
            )
        if new_entities:
            async_add_entities(new_entities)

    _add_new_valves()

    @callback
    def _registry_updated(_event: Event) -> None:
        # A valve paired after setup registers its switch/volume sensor here;
        # re-scan so its action-enabling entity (and thus the actions) appear
        # without a reload.
        _add_new_valves()

    entry.async_on_unload(
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, _registry_updated)
    )


class IrrigationRunningBinarySensor(BinarySensorEntity):
    """On while a tuya_irrigation timer is running for this valve's switch."""

    _attr_has_entity_name = True
    _attr_translation_key = "irrigating"
    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_should_poll = False

    def __init__(self, device: dr.DeviceEntry, switch_entity: str) -> None:
        self._switch_entity = switch_entity
        self._attr_unique_id = f"{DOMAIN}_running_{switch_entity}"
        self._attr_is_on = False
        # Merge into the existing (ZHA) device by reusing its identifiers and
        # connections — this is the association HA uses to surface device actions.
        self._attr_device_info = DeviceInfo(
            identifiers=device.identifiers,
            connections=device.connections,
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe to the running signal for this valve's switch."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                running_signal(self._switch_entity),
                self._handle_running,
            )
        )

    @callback
    def _handle_running(self, running: bool) -> None:
        self._attr_is_on = running
        self.async_write_ha_state()
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/binary_sensor.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add custom_components/tuya_irrigation/binary_sensor.py
git commit -m "tuya_irrigation: add 'Irrigazione in corso' anchor binary_sensor"
```

---

## Task 4: `device_action.py` — the two device actions

**Files:**
- Create: `custom_components/tuya_irrigation/device_action.py`

- [ ] **Step 1: Create the device_action module**

Create `custom_components/tuya_irrigation/device_action.py` with:

```python
"""Device actions for irrigation valves.

Surfaces two actions in the device-first automation builder for any device that
auto-detection classifies as an irrigation valve:
  * irrigate_liters  -> tuya_irrigation.irrigation_by_liters
  * irrigate_seconds -> tuya_irrigation.irrigation_by_seconds

The actions only translate config into the existing services; no valve logic is
duplicated here.
"""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.const import CONF_DEVICE_ID, CONF_DOMAIN, CONF_TYPE
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import selector
from homeassistant.helpers.typing import ConfigType, TemplateVarsType

from .const import (
    ACTION_IRRIGATE_LITERS,
    ACTION_IRRIGATE_SECONDS,
    ATTR_LITERS,
    ATTR_SECONDS,
    ATTR_SWITCH_ENTITY,
    CONF_DURATION,
    CONF_LITERS,
    DOMAIN,
    MAX_IRRIGATION_SECONDS,
    SERVICE_IRRIGATION_BY_LITERS,
    SERVICE_IRRIGATION_BY_SECONDS,
)
from .discovery import device_is_valve, valve_switch_for_device

_LOGGER = logging.getLogger(__name__)

ACTION_TYPES = {ACTION_IRRIGATE_LITERS, ACTION_IRRIGATE_SECONDS}

LITERS_SELECTOR = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=1,
        max=10000,
        step=1,
        unit_of_measurement="L",
        mode=selector.NumberSelectorMode.BOX,
    )
)
DURATION_SELECTOR = selector.DurationSelector(selector.DurationSelectorConfig())

ACTION_SCHEMA = cv.DEVICE_ACTION_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_TYPE): vol.In(ACTION_TYPES),
        vol.Optional(CONF_LITERS): LITERS_SELECTOR,
        vol.Optional(CONF_DURATION): DURATION_SELECTOR,
    }
)


async def async_get_actions(
    hass: HomeAssistant, device_id: str
) -> list[dict[str, str]]:
    """Return the irrigation actions for a valve device (empty otherwise)."""
    if not device_is_valve(hass, device_id):
        return []
    base = {CONF_DEVICE_ID: device_id, CONF_DOMAIN: DOMAIN}
    return [
        {**base, CONF_TYPE: ACTION_IRRIGATE_LITERS},
        {**base, CONF_TYPE: ACTION_IRRIGATE_SECONDS},
    ]


async def async_get_action_capabilities(
    hass: HomeAssistant, config: ConfigType
) -> dict[str, vol.Schema]:
    """Return the extra UI fields for each action type."""
    action_type = config[CONF_TYPE]
    if action_type == ACTION_IRRIGATE_LITERS:
        fields = {vol.Required(CONF_LITERS): LITERS_SELECTOR}
    elif action_type == ACTION_IRRIGATE_SECONDS:
        fields = {vol.Required(CONF_DURATION): DURATION_SELECTOR}
    else:
        return {}
    return {"extra_fields": vol.Schema(fields)}


async def async_call_action_from_config(
    hass: HomeAssistant,
    config: ConfigType,
    variables: TemplateVarsType,
    context: Context | None,
) -> None:
    """Execute the action by calling the existing irrigation service."""
    device_id = config[CONF_DEVICE_ID]
    switch_entity = valve_switch_for_device(hass, device_id)
    if switch_entity is None:
        _LOGGER.warning(
            "No switch entity found on device %s; cannot run irrigation action",
            device_id,
        )
        return

    action_type = config[CONF_TYPE]
    if action_type == ACTION_IRRIGATE_LITERS:
        await hass.services.async_call(
            DOMAIN,
            SERVICE_IRRIGATION_BY_LITERS,
            {ATTR_SWITCH_ENTITY: switch_entity, ATTR_LITERS: float(config[CONF_LITERS])},
            blocking=True,
            context=context,
        )
        return

    if action_type == ACTION_IRRIGATE_SECONDS:
        seconds = int(cv.time_period_dict(config[CONF_DURATION]).total_seconds())
        if seconds < 1:
            _LOGGER.warning("Irrigation duration must be at least 1 second")
            return
        if seconds > MAX_IRRIGATION_SECONDS:
            _LOGGER.warning(
                "Irrigation duration %ds exceeds maximum %ds; clamping",
                seconds,
                MAX_IRRIGATION_SECONDS,
            )
            seconds = MAX_IRRIGATION_SECONDS
        await hass.services.async_call(
            DOMAIN,
            SERVICE_IRRIGATION_BY_SECONDS,
            {ATTR_SWITCH_ENTITY: switch_entity, ATTR_SECONDS: seconds},
            blocking=True,
            context=context,
        )
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/device_action.py && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add custom_components/tuya_irrigation/device_action.py
git commit -m "tuya_irrigation: add irrigate-by-liters/seconds device actions"
```

---

## Task 5: Wire the platform + dispatcher signals into `__init__.py`

**Files:**
- Modify: `custom_components/tuya_irrigation/__init__.py`

- [ ] **Step 1: Add imports**

In the import block, after line 22 (`from homeassistant.const import EVENT_HOMEASSISTANT_STOP`), change that import to also bring in `Platform`:

Replace:
```python
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
```
with:
```python
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, Platform
```

After the line `from homeassistant.helpers.event import async_track_state_change_event` (line 25), add:
```python
from homeassistant.helpers.dispatcher import async_dispatcher_send
```

- [ ] **Step 2: Import the running_signal helper**

In the `from .const import (...)` block, add `running_signal,` (keep the others). The block becomes:

```python
from .const import (
    ATTR_LITERS,
    ATTR_SECONDS,
    ATTR_SWITCH_ENTITY,
    ATTR_TIMEOUT_SECONDS,
    DEFAULT_LITERS_TIMEOUT,
    DOMAIN,
    JSMODULES,
    SERVICE_IRRIGATION_BY_LITERS,
    SERVICE_IRRIGATION_BY_SECONDS,
    SUMMATION_SUFFIX,
    URL_BASE,
    VERSION,
    running_signal,
)
```

- [ ] **Step 3: Declare the platforms list**

After the `_LOGGER = logging.getLogger(__name__)` line (line 48), add:
```python

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR]
```

- [ ] **Step 4: Forward the platform in async_setup_entry**

In `async_setup_entry`, replace:
```python
    await _async_register_frontend(hass)
    _async_register_services(hass, active_tasks, managed_switches)
```
with:
```python
    await _async_register_frontend(hass)
    _async_register_services(hass, active_tasks, managed_switches)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
```

- [ ] **Step 5: Unload the platform in async_unload_entry**

In `async_unload_entry`, replace:
```python
    domain_data = hass.data.get(DOMAIN, {})
    active_tasks: dict[str, asyncio.Task] = domain_data.get("active_tasks", {})
    managed_switches: set[str] = domain_data.get("managed_switches", set())
    await _async_close_all_valves(hass, active_tasks, managed_switches)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_SECONDS)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_LITERS)
    hass.data.pop(DOMAIN, None)
```
with:
```python
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    domain_data = hass.data.get(DOMAIN, {})
    active_tasks: dict[str, asyncio.Task] = domain_data.get("active_tasks", {})
    managed_switches: set[str] = domain_data.get("managed_switches", set())
    await _async_close_all_valves(hass, active_tasks, managed_switches)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_SECONDS)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_LITERS)
    hass.data.pop(DOMAIN, None)
```

- [ ] **Step 6: Dispatch running=True at the start of each runner**

In `_run_seconds`, replace:
```python
    async def _run_seconds(switch_entity: str, seconds: int) -> None:
        """Sleep for `seconds`, then close the valve. Cancellation-safe."""
        my_task = asyncio.current_task()
        _LOGGER.info("Irrigation on %s for %d seconds (started)", switch_entity, seconds)
```
with:
```python
    async def _run_seconds(switch_entity: str, seconds: int) -> None:
        """Sleep for `seconds`, then close the valve. Cancellation-safe."""
        my_task = asyncio.current_task()
        async_dispatcher_send(hass, running_signal(switch_entity), True)
        _LOGGER.info("Irrigation on %s for %d seconds (started)", switch_entity, seconds)
```

In `_run_liters`, replace:
```python
        """Turn valve on, watch summation_delivered, close when target reached."""
        my_task = asyncio.current_task()
        start_state = hass.states.get(summation_entity)
```
with:
```python
        """Turn valve on, watch summation_delivered, close when target reached."""
        my_task = asyncio.current_task()
        async_dispatcher_send(hass, running_signal(switch_entity), True)
        start_state = hass.states.get(summation_entity)
```

- [ ] **Step 7: Dispatch running=False when the runner actually closes the valve**

In `_run_seconds`, replace its `finally` block:
```python
        finally:
            # Only touch the valve + dict if we are still the registered task.
            # If a newer call has replaced us, it is responsible for the valve.
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                await _turn_off(switch_entity)
```
with:
```python
        finally:
            # Only touch the valve + dict if we are still the registered task.
            # If a newer call has replaced us, it is responsible for the valve
            # (and keeps the running signal True), so we must not clear it.
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                async_dispatcher_send(hass, running_signal(switch_entity), False)
                await _turn_off(switch_entity)
```

In `_run_liters`, replace its `finally` block:
```python
        finally:
            unsub()
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                await _turn_off(switch_entity)
```
with:
```python
        finally:
            unsub()
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                async_dispatcher_send(hass, running_signal(switch_entity), False)
                await _turn_off(switch_entity)
```

- [ ] **Step 8: Verify it compiles**

Run: `python3 -m py_compile custom_components/tuya_irrigation/__init__.py && echo OK`
Expected: `OK`

- [ ] **Step 9: Commit**

```bash
git add custom_components/tuya_irrigation/__init__.py
git commit -m "tuya_irrigation: forward binary_sensor platform + dispatch running signal"
```

---

## Task 6: Translations (action names, field labels, entity name)

**Files:**
- Modify: `custom_components/tuya_irrigation/strings.json`
- Modify: `custom_components/tuya_irrigation/translations/en.json`
- Modify: `custom_components/tuya_irrigation/translations/it.json`

- [ ] **Step 1: Update `strings.json` (EN source)**

Replace the whole content of `custom_components/tuya_irrigation/strings.json` with:

```json
{
  "config": {
    "step": {
      "user": {
        "title": "Set up Tuya Irrigation",
        "description": "Click Submit to enable the Tuya Irrigation integration. It registers the `irrigation_by_seconds` and `irrigation_by_liters` services and auto-registers the Lovelace card bundle. There is nothing to configure here."
      }
    },
    "abort": {
      "already_configured": "Tuya Irrigation is already set up."
    }
  },
  "device_automation": {
    "action_type": {
      "irrigate_liters": "Irrigate by liters",
      "irrigate_seconds": "Irrigate for a duration"
    },
    "extra_fields": {
      "liters": "Liters",
      "duration": "Duration"
    }
  },
  "entity": {
    "binary_sensor": {
      "irrigating": {
        "name": "Irrigating"
      }
    }
  }
}
```

- [ ] **Step 2: Update `translations/en.json` (same as EN source)**

Replace the whole content of `custom_components/tuya_irrigation/translations/en.json` with the identical JSON used in Step 1.

- [ ] **Step 3: Update `translations/it.json`**

Replace the whole content of `custom_components/tuya_irrigation/translations/it.json` with:

```json
{
  "config": {
    "step": {
      "user": {
        "title": "Configura Tuya Irrigation",
        "description": "Clicca Invia per abilitare l'integrazione Tuya Irrigation. Registra i servizi `irrigation_by_seconds` e `irrigation_by_liters` e pubblica automaticamente il bundle delle card Lovelace. Non c'è nulla da configurare qui."
      }
    },
    "abort": {
      "already_configured": "Tuya Irrigation è già configurato."
    }
  },
  "device_automation": {
    "action_type": {
      "irrigate_liters": "Irriga per litri",
      "irrigate_seconds": "Irriga per tempo"
    },
    "extra_fields": {
      "liters": "Litri",
      "duration": "Durata"
    }
  },
  "entity": {
    "binary_sensor": {
      "irrigating": {
        "name": "Irrigazione in corso"
      }
    }
  }
}
```

- [ ] **Step 4: Verify all three are valid JSON**

Run:
```bash
for f in custom_components/tuya_irrigation/strings.json custom_components/tuya_irrigation/translations/en.json custom_components/tuya_irrigation/translations/it.json; do python3 -m json.tool "$f" >/dev/null && echo "OK $f"; done
```
Expected: three `OK ...` lines.

- [ ] **Step 5: Commit**

```bash
git add custom_components/tuya_irrigation/strings.json custom_components/tuya_irrigation/translations/en.json custom_components/tuya_irrigation/translations/it.json
git commit -m "tuya_irrigation: translations for device actions + irrigating sensor"
```

---

## Task 7: Version bump in manifest

**Files:**
- Modify: `custom_components/tuya_irrigation/manifest.json`

- [ ] **Step 1: Bump the version**

In `custom_components/tuya_irrigation/manifest.json`, replace:
```json
  "version": "2.3.1",
```
with:
```json
  "version": "2.4.0",
```

- [ ] **Step 2: Verify valid JSON**

Run: `python3 -m json.tool custom_components/tuya_irrigation/manifest.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add custom_components/tuya_irrigation/manifest.json
git commit -m "tuya_irrigation v2.4.0: device actions for irrigation valves"
```

---

## Task 8: Documentation (README)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new device actions**

Add a new section to `README.md` (place it after the existing services documentation; match the surrounding heading style). Use this content:

```markdown
## Device actions (automation builder)

When you build an automation by **selecting a device first**, any device the
integration recognizes as an irrigation valve gains two extra actions:

| Action | Field | Calls |
| --- | --- | --- |
| **Irriga per litri** / *Irrigate by liters* | Liters | `tuya_irrigation.irrigation_by_liters` (safety timeout fixed at 3600 s) |
| **Irriga per tempo** / *Irrigate for a duration* | Duration (hh:mm:ss) | `tuya_irrigation.irrigation_by_seconds` |

**Valve auto-detection:** a device is treated as an irrigation valve when it has
both a `switch.*` entity and a `sensor.*` entity whose `device_class` is `volume`
or `water`. Energy-metering sockets (`device_class=energy`) are ignored, so the
actions only appear on real flow-metering valves — no configuration needed.

Each detected valve also gets an **"Irrigazione in corso" / "Irrigating"**
`binary_sensor` attached to its device, which is `on` while a server-side
irrigation timer is running. This is the association that lets the device actions
appear, and it gives live feedback during irrigation.
```

- [ ] **Step 2: Verify the section renders (visual scan)**

Run: `grep -n "Device actions (automation builder)" README.md && echo OK`
Expected: a matching line and `OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document irrigation device actions + Irrigazione in corso sensor"
```

---

## Task 9: Live verification on Home Assistant

> This task has no code. It is performed after the new version is deployed to the
> running HA instance (HACS update to 2.4.0 or manual copy of
> `custom_components/tuya_irrigation/`) and the integration reloaded. Verification
> uses the HA MCP tools (`ha_*` / `hass_*`) and/or the HA UI.

- [ ] **Step 1: Confirm the integration loads at the new version**

Via HA MCP `ha_render_template`:
```
installed: {{ state_attr('update.tuya_cards_for_ha_update','installed_version') }}
```
Expected: reflects the deployed 2.4.0 build (or the new commit hash). Also check
Settings → Devices & Services → Logs has no `tuya_irrigation` errors
(`ha_system_log_list`).

- [ ] **Step 2: Confirm the anchor entity exists on the valve device**

Via `ha_render_template`:
```
{{ states('binary_sensor.tze200_a7sghmms_ts0601_irrigating') }}
{{ device_entities('182268ccf1234c07824785906064cf1a') }}
```
Expected: the `binary_sensor.*_irrigating` entity exists, state `off`, and it is
listed among the valve device's entities (proves the device merge worked).
(The exact entity_id may differ; confirm one ending in `_irrigating` is present.)

- [ ] **Step 3: Confirm the device actions are offered**

In the HA UI: Settings → Automations → Create → add Action → **Device** → pick the
valve → the action dropdown shows "Irriga per litri" and "Irriga per tempo".
Confirm the `presa_contatore_cantina` socket device shows **neither**.

- [ ] **Step 4: Functional test — by liters**

Create/run an automation action: device = valve, action = "Irriga per litri",
Liters = 2 (small, for a quick test). Expected:
- valve `switch.tze200_a7sghmms_ts0601` turns `on`,
- `binary_sensor.*_irrigating` becomes `on`,
- after ~2 L delivered (watch `sensor.tze200_a7sghmms_ts0601_summation_delivered`)
  the valve turns `off` and the binary_sensor returns to `off`.

- [ ] **Step 5: Functional test — by time**

Action = "Irriga per tempo", Duration = 00:00:30. Expected: valve opens, binary
sensor `on`, valve closes after ~30 s, binary sensor `off`.

- [ ] **Step 6: Cancellation / restart safety unchanged**

Start a by-time action of 00:02:00, then within HA restart the integration
(Settings → Devices & Services → tuya_irrigation → Reload) mid-run. Expected:
the valve is closed by the unload sweep and the binary_sensor ends `off`.

---

## Self-Review notes (already applied)

- **Spec coverage:** detection rule → Task 2; anchor binary_sensor + late-device
  listener + dispatcher sync → Tasks 3 & 5; both actions with liters/duration
  fields and no exposed timeout → Task 4; translations → Task 6; version + README
  → Tasks 7 & 8; manual HA test plan → Task 9. All spec sections mapped.
- **Type/name consistency:** `running_signal()`, `find_valve_devices()`,
  `valve_switch_for_device()`, `device_is_valve()`, `ACTION_IRRIGATE_LITERS/SECONDS`,
  `CONF_LITERS/CONF_DURATION` are defined in Tasks 1–2 and used with identical
  names in Tasks 3–5.
- **No placeholders:** every code step contains complete content.
```
