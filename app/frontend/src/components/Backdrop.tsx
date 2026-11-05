import { useEffect, useState } from "react";
import { logoTileSvg, type Colours } from "./DotsLogo";

// The window's background: three layers of small skulls from the logo, each
// a repeating tile, drifting down at their own speed so the near ones (big,
// quick) pass the far ones (small, faint, slow). The motion is a CSS
// transform per layer, so it costs no JavaScript while it runs; with reduced
// motion the layers stand still (styles.css).

// size of the tile, size of its skulls, opacity, seconds per tile
const LAYERS: [number, number, number, number][] = [
  [150, 12, 0.35, 60],
  [210, 26, 0.6, 38],
  [320, 48, 0.9, 24],
];

// Fixed scatter of three skulls per tile, so the pattern is the same on every visit.
function scatter(seed: number, tile: number, skull: number) {
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return [0, 1, 2].map(() => ({ x: random() * tile, y: random() * tile, size: skull * (0.8 + random() * 0.4) }));
}

/** The logo's three shades as the page shows them now (theme and accent). */
function currentColours(): Colours {
  const style = getComputedStyle(document.documentElement);
  const read = (part: string) => style.getPropertyValue(`--dot-${part}`).trim();
  return { edge: read("edge"), bone: read("bone"), high: read("high") };
}

export function Backdrop() {
  const [colours, setColours] = useState(currentColours);

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
      {LAYERS.map(([tile, skull, opacity, seconds], i) => {
        const svg = logoTileSvg(tile, scatter(7 + i, tile, skull), colours);
        return (
          <div
            key={i}
            style={{
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
              backgroundSize: `${tile}px ${tile}px`,
              opacity,
              top: -tile,
              animationDuration: `${seconds}s`,
              ["--tile" as string]: `${tile}px`,
            }}
          />
        );
      })}
    </div>
  );
}
