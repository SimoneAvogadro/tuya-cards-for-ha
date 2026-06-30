"""Per-valve irrigation run log — the system of record for irrigation history.

Recording hangs off the **valve switch entity's state**, the one signal common
to every run origin (this integration's services, a bare ``switch.turn_on``, an
automation, the device's physical button, the firmware's own auto-off). The
services still own *closing* the valve; they only provide enrichment
(mode/target/outcome/source) that this observer folds in when a run was
integration-started.

Durability: each finalized run is appended to a ``helpers.storage.Store`` JSON
file under ``.storage/`` — atomic, versioned, outside the recorder DB (no bloat,
no purge), and surviving HA restarts and the device dropping its DPs. An
``in_flight`` snapshot lets a run that spans a restart still be recorded.

On each finalized run the manager also:
  * bumps a per-valve cumulative ``water_total_l`` (the device's own
    ``summation_delivered`` is a per-session counter that resets, so we keep our
    own total — surfaced by the ``water_total`` sensor for HA's water dashboard),
  * dispatches ``history_signal(switch)`` so the two history sensors refresh, and
  * fires the un-namespaced ``irrigation_completed`` event for automations.
"""
from __future__ import annotations

import asyncio
import logging

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    EVENT_IRRIGATION_COMPLETED,
    LITERS_SETTLE,
    MIN_RUN_S,
    RUNS_STORE_CAP,
    STORAGE_KEY,
    STORAGE_VERSION,
    SUMMATION_SUFFIX,
    history_signal,
)
from .discovery import find_valve_devices, valve_switch_for_device

_LOGGER = logging.getLogger(__name__)


def _empty_valve() -> dict:
    """Fresh per-valve record."""
    return {"water_total_l": 0.0, "in_flight": None, "runs": []}


