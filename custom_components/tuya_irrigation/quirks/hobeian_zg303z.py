"""HOBEIAN ZG-303Z Soil Moisture Sensor quirk.

Observed device behaviour (12h ZHA debug capture, 2026-05-07):

  * Soil moisture is emitted on Tuya DP 109 (raw 0-100 %).
  * Temperature is emitted both via the standard cluster 0x0402 AND via
    Tuya DP 5 on cluster 0xEF00. The DP value is scaled by 10
    (raw 180 -> 18.0 degC, matching the cluster 0x0402 reading at the
    same instant).
  * The device also periodically emits DP 3 (air humidity, redundant
    with cluster 0x0405), DP 9 (temperature unit), DP 15 (battery) and
    DPs 102/104/105/110/111/112 (calibration / sampling / threshold
    config). Z2M's reference external converter for ZG-303Z
    (Koenkk/zigbee2mqtt#30576) maps only DP 5 and DP 109 and ignores
    the rest; this quirk follows the same approach.

Why the unhandled DPs matter:
  Without a registered handler, ZHA sends a ZCL DefaultResponse with
  status UNSUPPORTED_ATTRIBUTE (0x86). The ZG-303Z is a sleepy device
  and does not poll its parent fast enough to retrieve that response,
  which manifests as a cascade of MAC_INDIRECT_TIMEOUT errors and
  floods the radio log (anomaly A2 in findings-2026-05-07).

This quirk:
  1. Maps DP 109 -> SoilMoisture.measured_value (existing).
  2. Maps DP 5  -> TemperatureMeasurement.measured_value, alongside
     the native 0x0402 reports.
  3. Registers all other observed DPs to a no-op handler so they are
     acknowledged silently instead of triggering UNSUPPORTED.

Deploy: copy this file to the path configured as `custom_quirks_path`
in HA's `configuration.yaml` (typically `/config/custom_zha_quirks/`)
and restart Home Assistant.
"""

from zigpy.profiles import zha
from zigpy.quirks import CustomDevice
from zigpy.zcl.clusters.general import Basic, Identify, PowerConfiguration
from zigpy.zcl.clusters.measurement import RelativeHumidity, SoilMoisture, TemperatureMeasurement

from zhaquirks.const import (
    DEVICE_TYPE,
    ENDPOINTS,
    INPUT_CLUSTERS,
    MODELS_INFO,
    OUTPUT_CLUSTERS,
    PROFILE_ID,
)
from zhaquirks.tuya import TuyaLocalCluster
from zhaquirks.tuya.mcu import (
    DPToAttributeMapping,
    TuyaMCUCluster,
)


class TuyaTemperatureMeasurement(TuyaLocalCluster, TemperatureMeasurement):
    """Tuya-fed Temperature cluster (also receives native 0x0402 reports)."""


class TuyaSoilMoistureCluster(TuyaLocalCluster, SoilMoisture):
    """Tuya Soil Moisture cluster."""
    cluster_id = SoilMoisture.cluster_id


# DPs the device emits but for which we don't expose a HA entity. Routed
# to a no-op handler so ZHA does not reply with UNSUPPORTED_ATTRIBUTE
# (the sleepy device fails to retrieve it -> MAC_INDIRECT_TIMEOUT cascade).
_NOOP_DPS = (3, 9, 15, 102, 104, 105, 110, 111, 112)


class SoilMoistureMCUCluster(TuyaMCUCluster):
    """Tuya MCU Cluster for ZG-303Z."""

    dp_to_attribute: dict[int, DPToAttributeMapping] = {
        5: DPToAttributeMapping(
            TuyaTemperatureMeasurement.ep_attribute,
            "measured_value",
            converter=lambda x: x * 10,  # raw 0.1 degC -> ZCL 0.01 degC
        ),
        109: DPToAttributeMapping(
            TuyaSoilMoistureCluster.ep_attribute,
            "measured_value",
            converter=lambda x: x * 100,
        ),
    }

    data_point_handlers = {
        5: "_dp_2_attr_update",
        109: "_dp_2_attr_update",
        **{dp: "_dp_noop" for dp in _NOOP_DPS},
    }

    def _dp_noop(self, datapoint) -> None:
        """Silently absorb a DP without mapping it to any attribute."""
        return


class HobeianZG303Z(CustomDevice):
    """HOBEIAN ZG-303Z Soil Moisture Sensor."""

    signature = {
        MODELS_INFO: [("HOBEIAN", "ZG-303Z")],
        ENDPOINTS: {
            1: {
                PROFILE_ID: zha.PROFILE_ID,
                DEVICE_TYPE: 0x0302,
                INPUT_CLUSTERS: [
                    Basic.cluster_id,
                    PowerConfiguration.cluster_id,
                    Identify.cluster_id,
                    TemperatureMeasurement.cluster_id,
                    RelativeHumidity.cluster_id,
                    0xEF00,
                ],
                OUTPUT_CLUSTERS: [
                    Identify.cluster_id,
                ],
            }
        },
    }

    replacement = {
        ENDPOINTS: {
            1: {
                PROFILE_ID: zha.PROFILE_ID,
                DEVICE_TYPE: 0x0302,
                INPUT_CLUSTERS: [
                    Basic.cluster_id,
                    PowerConfiguration.cluster_id,
                    Identify.cluster_id,
                    TuyaTemperatureMeasurement,
                    RelativeHumidity.cluster_id,
                    TuyaSoilMoistureCluster,
                    SoilMoistureMCUCluster,
                ],
                OUTPUT_CLUSTERS: [
                    Identify.cluster_id,
                ],
            }
        }
    }