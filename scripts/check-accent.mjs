// Checks the accent colour maths: every slider position keeps readable
// contrast, and the defaults written into styles.css match the calculation.
//
//   docker run --rm -v "$PWD":/w -w /w node:22-alpine node scripts/check-accent.mjs
import { readFileSync } from "node:fs";
import { accentTokens, contrast, DEFAULT_ACCENT } from "../app/frontend/src/lib/accentColour.ts";

const SURFACES = { l: ["#fff8ee", "#ffffff", "#f6ecdd"], d: ["#0b0b0c", "#17171a", "#222226"] };
let failed = false;
const fail = (message) => {
  failed = true;
  console.log("FAIL", message);
};

let worstText = Infinity;
let worstEdge = Infinity;
const choices = [...Array(360).keys()].map((hue) => ({ hue, mono: false })).concat({ hue: 0, mono: true });
for (const choice of choices) {
  const t = accentTokens(choice);
  const label = choice.mono ? "mono" : `hue ${choice.hue}`;
  for (const theme of ["l", "d"]) {
    // Text on accent fills (buttons, tags) and on their hover shade.
    for (const fill of [t[`--ac-${theme}`], t[`--ac-strong-${theme}`]]) {
      const ratio = contrast(fill, t[`--ac-on-${theme}`]);
      worstText = Math.min(worstText, ratio);
      if (ratio < 4.5) fail(`${label} ${theme}: text on ${fill} is ${ratio.toFixed(2)}:1`);
    }
    // Focus outlines and shadows against the page surfaces (3:1 for non-text).
    if (theme === "d" || choice.mono) {
      for (const surface of SURFACES[theme]) {
        const ratio = contrast(t[`--ac-strong-${theme}`], surface);
        worstEdge = Math.min(worstEdge, ratio);
        if (ratio < 3) fail(`${label} ${theme}: outline on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
}
// The logo against the page, and in the browser-tab icon the eyes against the shadow.
const PAGE = { l: "#fff8ee", d: "#0b0b0c" };
let worstLogo = Infinity;
for (const choice of choices) {
  const t = accentTokens(choice);
  const label = choice.mono ? "mono" : `hue ${choice.hue}`;
  for (const theme of ["l", "d"]) {
    const ratio = contrast(t[`--ac-logo-${theme}`], PAGE[theme]);
    worstLogo = Math.min(worstLogo, ratio);
    if (ratio < 3) fail(`${label} ${theme}: logo on the page is ${ratio.toFixed(2)}:1`);
  }
  if (contrast(t["--ac-logo-edge"], t["--ac-logo-shadow"]) < 4.5) fail(`${label}: icon eyes are too close to its shadow`);
  if (contrast("#fdfdfd", t["--ac-logo-shadow"]) < 2) fail(`${label}: icon shadow is too close to its white`);
}
console.log(`logo on the page: worst ${worstLogo.toFixed(2)}:1`);
console.log(`text on accent: worst ${worstText.toFixed(2)}:1 over ${choices.length} choices`);
console.log(`outline on dark surfaces: worst ${worstEdge.toFixed(2)}:1`);

// The shades used only by the browser-tab icon have their defaults in favicon.svg.
const ICON_ONLY = ["--ac-logo-shadow", "--ac-logo-edge"];
const defaults = accentTokens(DEFAULT_ACCENT);
const css = readFileSync(new URL("../app/frontend/src/styles.css", import.meta.url), "utf8");
for (const [name, value] of Object.entries(defaults)) {
  if (!ICON_ONLY.includes(name) && !css.includes(`var(${name}, ${value})`)) fail(`styles.css default for ${name} should be ${value}`);
}

// The favicon is in the default colours and has the same outline as the logo.
const favicon = readFileSync(new URL("../app/frontend/public/favicon.svg", import.meta.url), "utf8");
const logo = readFileSync(new URL("../app/frontend/src/components/Skull.tsx", import.meta.url), "utf8");
const colours = new Set(favicon.match(/#[0-9a-fA-F]{6}\b/g));
const expected = new Set(["#fdfdfd", ...ICON_ONLY.map((name) => defaults[name])]);
if (colours.size !== 3 || [...expected].some((c) => !colours.has(c))) {
  fail(`favicon.svg colours are ${[...colours]}, expected ${[...expected]}`);
}
const silhouette = favicon.match(/id="silhouette" d="([^"]+)"/);
if (!silhouette || !logo.includes(`"${silhouette[1]}"`)) fail("favicon.svg and Skull.tsx have different outlines");
console.log("default", defaults);
console.log(failed ? "FAILED" : "ALL PASS");
process.exit(failed ? 1 : 0);
