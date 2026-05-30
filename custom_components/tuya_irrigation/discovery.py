"""Helpers to auto-detect Tuya irrigation valve switches and their companion sensors."""
from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

IRRIGATION_SWITCH_SUFFIX = "_switch"
SUMMATION_SENSOR_SUFFIX = "_summation_delivered"


def find_irrigation_switches(hass: HomeAssistant) -> list[str]:
    """Return entity_ids of switches that look like Tuya irrigation valves."""
    registry = er.async_get(hass)
    switches: list[str] = []
    for entry in registry.entities.values():
        if entry.domain != "switch":
            continue
        if entry.platform not in ("zha", "mqtt"):
            continue
        if not entry.entity_id.endswith(IRRIGATION_SWITCH_SUFFIX):
            continue
        switches.append(entry.entity_id)
    return switches


def companion_summation_sensor(switch_entity_id: str) -> str:
    """Given a valve switch entity_id, return the expected summation sensor entity_id."""
    prefix = switch_entity_id.removeprefix("switch.").removesuffix(IRRIGATION_SWITCH_SUFFIX)
    return f"sensor.{prefix}{SUMMATION_SENSOR_SUFFIX}"
