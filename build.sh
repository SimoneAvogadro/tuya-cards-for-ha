#!/usr/bin/env bash
# Builds tuya-cards.js by concatenating all card sources from src/
set -euo pipefail

OUTFILE="tuya-cards.js"

cat > "$OUTFILE" <<'HEADER'
/**
 * Tuya Cards for Home Assistant
 * Collection of custom Lovelace cards for Tuya-based smart devices
 *
 * https://github.com/simoneavogadro/tuya-cards-for-ha
 */
HEADER

for f in src/*.js; do
  printf '\n// --- %s ---\n' "$(basename "$f")" >> "$OUTFILE"
  cat "$f" >> "$OUTFILE"
done

# Copy the bundle into the integration's www/ so it can be served by the
# custom_components.tuya_irrigation integration and auto-registered as a
# Lovelace resource.
INTG_WWW="custom_components/tuya_irrigation/www"
if [ -d "$INTG_WWW" ]; then
  cp "$OUTFILE" "$INTG_WWW/$OUTFILE"
  echo "Copied $OUTFILE → $INTG_WWW/"
fi

echo "Built $OUTFILE ($(wc -c < "$OUTFILE") bytes, $(ls src/*.js | wc -l) card(s))"
