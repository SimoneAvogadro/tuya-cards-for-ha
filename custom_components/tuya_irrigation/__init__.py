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
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
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
    running_signal,
)

# Import for side-effect: registers bundled ZHA quirks into zigpy's global
# registry. Needs to happen at module load time so ZHA picks them up before
# enumerating devices.
from . import quirks  # noqa: F401, E402
from .history import IrrigationRunLog

_LOGGER = logging.getLogger(__name__)

# Seconds to wait after pushing the device clock before opening the valve, so the
# Tuya MCU applies the pushed time before it stamps irrigation_start_time. The
# 0x24 time command is fire-and-forget (no ack), hence a fixed settle delay.
_TIME_SYNC_SETTLE = 1.5

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR, Platform.SENSOR]

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
    # Every switch entity this integration has ever driven during this HA
    # session. Used as the authoritative list to sweep on shutdown/unload,
    # so a valve left open (e.g. because a prior turn_off call failed or a
    # task was killed before its finally ran) still gets closed.
    managed_switches: set[str] = set()
    hass.data.setdefault(DOMAIN, {}).update(
        {
            "active_tasks": active_tasks,
            "managed_switches": managed_switches,
            # Transient per-switch enrichment the run-log observer folds into a
            # record (mode/target/source at open; reason/delivered at close).
            "pending": {},
        }
    )

    # System of record for irrigation history. Set up (store loaded + valve
    # subscriptions live) BEFORE the sensor platform, so its entities find a
    # populated run log the moment they are added.
    run_log = IrrigationRunLog(hass)
    await run_log.async_setup()
    hass.data[DOMAIN]["run_log"] = run_log

    await _async_register_frontend(hass)
    _async_register_services(hass, active_tasks, managed_switches)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def _async_stop(event) -> None:
        """On HA shutdown, close every valve this integration opened."""
        await _async_close_all_valves(hass, active_tasks, managed_switches)

    entry.async_on_unload(
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _async_stop)
    )
    _LOGGER.info("Tuya Irrigation v%s integration loaded", VERSION)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Close open valves, cancel running tasks, unregister services."""
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    domain_data = hass.data.get(DOMAIN, {})
    active_tasks: dict[str, asyncio.Task] = domain_data.get("active_tasks", {})
    managed_switches: set[str] = domain_data.get("managed_switches", set())
    await _async_close_all_valves(hass, active_tasks, managed_switches)
    run_log: IrrigationRunLog | None = domain_data.get("run_log")
    if run_log is not None:
        await run_log.async_unload()
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_SECONDS)
    hass.services.async_remove(DOMAIN, SERVICE_IRRIGATION_BY_LITERS)
    hass.data.pop(DOMAIN, None)
    # Static path and Lovelace resource stay registered — HA doesn't expose
    # a clean way to undo them, and leaving them idle is harmless.
    return True


async def _async_close_all_valves(
    hass: HomeAssistant,
    active_tasks: dict[str, asyncio.Task],
    managed_switches: set[str],
) -> None:
    """Cancel running timers and force-close any valve this integration ever opened.

    Two-pass design:
      1. Cancel active tasks so their own `finally: turn_off` runs and they
         don't race us by re-opening a valve we're about to close.
      2. Explicit safety sweep: for each switch we have ever managed, if HA
         still reports it 'on', call switch.turn_off directly. Covers the
         cases where the task's finally got cut short or a previous turn_off
         silently failed.
    """
    # Pass 1: cancel active timers, wait briefly for their finally blocks.
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
                "Timed out waiting for irrigation tasks to finish — "
                "falling through to explicit valve close"
            )

    # Pass 2: explicit close for every managed valve still reporting 'on'.
    for switch_entity in list(managed_switches):
        state = hass.states.get(switch_entity)
        if state is None or state.state != "on":
            continue
        _LOGGER.warning(
            "Shutdown safety: closing open irrigation valve %s", switch_entity
        )
        try:
            await hass.services.async_call(
                "switch",
                "turn_off",
                {"entity_id": switch_entity},
                blocking=True,
            )
        except Exception as err:  # pragma: no cover - defensive
            _LOGGER.error(
                "Shutdown safety: failed to close %s: %s", switch_entity, err
            )


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


async def _async_push_run_plan(
    hass: HomeAssistant, switch_entity: str, mode: str, target: int
) -> None:
    """Best-effort: write the run's MODE + TARGET to the valve before opening it.

    The GiEX QT06 exposes ``select.<prefix>_irrigation_mode`` ("Duration" /
    "Capacity") and ``number.<prefix>_irrigation_target`` (seconds or liters).
    Until something writes them they read 'unknown', because we drive the valve
    via the raw switch and bypass the device's native irrigation UI. Writing
    them here makes the device echo the values back AND compute
    ``irrigation_end_time = start + target`` — which the card reads to render an
    accurate, refresh-proof progress bar (works even for automation-started runs
    since this runs inside the service).

    The device's own native timer is NOT trusted for closing the valve — the
    integration's server-side task still closes it. These writes are display-only
    and fully guarded: any failure is logged and swallowed.
    """
    prefix = switch_entity[len("switch.") :]
    mode_entity = f"select.{prefix}_irrigation_mode"
    target_entity = f"number.{prefix}_irrigation_target"
    try:
        if hass.states.get(mode_entity) is not None:
            await hass.services.async_call(
                "select",
                "select_option",
                {"entity_id": mode_entity, "option": mode},
                blocking=True,
            )
        if hass.states.get(target_entity) is not None:
            await hass.services.async_call(
                "number",
                "set_value",
                {"entity_id": target_entity, "value": target},
                blocking=True,
            )
        _LOGGER.info(
            "Pushed run plan to %s: mode=%s target=%s", switch_entity, mode, target
        )
    except Exception as err:  # noqa: BLE001 - best-effort, never block irrigation
        _LOGGER.warning(
            "Run-plan push to %s failed (non-fatal): %s", switch_entity, err
        )


def _async_register_services(
    hass: HomeAssistant,
    active_tasks: dict[str, asyncio.Task],
    managed_switches: set[str],
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

    def _set_pending(switch_entity: str, **fields) -> None:
        """Stash run-log enrichment the switch observer folds into the record.

        Best-effort and non-blocking. Only applies while the run is still
        in-flight: if the valve already closed early (device auto-off / external
        turn-off) the observer has finalized and popped pending, so a late write
        here would resurrect a stale entry and mislabel the NEXT run — skip it.
        ``reason``/``delivered`` set before the valve closes still land normally.
        """
        run_log = hass.data.get(DOMAIN, {}).get("run_log")
        if run_log is not None and not run_log.is_running(switch_entity):
            return
        pending = hass.data.get(DOMAIN, {}).setdefault("pending", {})
        pending.setdefault(switch_entity, {}).update(fields)

    async def _async_begin_run(
        switch_entity: str, mode: str, target: int, run_coro
    ) -> None:
        """Shared start sequence for both irrigation services.

        All three entry points (card, service call, device action) funnel through
        the two services, and both services funnel through here — so the start
        logic lives in exactly one place.

        Order matters: write the run plan (MODE+TARGET DPs) and sync the device
        clock, wait the settle, THEN start the monitoring task and open the valve
        last. That way the device stamps start_time/end_time with the target + a
        correct RTC (it computes end_time = start + target). Both pushes are
        best-effort and never block irrigation; the server-side `run_coro` task
        still owns closing the valve regardless of the device's native auto-off.

        `run_coro` is the (already-created, not-yet-scheduled) `_run_seconds` /
        `_run_liters` coroutine; it is scheduled here after the settle. Cancelling
        any in-flight run runs before we register ours, so the cancelled task's
        finally (executing during these awaits) closes the valve cleanly before we
        open ours.
        """
        _cancel_existing(switch_entity)
        managed_switches.add(switch_entity)
        await _async_push_run_plan(hass, switch_entity, mode, target)
        await _async_push_device_time(hass, switch_entity)
        await asyncio.sleep(_TIME_SYNC_SETTLE)
        task = hass.async_create_task(run_coro)
        active_tasks[switch_entity] = task
        # Guarantee a clean off->on edge so the observer attaches THIS run to the
        # _turn_on below. If the valve is already open we are superseding a prior
        # run whose valve the cancel above didn't close — a *manual* run (physical
        # button / Tuya app / bare switch.turn_on) with no task, or a valve left on
        # across a restart. Close it first; otherwise _turn_on is a no-op on an
        # already-open valve and the new run is never recorded (its pending then
        # leaks into the next run). Then record any prior run the log still has
        # open as its own run (with a correct end time), instead of merging it.
        run_log = hass.data.get(DOMAIN, {}).get("run_log")
        state = hass.states.get(switch_entity)
        if state is not None and state.state == "on":
            await _turn_off(switch_entity)
        if run_log is not None and run_log.is_running(switch_entity):
            await run_log.async_force_finalize(switch_entity)
        # The switch observer reads this when the valve opens, tagging the
        # recorded run as integration-driven with its requested mode/target. A
        # fresh dict each run discards any stale reason/delivered from before.
        hass.data.get(DOMAIN, {}).setdefault("pending", {})[switch_entity] = {
            "mode": mode,
            "target": target,
            "source": "integration",
        }
        await _turn_on(switch_entity)

    async def _run_seconds(switch_entity: str, seconds: int) -> None:
        """Sleep for `seconds`, then close the valve. Cancellation-safe."""
        my_task = asyncio.current_task()
        async_dispatcher_send(hass, running_signal(switch_entity), True)
        _LOGGER.info("Irrigation on %s for %d seconds (started)", switch_entity, seconds)
        try:
            await asyncio.sleep(seconds)
            _set_pending(switch_entity, reason="completed")
            _LOGGER.info("Timer expired on %s — closing valve", switch_entity)
        except asyncio.CancelledError:
            _LOGGER.info("Irrigation on %s cancelled", switch_entity)
            raise
        finally:
            # Only touch the valve + dict if we are still the registered task.
            # If a newer call has replaced us, it is responsible for the valve
            # (and keeps the running signal True), so we must not clear it.
            if active_tasks.get(switch_entity) is my_task:
                active_tasks.pop(switch_entity, None)
                async_dispatcher_send(hass, running_signal(switch_entity), False)
                await _turn_off(switch_entity)

    async def _run_liters(
        switch_entity: str,
        liters: float,
        timeout_seconds: int,
        summation_entity: str,
    ) -> None:
        """Turn valve on, watch summation_delivered, close when target reached."""
        my_task = asyncio.current_task()
        async_dispatcher_send(hass, running_signal(switch_entity), True)

        # summation_delivered on these valves is a PER-SESSION counter that resets
        # to 0 shortly after the valve opens (verified on _TZE200_a7sghmms); it can
        # also still hold the previous session's value at open time. So we do not
        # treat the sensor as an absolute lifetime total — instead we accumulate the
        # volume delivered since we started, treating any decrease in the reading as
        # a counter reset (matching HA's total_increasing semantics). This is robust
        # whether the device resets per session or accumulates across sessions.
        start_state = hass.states.get(summation_entity)
        try:
            prev_reading = float(start_state.state) if start_state else 0.0
        except (TypeError, ValueError):
            prev_reading = 0.0
        delivered = 0.0
        done = asyncio.Event()

        @callback
        def _listener(event) -> None:
            nonlocal prev_reading, delivered
            new_state = event.data.get("new_state")
            if new_state is None or new_state.state in ("unknown", "unavailable"):
                return
            try:
                current = float(new_state.state)
            except (TypeError, ValueError):
                return
            if current >= prev_reading:
                delivered += current - prev_reading
            else:
                # Counter reset (e.g. device zeroed for a new session): the
                # increment since the reset is the new value itself.
                delivered += current
            prev_reading = current
            if delivered >= liters:
                _LOGGER.info(
                    "%s reached target: delivered %.3f >= %.3f L",
                    summation_entity,
                    delivered,
                    liters,
                )
                done.set()

        unsub = async_track_state_change_event(hass, [summation_entity], _listener)
        _LOGGER.info(
            "Irrigation on %s for %.3f L (timeout %ds, started)",
            switch_entity,
            liters,
            timeout_seconds,
        )
        try:
            await asyncio.wait_for(done.wait(), timeout=timeout_seconds)
            _set_pending(switch_entity, reason="completed")
        except asyncio.TimeoutError:
            _set_pending(switch_entity, reason="timeout")
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
                # Hand the precise server-measured volume to the run-log observer,
                # which prefers it over the summation-delta estimate.
                _set_pending(switch_entity, delivered=delivered)
                active_tasks.pop(switch_entity, None)
                async_dispatcher_send(hass, running_signal(switch_entity), False)
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

        await _async_begin_run(
            switch_entity, "Duration", seconds, _run_seconds(switch_entity, seconds)
        )

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

        await _async_begin_run(
            switch_entity,
            "Capacity",
            int(round(liters)),
            _run_liters(switch_entity, liters, timeout_seconds, summation_entity),
        )

    hass.services.async_register(
        DOMAIN, SERVICE_IRRIGATION_BY_SECONDS, _handle_seconds, schema=SECONDS_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_IRRIGATION_BY_LITERS, _handle_liters, schema=LITERS_SCHEMA
    )
