"""Device actions for Tuya Irrigation."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.const import CONF_DEVICE_ID, CONF_DOMAIN, CONF_TYPE
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import config_validation as cv, device_registry as dr, entity_registry as er
from homeassistant.helpers.entity_registry import async_entries_for_device

from .const import DOMAIN

ACTION_BY_SECONDS = "irrigate_by_seconds"
ACTION_BY_LITERS = "irrigate_by_liters"

ACTION_TYPES = {ACTION_BY_SECONDS, ACTION_BY_LITERS}

ACTION_SCHEMA = cv.DEVICE_ACTION_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_TYPE): vol.In(ACTION_TYPES),
        vol.Optional("seconds"): vol.Coerce(int),
        vol.Optional("liters"): vol.Coerce(float),
        vol.Optional("timeout_seconds"): vol.Coerce(int),
    }
)


async def async_get_actions(
    hass: HomeAssistant, device_id: str
) -> list[dict]:
    """List device actions for Tuya Irrigation devices."""
    registry = er.async_get(hass)
    actions: list[dict] = []

    # Only expose actions if the device has a switch entity.
    has_switch = any(
        entry.domain == "switch"
        for entry in async_entries_for_device(registry, device_id, include_disabled_entities=False)
    )
    if not has_switch:
        return actions

    base = {CONF_DEVICE_ID: device_id, CONF_DOMAIN: DOMAIN}
    actions.append({**base, CONF_TYPE: ACTION_BY_SECONDS})
    actions.append({**base, CONF_TYPE: ACTION_BY_LITERS})
    return actions


def _resolve_switch(hass: HomeAssistant, device_id: str) -> str | None:
    """Return the first switch entity_id for the device, or None."""
    registry = er.async_get(hass)
    for entry in async_entries_for_device(registry, device_id, include_disabled_entities=False):
        if entry.domain == "switch":
            return entry.entity_id
    return None


async def async_call_action_from_config(
    hass: HomeAssistant, config: dict, variables: dict, context: Context | None
) -> None:
    """Execute a device action."""
    action_type = config[CONF_TYPE]
    switch_entity = _resolve_switch(hass, config[CONF_DEVICE_ID])
    if switch_entity is None:
        return

    if action_type == ACTION_BY_SECONDS:
        await hass.services.async_call(
            DOMAIN,
            "irrigation_by_seconds",
            {"switch_entity": switch_entity, "seconds": config.get("seconds", 60)},
            blocking=False,
            context=context,
        )
    elif action_type == ACTION_BY_LITERS:
        data = {"switch_entity": switch_entity, "liters": config.get("liters", 1.0)}
        if "timeout_seconds" in config:
            data["timeout_seconds"] = config["timeout_seconds"]
        await hass.services.async_call(
            DOMAIN,
            "irrigation_by_liters",
            data,
            blocking=False,
            context=context,
        )


async def async_get_action_capabilities(
    hass: HomeAssistant, config: dict
) -> dict:
    """List action capabilities (extra fields)."""
    action_type = config[CONF_TYPE]
    fields: dict = {}

    if action_type == ACTION_BY_SECONDS:
        fields[vol.Optional("seconds", default=60)] = vol.Coerce(int)
    elif action_type == ACTION_BY_LITERS:
        fields[vol.Optional("liters", default=1.0)] = vol.Coerce(float)
        fields[vol.Optional("timeout_seconds")] = vol.Coerce(int)

    return {"extra_fields": vol.Schema(fields)}


# Lint/registration note: HA imports this module by name; nothing else to wire up.
# The `dr` and `cv` imports are part of the documented device_action contract.
