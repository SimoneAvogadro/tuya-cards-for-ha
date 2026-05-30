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
