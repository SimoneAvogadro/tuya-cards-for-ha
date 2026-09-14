"""Auto-detection of irrigation valve devices.

A device is treated as an irrigation valve when it exposes BOTH:
  * at least one `switch.*` entity (the valve), and
  * at least one `sensor.*` entity whose device_class is in
    VALVE_VOLUME_DEVICE_CLASSES (a water-volume meter),

and when no integration in FOREIGN_VALVE_PLATFORMS already owns it.

This keeps energy-metering sockets (device_class=energy) out of scope while
matching real flow-metering valves such as the GiEX QT06 — and keeps this
integration off valves that have one of their own.
"""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import FOREIGN_VALVE_PLATFORMS, VALVE_VOLUME_DEVICE_CLASSES

_LOGGER = logging.getLogger(__name__)


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
        # A valve with a dedicated integration is not ours to adopt.
        if any(e.platform in FOREIGN_VALVE_PLATFORMS for e in entries):
            continue
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
    """Return the device's only switch entity_id, or None.

    This integration is built on one switch per valve: every service call and
    every run-log record is keyed by that entity. A device with several would
    silently get the first one, so it is flagged — auto-detection already skips
    the multi-line valves we know about (FOREIGN_VALVE_PLATFORMS), and anything
    else reaching here is worth a line in the log rather than a silent guess.
    """
    ent_reg = er.async_get(hass)
    switches = [
        entry.entity_id
        for entry in er.async_entries_for_device(
            ent_reg, device_id, include_disabled_entities=True
        )
        if entry.domain == "switch"
    ]
    if not switches:
        return None
    if len(switches) > 1:
        _LOGGER.warning(
            "Device %s has %d switches (%s); this integration assumes one per "
            "valve and will use %s. If this is a multi-line valve, it needs an "
            "integration that knows about its lines",
            device_id,
            len(switches),
            ", ".join(switches),
            switches[0],
        )
    return switches[0]


@callback
def device_is_valve(hass: HomeAssistant, device_id: str) -> bool:
    """Whether a given device_id qualifies as an irrigation valve."""
    return device_id in find_valve_devices(hass)


@callback
def device_has_battery(hass: HomeAssistant, device_id: str) -> bool:
    """Whether a device exposes a battery sensor (i.e. is battery-powered).

    Used to scope keep-alive polling to sleepy battery valves: mains-powered
    valves are kept available by ZHA's own polling and don't need it.
    """
    ent_reg = er.async_get(hass)
    for entry in er.async_entries_for_device(
        ent_reg, device_id, include_disabled_entities=True
    ):
        if entry.domain == "sensor" and _device_class_of(hass, entry) == "battery":
            return True
    return False


@callback
def device_is_zha(hass: HomeAssistant, device_id: str) -> bool:
    """Whether a device is a ZHA (Zigbee) device.

    Used to decide if the `zha_tuya_quirks` layer is expected: only ZHA valves
    need its quirks and radio helpers; a Zigbee2MQTT valve does not.
    """
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return False
    return any(i[0] == "zha" for i in device.identifiers) or any(
        c[0] == dr.CONNECTION_ZIGBEE for c in device.connections
    )


@callback
def resolve_valve_device(hass: HomeAssistant, device_id: str) -> str | None:
    """Map a device id to the device that actually carries the valve switch.

    Since HA 2026.8 a device belongs to exactly one config entry, so this
    integration's entities (the "Irrigating" binary_sensor, the history and
    water-total sensors) live on a *sibling* device of their own — same
    identifiers/connections as the radio integration's (ZHA) device, same user
    name, but no switch. That sibling is what the UI hands us: it is the device
    the service picker (`filter: integration: tuya_irrigation`) lists and the
    device HA asks device actions for. Runs, however, are keyed by the switch,
    which lives on the radio device.

    Returns `device_id` itself when it is a valve device, else the id of the
    sibling sharing an identifier or connection that is one, else None.
    """
    if device_is_valve(hass, device_id):
        return device_id
    dev_reg = dr.async_get(hass)
    device = dev_reg.async_get(device_id)
    if device is None:
        return None
    for other in dev_reg.devices:  # iterating the registry is the supported access
        if other.id == device_id:
            continue
        if not (
            (other.identifiers & device.identifiers)
            or (other.connections & device.connections)
        ):
            continue
        if device_is_valve(hass, other.id):
            return other.id
    return None


@callback
def valve_switch_for_any_device(hass: HomeAssistant, device_id: str) -> str | None:
    """`valve_switch_for_device` that also accepts this integration's sibling device."""
    valve_device = resolve_valve_device(hass, device_id)
    if valve_device is None:
        return None
    return valve_switch_for_device(hass, valve_device)
