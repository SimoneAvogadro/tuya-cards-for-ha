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
