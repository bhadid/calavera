// Icons in the manner of SF Symbols: a 24 x 24 grid, rounded 2 px strokes,
// sized to the text beside them. Drawn here because SF Symbols may only be
// used in apps on Apple platforms.
const PATHS = {
  queue: "M4 6h16M4 12h16M4 18h10",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm10 2-4.3-4.3",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  download: "M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6 6 18",
  clear: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6m0-6-6 6",
  drive: "M3 13h18v6H3zM5 13l2-8h10l2 8M7 16h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  note: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  wave: "M3 12h2l2-6 4 12 3-9 2 3h5",
  disc: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4m8-4v4",
  warning: "M12 4 2.5 20h19L12 4zm0 6v5m0 2.5v.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-10v6m0-9.5v.5",
  retry: "M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  terminal: "M4 5h16v14H4zM8 10l3 2-3 2m5 0h3",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8z",
  paint: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H15a2 2 0 0 0-1 3.7c.6.4.5 2.3-2 2.3zM7.5 12h.01M10 7.5h.01M15 7.5h.01",
  sliders: "M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M16 4v4M10 10v4M18 16v4",
  tag: "M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01",
  key: "M15 9a4 4 0 1 0-3.9 4.9L8 17v3h3v-2h2v-2l2.1-2.1A4 4 0 0 0 15 9zm1.5-1.5h.01",
  plus: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, weight = 2 }: { name: IconName; size?: number; weight?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
