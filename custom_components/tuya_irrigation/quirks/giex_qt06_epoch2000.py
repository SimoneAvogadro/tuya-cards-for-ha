"""Custom ZHA quirk override: GiEX QT06 / GX02 valve family with 2000-epoch MCU sync.

Symptoms on `_TZE200_a7sghmms` (and other TS0601 GiEX QT06 variants) under ZHA:

  * Battery drains in days/weeks instead of months, even when the valve is idle.
  * `irrigation_end_time` sensor flaps continuously to "today + N hours", with
    rapid back-to-back updates visible in the device's Activity panel.
  * Marginal RSSI (-80 dBm or worse) even when a Tuya router is nearby.

Suspected root cause:
  Tuya MCU devices send `commandMcuSyncTime` (cluster 0xEF00, command 0x24)
  on a periodic schedule. Upstream `TuyaMCUCluster.handle_set_time_request`
  in zha-device-handlers answers using a **1970-01-01 epoch** by default.
  The GiEX firmware family appears to expect a **2000-01-01 epoch** ("Tuya
  epoch") - when it gets a 1970-based timestamp, it discards the response,
  leaves its internal clock at zero, and re-fires `commandMcuSyncTime`
  aggressively. The retry storm explains both the battery drain and the
  bogus end-time values.

  See:
    - https://github.com/zigpy/zha-device-handlers/blob/dev/zhaquirks/tuya/mcu/__init__.py
      (TuyaMCUCluster.handle_set_time_request and the set_time_offset default)
    - https://github.com/Koenkk/zigbee2mqtt/issues/19817
      (Tuya devices flooding when MCU sync requests go unanswered)
    - https://github.com/zigpy/zha-device-handlers/issues/2682
      (analogous time-sync bug in MOES thermostat path)

What this file does:
  Subclasses `TuyaMCUCluster` with `set_time_offset` / `set_time_local_offset`
  pinned to 2000-01-01, then re-registers the upstream `gx02_base_quirk`
  with our cluster as the replacement. zigpy's QuirksV2 registry uses
  last-registered-wins for the same `(manufacturer, model)` tuple; HA loads
  `custom_quirks_path` after upstream zha-device-handlers, so our entry
  takes precedence.

Deploy:
  1. In `configuration.yaml` make sure ZHA points to a custom quirks path:
        zha:
          custom_quirks_path: /config/custom_zha_quirks
     (Pick any path you like; the convention is `/config/custom_zha_quirks`.)

  2. Copy this file to that path:
        /config/custom_zha_quirks/giex_qt06_epoch2000.py

  3. Restart Home Assistant.

  4. Settings -> Devices -> "Irrigatore 31" -> Reconfigure (top-right menu).

  5. Verify in logs (Settings -> System -> Logs, or `home-assistant.log`):
        - Search for "handle_set_time_request" - you should see periodic
          entries from `zhaquirks.tuya.mcu` showing the response payload.
          Without this fix, those entries appear but the device ignores them;
          with the fix, the device's internal clock should start advancing
          and `irrigation_end_time` should stop flapping.
        - Optionally enable debug logging for a clearer view:
            logger:
              logs:
                zhaquirks.tuya: debug
                zigpy.zcl: info

  6. Watch over 24-48h:
        - `irrigation_end_time` sensor stops flapping (changes only when an
          irrigation actually starts/stops).
        - Battery percentage stops dropping at the previous rate.
        - LQI/RSSI may also improve as fewer retransmissions are needed.

Roll back:
  Delete this file from `custom_quirks_path` and restart HA.

Compatibility note:
  Tested against zha-device-handlers `dev` as of April 2026. If upstream
  refactors `gx02_base_quirk` or `TuyaQuirkBuilder.add_to_registry`, this
  override may need updating. Pin a known-good commit in your HA snapshots
  before applying.
"""

from __future__ import annotations

import datetime

import zigpy.types as t
from zigpy.quirks.v2.homeassistant import UnitOfTime

from zhaquirks.tuya.mcu import TuyaMCUCluster
from zhaquirks.tuya.tuya_valve import gx02_base_quirk


# Tuya epoch: 2000-01-01 UTC. The default in upstream TuyaMCUCluster is
# 1970-01-01 (Unix epoch); GiEX firmware ignores responses based on it.
_TUYA_EPOCH_UTC = datetime.datetime(2000, 1, 1, tzinfo=datetime.UTC)
_TUYA_EPOCH_LOCAL = datetime.datetime(2000, 1, 1)


class GiexEpoch2000MCUCluster(TuyaMCUCluster):
    """TuyaMCUCluster that answers MCU set_time using the 2000-01-01 epoch
    that the GiEX QT06 firmware family expects, instead of 1970-01-01."""

    set_time_offset = _TUYA_EPOCH_UTC
    set_time_local_offset = _TUYA_EPOCH_LOCAL


# Matches upstream tuya_valve.py: 12 hours expressed as seconds.
_GIEX_12HRS_AS_SEC = 12 * 60 * 60


# Re-register the upstream GX02 quirk with our MCU cluster as replacement.
# We clone gx02_base_quirk to inherit all the DPs (battery, metering, on/off,
# cycles, mode, weather delay, duration, start/end time) and add the variant-
# specific DPs (target, interval) the same way upstream does for the
# a7sghmms / 7ytb3h8u family.
(
    gx02_base_quirk.clone()
    .applies_to("_TZE200_a7sghmms", "TS0601")
    .applies_to("_TZE204_a7sghmms", "TS0601")
    .applies_to("_TZE200_7ytb3h8u", "TS0601")
    .applies_to("_TZE204_7ytb3h8u", "TS0601")
    .applies_to("_TZE284_7ytb3h8u", "TS0601")
    .tuya_number(
        dp_id=104,
        attribute_name="irrigation_target",
        type=t.uint32_t,
        min_value=0,
        max_value=_GIEX_12HRS_AS_SEC,
        step=1,
        translation_key="irrigation_target",
        fallback_name="Irrigation target",
    )
    .tuya_number(
        dp_id=105,
        attribute_name="irrigation_interval",
        type=t.uint32_t,
        min_value=0,
        max_value=_GIEX_12HRS_AS_SEC,
        step=1,
        unit=UnitOfTime.SECONDS,
        translation_key="irrigation_interval",
        fallback_name="Irrigation interval",
    )
    .add_to_registry(replacement_cluster=GiexEpoch2000MCUCluster)
)
