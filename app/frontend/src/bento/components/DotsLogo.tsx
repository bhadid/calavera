// The halftone logo: a skull and crossbones drawn in dots of three colours,
// each a shade of the accent (lib/accentColour.ts): edge dots, bone and
// highlights, with a light and a dark set so it shows on either page. The
// drawing is 3-halftone-dots-10x11.svg (there on a dark tile); each dot is
// "x y radius", x and y doubled.
const DOTS = {
  edge: "5 1 .122,11 1 .254,13 3 .160,7 7 .258,11 7 .288,5 9 .138,13 9 .254,7 11 .233,15 11 .146,3 13 .233,7 13 .193,9 13 .250,11 13 .169,3 15 .272,15 15 .233,5 17 .261,17 17 .166,3 19 .193,13 19 .241,17 19 .153",
  bone: "7 1 .321,9 1 .395,5 3 .405,7 3 .500,11 3 .368,5 5 .463,7 5 .485,11 5 .431,13 5 .392,5 7 .380,9 7 .457,13 7 .360,7 9 .451,9 9 .418,11 9 .467,9 11 .389,11 11 .349,5 13 .442,13 13 .373,15 13 .465,5 15 .381,7 15 .391,9 15 .432,11 15 .437,13 15 .322,7 17 .416,9 17 .357,11 17 .345,13 17 .427,15 17 .404,5 19 .459,7 19 .348,15 19 .417",
  high: "9 3 .520,9 5 .514",
} as const;
// The drawing's area (its viewBox without the tile), and its width and height.
const VIEW = "-1 -1 12 13";
const [WIDTH, HEIGHT] = [12, 13];

type Part = keyof typeof DOTS;
const parse = (part: Part) => DOTS[part].split(",").map((dot) => dot.split(" ").map(Number));

type Colours = Record<Part, string>;

/**
 * The drawing as SVG markup for the browser-tab icon, in the light set and,
 * when the browser is dark, the dark one.
 */
export function logoSvg(light: Colours, dark: Colours): string {
  const parts = Object.keys(DOTS) as Part[];
  const style = (c: Colours) => parts.map((part) => `.${part}{fill:${c[part]}}`).join("");
  const groups = parts
    .map((part) => `<g class="${part}">${parse(part).map(([x, y, r]) => `<circle cx="${x / 2}" cy="${y / 2}" r="${r}"/>`).join("")}</g>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}"><style>${style(light)}` +
    `@media (prefers-color-scheme: dark){${style(dark)}}</style>${groups}</svg>`
  );
}

/** The logo, coloured by the --dot-* variables of the theme. `size` is its height. */
export function DotsLogo({ size = 32 }: { size?: number }) {
  return (
    <svg className="dots-logo" width={(size * WIDTH) / HEIGHT} height={size} viewBox={VIEW} aria-hidden="true">
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
