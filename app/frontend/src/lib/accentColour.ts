// Accent colour maths. Pure functions, no browser APIs, so they can be checked
// from Node (scripts/check-accent.mjs).
//
// The accent is chosen as a hue and a depth. Every shade is then calculated
// in the OKLCH colour model, where lightness means the same to the eye at
// every hue: the hue slider leaves it alone, the depth slider moves it within
// limits, and that is what guarantees that the text on an accent fill stays
// readable wherever the sliders are. Each shade is made as vivid as sRGB
// allows for its hue, up to a cap.
//
// The logo is tinted the same way: its lines are one more shade of the chosen
// hue, on white bone unless the fill is switched off. Lightness and chroma of that shade come from the first
// artwork (drawn in violet).

/** `fill`: whether the logo has its white bone; monochrome never has it. */
export type AccentChoice = { hue: number; depth: number; mono: boolean; fill: boolean };

// The default: a red.
export const DEFAULT_ACCENT: AccentChoice = { hue: 21, depth: 5, mono: false, fill: true };

/** The depth slider: each step makes the accent fills this much darker. */
export const DEPTH = { min: -5, max: 7, step: 0.011 };
// Fills are never darker than this: below it, black text on them is too faint.
const FLOOR = 0.615;
const FILLS = ["--ac-l", "--ac-strong-l", "--ac-d", "--ac-strong-d"];

/** Lightness and highest chroma of each calculated shade. */
const SHADES = {
  "--ac-l": [0.694, 0.234],
  "--ac-strong-l": [0.664, 0.246],
  "--ac-soft-l": [0.916, 0.052],
  "--ac-d": [0.713, 0.234],
  "--ac-strong-d": [0.751, 0.174],
  "--ac-soft-d": [0.262, 0.066],
  "--ac-logo-l": [0.605, 0.193],
  "--ac-logo-d": [0.605, 0.193],
} as const;

// The bento interface uses the accent as text on its grey page and as a fill
// under white (light theme) or black (dark theme) text, as Apple's tint
// colours are. Its shades are a step darker (light) and lighter (dark) than
// the classic ones, and move with the depth slider within these bounds.
const BENTO = {
  "--ac-b-l": { lightness: 0.61, cap: 0.24, highest: 0.555 },
  "--ac-b-d": { lightness: 0.74, cap: 0.2, lowest: 0.69 },
} as const;
/** The lightest surface accent text sits on in each theme (bento's grey page, raised dark fill). */
const BENTO_PAGE = { l: "#f2f2f7", d: "#2c2c2e" };

// The halftone logo: dots in three colours on a dark tile. Each keeps the
// lightness, chroma and hue distance from the accent that the drawing has at
// the default accent, so the default reproduces the drawing and every other
// hue turns all four colours together.
const DOTS: Record<string, [number, number, number]> = {
  "--ac-dot-edge": [0.648, 0.204, -9.9],
  "--ac-dot-high": [0.88, 0.135, 65.1],
  "--ac-dot-bone": [0.967, 0.016, 70.6],
  "--ac-dot-tile": [0.191, 0.026, 269.8],
};

/** Monochrome: ink on paper in the light theme, paper on ink in the dark one. */
const MONO: Record<string, string> = {
  "--ac-l": "#0c0c0c",
  "--ac-strong-l": "#3a3632",
  "--ac-soft-l": "#e9e0d2",
  "--ac-on-l": "#fff8ee",
  "--ac-d": "#f4f1ea",
  "--ac-strong-d": "#ffffff",
  "--ac-soft-d": "#2e2e33",
  "--ac-on-d": "#0b0b0c",
  // Lines only, no bone: black in the light theme, white in the dark one.
  "--ac-logo-l": "#0c0c0c",
  "--ac-logo-d": "#f4f1ea",
  "--ac-logo-bone-l": "#fdfdfd00",
  "--ac-logo-bone-d": "#fdfdfd00",
  "--ac-b-l": "#000000",
  "--ac-b-d": "#ffffff",
  "--ac-dot-edge": "#8e8e93",
  "--ac-dot-high": "#ffffff",
  "--ac-dot-bone": "#c7c7cc",
  "--ac-dot-tile": "#1c1c1e",
};

