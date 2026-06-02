#!/usr/bin/env node
// Renders every brand/<domain>/icon.svg into icon.png (256x256) and
// icon@2x.png (512x512), the exact pair home-assistant/brands wants under
// custom_integrations/<domain>/.
//
// Usage:
//   cd /tmp/iconrender && npm install @resvg/resvg-js   # one-off, see below
//   NODE_PATH=/tmp/iconrender/node_modules node brand/build.js
//
// @resvg/resvg-js isn't pinned as a project dep on purpose — this script
// only runs when icons change, and the repo is otherwise dependency-free.

const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const BRAND_DIR = path.join(__dirname);
const SIZES = [
  { name: "icon.png", w: 256 },
  { name: "icon@2x.png", w: 512 },
];

const domains = fs
  .readdirSync(BRAND_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const domain of domains) {
  const svgPath = path.join(BRAND_DIR, domain, "icon.svg");
  if (!fs.existsSync(svgPath)) continue;
  const svg = fs.readFileSync(svgPath);
  for (const { name, w } of SIZES) {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: w },
      background: "rgba(0,0,0,0)",
    });
    const png = resvg.render().asPng();
    const outPath = path.join(BRAND_DIR, domain, name);
    fs.writeFileSync(outPath, png);
    console.log(`  ${domain}/${name}  (${png.length} bytes)`);
  }
}
