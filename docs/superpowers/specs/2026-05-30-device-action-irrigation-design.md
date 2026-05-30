# Design — Device action "Irriga per litri / per tempo"

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan
**Component:** `custom_components/tuya_irrigation`

## Problem

When a user builds an automation in Home Assistant by **first selecting a device**
(the device-first builder flow), Home Assistant only offers the *device actions*
contributed by integrations that are **associated with that device**. The
irrigation valve is owned by ZHA; `tuya_irrigation` today has zero presence on
that device (no entities, not the device's config entry), so its two services
(`irrigation_by_seconds`, `irrigation_by_liters`) never appear in the device-first
action picker. The user must instead switch to the generic "Esegui azione" flow.

The user wants: pick the valve from the Zigbee device list → see two new actions
("Irriga per litri", "Irriga per tempo") directly in that device's action list,
with a field to type the value. Zero manual configuration.

## Constraint that shapes the design

HA gathers the candidate domains for a device's device actions from (a) the
device's config-entry domains and (b) the domains/platforms of entities attached
to the device. To make `tuya_irrigation` a candidate domain for the valve device,
the integration must attach at least one **entity** to that device. A pure
config-entry attachment (no entity) is fragile: HA's periodic device-registry
cleanup can prune a config entry that has no entities on the device, making the
actions disappear unpredictably. Therefore the design uses a real anchor entity.

## Decisions (locked)

1. **Zero-config valve detection.** A device qualifies as an irrigation valve if
   it has *both* a `switch.*` entity *and* a `sensor.*` entity whose
   `device_class` is `volume` or `water`. Verified against live data: the GiEX
   valve's `_summation_delivered` sensor is `device_class=volume`, `unit=L`; the
   `presa_contatore_cantina` socket's `_summation_delivered` is
   `device_class=energy`, `unit=kWh` and is correctly excluded.
2. **Anchor = status entity.** A `binary_sensor` "Irrigazione in corso"
   (`device_class=running`) is created per detected valve, attached to the
   existing ZHA device. It both anchors the integration (surfacing the actions)
   and gives real feedback during the otherwise-invisible server-side timer.
3. **Action fields.**
   - "Irriga per litri": single `liters` field. No safety-timeout field exposed;
     the underlying service's default (3600 s) is always used.
   - "Irriga per tempo": single `duration` field as an hh:mm:ss duration
     selector, converted to whole seconds before calling the service.
4. **No duplicated valve logic.** The device action calls the existing services
   (`irrigation_by_liters` / `irrigation_by_seconds`); it does not re-implement
   open/wait/close.

## Architecture

### Valve detection helper
A shared function (e.g. `_find_valve_devices(hass) -> set[str]` of device_ids),
usable both by the `binary_sensor` platform and by `device_action.py`. It walks
the entity registry grouped by `device_id` and applies the rule in Decision 1.
`device_class` is read from the entity registry entry
(`device_class or original_device_class`), falling back to the live state
attribute when the registry value is absent.

### `binary_sensor.py` (new platform)
- On `async_setup_entry`, detect valve devices and add one
  `IrrigationRunningBinarySensor` per device.
- Each entity:
  - `unique_id` derived from the valve's switch entity_id.
  - `DeviceInfo` reusing the existing ZHA device's `identifiers` and
    `connections` so HA merges it into that device (no separate device card).
  - `name = "Irrigazione in corso"`, `device_class = RUNNING`.
  - `is_on` reflects whether a task is active for its switch.
- **State sync** via `async_dispatcher_*`: each entity subscribes to a
  per-switch signal (e.g. `f"{DOMAIN}_running_{switch_entity}"`). The services in
  `__init__.py` dispatch `True` when a task starts and `False` in the task's
  `finally` (covering normal completion, cancellation, and the shutdown safety
  sweep).
- **Late devices:** a device-registry-updated listener re-scans and adds entities
  for valves paired after setup (and the platform removes them on unload). Newly
  paired valves get the actions without a reload.

### `device_action.py` (new)
Implements the three standard HA device-automation hooks:
- `async_get_actions(hass, device_id)`: if `device_id` is a detected valve,
  return two action configs with `CONF_TYPE` `irrigate_liters` and
  `irrigate_seconds` (plus `CONF_DOMAIN = DOMAIN`, `CONF_DEVICE_ID`).
- `async_get_action_capabilities(hass, config)`: return `extra_fields` schema:
  - `irrigate_liters` → `vol.Required("liters")` with a number selector
    (min 1, max 10000, unit L, box mode).
  - `irrigate_seconds` → `vol.Required("duration")` with a duration selector.
- `async_call_action_from_config(hass, config, variables, context)`:
  1. Resolve the `switch.*` entity on `config[CONF_DEVICE_ID]` from the entity
     registry (use the first switch if several; documented assumption).
  2. For `irrigate_liters`: call `tuya_irrigation.irrigation_by_liters` with
     `switch_entity` + `liters`.
  3. For `irrigate_seconds`: convert the duration value to total seconds and call
     `tuya_irrigation.irrigation_by_seconds` with `switch_entity` + `seconds`.

### `__init__.py` changes
- Add `binary_sensor` to a `PLATFORMS` list and
  `async_forward_entry_setups` / `async_unload_platforms`.
- In both services, dispatch the per-switch running signal on task start and in
  the task `finally` (so the binary_sensor mirrors the real task lifecycle,
  including the shutdown sweep).
- Unload removes the platform and stops dispatching.

### Translations
Add `device_automation` strings (action type names + extra-field labels) to
`strings.json` and to `translations/en.json` and `translations/it.json`:
- `irrigate_liters` → EN "Irrigate by liters" / IT "Irriga per litri".
- `irrigate_seconds` → EN "Irrigate by time" / IT "Irriga per tempo".
- field `liters` → "Liters" / "Litri"; field `duration` → "Duration" / "Durata".

### Other files
- `manifest.json`: bump version.
- `README.md`: new section documenting the device actions, the detection rule,
  and the "Irrigazione in corso" binary_sensor.
- Unchanged: `services.yaml`, the services' core logic, the Lovelace cards, the
  ZHA quirks, `config_flow.py` (still zero-input, singleton).

## Error handling & edge cases
- Valve device with multiple `switch.*` entities → use the first; documented.
- Switch entity not resolvable at call time → log a warning, perform no action.
- `irrigate_liters` is only offered for devices that have the volume/water
  sensor (guaranteed by the detection rule), so the liters service always has its
  flow sensor available.
- Integration unload → `binary_sensor` entities removed; dispatcher subscriptions
  torn down.

## Testing (manual, real HA — no automated tests in this project)
1. Build an automation, select the valve device → both "Irriga per litri" and
   "Irriga per tempo" appear in its action list.
2. "Irriga per litri" = 80 → valve opens, monitors the volume sensor, closes at
   80 L. `binary_sensor` "Irrigazione in corso" is `on` during, `off` after.
3. "Irriga per tempo" = 00:10:00 → valve opens for 600 s then closes; binary
   sensor tracks it.
4. Cancel mid-run / restart HA mid-run → valve closes (existing safety) and the
   binary_sensor returns to `off`.
5. The `presa_contatore_cantina` socket device shows **no** irrigation actions.
6. Light and dark theme unaffected (no card changes).
