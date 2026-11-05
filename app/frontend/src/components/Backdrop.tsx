import { useEffect, useState } from "react";
import { logoTileSvg, type Colours } from "./DotsLogo";

// The window's background: three layers of small skulls from the logo,
// drifting down at their own speed so the near ones (big, quick) pass the far
// ones (small, faint, slow). Each layer is one repeating image, moved by a
// CSS transform, so it costs no JavaScript while it runs; with reduced motion
// the layers stand still (styles.css).
//
// So the repeat does not show, each image is large, its skulls are scattered
// at random (anew on every visit) with room between them, and the three
// layers repeat at different widths and heights, so they never line up.

type Layer = { width: number; height: number; count: number; min: number; max: number; opacity: number; speed: number };
const LAYERS: Layer[] = [
  // speed in px per second
  { width: 700, height: 430, count: 34, min: 9, max: 15, opacity: 0.35, speed: 2.5 },
  { width: 860, height: 530, count: 26, min: 20, max: 32, opacity: 0.6, speed: 5.5 },
  { width: 1040, height: 650, count: 16, min: 40, max: 58, opacity: 0.9, speed: 13 },
];

/** Skulls at random places in the tile, no two closer than about their size (measured across the tile's edges too). */
function scatter({ width, height, count, min, max }: Layer) {
  const skulls: { x: number; y: number; size: number; opacity: number }[] = [];
  for (let tries = 0; skulls.length < count && tries < count * 60; tries++) {
    const size = min + Math.random() * (max - min);
    const x = Math.random() * width, y = Math.random() * height;
    const crowded = skulls.some((s) => {
      const dx = Math.min(Math.abs(s.x - x), width - Math.abs(s.x - x));
      const dy = Math.min(Math.abs(s.y - y), height - Math.abs(s.y - y));
      return Math.hypot(dx, dy) < (s.size + size) * 1.4;
    });
    if (!crowded) skulls.push({ x, y, size, opacity: 0.55 + Math.random() * 0.45 });
  }
  return skulls;
}

/** The logo's three shades as the page shows them now (theme and accent). */
function currentColours(): Colours {
  const style = getComputedStyle(document.documentElement);
  const read = (part: string) => style.getPropertyValue(`--dot-${part}`).trim();
  return { edge: read("edge"), bone: read("bone"), high: read("high") };
}

export function Backdrop() {
  const [colours, setColours] = useState(currentColours);
  const [layout] = useState(() => LAYERS.map(scatter));

  // Theme and accent are attributes and inline variables on <html>; the
  // system appearance is a media query.
  useEffect(() => {
    const update = () =>
      setColours((was) => {
        const now = currentColours();
        return now.edge === was.edge && now.bone === was.bone && now.high === was.high ? was : now;
      });
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", update);
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", update);
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      {LAYERS.map((layer, i) => {
        const svg = logoTileSvg(layer.width, layer.height, layout[i], colours);
        return (
          <div
            key={i}
            style={{
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
              backgroundSize: `${layer.width}px ${layer.height}px`,
              opacity: layer.opacity,
              top: -layer.height,
              animationDuration: `${layer.height / layer.speed}s`,
              ["--tile" as string]: `${layer.height}px`,
            }}
          />
        );
      })}
    </div>
  );
}
