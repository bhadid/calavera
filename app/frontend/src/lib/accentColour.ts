// Accent colour maths. Pure functions, no browser APIs, so they can be checked
// from Node (scripts/check-accent.mjs).
//
// The accent is monochrome (the default) or one hue. Every shade is
// calculated in the OKLCH colour model, where lightness means the same to the
// eye at every hue, and made as vivid as sRGB allows for its hue, up to a cap.
// Where a hue still looks too light or too dark at that lightness (greens,
// yellows), the shade is moved further until text in and on it is readable.
//
// Three groups of shades, each for the light (-l) and the dark (-d) appearance:
//   --ac-b-*    the accent: buttons, links, all-good status. Monochrome is
//               black in the light appearance and white in the dark one.
//   --ac-b2-*   the second colour, for status that needs attention: the hue of
//               the logo's highlight.
//   --ac-dot-*  the halftone logo's edge, bone and highlight dots.
// In monochrome the second colour and the logo keep the default hue's shades,
// so they stay in colour.

export type AccentChoice = { hue: number; mono: boolean };

/** The hue the logo's drawing was made in (a red); its colours at this hue are the drawing's. */
export const DEFAULT_HUE = 21;
export const DEFAULT_ACCENT: AccentChoice = { hue: DEFAULT_HUE, mono: true };

// The accent: [lightness, highest chroma]. Accent fills carry white text in
// the light appearance and black text in the dark one.
const ACCENT = { l: [0.555, 0.24], d: [0.69, 0.2] } as const;
/** The lightest surface accent text sits on in each appearance (grey page, raised dark fill). */
const PAGE = { l: "#f2f2f7", d: "#2c2c2e" };
const MONO = { "--ac-b-l": "#000000", "--ac-b-d": "#ffffff" };

// The halftone logo: dots in three colours, edge, bone and highlight, with no
// tile behind them. Each keeps the lightness, chroma and hue distance from the
// accent that the drawing has at the default hue, so the dark-appearance
// shades at the default reproduce the drawing (components/halftone-skull.svg)
// and every other hue turns all three together. On a light page the bone is
// dark and the other two are deeper, so the skull shows on both.
// [lightness, chroma, turn from the accent hue]
const DOTS: Record<"edge" | "high" | "bone", { l: [number, number, number]; d: [number, number, number] }> = {
  edge: { l: [0.6, 0.2, -9.9], d: [0.648, 0.204, -9.9] },
  high: { l: [0.68, 0.15, 65.1], d: [0.88, 0.135, 65.1] },
  bone: { l: [0.27, 0.035, 70.6], d: [0.967, 0.016, 70.6] },
};
/** The page surfaces the logo is drawn on; each dot colour keeps 3:1 against them (graphics). */
const LOGO_PAGE = { l: "#f2f2f7", d: "#1c1c1e" };

// The second colour, at the hue of the logo's highlight. [lightness, chroma]
const SECOND = { turn: 65.1, l: [0.56, 0.17], d: [0.84, 0.15] } as const;

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

/** A shade moved lighter (`step` > 0) or darker until it has `ratio` against `surface`. */
function readable(lightness: number, cap: number, hue: number, surface: string, ratio: number, step: number): string {
  while (contrast(shade(lightness, cap, hue), surface) < ratio && lightness > 0 && lightness < 1) lightness += step;
  return shade(lightness, cap, hue);
}

/** The CSS variables for a choice. */
export function accentTokens(choice: AccentChoice): Record<string, string> {
  const hue = choice.mono ? DEFAULT_HUE : choice.hue;
  const turned = (turn: number) => (hue + turn + 360) % 360;
  const tokens: Record<string, string> = choice.mono
    ? { ...MONO }
    : {
        "--ac-b-l": readable(ACCENT.l[0], ACCENT.l[1], hue, PAGE.l, 4.6, -0.005),
        "--ac-b-d": readable(ACCENT.d[0], ACCENT.d[1], hue, PAGE.d, 4.6, 0.005),
      };
  tokens["--ac-b2-l"] = readable(SECOND.l[0], SECOND.l[1], turned(SECOND.turn), PAGE.l, 4.6, -0.005);
  tokens["--ac-b2-d"] = readable(SECOND.d[0], SECOND.d[1], turned(SECOND.turn), PAGE.d, 4.6, 0.005);
  for (const [part, themes] of Object.entries(DOTS)) {
    for (const theme of ["l", "d"] as const) {
      const [lightness, cap, turn] = themes[theme];
      tokens[`--ac-dot-${part}-${theme}`] = readable(lightness, cap, turned(turn), LOGO_PAGE[theme], 3, theme === "l" ? -0.005 : 0.005);
    }
  }
  return tokens;
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
