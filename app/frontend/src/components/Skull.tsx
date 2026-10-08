import { useId } from "react";

// The logo, in three flat colours: white bone, and a shadow and an outline
// that are shades of the accent hue (--logo-shadow, --logo-edge). The same
// drawing is in public/favicon.svg in the default colours;
// scripts/check-accent.mjs fails if the two drift apart.
const SILHOUETTE =
  "M7 23.5C6.21 23.2 5.3 22.89 4.5 22.5C3.7 22.12 2.84 21.85 2.2 21.2C1.45 20.43 0.66 19.19 0.5 18C0.32 16.66 1.16 14.95 1.5 13.5C1.82 12.13 2.02 10.81 2.5 9.5C3 8.14 3.59 6.66 4.5 5.5C5.42 4.32 6.81 3.17 8 2.5C8.98 1.94 9.79 1.79 11 1.5C12.74 1.08 15.33 0.5 17.5 0.5C19.67 0.5 22.26 1.08 24 1.5C25.21 1.79 25.98 2.05 27 2.5C28.15 3.01 29.55 3.69 30.5 4.5C31.34 5.22 31.99 6.13 32.5 7C32.97 7.8 33.21 8.47 33.5 9.5C33.93 11.05 34.52 13.62 34.5 15.5C34.48 17.16 34.21 18.97 33.6 20.2C33.1 21.19 32.18 21.92 31.5 22.5Q30.6 23.5 29.5 23.5L27.5 23.5Q26 23.5 25 24.3Q23.5 25.3 23.5 26.3Q23.5 27.5 22.3 27.5L20 27.5Q18.7 27.5 18.5 26.7Q18.3 27.5 17 27.5L15 27.5Q13.7 27.5 13.5 26.7Q13.3 27.5 12 27.5L9.7 27.5Q8.5 27.5 8.5 26.3L8.5 24.8Q8.5 23.9 7 23.5Z";
const SIDE_SHADOW =
  "M20.5 1.4C21.43 1.93 22.93 2.66 24 3.5C25.1 4.36 26.17 5.35 27 6.5C27.85 7.68 28.49 9.19 29 10.5C29.46 11.68 30.02 12.88 30 14C29.98 15.04 29.46 16.19 29 17C28.62 17.66 27.85 18.05 27.6 18.6Q27.5 21.3 26.5 23.5L26 30L40 30L40 -2L20.5 -2Z";
const TEETH_SHADOW = "M12.5 23.5V27M17.5 23.5V27M22.5 24.6V27M13.5 22.5V24M18.5 22.5V24";
const LINES = "M27.6 18.3Q27.6 21.2 26.5 23.5M13.5 23.6V26.7M18.5 23.6V26.7";
const NOSE = "M15 17.6L17.4 19.5H12.6Z";
const NOSE_SHADOW = "M14 20Q15 18.1 16 20Z";

/** The logo. `size` is its height; it is about a quarter wider than tall. */
export function Skull({ size = 32 }: { size?: number }) {
  // Several logos can be on a page: each needs its own clip path id.
  const clip = useId();
  return (
    <svg className="skull" width={(size * 36) / 29} height={size} viewBox="-0.5 -0.5 36 29" aria-hidden="true">
      <clipPath id={clip}>
        <path d={SILHOUETTE} />
      </clipPath>
      <g clipPath={`url(#${clip})`} fill="var(--logo-shadow)">
        <rect x="-1" y="-1" width="37" height="30" />
        <path d={SILHOUETTE} transform="translate(0 -1.5)" fill="#fdfdfd" />
        <path d={SIDE_SHADOW} />
        <path d={TEETH_SHADOW} fill="none" stroke="var(--logo-shadow)" strokeLinecap="round" />
        <circle cx="10" cy="14" r="4.1" />
        <circle cx="11" cy="13" r="4.1" />
        <circle cx="20" cy="14" r="4.1" />
        <circle cx="21" cy="13" r="4.1" />
      </g>
      <g className="skull-line" fill="none" stroke="var(--logo-edge)" strokeLinecap="round" strokeLinejoin="round">
        <path d={SILHOUETTE} />
        <path d={LINES} />
      </g>
      <g fill="var(--logo-edge)">
        <circle cx="10" cy="13" r="4.1" />
        <circle cx="20" cy="13" r="4.1" />
        <path d={NOSE} stroke="var(--logo-edge)" strokeLinejoin="round" />
      </g>
      <path d={NOSE_SHADOW} fill="var(--logo-shadow)" />
    </svg>
  );
}
