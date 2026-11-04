// Writes app/frontend/public/favicon.svg: the halftone logo
// (app/frontend/src/components/DotsLogo.tsx) in the default shades, light and
// dark. Run after changing the drawing or its shades; check-accent.mjs fails
// if the file is out of date.
//
//   docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:22-alpine node scripts/favicon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { accentTokens, DEFAULT_ACCENT } from "../app/frontend/src/lib/accentColour.ts";

export function favicon() {
  const source = readFileSync(new URL("../app/frontend/src/components/DotsLogo.tsx", import.meta.url), "utf8");
  const view = source.match(/const VIEW = "([^"]+)"/)[1];
  const parts = ["edge", "bone", "high"];
  const dots = Object.fromEntries(parts.map((part) => [part, source.match(new RegExp(`  ${part}: "([^"]+)"`))[1]]));
  const t = accentTokens(DEFAULT_ACCENT);
  const style = (theme) => parts.map((part) => `.${part}{fill:${t[`--ac-dot-${part}-${theme}`]}}`).join("");
  const groups = parts
    .map((part) => `<g class="${part}">${dots[part].split(",").map((dot) => {
      const [x, y, r] = dot.split(" ").map(Number);
      return `<circle cx="${x / 2}" cy="${y / 2}" r="${r}"/>`;
    }).join("")}</g>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}"><style>${style("l")}@media (prefers-color-scheme: dark){${style("d")}}</style>${groups}</svg>\n`;
}

if (process.argv[1]?.endsWith("favicon.mjs")) {
  writeFileSync(new URL("../app/frontend/public/favicon.svg", import.meta.url), favicon());
  console.log("wrote app/frontend/public/favicon.svg");
}
