// Calavera's icon set.
//
// Drawn for this interface rather than typed as text characters, so every
// icon looks the same on every device. One style throughout: a 24 x 24 grid,
// 2 px strokes (the weight of the interface's borders), square line ends and
// sharp corners.
//
// To add an icon, add its path data to PATHS; several strokes go in one
// string, each starting with "M".
const PATHS = {
  // navigation
  queue: "M4 6h16M4 12h16M4 18h10",
  search: "M4 4h11v11H4zM15 15l5 5",
  settings: "M4 7h8M16 7h4M12 4.5h4v5h-4zM4 17h4M12 17h8M8 14.5h4v5H8z",
  user: "M8.5 4h7v7h-7zM4 20v-5h16v5",
  // actions
  download: "M12 4v11M7 10.5l5 5 5-5M4 20h16",
  back: "M20 12H5M11 6l-6 6 6 6",
  retry: "M19 12v7H5V6h9M11 2.5L14.5 6 11 9.5",
  trash: "M4 7h16M9 7V4h6v3M6 7v13h12V7M10 11v5M14 11v5",
  close: "M6 6l12 12M18 6L6 18",
  // disclosure and direction
  "chevron-right": "M9 5l7 7-7 7",
  "chevron-down": "M5 9l7 7 7-7",
  "arrow-right": "M4 12h15M13 6l6 6-6 6",
  // status
  check: "M4 12.5l5 5L20 6.5",
  warning: "M12 3.5L2.5 20.5h19zM12 10v5M12 17.5v.5",
  info: "M4 4h16v16H4zM12 11v6M12 7v.5",
  // theme
  sun: "M9 9h6v6H9zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  moon: "M19 14.5A8 8 0 0 1 9.5 5 8 8 0 1 0 19 14.5z",
  auto: "M4 4h16v16H4zM4 20L20 4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The prompt mark in front of page titles and command-style inputs. */
export function Prompt({ size = 20 }: { size?: number }) {
  return (
    <svg className="prompt" width={size * 0.6} height={size} viewBox="0 0 12 20" aria-hidden="true">
      <path d="M2 3l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export function Skull({ size = 28 }: { size?: number }) {
  return (
    <svg className="skull" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path
        fill="var(--on-accent)"
        d="M16 5c-5.4 0-9 3.5-9 8.3 0 2.7 1.3 4.5 2.8 5.7.7.6 1 1 1.1 1.800l.2 1.500c.1.8.8 1.4 1.6 1.400h6.600c.8 0 1.5-.6 1.6-1.400l.2-1.500c.1-.8.4-1.2 1.1-1.8 1.5-1.2 2.8-3 2.8-5.700C25 8.5 21.4 5 16 5z"
      />
      <g fill="var(--accent)">
        <circle cx="12.1" cy="13.8" r="2.7" />
        <circle cx="19.9" cy="13.8" r="2.7" />
        <path d="M16 16.600l-1.5 2.800h3z" />
        <rect x="13.2" y="21.6" width="1.6" height="3.4" rx=".5" />
        <rect x="17.2" y="21.6" width="1.6" height="3.4" rx=".5" />
      </g>
    </svg>
  );
}
