// The halftone logo: a skull and crossbones drawn in dots of three colours,
// each a shade of the accent (lib/accentColour.ts): edge dots, bone and
// highlights, with a light and a dark set so it shows on either page. The
// drawing is halftone-skull.svg (there on a dark tile); each dot is
// "x y radius", x and y doubled.
const DOTS = {
  edge: "5 1 .122,11 1 .254,13 3 .160,7 7 .258,11 7 .288,5 9 .138,13 9 .254,7 11 .233,15 11 .146,3 13 .233,7 13 .193,9 13 .250,11 13 .169,3 15 .272,15 15 .233,5 17 .261,17 17 .166,3 19 .193,13 19 .241,17 19 .153",
  bone: "7 1 .321,9 1 .395,5 3 .405,7 3 .500,11 3 .368,5 5 .463,7 5 .485,11 5 .431,13 5 .392,5 7 .380,9 7 .457,13 7 .360,7 9 .451,9 9 .418,11 9 .467,9 11 .389,11 11 .349,5 13 .442,13 13 .373,15 13 .465,5 15 .381,7 15 .391,9 15 .432,11 15 .437,13 15 .322,7 17 .416,9 17 .357,11 17 .345,13 17 .427,15 17 .404,5 19 .459,7 19 .348,15 19 .417",
  high: "9 3 .520,9 5 .514",
} as const;
// A square around the dots, which span x 1.23 to 8.67 and y 0.10 to 9.96
// (centre 4.95, 5.03), with a thin margin: the skull fills its box at any
// size, centred. At 16 px that leaves about 0.7 px on top and bottom.
const VIEW = "-0.453 -0.368 10.8 10.8";
// Dots smaller than this in the tab icon are drawn at this size: at 16 px
// anything under about a pixel across shows as haze, not as a dot.
const ICON_MIN_RADIUS = 0.26;

type Part = keyof typeof DOTS;
const parse = (part: Part) => DOTS[part].split(",").map((dot) => dot.split(" ").map(Number));

export type Colours = Record<Part, string>;

/**
 * The drawing as SVG markup for the browser-tab icon, in the light set and,
 * when the browser is dark, the dark one.
 */
export function logoSvg(light: Colours, dark: Colours): string {
  const parts = Object.keys(DOTS) as Part[];
  const style = (c: Colours) => parts.map((part) => `.${part}{fill:${c[part]}}`).join("");
  const radius = (r: number) => Math.max(r, ICON_MIN_RADIUS);
  const groups = parts
    .map((part) => `<g class="${part}">${parse(part).map(([x, y, r]) => `<circle cx="${x / 2}" cy="${y / 2}" r="${radius(r)}"/>`).join("")}</g>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}"><style>${style(light)}` +
    `@media (prefers-color-scheme: dark){${style(dark)}}</style>${groups}</svg>`
  );
}

/**
 * A repeating tile of the logo, `width` × `height` px, as SVG markup: each
 * skull is `{x, y, size}` in px (top-left corner), and skulls over an edge
 * are drawn again on the other side so the tile repeats without seams.
 */
export function logoTileSvg(width: number, height: number, skulls: { x: number; y: number; size: number; opacity?: number }[], colours: Colours): string {
  const parts = Object.keys(DOTS) as Part[];
  const [vx, vy, vs] = VIEW.split(" ").map(Number);
  const drawing = parts
    .map((part) => `<g fill="${colours[part]}">${parse(part).map(([x, y, r]) => `<circle cx="${x / 2}" cy="${y / 2}" r="${r}"/>`).join("")}</g>`)
    .join("");
  const placed: string[] = [];
  for (const s of skulls)
    for (const dx of [-width, 0, width])
      for (const dy of [-height, 0, height]) {
        const x = s.x + dx, y = s.y + dy;
        const opacity = s.opacity === undefined ? "" : ` opacity="${s.opacity.toFixed(2)}"`;
        if (x < width && x + s.size > 0 && y < height && y + s.size > 0)
          placed.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(s.size / vs).toFixed(4)}) translate(${-vx} ${-vy})"${opacity}>${drawing}</g>`);
      }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${placed.join("")}</svg>`;
}

/** The logo, coloured by the --dot-* variables of the theme, in a square of `size`. */
export function DotsLogo({ size = 32 }: { size?: number }) {
  return (
    <svg className="dots-logo" width={size} height={size} viewBox={VIEW} aria-hidden="true">
      {(Object.keys(DOTS) as Part[]).map((part) => (
        <g key={part} fill={`var(--dot-${part})`}>
          {parse(part).map(([x, y, r]) => (
            <circle key={`${x} ${y}`} cx={x / 2} cy={y / 2} r={r} />
          ))}
        </g>
      ))}
    </svg>
  );
}
