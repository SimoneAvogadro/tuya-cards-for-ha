"""Irrigation history sensors, one pair per detected valve.

Two entities per valve, both attached to the valve's (ZHA) device by reusing its
identifiers/connections (same merge trick as ``binary_sensor.py``):

  * ``sensor.<prefix>_irrigation_history`` — state is the timestamp of the last
    completed run; its ``runs`` attribute carries the recent run list the card
    reads. The (potentially large) ``runs`` attribute is excluded from the
    recorder so it never bloats the database.
  * ``sensor.<prefix>_irrigation_water_total`` — a cumulative liters counter
    (``total_increasing`` / ``water``) that feeds HA's native water dashboard and
    long-term statistics.

Both pull their values from the :class:`IrrigationRunLog` manager and refresh on
its ``history_signal`` dispatch.
"""
from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfVolume
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    HISTORY_SUFFIX,
    RUNS_ATTR_CAP,
    WATER_TOTAL_SUFFIX,
    history_signal,
)
from .discovery import find_valve_devices, valve_switch_for_device
from .history import IrrigationRunLog


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the history + water-total sensors for each detected valve."""
    dev_reg = dr.async_get(hass)
    added_switches: set[str] = set()

    @callback
    def _add_new_valves() -> None:
        run_log: IrrigationRunLog = hass.data[DOMAIN]["run_log"]
        new_entities: list[SensorEntity] = []
        for device_id in find_valve_devices(hass):
            switch_entity = valve_switch_for_device(hass, device_id)
            if switch_entity is None or switch_entity in added_switches:
                continue
            device = dev_reg.async_get(device_id)
            if device is None:
                continue
            added_switches.add(switch_entity)
            new_entities.append(
                IrrigationHistorySensor(device, switch_entity, run_log)
            )
            new_entities.append(
                IrrigationWaterTotalSensor(device, switch_entity, run_log)
            )
        if new_entities:
            async_add_entities(new_entities)

    _add_new_valves()

    @callback
    def _registry_updated(_event: Event) -> None:
        _add_new_valves()

    entry.async_on_unload(
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, _registry_updated)
    )


class _ValveHistoryEntity(SensorEntity):
    """Shared device-merge + run-log subscription for the history sensors."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        device: dr.DeviceEntry,
        switch_entity: str,
        run_log: IrrigationRunLog,
        suffix: str,
    ) -> None:
        self._switch_entity = switch_entity
        self._run_log = run_log
        prefix = switch_entity[len("switch.") :]
        # Deterministic entity_id derived from the switch prefix, so the card can
        # discover it via the same suffix convention used for every other entity.
        self.entity_id = f"sensor.{prefix}{suffix}"
        self._attr_device_info = DeviceInfo(
            identifiers=device.identifiers,
            connections=device.connections,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                history_signal(self._switch_entity),
                self._handle_update,
            )
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()


class IrrigationHistorySensor(_ValveHistoryEntity):
    """Timestamp of the last completed run; carries the recent-run list."""

    _attr_translation_key = "irrigation_history"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    # Keep the (potentially large) run list out of the recorder DB.
    _unrecorded_attributes = frozenset({"runs"})

    def __init__(
        self, device: dr.DeviceEntry, switch_entity: str, run_log: IrrigationRunLog
    ) -> None:
        super().__init__(device, switch_entity, run_log, HISTORY_SUFFIX)
        self._attr_unique_id = f"{DOMAIN}_history_{switch_entity}"

    @property
    def native_value(self) -> datetime | None:
        last = self._run_log.last_run(self._switch_entity)
        if not last or not last.get("end"):
            return None
        return dt_util.parse_datetime(last["end"])

    @property
    def extra_state_attributes(self) -> dict:
        runs = self._run_log.runs_for(self._switch_entity)
        return {"runs": runs[:RUNS_ATTR_CAP], "run_count": len(runs)}


class IrrigationWaterTotalSensor(_ValveHistoryEntity):
    """Cumulative liters delivered — feeds HA's water dashboard + LTS."""

    _attr_translation_key = "irrigation_water_total"
    _attr_device_class = SensorDeviceClass.WATER
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = UnitOfVolume.LITERS

    def __init__(
        self, device: dr.DeviceEntry, switch_entity: str, run_log: IrrigationRunLog
    ) -> None:
        super().__init__(device, switch_entity, run_log, WATER_TOTAL_SUFFIX)
        self._attr_unique_id = f"{DOMAIN}_water_total_{switch_entity}"

    @property
    def native_value(self) -> float:
        return round(self._run_log.water_total(self._switch_entity), 2)
