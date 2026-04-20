"""Config flow for the Tuya Irrigation integration.

The integration has no user-visible options — all parameters are per-call
service data. This flow exists purely so the user can enable the
integration from the UI (Settings → Devices & Services → Add Integration)
instead of editing configuration.yaml.

A single config entry is sufficient; repeated attempts abort as
'already_configured'.
"""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class TuyaIrrigationConfigFlow(ConfigFlow, domain=DOMAIN):
    """Singleton config flow: one click, no inputs."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the user clicking 'Add Integration'."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title="Tuya Irrigation", data={})
