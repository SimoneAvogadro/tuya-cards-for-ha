"""Tuya Irrigation custom integration.

Provides server-side services to orchestrate irrigation valves that have
unreliable native auto-off behaviour (e.g. GiEX QT06 / _TZE200_a7sghmms),
and auto-registers the companion Lovelace card bundle as a Lovelace module
resource.

Services registered:
    - tuya_irrigation.irrigation_by_seconds(switch_entity, seconds)
    - tuya_irrigation.irrigation_by_liters(switch_entity, liters, timeout_seconds)
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.setup import async_when_setup

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
)

_LOGGER = logging.getLogger(__name__)

SECONDS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_SWITCH_ENTITY): cv.entity_id,
        vol.Required(ATTR_SECONDS): vol.All(vol.Coerce(int), vol.Range(min=1, max=43200)),
    }
)

LITERS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_SWITCH_ENTITY): cv.entity_id,
        vol.Required(ATTR_LITERS): vol.All(vol.Coerce(float), vol.Range(min=0.001, max=10000)),
        vol.Optional(ATTR_TIMEOUT_SECONDS, default=DEFAULT_LITERS_TIMEOUT): vol.All(
            vol.Coerce(int), vol.Range(min=60, max=86400)
        ),
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the Tuya Irrigation integration from a config entry."""
    # Per-switch asyncio.Task registry. A new call for the same switch
    # cancels the previous task; the cancelled task's finally block checks
    # task identity before touching the valve, so the new call is not
    # disturbed by the old one shutting down.
    active_tasks: dict[str, asyncio.Task] = {}
    hass.data.setdefault(DOMAIN, {})["active_tasks"] = active_tasks

    await _async_register_frontend(hass)
    _async_register_services(hass, active_tasks)

    async def _async_stop(event) -> None:
        """Cancel all running irrigation tasks and wait briefly for cleanup."""
        tasks = list(active_tasks.values())
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True), timeout=5
                )
            except asyncio.TimeoutError:
                _LOGGER.warning(
                    "Timed out waiting for irrigation tasks to finish during shutdown"
                )

    entry.async_on_unload(
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _async_stop)
    )
    _LOGGER.info("Tuya Irrigation v%s integration loaded", VERSION)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Cancel running irrigation tasks and unregister services on unload."""
    domain_data = hass.data.get(DOMAIN, {})
    active_tasks: dict[str, asyncio.Task] = domain_data.get("active_tasks", {})
    for task in list(active_tasks.values()):
        if not task.done():
            task.cancel()
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_SECONDS)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_LITERS)
    hass.data.pop(DOMAIN, None)
    # Static path and Lovelace resource stay registered — HA doesn't expose
    # a clean way to undo them, and leaving them idle is harmless.
    return True


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the bundle via a static path and auto-register it as a Lovelace module.

    The static path can be registered during async_setup_entry, but the
    Lovelace resource registration has to wait until the lovelace component
    itself is set up, hence the async_when_setup deferral.
    """
    www_dir = Path(__file__).parent / "www"
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(www_dir), False)]
        )
    except RuntimeError:
        _LOGGER.debug("Static path %s already registered", URL_BASE)

    async_when_setup(hass, "lovelace", _async_register_lovelace_resource)


async def _async_register_lovelace_resource(
    hass: HomeAssistant, _component: str
) -> None:
    """Register the card bundle as a Lovelace module resource.

    Invoked after the lovelace component has finished setting up, so
    hass.data["lovelace"] is guaranteed to be the LovelaceData dataclass
    (attributes: resource_mode, resources, dashboards, ...).
    """
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.warning(
            "Lovelace data missing after setup — cannot auto-register %s",
            URL_BASE,
        )
        return

    # Recent HA versions expose `resource_mode`; older ones exposed `mode`.
    mode = getattr(lovelace, "resource_mode", None) or getattr(lovelace, "mode", None)
    resources = getattr(lovelace, "resources", None)
    if mode != "storage" or resources is None:
        _LOGGER.warning(
            "Lovelace is in '%s' mode; add '%s/tuya-cards.js' as a module "
            "resource manually under Settings → Dashboards → Resources",
            mode,
            URL_BASE,
        )
        return

    try:
        if not resources.loaded:
            await resources.async_load()
    except Exception as err:  # pragma: no cover - defensive against HA API drift
        _LOGGER.warning("Could not load Lovelace resources: %s", err)
        return

    for module in JSMODULES:
        url = f"{URL_BASE}/{module['filename']}"
        versioned_url = f"{url}?v={module['version']}"
        found_id: str | None = None
        try:
            items = resources.async_items()
        except Exception as err:  # pragma: no cover - defensive
            _LOGGER.warning("Could not read Lovelace resources: %s", err)
            return
        for item in items:
            item_url = item.get("url", "")
            if item_url.split("?")[0] == url:
                found_id = item.get("id")
                if item_url == versioned_url:
                    _LOGGER.debug("Resource %s already up to date", versioned_url)
                    found_id = "UPTODATE"
                break
        if found_id == "UPTODATE":
            continue
        try:
            if found_id:
                await resources.async_update_item(
                    found_id, {"res_type": "module", "url": versioned_url}
                )
                _LOGGER.warning("Updated Lovelace resource: %s", versioned_url)
            else:
                await resources.async_create_item(
                    {"res_type": "module", "url": versioned_url}
                )
                _LOGGER.warning("Registered Lovelace resource: %s", versioned_url)
        except Exception as err:  # pragma: no cover - defensive
            _LOGGER.warning(
                "Could not register Lovelace resource %s: %s", versioned_url, err
            )


