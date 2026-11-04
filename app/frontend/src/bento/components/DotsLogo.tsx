// The halftone logo: a skull and crossbones drawn in dots of three colours
// on a dark tile. Each colour is a shade of the accent (lib/accentColour.ts):
// edge dots, bone and highlights, and the tile. The drawing is
// 3-halftone-dots.svg; each dot is "x y radius", x and y doubled.
const DOTS = {
  edge: "15 1 .113,19 1 .113,11 3 .175,23 3 .181,25 3 .117,9 5 .130,23 5 .221,25 5 .113,9 7 .269,25 7 .221,27 7 .122,27 9 .254,9 13 .216,13 13 .206,27 13 .244,15 15 .156,23 15 .298,11 17 .214,13 19 .223,15 21 .298,17 21 .302,15 23 .254,23 23 .226,29 23 .138,31 23 .181,7 25 .237,11 25 .126,17 25 .190,21 25 .237,27 25 .187,7 27 .300,13 27 .274,33 27 .117,19 29 .239,27 29 .291,29 29 .181,33 29 .156,7 31 .166,9 31 .166,15 31 .172,21 33 .300,27 33 .274,9 35 .209,17 35 .214,33 35 .246,7 37 .272,15 37 .134,33 37 .235,7 39 .117,9 39 .239,29 39 .274",
  bone: "13 3 .312,15 3 .413,17 3 .456,19 3 .462,21 3 .349,11 5 .380,15 5 .420,21 5 .338,21 7 .457,23 7 .338,9 9 .364,23 9 .420,25 9 .338,9 11 .345,13 11 .469,15 11 .408,17 11 .500,21 11 .395,23 11 .338,25 11 .500,27 11 .321,11 13 .496,17 13 .416,19 13 .501,25 13 .430,11 15 .354,13 15 .311,17 15 .438,19 15 .461,21 15 .326,25 15 .412,17 17 .395,21 17 .499,25 17 .360,15 19 .378,17 19 .472,19 19 .457,21 19 .470,23 19 .309,19 21 .319,21 21 .309,23 21 .316,17 23 .414,19 23 .450,21 23 .438,9 25 .370,19 25 .345,29 25 .483,31 25 .364,11 27 .479,25 27 .332,27 27 .480,31 27 .469,7 29 .374,9 29 .477,11 29 .400,13 29 .450,15 29 .459,17 29 .385,21 29 .312,23 29 .448,25 29 .428,31 29 .321,17 31 .434,23 31 .376,15 33 .381,17 33 .467,19 33 .316,23 33 .454,25 33 .451,11 35 .321,13 35 .465,15 35 .463,25 35 .358,29 35 .483,31 35 .457,13 37 .459,27 37 .322,31 37 .445,11 39 .418,13 39 .314",
  high: "13 5 .517,17 5 .520,19 5 .520,11 7 .520,13 7 .520,15 7 .520,17 7 .520,19 7 .520,11 9 .520,13 9 .520,15 9 .520,17 9 .520,19 9 .520,21 9 .510,11 11 .520,19 11 .516,13 17 .511,15 17 .516,23 17 .520,9 27 .520,29 27 .511,19 31 .520,21 31 .520,27 35 .506,9 37 .511,11 37 .520,29 37 .520",
} as const;

type Part = keyof typeof DOTS;
const parse = (part: Part) => DOTS[part].split(",").map((dot) => dot.split(" ").map(Number));

/** The drawing as SVG markup with the given colours, for the browser-tab icon. */
export function logoSvg(colours: Record<Part | "tile", string>): string {
  const circles = (Object.keys(DOTS) as Part[])
    .flatMap((part) => parse(part).map(([x, y, r]) => `<circle cx="${x / 2}" cy="${y / 2}" r="${r}" fill="${colours[part]}"/>`))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 22 24"><rect x="-1" y="-1" width="22" height="24" rx="4" fill="${colours.tile}"/>${circles}</svg>`;
}

/** The logo, coloured by the --ac-dot-* variables. `size` is its height. */
export function DotsLogo({ size = 32 }: { size?: number }) {
  return (
    <svg className="dots-logo" width={(size * 22) / 24} height={size} viewBox="-1 -1 22 24" aria-hidden="true">
      <rect x={-1} y={-1} width={22} height={24} rx={4} fill="var(--dot-tile)" />
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
