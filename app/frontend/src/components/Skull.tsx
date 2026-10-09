import { useId } from "react";

// The logo: a skull in one colour, a shade of the accent hue (--logo). Eyes,
// nose, the gaps between the teeth and the crease on its side are cut out of
// it, so the page shows through. public/favicon.svg has the same outline;
// scripts/check-accent.mjs fails if the two drift apart.
const SILHOUETTE =
  "M7 23.5C6.21 23.2 5.3 22.89 4.5 22.5C3.7 22.12 2.84 21.85 2.2 21.2C1.45 20.43 0.66 19.19 0.5 18C0.32 16.66 1.16 14.95 1.5 13.5C1.82 12.13 2.02 10.81 2.5 9.5C3 8.14 3.59 6.66 4.5 5.5C5.42 4.32 6.81 3.17 8 2.5C8.98 1.94 9.79 1.79 11 1.5C12.74 1.08 15.33 0.5 17.5 0.5C19.67 0.5 22.26 1.08 24 1.5C25.21 1.79 25.98 2.05 27 2.5C28.15 3.01 29.55 3.69 30.5 4.5C31.34 5.22 31.99 6.13 32.5 7C32.97 7.8 33.21 8.47 33.5 9.5C33.93 11.05 34.52 13.62 34.5 15.5C34.48 17.16 34.21 18.97 33.6 20.2C33.1 21.19 32.18 21.92 31.5 22.5Q30.6 23.5 29.5 23.5L27.5 23.5Q26 23.5 25 24.3Q23.5 25.3 23.5 26.3Q23.5 27.5 22.3 27.5L20 27.5Q18.7 27.5 18.5 26.7Q18.3 27.5 17 27.5L15 27.5Q13.7 27.5 13.5 26.7Q13.3 27.5 12 27.5L9.7 27.5Q8.5 27.5 8.5 26.3L8.5 24.8Q8.5 23.9 7 23.5Z";
const CREASE =
  "M20.5 1.4C21.43 1.93 22.93 2.66 24 3.5C25.1 4.36 26.17 5.35 27 6.5C27.85 7.68 28.49 9.19 29 10.5C29.46 11.68 30.02 12.88 30 14C29.98 15.04 29.46 16.19 29 17C28.62 17.66 27.85 18.05 27.6 18.6Q27.5 21.3 26.5 23.5";
const GAPS = "M13.5 23.7V28M18.5 23.7V28";
const NOSE = "M15 17.6L17.4 19.5H12.6Z";
const NOSE_TIP = "M14 20Q15 18.1 16 20Z";

/** The logo. `size` is its height; it is a quarter wider than tall. */
export function Skull({ size = 32 }: { size?: number }) {
  // Several logos can be on a page: each needs its own mask id.
  const mask = useId();
  return (
    <svg className="skull" width={(size * 35) / 28} height={size} viewBox="0 0 35 28" aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="35" height="28">
        <path fill="#fff" d={SILHOUETTE} />
        <g fill="#000" stroke="#000">
          <circle cx="10" cy="13" r="4.1" />
          <circle cx="20" cy="13" r="4.1" />
          <path strokeLinejoin="round" d={NOSE} />
          <path fill="none" strokeWidth="0.7" strokeLinecap="round" d={GAPS} />
          <path fill="none" strokeWidth="0.7" strokeLinecap="round" d={CREASE} />
        </g>
        <path fill="#fff" d={NOSE_TIP} />
      </mask>
      <rect width="35" height="28" fill="var(--logo)" mask={`url(#${mask})`} />
    </svg>
  );
}