def _async_register_services(
    hass: HomeAssistant, active_tasks: dict[str, asyncio.Task]
) -> None:
    """Register the two irrigation services."""

    async def _turn_on(switch_entity: str) -> None:
        await hass.services.async_call(
            "switch", "turn_on", {"entity_id": switch_entity}, blocking=True
        )

    async def _turn_off(switch_entity: str) -> None:
        try:
            await hass.services.async_call(
                "switch", "turn_off", {"entity_id": switch_entity}, blocking=True
            )
        except Exception as err:  # pragma: no cover - defensive
            _LOGGER.error("Failed to turn off %s: %s", switch_entity, err)

    def _cancel_existing(switch_entity: str) -> None:
        existing = active_tasks.get(switch_entity)
        if existing and not existing.done():
            _LOGGER.info("Cancelling running irrigation task on %s", switch_entity)
            existing.cancel()

    async def _run_seconds(switch_entity: str, seconds: int) -> None:
        """Sleep for `seconds`, then close the valve. Cancellation-safe."""
        my_task = asyncio.current_task()
        _LOGGER.info("Irrigation on %s for %d seconds (started)", switch_entity, seconds)
        try:
            await asyncio.sleep(seconds)
            _LOGGER.info("Timer expired on %s — closing valve", switch_entity)
        except asyncio.CancelledError:
            _LOGGER.info("Irrigation on %s cancelled", switch_entity)
            raise
        finally:
            # Only touch the valve + dict if we are still the registered task.
            # If a newer call has replaced us, it is responsible for the valve.
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                await _turn_off(switch_entity)

    async def _run_liters(
        switch_entity: str,
        liters: float,
        timeout_seconds: int,
        summation_entity: str,
    ) -> None:
        """Turn valve on, watch summation_delivered, close when target reached."""
        my_task = asyncio.current_task()
        start_state = hass.states.get(summation_entity)
        try:
            start_volume = float(start_state.state) if start_state else 0.0
        except (TypeError, ValueError):
            start_volume = 0.0
        target_volume = start_volume + liters
        done = asyncio.Event()

        @callback
        def _listener(event) -> None:
            new_state = event.data.get("new_state")
            if new_state is None or new_state.state in ("unknown", "unavailable"):
                return
            try:
                current = float(new_state.state)
            except (TypeError, ValueError):
                return
            if current >= target_volume:
                _LOGGER.info(
                    "%s reached target: %.3f >= %.3f",
                    summation_entity,
                    current,
                    target_volume,
                )
                done.set()

        unsub = async_track_state_change_event(hass, [summation_entity], _listener)
        _LOGGER.info(
            "Irrigation on %s for %.3f L (target %.3f, timeout %ds, started)",
            switch_entity,
            liters,
            target_volume,
            timeout_seconds,
        )
        try:
            await asyncio.wait_for(done.wait(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            _LOGGER.warning(
                "Timeout on %s before volume target reached — forcing valve close",
                switch_entity,
            )
        except asyncio.CancelledError:
            _LOGGER.info("Irrigation on %s cancelled", switch_entity)
            raise
        finally:
            unsub()
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                await _turn_off(switch_entity)

    async def _handle_seconds(call: ServiceCall) -> None:
        switch_entity: str = call.data[ATTR_SWITCH_ENTITY]
        seconds: int = int(call.data[ATTR_SECONDS])

        if not switch_entity.startswith("switch."):
            _LOGGER.error(
                "irrigation_by_seconds requires a switch.* entity, got %s",
                switch_entity,
            )
            return

        _cancel_existing(switch_entity)
        # Create and register the task BEFORE any await, so the cancelled old
        # task (whose finally block will run during our first await) sees that
        # it is no longer the registered task and skips turning off the valve
        # that we are about to open.
        task = hass.async_create_task(_run_seconds(switch_entity, seconds))
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)

    async def _handle_liters(call: ServiceCall) -> None:
        switch_entity: str = call.data[ATTR_SWITCH_ENTITY]
        liters: float = float(call.data[ATTR_LITERS])
        timeout_seconds: int = int(
            call.data.get(ATTR_TIMEOUT_SECONDS, DEFAULT_LITERS_TIMEOUT)
        )

        if not switch_entity.startswith("switch."):
            _LOGGER.error(
                "irrigation_by_liters requires a switch.* entity, got %s",
                switch_entity,
            )
            return
        prefix = switch_entity[len("switch.") :]
        summation_entity = f"sensor.{prefix}{SUMMATION_SUFFIX}"
        if hass.states.get(summation_entity) is None:
            _LOGGER.error(
                "Required sensor %s not found for %s",
                summation_entity,
                switch_entity,
            )
            return

        _cancel_existing(switch_entity)
        task = hass.async_create_task(
            _run_liters(switch_entity, liters, timeout_seconds, summation_entity)
        )
        active_tasks[switch_entity] = task
        await _turn_on(switch_entity)

    hass.services.async_register(
        DOMAIN, SERVICE_IRRIGATION_BY_SECONDS, _handle_seconds, schema=SECONDS_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_IRRIGATION_BY_LITERS, _handle_liters, schema=LITERS_SCHEMA
    )
