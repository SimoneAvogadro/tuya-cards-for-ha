# CLAUDE.md — tuya-cards-for-ha

## What this project is

Custom Lovelace cards for Home Assistant, targeting Tuya-based smart devices (ZHA / Zigbee2MQTT). Distributed as a single HACS custom repository (category: Dashboard).

## Repo structure

```
tuya-cards-for-ha/
├── src/                         ← card sources, one file per card
│   └── irrigation-control-card.js
├── tuya-cards.js                ← built bundle (DO NOT edit directly)
├── build.sh                     ← concatenates src/*.js → tuya-cards.js
├── hacs.json                    ← HACS manifest, points to tuya-cards.js
├── README.md
├── LICENSE                      ← MIT
└── CLAUDE.md
```

## Build

```bash
bash build.sh
```

No dependencies. The script concatenates a header + all `src/*.js` files into `tuya-cards.js`. Always run after modifying sources.

## Adding a new card

1. Create `src/<card-name>.js` — self-contained HTMLElement + Shadow DOM
2. The file must end with `customElements.define(...)` and `window.customCards.push(...)`
3. Run `bash build.sh`
4. Update the "Cards included" table in `README.md`

## Architecture rules

- **No LitElement** — pure HTMLElement with Shadow DOM only
- **No build tools / npm** — just bash concatenation
- **Auto-discovery** — each card discovers its entities from a single primary entity via suffix conventions
- **CSS theming** — use HA CSS variables (`--primary-text-color`, `--card-background-color`, etc.) for light/dark support
- **Panels closed by default** — mobile-first compactness
- **Labels in Italian** — UI strings are in Italian
- **Visual editor** — each card must implement `getConfigElement()` showing only compatible devices

## HACS specifics

- `content_in_root: true` — `tuya-cards.js` lives in the repo root
- `filename: tuya-cards.js` — single bundle serves all cards
- One resource registration in HA covers all cards
- Cards for devices the user doesn't have are simply invisible (auto-discovery)

## Testing

No automated tests. Verify manually on a real HA instance:
- Card renders correctly in light and dark theme
- Auto-discovery finds compatible devices
- Visual editor dropdown lists only compatible devices
- All interactive features work (buttons, inputs, timer, etc.)
