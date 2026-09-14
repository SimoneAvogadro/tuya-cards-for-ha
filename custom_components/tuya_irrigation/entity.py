"""Device attachment shared by every entity this integration owns.

The entities belong on the valve's ZHA device, but they must NOT claim it
through ``DeviceInfo`` with the ZHA device's identifiers: since HA 2026.8 a
device belongs to a single config entry, so a foreign identifier claim gives
this integration its own duplicate "sibling" device (same identifiers and
name, no switch — observed live on 2026-09-14). What HA actually reads for
device pages, device actions and the service device picker is the entity
registry's ``device_id``, so the entities register with no device at all and
move themselves onto the right one as soon as they are added.

Same approach as ``SwvAttachedEntity`` in zha-sonoff-quirks, which proved it
on the same HA instance. Mix it in FIRST, before the platform's entity class.
"""
from __future__ import annotations

from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import Entity


class ValveAttachedEntity(Entity):
    """An entity that hooks itself onto the ZHA device of a valve switch."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, device: dr.DeviceEntry, switch_entity: str) -> None:
        """Remember the target ZHA device and the switch."""
        self._switch_entity = switch_entity
        # Deliberately NO _attr_device_info (see module docstring).
        self._target_device_id = device.id

    async def async_added_to_hass(self) -> None:
        """Move the entity onto the valve's ZHA device."""
        await super().async_added_to_hass()
        ent_reg = er.async_get(self.hass)
        reg_entry = ent_reg.async_get(self.entity_id)
        if reg_entry is not None and reg_entry.device_id != self._target_device_id:
            ent_reg.async_update_entity(
                self.entity_id, device_id=self._target_device_id
            )
