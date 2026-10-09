// Checks the accent colour maths: every slider position keeps readable
// contrast, and the defaults written into styles.css match the calculation.
//
//   docker run --rm -v "$PWD":/w -w /w node:22-alpine node scripts/check-accent.mjs
import { readFileSync } from "node:fs";
import { accentTokens, contrast, DEFAULT_ACCENT, DEPTH } from "../app/frontend/src/lib/accentColour.ts";

const SURFACES = { l: ["#fff8ee", "#ffffff", "#f6ecdd"], d: ["#0b0b0c", "#17171a", "#222226"] };
let failed = false;
const fail = (message) => {
  failed = true;
  console.log("FAIL", message);
};

let worstText = Infinity;
let worstEdge = Infinity;
const choices = [{ hue: 0, depth: 0, mono: true, fill: true }];
for (let depth = DEPTH.min; depth <= DEPTH.max; depth++) {
  for (let hue = 0; hue < 360; hue++) choices.push({ hue, depth, mono: false, fill: true });
}
// The logo without its fill; depth does not change the logo.
for (let hue = 0; hue < 360; hue++) choices.push({ hue, depth: 0, mono: false, fill: false });
for (const choice of choices) {
  const t = accentTokens(choice);
  const label = choice.mono ? "mono" : `hue ${choice.hue} depth ${choice.depth}`;
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
// The lines of the logo against its white bone and against the page.
const PAGE = { l: "#fff8ee", d: "#0b0b0c" };
const BONE = "#fdfdfd";
let worstLogo = Infinity;
for (const choice of choices) {
  const t = accentTokens(choice);
  const label = choice.mono ? "mono" : `hue ${choice.hue}${choice.fill ? "" : " without fill"}`;
  for (const theme of ["l", "d"]) {
    const lines = t[`--ac-logo-${theme}`];
    // Without bone (monochrome, or the fill switched off) only the lines on the page count.
    const boneless = t[`--ac-logo-bone-${theme}`].endsWith("00");
    const onBone = boneless ? Infinity : contrast(lines, BONE);
    const onPage = boneless ? contrast(lines, PAGE[theme]) : Math.max(contrast(lines, PAGE[theme]), contrast(BONE, PAGE[theme]));
    worstLogo = Math.min(worstLogo, onBone, onPage);
    if (onBone < 3) fail(`${label} ${theme}: logo lines on the bone are ${onBone.toFixed(2)}:1`);
    if (onPage < 3) fail(`${label} ${theme}: logo on the page is ${onPage.toFixed(2)}:1`);
  }
}
console.log(`logo on the page and on its bone: worst ${worstLogo.toFixed(2)}:1`);
console.log(`text on accent: worst ${worstText.toFixed(2)}:1 over ${choices.length} choices`);
console.log(`outline on dark surfaces: worst ${worstEdge.toFixed(2)}:1`);

const defaults = accentTokens(DEFAULT_ACCENT);
const css = readFileSync(new URL("../app/frontend/src/styles.css", import.meta.url), "utf8");
for (const [name, value] of Object.entries(defaults)) {
  if (!css.includes(`var(${name}, ${value})`)) fail(`styles.css default for ${name} should be ${value}`);
}

// The favicon is in the default colours and is the same drawing as the logo.
const favicon = readFileSync(new URL("../app/frontend/public/favicon.svg", import.meta.url), "utf8");
const logo = readFileSync(new URL("../app/frontend/src/components/Skull.tsx", import.meta.url), "utf8");
const colours = [...new Set(favicon.match(/#[0-9a-fA-F]{6}\b/g))].sort();
const expected = [BONE, defaults["--ac-logo-l"]].sort();
if (colours.join() !== expected.join()) fail(`favicon.svg colours are ${colours}, expected ${expected}`);
for (const part of ["bone", "lines"]) {
  const path = favicon.match(new RegExp(`id="${part}" fill="[^"]+" d="([^"]+)"`));
  if (!path || !logo.includes(`"${path[1]}"`)) fail(`favicon.svg and Skull.tsx have different ${part}`);
}
console.log("default", defaults);
console.log(failed ? "FAILED" : "ALL PASS");
process.exit(failed ? 1 : 0);
