# ZHA layer split — design note (2026-09-14)

## Decision

Everything that depends on ZHA / zigpy moves out of `tuya_irrigation`
(repo `tuya-cards-for-ha`) into the `zha_tuya_quirks` integration (repo
`zha-tuya-quirks`, "ZHA" in the name). `tuya_irrigation` keeps everything that
reasons only about Home Assistant entities and could, in principle, work with
Zigbee2MQTT: the two irrigation services, the run log, the sensors, discovery,
device actions, and the cards.

This is the "cut by layer" option: ZHA layer vs entity layer. The alternative
("integration vs frontend": move the whole integration to the quirks repo and
leave only cards here) was rejected because it moves ~2 000 platform-agnostic
lines under a ZHA-named repo.

## What moved

| Piece | Before | After |
|---|---|---|
| `giex_qt06_epoch2000.py`, `hobeian_zg303z.py` | `tuya_irrigation/quirks/` | `zha_tuya_quirks/quirks/`, byte-identical quirk code (only two docstring lines changed) — unique_ids derive from IEEE + endpoint + cluster, so entity ids are unchanged |
| zigpy time push (`handle_set_time_request(0)` on 0xEF00) | `_async_push_device_time` in `tuya_irrigation` | service `zha_tuya_quirks.push_device_time(entity_id)` in `zha_tuya_quirks/services.py` |
| zigpy keep-alive read (Basic `app_version`, `allow_cache=False`) | `_async_keepalive_poll` in `tuya_irrigation` | service `zha_tuya_quirks.keepalive_poll(entity_id)` |
| entity → device → IEEE → gateway resolution | `_resolve_zha_device` in `tuya_irrigation` | `_resolve_zha_device` in `zha_tuya_quirks/services.py` (raises `HomeAssistantError` instead of returning `None`) |

## What stayed (and why)

- The **decision** of when to push time (right before `_turn_on`, after the run
  plan) and which valves to keep alive (idle, battery, discovered) stays in
  `tuya_irrigation`: it needs discovery and the run log, and it is not a ZHA
  concern. Only the radio call crosses the boundary.
- `_async_push_device_time` / `_async_keepalive_poll` keep their names and
  call sites; their bodies became `_async_call_zha_layer(hass, service,
  switch_entity)`: skip with a debug log when the service is not registered,
  `async_call(..., blocking=True)` inside a try/except that logs a WARNING.
  Neither can block or fail irrigation, exactly as before.

## Missing-layer handling

A ZHA valve without `zha_tuya_quirks` loaded still irrigates, but its
start/end stamps drift and a weak-link battery valve can go unavailable.
`_async_check_zha_layer` runs at the start of every keep-alive sweep (HA start
+ hourly): if any discovered valve is a ZHA device (`device_is_zha`, device
registry identifiers/connections) and the time-push service is absent, it
raises the non-fixable repair issue `zha_layer_missing` (learn-more → the
zha-tuya-quirks repo) and skips the sweep; otherwise it deletes the issue.

## Upgrade path for an existing install

1. Update zha-tuya-quirks, restart. Both integrations now register the same
   two quirks; zigpy is last-registered-wins with identical classes and the
   GiEX converter patch is a plain module-attribute assignment, so the overlap
   is harmless.
2. Update tuya-cards-for-ha, restart.

Reverse order leaves the GiEX on the upstream quirk (+04:00 stamps) and the
ZG-303Z without its DP mapping for one restart. Nothing destructive either way.

## Not done on purpose

- No version bump in either repo (the user decides when to tag).
- No Zigbee2MQTT implementation of the two services: Z2M answers Tuya time
  requests itself and has no simple MQTT equivalent of an attribute read. The
  boundary makes such an implementation possible, it does not provide it.
- No change to the cards.
