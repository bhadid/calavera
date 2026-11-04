import { useCallback, useState } from "react";
import { accentTokens, DEFAULT_ACCENT, type AccentChoice } from "./accentColour";
import { logoSvg } from "../components/DotsLogo";

// The accent choice is kept per browser, like the theme. The calculated
// shades are stored with it so that public/theme.js can apply them before
// first paint without repeating the colour maths. Monochrome is the default:
// nothing is stored for it, and its shades are in styles.css.
const KEY = "calavera-accent";

/** The browser-tab icon: public/favicon.svg for the default, else the logo in the chosen shades. */
function paintFavicon(choice: AccentChoice) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (choice.mono) {
    link.href = "/favicon.svg";
    return;
  }
  const tokens = accentTokens(choice);
  const set = (theme: "l" | "d") => ({
    edge: tokens[`--ac-dot-edge-${theme}`], bone: tokens[`--ac-dot-bone-${theme}`], high: tokens[`--ac-dot-high-${theme}`],
  });
  link.href = `data:image/svg+xml,${encodeURIComponent(logoSvg(set("l"), set("d")))}`;
}

function read(): AccentChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (stored && Number.isInteger(stored.hue) && stored.hue >= 0 && stored.hue < 360) return { hue: stored.hue, mono: stored.mono === true };
  } catch {
    // Storage unavailable or damaged: use the default.
  }
  return DEFAULT_ACCENT;
}

function apply(choice: AccentChoice) {
  const style = document.documentElement.style;
  const tokens = accentTokens(choice);
  // Shades stored by an earlier version may have other names: clear them all.
  for (const name of [...style].filter((n) => n.startsWith("--ac-"))) style.removeProperty(name);
  if (!choice.mono) for (const [name, value] of Object.entries(tokens)) style.setProperty(name, value);
  try {
    if (choice.mono) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...choice, tokens }));
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
  paintFavicon(choice);
}

// Shades stored by an earlier version may lack ones added since: recalculate.
apply(read());

/** The accent choice and a setter that applies it at once. */
export function useAccent(): [AccentChoice, (choice: AccentChoice) => void] {
  const [choice, setChoice] = useState<AccentChoice>(read);
  const change = useCallback((next: AccentChoice) => {
    apply(next);
    setChoice(next);
  }, []);
  return [choice, change];
}
