import { useState, type CSSProperties, type ReactNode } from "react";
import { contrast } from "../../lib/accentColour";
import type { ArtworkColors } from "../../lib/types";
import { DotsLogo } from "./DotsLogo";
import { Icon } from "./Icon";

/**
 * A tile's place in the grid: its width and height in columns and rows at
 * each width class (2, 4 and 6 columns). Heights default to one row.
 */
export function span(w2: number, w4: number, w6: number, h2 = 1, h4 = h2, h6 = h4): CSSProperties {
  return { "--w2": w2, "--w4": w4, "--w6": w6, "--h2": h2, "--h4": h4, "--h6": h6 } as CSSProperties;
}

/**
 * The colours Apple picked from a cover, for a tile showing it: background
 * and two text colours. Only when the text is readable on the background
 * (4.5:1); otherwise none, and the tile keeps the theme's colours.
 */
export function tint(colors?: ArtworkColors | null): { className: string; style: CSSProperties } {
  if (!colors) return { className: "", style: {} };
  const [first, second] = colors.text;
  if (contrast(colors.bg, first) < 4.5) return { className: "", style: {} };
  const secondary = contrast(colors.bg, second) >= 4.5 ? second : first;
  return { className: " tinted", style: { "--art-bg": colors.bg, "--art-1": first, "--art-2": secondary } as CSSProperties };
}

/** Artwork, with the logo in its place while unknown or if it fails to load. */
export function Cover({ src, size, round = false, className = "" }: { src: string; size?: number; round?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style: CSSProperties = size ? { width: size, height: size } : {};
  const cls = `cover${round ? " round" : ""}${className ? ` ${className}` : ""}`;
  if (!src || failed) {
    return (
      <div className={`${cls} cover-empty`} style={style}>
        <DotsLogo size={Math.max(18, Math.round((size ?? 120) * 0.45))} />
      </div>
    );
  }
  return <img className={cls} style={style} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/** A tinted notice tile: a warning, a problem, or good news. */
export function Notice({ tone, children, role }: { tone: "warn" | "bad" | "ok" | "info"; children: ReactNode; role?: string }) {
  const icon = tone === "ok" ? "check" : tone === "info" ? "info" : "warning";
  return (
    <div className={`tile notice notice-${tone}`} role={role}>
      <Icon name={icon} size={20} />
      <div>{children}</div>
    </div>
  );
}

