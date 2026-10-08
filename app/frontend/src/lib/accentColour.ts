// Accent colour maths. Pure functions, no browser APIs, so they can be checked
// from Node (scripts/check-accent.mjs).
//
// The accent is chosen as a hue only. Every shade is then calculated in the
// OKLCH colour model, where lightness means the same to the eye at every hue:
// holding it fixed is what guarantees that the text on an accent fill stays
// readable wherever the slider is. Each shade is made as vivid as sRGB allows
// for its hue, up to a cap taken from the original pink.
//
// The logo is tinted the same way: its shadow and its outline are two more
// shades of the chosen hue, with lightness and chroma taken from the artwork
// (drawn in violet). Its bone stays white.

export type AccentChoice = { hue: number; mono: boolean };

export const DEFAULT_ACCENT: AccentChoice = { hue: 250, mono: false };

/** Lightness and highest chroma of each calculated shade. */
const SHADES = {
  "--ac-l": [0.694, 0.222],
  "--ac-strong-l": [0.664, 0.246],
  "--ac-soft-l": [0.916, 0.052],
  "--ac-d": [0.713, 0.205],
  "--ac-strong-d": [0.751, 0.174],
  "--ac-soft-d": [0.262, 0.066],
  "--ac-logo-shadow": [0.707, 0.106],
  "--ac-logo-edge": [0.196, 0.105],
} as const;

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
  "--ac-logo-shadow": "#a3a3a3",
  "--ac-logo-edge": "#0c0c0c",
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
  for (const [name, [lightness, cap]] of Object.entries(SHADES)) tokens[name] = shade(lightness, cap, choice.hue);
  return tokens;
}

/** The slider track: the light-theme accent at evenly spaced hues. */
export function hueTrack(): string {
  const stops: string[] = [];
  for (let hue = 0; hue <= 360; hue += 15) stops.push(shade(...SHADES["--ac-l"], hue));
  return `linear-gradient(to right, ${stops.join(", ")})`;
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