class IrrigationRunLog:
    """Observes valve switches and records every completed irrigation run."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict = {"valves": {}}
        self._unsubs: dict[str, callable] = {}
        self._reg_unsub: callable | None = None
        # switch -> asyncio.Task awaiting the post-close grace before finalizing.
        self._finalize_tasks: dict[str, asyncio.Task] = {}
        # switch -> ISO of the REAL off-transition, captured when the grace starts
        # so the deferred finalize records the true close time, not now+grace.
        self._off_at: dict[str, str] = {}

    # ── lifecycle ──
    async def async_setup(self) -> None:
        """Load the store, subscribe to valves, recover any in-flight run."""
        loaded = await self._store.async_load()
        if isinstance(loaded, dict) and "valves" in loaded:
            self._data = loaded
        self._data.setdefault("valves", {})
        self._refresh_subscriptions()
        self._reg_unsub = self.hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED, self._on_registry_updated
        )
        await self._recover_in_flight()

    async def async_unload(self) -> None:
        """Unsubscribe and flush the store."""
        for unsub in self._unsubs.values():
            unsub()
        self._unsubs.clear()
        if self._reg_unsub is not None:
            self._reg_unsub()
            self._reg_unsub = None
        for switch in list(self._finalize_tasks):
            self._cancel_finalize(switch)
        self._off_at.clear()
        await self._store.async_save(self._data)

    # ── subscriptions / discovery ──
    @callback
    def _refresh_subscriptions(self) -> None:
        """Subscribe to the switch of every discovered valve (idempotent)."""
        switches: set[str] = set()
        for device_id in find_valve_devices(self.hass):
            sw = valve_switch_for_device(self.hass, device_id)
            if sw:
                switches.add(sw)
        for sw in switches - set(self._unsubs):
            self._unsubs[sw] = async_track_state_change_event(
                self.hass, [sw], self._on_state_change
            )
            _LOGGER.debug("Run log now tracking %s", sw)

    @callback
    def _on_registry_updated(self, _event: Event) -> None:
        # A valve paired after setup registers its switch here; pick it up.
        self._refresh_subscriptions()

    # ── state observation ──
    @callback
    def _on_state_change(self, event: Event) -> None:
        switch: str = event.data["entity_id"]
        new = event.data.get("new_state")
        if new is None:
            return
        state = new.state
        valve = self._data["valves"].get(switch)
        has_inflight = bool(valve and valve.get("in_flight"))
        if state == "on":
            # Reopened (possibly after a transient drop within the grace window):
            # keep the run going rather than finalizing it. That earlier off is no
            # longer a run-end, so drop its captured time — otherwise a later
            # off-less finalize (force-finalize) could consume a stale flap stamp.
            self._cancel_finalize(switch)
            self._off_at.pop(switch, None)
            if not has_inflight:
                self._open_run(switch)
        elif state == "off":
            if has_inflight:
                self._schedule_finalize(switch)
        # 'unavailable' / 'unknown': ignore — a Zigbee drop must not end a run.

    @callback
    def _open_run(self, switch: str) -> None:
        valve = self._data["valves"].setdefault(switch, _empty_valve())
        if valve.get("in_flight"):
            return
        pending = (self.hass.data.get(DOMAIN, {}).get("pending", {}) or {}).get(
            switch
        ) or {}
        valve["in_flight"] = {
            "start": dt_util.utcnow().isoformat(),
            "summation_base": self._read_summation(switch),
            "source": pending.get("source", "manual"),
            "mode": pending.get("mode"),
            "target": pending.get("target"),
        }
        _LOGGER.debug("Run opened on %s (%s)", switch, valve["in_flight"]["source"])
        self._save()

    @callback
    def _schedule_finalize(self, switch: str) -> None:
        self._cancel_finalize(switch)
        # Capture the REAL off-transition time now; the grace below only defers
        # reading the final summation — it must not inflate the recorded duration.
        self._off_at[switch] = dt_util.utcnow().isoformat()
        self._finalize_tasks[switch] = self.hass.async_create_task(
            self._finalize_after_grace(switch)
        )

    @callback
    def _cancel_finalize(self, switch: str) -> None:
        task = self._finalize_tasks.pop(switch, None)
        if task and not task.done():
            task.cancel()

    async def _finalize_after_grace(self, switch: str) -> None:
        try:
            await asyncio.sleep(LITERS_SETTLE)
        except asyncio.CancelledError:
            return
        self._finalize_tasks.pop(switch, None)
        await self._finalize(switch)

    async def _finalize(self, switch: str, reason_override: str | None = None) -> None:
        valve = self._data["valves"].get(switch)
        if not valve or not valve.get("in_flight"):
            return
        inf = valve["in_flight"]
        start = dt_util.parse_datetime(inf.get("start", "")) if inf.get("start") else None
        # End = the real off-transition time captured at _schedule_finalize, so the
        # grace delay never inflates it. Falls back to now for the shutdown-recovery
        # and force-finalize paths where no off was observed for this switch.
        off_iso = self._off_at.pop(switch, None)
        end = (dt_util.parse_datetime(off_iso) if off_iso else None) or dt_util.utcnow()
        duration_s = (end - start).total_seconds() if start else 0.0

        pending = (self.hass.data.get(DOMAIN, {}).get("pending", {}) or {}).pop(
            switch, None
        ) or {}

        delivered = pending.get("delivered")
        if delivered is None:
            delivered = self._delta_liters(
                inf.get("summation_base"), self._read_summation(switch)
            )

        source = inf.get("source", "manual")
        if reason_override is not None:
            reason = reason_override
        else:
            reason = pending.get("reason") or (
                "manual_off" if source == "manual" else "auto_off"
            )

        # Discard sub-MIN_RUN_S *manual* toggles/glitches (a physical double-tap or
        # a Zigbee blip). Never discard an integration-driven run — the by_seconds
        # service allows a deliberate 1s run — nor a restart-recovered / force-
        # closed run (reason_override marks those paths).
        if reason_override is None and source == "manual" and duration_s < MIN_RUN_S:
            valve["in_flight"] = None
            self._save()
            _LOGGER.debug("Discarded %s manual flap (%.1fs)", switch, duration_s)
            return

        record = {
            "start": inf.get("start"),
            "end": end.isoformat(),
            "duration_s": int(round(duration_s)),
            "liters": round(delivered, 2) if delivered is not None else None,
            "mode": inf.get("mode"),
            "target": inf.get("target"),
            "source": source,
            "reason": reason,
        }
        runs = valve.setdefault("runs", [])
        runs.insert(0, record)
        del runs[RUNS_STORE_CAP:]
        if delivered:
            valve["water_total_l"] = round(
                float(valve.get("water_total_l", 0.0)) + float(delivered), 2
            )
        valve["in_flight"] = None
        self._save()

        async_dispatcher_send(self.hass, history_signal(switch))
        self._fire_event(switch, record)
        _LOGGER.info(
            "Recorded irrigation on %s: %ss, %s L (%s/%s)",
            switch,
            record["duration_s"],
            record["liters"],
            source,
            reason,
        )

    async def _recover_in_flight(self) -> None:
        """Finalize runs whose close we missed while HA was down.

        A non-None ``in_flight`` at startup means a run was open at the previous
        shutdown (or its finalize was cancelled during unload). Keep it ONLY if
        the switch is *confirmed still on* — then the run is genuinely continuing
        and the live observer will finalize it. In every other case (off,
        unavailable/unknown, or the switch entity not loaded yet) finalize it
        best-effort with reason ``shutdown``. Leaving a stale ``in_flight`` would
        otherwise suppress the next run's open and corrupt its duration.
        """
        for switch, valve in list(self._data["valves"].items()):
            if not valve.get("in_flight"):
                continue
            state = self.hass.states.get(switch)
            if state is not None and state.state == "on":
                continue
            await self._finalize(switch, reason_override="shutdown")

    async def async_force_finalize(self, switch: str, reason: str = "stopped") -> None:
        """Immediately record an open run, used when a new run supersedes it.

        Starting a run on a valve that already has one running closes the valve
        and reopens it within the run log's grace window; without this the
        observer would treat the reopen as a transient flap and merge the two
        runs into one corrupted record (dropping the first run's water). We cancel
        the pending grace timer (so it can't later finalize the *new* run that
        reuses the switch) and record the prior run now — ``_finalize`` uses the
        off time already captured for the superseded run when present.
        """
        if not self._data["valves"].get(switch, {}).get("in_flight"):
            return
        self._cancel_finalize(switch)
        await self._finalize(switch, reason_override=reason)

    @callback
    def is_running(self, switch: str) -> bool:
        """Whether a run is currently in-flight for this switch."""
        return bool(self._data["valves"].get(switch, {}).get("in_flight"))

    # ── helpers ──
    @callback
    def _read_summation(self, switch: str) -> float | None:
        prefix = switch[len("switch.") :]
        ent = f"sensor.{prefix}{SUMMATION_SUFFIX}"
        st = self.hass.states.get(ent)
        if st is None or st.state in ("unknown", "unavailable", "none", ""):
            return None
        try:
            return float(st.state)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _delta_liters(base: float | None, final: float | None) -> float | None:
        """Liters delivered between two summation samples, reset-safe.

        ``summation_delivered`` is a per-session counter that may reset to 0
        during a run; a decrease therefore means the reading itself is the
        session total (mirrors the accumulation logic in ``_run_liters``).
        """
        if final is None:
            return None
        if base is None:
            return max(0.0, final)
        return (final - base) if final >= base else final

    @callback
    def _device_id_for(self, switch: str) -> str | None:
        entry = er.async_get(self.hass).async_get(switch)
        return entry.device_id if entry else None

    @callback
    def _fire_event(self, switch: str, record: dict) -> None:
        self.hass.bus.async_fire(
            EVENT_IRRIGATION_COMPLETED,
            {
                "switch_entity": switch,
                "device_id": self._device_id_for(switch),
                **record,
            },
        )

    @callback
    def _save(self) -> None:
        self._store.async_delay_save(lambda: self._data, 1)

    # ── read accessors (used by the sensor entities) ──
    @callback
    def runs_for(self, switch: str) -> list[dict]:
        return list(self._data["valves"].get(switch, {}).get("runs", []))

    @callback
    def last_run(self, switch: str) -> dict | None:
        runs = self._data["valves"].get(switch, {}).get("runs", [])
        return runs[0] if runs else None

    @callback
    def water_total(self, switch: str) -> float:
        return float(self._data["valves"].get(switch, {}).get("water_total_l", 0.0))
