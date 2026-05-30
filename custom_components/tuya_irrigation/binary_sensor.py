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
