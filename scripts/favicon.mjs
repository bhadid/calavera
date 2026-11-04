// Writes the browser-tab and home-screen icons from the halftone logo
// (app/frontend/src/components/DotsLogo.tsx) in the default shades:
//
//   app/frontend/public/favicon.svg           light and dark set, no tile
//   app/frontend/public/apple-touch-icon.svg  dark set on the drawing's dark
//                                             tile, for the PNG below
//
// Run after changing the drawing or its shades; check-accent.mjs fails if
// favicon.svg is out of date. Then make the 180 x 180 PNG that iOS uses on the
// home screen (it takes no SVG):
//
//   docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:22-alpine node scripts/favicon.mjs
//   docker run --rm -v "$PWD/app/frontend/public":/p zenika/alpine-chrome --no-sandbox --disable-gpu \
//     --headless --hide-scrollbars --window-size=180,180 --screenshot=/p/apple-touch-icon.png /p/apple-touch-icon.svg
import { readFileSync, writeFileSync } from "node:fs";
import { accentTokens, DEFAULT_ACCENT } from "../app/frontend/src/lib/accentColour.ts";

const PARTS = ["edge", "bone", "high"];
// The tile the drawing was made on, and how much of it the skull fills on
// the home screen (iOS rounds the corners, so the skull keeps clear of them).
const TILE = "#14121f";
const HOME_SCREEN_FILL = 0.66;

function logo() {
  const source = readFileSync(new URL("../app/frontend/src/components/DotsLogo.tsx", import.meta.url), "utf8");
  const view = source.match(/const VIEW = "([^"]+)"/)[1].split(" ").map(Number);
  const minRadius = Number(source.match(/const ICON_MIN_RADIUS = ([\d.]+)/)[1]);
  const dots = Object.fromEntries(
    PARTS.map((part) => [part, source.match(new RegExp(`  ${part}: "([^"]+)"`))[1].split(",").map((d) => d.split(" ").map(Number))]),
  );
  return { view, minRadius, dots };
}

const groups = (dots, radius) =>
  PARTS.map((part) => `<g class="${part}">${dots[part].map(([x, y, r]) => `<circle cx="${x / 2}" cy="${y / 2}" r="${radius(r)}"/>`).join("")}</g>`).join("");

export function favicon() {
  const { view, minRadius, dots } = logo();
  const t = accentTokens(DEFAULT_ACCENT);
  const style = (theme) => PARTS.map((part) => `.${part}{fill:${t[`--ac-dot-${part}-${theme}`]}}`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(" ")}"><style>${style("l")}` +
    `@media (prefers-color-scheme: dark){${style("d")}}</style>${groups(dots, (r) => Math.max(r, minRadius))}</svg>\n`
  );
}

export function homeScreenIcon() {
  const { view, dots } = logo();
  const t = accentTokens(DEFAULT_ACCENT);
  const [x, y, side] = view;
  const big = side / HOME_SCREEN_FILL;
  const [cx, cy] = [x + side / 2, y + side / 2];
  const box = [cx - big / 2, cy - big / 2, big, big].map((n) => +n.toFixed(3));
  const style = PARTS.map((part) => `.${part}{fill:${t[`--ac-dot-${part}-d`]}}`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(" ")}" width="180" height="180"><style>${style}</style>` +
    `<rect x="${box[0]}" y="${box[1]}" width="${big}" height="${big}" fill="${TILE}"/>${groups(dots, (r) => r)}</svg>\n`
  );
}

if (process.argv[1]?.endsWith("favicon.mjs")) {
  writeFileSync(new URL("../app/frontend/public/favicon.svg", import.meta.url), favicon());
  writeFileSync(new URL("../app/frontend/public/apple-touch-icon.svg", import.meta.url), homeScreenIcon());
  console.log("wrote favicon.svg and apple-touch-icon.svg; now make apple-touch-icon.png (see the comment at the top)");
}
