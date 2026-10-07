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
console.log(`text on accent: worst ${worstText.toFixed(2)}:1 over ${choices.length} choices`);
console.log(`outline on dark surfaces: worst ${worstEdge.toFixed(2)}:1`);

const css = readFileSync(new URL("../app/frontend/src/styles.css", import.meta.url), "utf8");
for (const [name, value] of Object.entries(accentTokens(DEFAULT_ACCENT))) {
  if (!css.includes(`var(${name}, ${value})`)) fail(`styles.css default for ${name} should be ${value}`);
}
const pink = accentTokens({ hue: 356, mono: false });
console.log("default", accentTokens(DEFAULT_ACCENT));
console.log("pink (hue 356)", pink);
console.log(failed ? "FAILED" : "ALL PASS");
process.exit(failed ? 1 : 0);