const ON_ACCENT = "#0c0c0c";

function toLinearRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const displayable = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

function toHex(rgb: number[]): string {
  const channel = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${rgb.map(channel).join("")}`;
}

/** The most vivid displayable colour of this lightness and hue, up to `cap`. */
export function shade(lightness: number, cap: number, hue: number): string {
  let low = 0;
  let high = cap;
  if (!displayable(toLinearRgb(lightness, cap, hue))) {
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (displayable(toLinearRgb(lightness, mid, hue))) low = mid;
      else high = mid;
    }
    high = low;
  }
  return toHex(toLinearRgb(lightness, high, hue));
}

/** The CSS variables for a choice: light (`-l`) and dark (`-d`) theme shades. */
export function accentTokens(choice: AccentChoice): Record<string, string> {
  if (choice.mono) return { ...MONO };
  const tokens: Record<string, string> = { "--ac-on-l": ON_ACCENT, "--ac-on-d": ON_ACCENT };
  tokens["--ac-logo-bone-l"] = tokens["--ac-logo-bone-d"] = choice.fill ? "#fdfdfd" : "#fdfdfd00";
  for (const [name, [lightness, cap]] of Object.entries(SHADES)) {
    const moved = FILLS.includes(name) ? Math.max(FLOOR, lightness - choice.depth * DEPTH.step) : lightness;
    tokens[name] = shade(moved, cap, choice.hue);
  }
  // Some hues (greens, yellows) look lighter at the same lightness: those
  // are moved further until text in and on them is readable.
  const step = choice.depth * DEPTH.step;
  let light = Math.min(BENTO["--ac-b-l"].highest, BENTO["--ac-b-l"].lightness - step);
  while (contrast(shade(light, BENTO["--ac-b-l"].cap, choice.hue), BENTO_PAGE.l) < 4.6) light -= 0.005;
  tokens["--ac-b-l"] = shade(light, BENTO["--ac-b-l"].cap, choice.hue);
  let dark = Math.max(BENTO["--ac-b-d"].lowest, BENTO["--ac-b-d"].lightness - step);
  while (contrast(shade(dark, BENTO["--ac-b-d"].cap, choice.hue), BENTO_PAGE.d) < 4.6) dark += 0.005;
  tokens["--ac-b-d"] = shade(dark, BENTO["--ac-b-d"].cap, choice.hue);
  for (const [name, [lightness, cap, turn]] of Object.entries(DOTS)) {
    tokens[name] = shade(lightness, cap, (choice.hue + turn + 360) % 360);
  }
  return tokens;
}

/** The hue slider track: the light-theme accent of this depth at evenly spaced hues. */
export function hueTrack(depth: number): string {
  const stops: string[] = [];
  for (let hue = 0; hue <= 360; hue += 15) stops.push(accentTokens({ hue, depth, mono: false, fill: true })["--ac-l"]);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** The depth slider track: the light-theme accent of this hue from lightest to deepest. */
export function depthTrack(hue: number): string {
  const ends = [DEPTH.min, 0, DEPTH.max].map((depth) => accentTokens({ hue, depth, mono: false, fill: true })["--ac-l"]);
  return `linear-gradient(to right, ${ends.join(", ")})`;
}

const NAMES: [number, string][] = [
  [15, "pink"],
  [40, "red"],
  [70, "orange"],
  [110, "yellow"],
  [160, "green"],
  [200, "teal"],
  [235, "cyan"],
  [275, "blue"],
  [310, "violet"],
  [340, "magenta"],
  [360, "pink"],
];

/** A plain name for a hue, for the value shown beside the slider. */
export function hueName(hue: number): string {
  return (NAMES.find(([end]) => hue < end) ?? NAMES[0])[1];
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
