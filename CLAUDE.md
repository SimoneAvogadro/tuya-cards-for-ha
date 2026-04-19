# CLAUDE.md — tuya-cards-for-ha

## What this project is

A Home Assistant custom **integration** (`tuya_irrigation`) plus two companion **Lovelace cards**, targeting Tuya-based smart devices (ZHA / Zigbee2MQTT). Distributed as a single HACS custom repository (category: Integration — HACS auto-detects from `custom_components/`).

The integration provides two server-side services that reliably open + wait + close an irrigation valve (working around firmware bugs in e.g. GiEX QT06 / `_TZE200_a7sghmms` whose native duration timer is silently ignored under ZHA). It also auto-serves and auto-registers the Lovelace card bundle so users don't need to configure Lovelace resources manually.

## Repo structure

```
tuya-cards-for-ha/
├── custom_components/
│   └── tuya_irrigation/
│       ├── __init__.py           ← services + static path + Lovelace auto-reg
│       ├── const.py
│       ├── manifest.json
│       ├── services.yaml
│       └── www/
│           └── tuya-cards.js     ← built bundle (copied by build.sh — DO NOT edit)
├── docs/
│   └── PLAN-integration-v2.md    ← architectural plan for v2.0
├── src/                          ← card sources, one file per card
│   ├── irrigation-control-card.js
│   └── soil-moisture-card.js
├── tuya-cards.js                 ← built bundle at repo root (DO NOT edit)
├── build.sh                      ← concatenates src/*.js → tuya-cards.js + copies into integration www/
├── hacs.json                     ← HACS manifest (integration type detected automatically)
├── README.md
├── LICENSE                       ← MIT
└── CLAUDE.md
```

## Build

```bash
bash build.sh
```

No dependencies. The script concatenates a header + all `src/*.js` files into `tuya-cards.js`, then copies the result into `custom_components/tuya_irrigation/www/` so the integration can serve it. Always run after modifying card sources.

## Integration services

Registered in `custom_components/tuya_irrigation/__init__.py`:

- `tuya_irrigation.irrigation_by_seconds(switch_entity, seconds)` — turn on, `asyncio.sleep(seconds)`, turn off. Cancellation-safe via per-switch task registry.
- `tuya_irrigation.irrigation_by_liters(switch_entity, liters, timeout_seconds?)` — turn on, monitor `sensor.<prefix>_summation_delivered` via `async_track_state_change_event`, turn off when target reached or timeout.

Both services cancel any previously-running task on the same switch. The cancelled task checks `active_tasks[switch] is my_task` in its `finally` before touching the valve, so the cancellation does not disturb the new task.

## Card rules

- **No LitElement** — pure HTMLElement with Shadow DOM only.
- **No build tools / npm** — just bash concatenation.
- **Auto-discovery** — each card discovers its entities from a single primary entity via suffix conventions.
- **CSS theming** — use HA CSS variables (`--primary-text-color`, `--card-background-color`, etc.).
- **Panels closed by default** — mobile-first compactness.
- **Labels in Italian by default**, with EN / ZH via `localStorage.selectedLanguage`.
- **Visual editor** — each card must implement `getConfigElement()` showing only compatible devices.
- **Irrigation card calls the integration's services**, never the underlying `number.set_value` + `switch.turn_on` sequence directly. A graceful banner appears if the integration is missing.

## Adding a new card

1. Create `src/<card-name>.js` — self-contained HTMLElement + Shadow DOM.
2. The file must end with `customElements.define(...)` and a `window.customCards.push(...)` (inside a self-invoking function that picks a localized display name from `localStorage.selectedLanguage`).
3. Run `bash build.sh`.
4. Update the "What's included" table in `README.md`.

## HACS specifics

- No `type` field in `hacs.json` — HACS detects `custom_components/` and classifies the repo as integration.
- Single bundle `tuya-cards.js` served at `/tuya_irrigation/tuya-cards.js` serves all cards.
- Lovelace resource auto-registered when Lovelace is in `storage` mode (default). YAML-mode users must add the resource manually.
- Cards for devices the user doesn't have are simply invisible (auto-discovery).

## Testing

No automated tests. Verify manually on a real HA instance:
- Integration loads without errors (Settings → Devices & Services → Logs).
- Both services visible in Dev Tools → Services with proper field UI.
- `tuya_irrigation.irrigation_by_seconds` with 5s closes the valve after 5s even on a valve with broken firmware auto-off.
- Lovelace resource auto-registered at `/tuya_irrigation/tuya-cards.js?v=<VERSION>`.
- Cards render correctly in light and dark theme.
- Auto-discovery finds compatible devices in both visual editors.
- Browser-closed test: start a 60s irrigation → close tab → wait 90s → reopen → valve is off.

## Additional context

Design decisions, entity behavior details, deployment context, and user preferences are documented in the GDrive shared memory folder `AI/Claude/tuya-cards-for-ha/` using this MCP: https://github.com/SimoneAvogadro/mcp-gdrive-fileaccess

The v2.0 architectural plan lives in `docs/PLAN-integration-v2.md`.
