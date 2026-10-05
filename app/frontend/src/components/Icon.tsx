// Small inline icon set (24x24, stroked) so the UI needs no icon dependency.
const PATHS = {
  queue: "M4 6h16M4 12h16M4 18h10",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm10 2-4.3-4.3",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.600h4l.4-2.600a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.200z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  download: "M12 3v12m0 0-4.5-4.500M12 15l4.5-4.500M4 20h16",
  check: "M5 12.500l4.5 4.500L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  retry: "M4 12a8 8 0 1 0 2.6-5.900M4 4v4.500h4.5",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-15v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.400M17.6 17.6 19 19M5 19l1.4-1.400M17.6 6.4 19 5",
  moon: "M20 14.500A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.500z",
  auto: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-18v18",
  chevron: "M9 6l6 6-6 6",
  warning: "M12 4 2.5 20h19L12 4zm0 6v5m0 2.500v.5",
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
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
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
