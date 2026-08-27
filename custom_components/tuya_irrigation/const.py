"""Constants for the Tuya Irrigation integration."""

DOMAIN = "tuya_irrigation"
VERSION = "2.9.0"

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

# Default safety timeout for liters mode (1 hour). This is the MAXIMUM the valve
# may stay open: the adaptive cap (see below) only ever tightens the ceiling
# below it, never extends past it. LITERS_HARD_GUARD_S is an absolute backstop
# that bounds even a larger caller-supplied timeout.
DEFAULT_LITERS_TIMEOUT = 3600

# ── Liters-mode safeguards ──
# A by-liters run closes when the target volume is delivered. Two independent
# safety nets bound a run that never reaches its target:
#   1. Stall watchdog: if no water is measured for LITERS_STALL_WINDOW_S, the
#      flow is dead (stuck sensor / no delivery) -> close. A slow but *alive*
#      run keeps resetting it and is never cut off by it.
#   2. Adaptive cap: sample the flow rate over the first LITERS_SAMPLE_WINDOW_S,
#      estimate the total run duration, and TIGHTEN the ceiling down to
#      estimate * LITERS_ESTIMATE_MARGIN when that is sooner than the caller's
#      timeout — so a run we expect to finish in 10 min is not left open a full
#      hour. The cap never exceeds the caller's timeout, nor LITERS_HARD_GUARD_S.
LITERS_SAMPLE_WINDOW_S = 120  # flow-rate sampling window (s)
LITERS_STALL_WINDOW_S = 300  # max time with no measured flow before closing (s)
LITERS_ESTIMATE_MARGIN = 1.20  # headroom applied to the estimated duration
LITERS_HARD_GUARD_S = 7200  # absolute ceiling on total runtime, caps timeout too (2 h)
LITERS_CHECK_INTERVAL_S = 5  # monitoring loop tick (s) — bounds close latency

# Entity suffix used to discover the water-delivered counter sensor from a switch entity_id.
SUMMATION_SUFFIX = "_summation_delivered"

# ── Keep-alive ──
# Battery valves (e.g. GiEX QT06) are sleepy Zigbee end devices: on a weak link
# their spontaneous reports stop reaching the coordinator and ZHA marks them
# 'unavailable' after consider_unavailable_battery (6 h default), even though the
# valve still works. We periodically read a Basic-cluster attribute off each idle
# battery valve at the zigpy level (over the air — entity-level polling only hits
# the quirk's local cache); the reply refreshes ZHA's last_seen, keeping the
# device online. 1 h gives 6 attempts per 6 h
# window (any received frame, spontaneous or poked, resets it) — comfortable
# margin, at a negligible battery cost. Drop toward 30 min if a weak-link valve
# starts going unavailable again (fewer attempts = thinner margin).
KEEPALIVE_INTERVAL_S = 3600

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


# ── Irrigation history (run log) ──

# helpers.storage.Store key + version for the per-valve run log.
STORAGE_KEY = f"{DOMAIN}_history"
STORAGE_VERSION = 1

# Event fired on the HA bus when a run finishes. Deliberately un-namespaced so
# other irrigation integrations (e.g. a future Sonoff valve) can emit the same
# event with the same schema; switch_entity + device_id disambiguate the source.
EVENT_IRRIGATION_COMPLETED = "irrigation_completed"

# Entity_id suffixes for the two integration-created history sensors. The card
# discovers the history sensor from the switch prefix using HISTORY_SUFFIX.
HISTORY_SUFFIX = "_irrigation_history"
WATER_TOTAL_SUFFIX = "_irrigation_water_total"

# Run-log retention: how many runs the Store keeps per valve, and how many the
# history sensor exposes in its `runs` attribute (kept small to stay light).
RUNS_STORE_CAP = 200
RUNS_ATTR_CAP = 50

# Seconds to wait after the valve reports 'off' before reading the final
# summation_delivered — the device often pushes the last increment shortly after
# closing, so we let it settle before finalizing the run's liters.
LITERS_SETTLE = 2.5

# Ignore on->off->on flaps shorter than this (seconds): a sub-MIN_RUN_S open is a
# toggle/glitch, not a real irrigation run, and would create a spurious record.
MIN_RUN_S = 2.0


def history_signal(switch_entity: str) -> str:
    """Dispatcher signal name fired when a valve's run log changes."""
    return f"{DOMAIN}_history_{switch_entity}"
