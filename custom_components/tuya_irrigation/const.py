"""Constants for the Tuya Irrigation integration."""

DOMAIN = "tuya_irrigation"
VERSION = "2.1.2"

# URL under which the integration serves static files (bundled Lovelace card JS).
URL_BASE = f"/{DOMAIN}"

# JS modules bundled and auto-registered as Lovelace resources.
JSMODULES = [
    {"filename": "tuya-cards.js", "version": VERSION},
]

# Service names.
SERVICE_IRRIGATION_BY_SECONDS = "irrigation_by_seconds"
SERVICE_IRRIGATION_BY_LITERS = "irrigation_by_liters"

# Service attribute keys.
ATTR_SWITCH_ENTITY = "switch_entity"
ATTR_SECONDS = "seconds"
ATTR_LITERS = "liters"
ATTR_TIMEOUT_SECONDS = "timeout_seconds"

# Default safety timeout for liters mode (1 hour).
DEFAULT_LITERS_TIMEOUT = 3600

# Entity suffix used to discover the water-delivered counter sensor from a switch entity_id.
SUMMATION_SUFFIX = "_summation_delivered"
