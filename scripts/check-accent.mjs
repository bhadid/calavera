// Checks the accent colour maths: every choice keeps readable contrast, the
// defaults written into styles.css match the calculation, the logo's default
// shades are the drawing's own, and the favicon is up to date.
//
//   docker run --rm -v "$PWD":/w -w /w node:22-alpine node scripts/check-accent.mjs
import { readFileSync } from "node:fs";
import { accentTokens, contrast, DEFAULT_ACCENT } from "../app/frontend/src/lib/accentColour.ts";
import { favicon } from "./favicon.mjs";

let failed = false;
const fail = (message) => {
  failed = true;
  console.log("FAIL", message);
};

const choices = [DEFAULT_ACCENT];
for (let hue = 0; hue < 360; hue++) choices.push({ hue, mono: false });

let worstText = Infinity;
let worstLogo = Infinity;
for (const choice of choices) {
  const t = accentTokens(choice);
  const label = choice.mono ? "monochrome" : `hue ${choice.hue}`;
  // Accent fills carry white (light) or black (dark) text; accent and second
  // colour are text on the page, on tiles and on raised fills.
  const pairs = [
    ["#ffffff", t["--ac-b-l"]], ["#f2f2f7", t["--ac-b-l"]],
    ["#000000", t["--ac-b-d"]], ["#1c1c1e", t["--ac-b-d"]], ["#2c2c2e", t["--ac-b-d"]],
    ["#ffffff", t["--ac-b2-l"]], ["#f2f2f7", t["--ac-b2-l"]],
    ["#000000", t["--ac-b2-d"]], ["#1c1c1e", t["--ac-b2-d"]], ["#2c2c2e", t["--ac-b2-d"]],
  ];
  for (const [surface, colour] of pairs) {
    const ratio = contrast(surface, colour);
    worstText = Math.min(worstText, ratio);
    if (ratio < 4.5) fail(`${label}: ${colour} with ${surface} is ${ratio.toFixed(2)}:1`);
  }
  // The halftone logo's dots on the page and on tiles (3:1 for graphics).
  for (const part of ["edge", "high", "bone"]) {
    for (const [theme, surfaces] of [["l", ["#ffffff", "#f2f2f7"]], ["d", ["#000000", "#1c1c1e"]]]) {
      for (const surface of surfaces) {
        const ratio = contrast(t[`--ac-dot-${part}-${theme}`], surface);
        worstLogo = Math.min(worstLogo, ratio);
        if (ratio < 3) fail(`${label} logo ${theme}: ${part} dots on ${surface} are ${ratio.toFixed(2)}:1`);
      }
    }
  }
}
console.log(`accent and second colour as text and fills: worst ${worstText.toFixed(2)}:1 over ${choices.length} choices`);
console.log(`logo dots on the page: worst ${worstLogo.toFixed(2)}:1`);

// The default (monochrome) is written into styles.css, so the first paint
// needs no script.
const defaults = accentTokens(DEFAULT_ACCENT);
const css = readFileSync(new URL("../app/frontend/src/styles.css", import.meta.url), "utf8");
for (const [name, value] of Object.entries(defaults)) {
  if (!css.includes(`var(${name}, ${value})`)) fail(`styles.css default for ${name} should be ${value}`);
}
// The logo's default dark shades are the drawing's own.
const drawing = { "--ac-dot-edge-d": "#ef476f", "--ac-dot-high-d": "#ffd166", "--ac-dot-bone-d": "#f8f4e8" };
for (const [name, value] of Object.entries(drawing)) {
  if (defaults[name] !== value) fail(`default ${name} is ${defaults[name]}, the drawing has ${value}`);
}
// The favicon is the logo in the default shades.
const icon = readFileSync(new URL("../app/frontend/public/favicon.svg", import.meta.url), "utf8");
if (icon !== favicon()) fail("public/favicon.svg is out of date: run node scripts/favicon.mjs");

console.log("default", defaults);
console.log(failed ? "FAILED" : "ALL PASS");
process.exit(failed ? 1 : 0);
