# Trend panel for `soil-moisture-card`

**Date:** 2026-09-08
**Status:** implemented autonomously (user asleep, asked for reasonable assumptions
consistent with the project); ships as soil-moisture-card v1.6.0 / integration 2.12.0

## Goal

Tapping one of the readings of `soil-moisture-card` (soil moisture, temperature, air
humidity) opens a section under the readings — styled like the energy-statistics
panel of `power-switch-card` in `zha-tuya-quirks` — showing how that value moved
over the **day**, **week** or **month**:

- **Day**: the plain trend of the value (one line).
- **Week / Month**: two lines, the daily **min** and **max**, with a light band between.

The user asked for "temperature / humidity"; the soil column gets the same treatment
because it is the card's primary reading and the mechanism is identical. Tapping the
open column again closes the panel; tapping another column switches metric and keeps
the chosen view and period.

## Why no backend change is needed

- **Day** view reads the raw recorded states through `history/history_during_period`
  (WebSocket) — the same data the more-info dialog plots. Kept 10 days by default.
  For older days it falls back to hourly `mean` long-term statistics.
- **Week / Month** views read `recorder/statistics_during_period` with `period: "day"`
  and `types: ["min", "max", "mean"]`. All three sensors are `state_class: measurement`,
  so long-term statistics exist and are never purged.

No Python change. The integration version bump (2.12.0) only tracks the card.

## User interface

```
┌────────────────────────────────────────┐
│ 💧 Umidità terreno Vite        🔋 87%  │
│   TERRENO    TEMPERATURA     ARIA      │
│    47%         23,9C          61%      │
│   ▬▬▬▬▬▬     [selected]     2 min fa   │
├────────────────────────────────────────┤
│  [Giorno]  Settimana   Mese            │
│  22,6 – 27,5 °C           media 24,8°C │
│ 28┤        ╭──╮                        │
│ 25┤   ╭────╯  ╰───╮                    │
│ 22┤───╯           ╰──                  │
│    00     06     12     18             │
│        ◀     8 set 2026     ▶          │
└────────────────────────────────────────┘
```

- **Tabs** — Day / Week / Month segmented control (no Year: the user asked for these
  three). Always opens on Day at "now"; not persisted.
- **Header line** — left: the period's `min – max` with unit; right: `media <mean>`.
  Tapping a point (Day) or a day (Week/Month) replaces the header with
  `14:00 · 26,3 °C` or `mar 3 set · 18,2 – 29,4 °C`; tapping again deselects.
- **Chart** — SVG drawn in pixel coordinates of the container (ResizeObserver), so
  strokes and markers never distort. Three horizontal gridlines with "nice" tick
  values on the left; x labels as in the energy panel (00/06/12/18, weekday initials,
  1 / mid / last day of month). Percent metrics are clamped to 0–100.
- **Colors** — soil: card green; temperature: amber `#f9a825`; air: blue `#4a90d9`.
  Max line full, min line lighter, band at ~12 % opacity.
- **Navigator** — `◀` / `▶` with the period label; `▶` disabled on the current period.
- **Offline** — the panel closes when the card goes offline (readings are hidden).
- **Refresh** — the current period is re-fetched at most every 15 min, driven by the
  card's existing 60 s tick (`refreshIfCurrent`). Past periods are cached for the
  page's lifetime.

## Code structure

- **New `src/sensor-trend-panel.js`** — custom element `<sensor-trend-panel>`,
  interface `setup(hass, entityId, {color, unit, decimals, keepPeriod})`, `hass`
  setter, `refreshIfCurrent()`. Not a Lovelace card. All top-level identifiers are
  prefixed `stp` / `STP_` because `build.sh` concatenates every `src/*.js` into one
  module scope.
- **`src/soil-moisture-card.js`** — columns become buttons (`role=button`, keyboard
  reachable), selected-column highlight, `.panel-wrap` under the readings, and the
  glue described above.
- **`tests/sensor-trend-panel.test.js`** — pure-logic tests of the period arithmetic,
  bucket filling, history parsing and axis ticks, run with
  `TZ=Europe/Rome node tests/sensor-trend-panel.test.js` (same convention as
  `zha-tuya-quirks`).

## Out of scope

- No mean line in Week/Month (the user asked for min/max).
- No Year view.
- The irrigation card is untouched.
