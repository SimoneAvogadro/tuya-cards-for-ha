"""Constants for the Tuya Irrigation integration."""

DOMAIN = "tuya_irrigation"
VERSION = "2.4.1"

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

# A device qualifies as an irrigation valve if it has a switch entity AND a
# sensor entity whose device_class is one of these (water volume meter).
VALVE_VOLUME_DEVICE_CLASSES = frozenset({"volume", "water"})

# Maximum seconds the "by seconds" service accepts (mirrors SECONDS_SCHEMA).
MAX_IRRIGATION_SECONDS = 43200

# device_action type identifiers.
ACTION_IRRIGATE_LITERS = "irrigate_liters"
ACTION_IRRIGATE_SECONDS = "irrigate_seconds"

# device_action extra-field config keys.
CONF_LITERS = "liters"
CONF_DURATION = "duration"


def running_signal(switch_entity: str) -> str:
    """Dispatcher signal name carrying the running state for a valve's switch."""
    return f"{DOMAIN}_running_{switch_entity}"
