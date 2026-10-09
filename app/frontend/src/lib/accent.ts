import { useCallback, useState } from "react";
import { accentTokens, DEFAULT_ACCENT, type AccentChoice } from "./accentColour";

// The accent choice is kept per browser, like the theme. The calculated
// shades are stored with it so that public/theme.js can apply them before
// first paint without repeating the colour maths.
const KEY = "calavera-accent";

const isDefault = (choice: AccentChoice) => !choice.mono && choice.hue === DEFAULT_ACCENT.hue;

const DEFAULT_TOKENS = accentTokens(DEFAULT_ACCENT);
let favicon = 0;

/** Recolour the browser-tab icon: public/favicon.svg with the logo shade swapped. */
async function paintFavicon(tokens: Record<string, string>, standard: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const turn = ++favicon;
  if (standard) {
    link.href = "/favicon.svg";
    return;
  }
  try {
    let svg = await (await fetch("/favicon.svg")).text();
    // The light-theme shade: with monochrome that is black lines on the white bone.
    svg = svg.replaceAll(DEFAULT_TOKENS["--ac-logo-l"], tokens["--ac-logo-l"]);
    // A slower, older request must not overwrite a newer colour.
    if (turn === favicon) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  } catch {
    // The icon keeps its previous colour.
  }
}

function read(): AccentChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (stored && Number.isInteger(stored.hue) && stored.hue >= 0 && stored.hue < 360) {
      return { hue: stored.hue, mono: stored.mono === true };
    }
  } catch {
    // Storage unavailable or damaged: use the default.
  }
  return DEFAULT_ACCENT;
}

function apply(choice: AccentChoice) {
  const style = document.documentElement.style;
  const tokens = accentTokens(choice);
  // The default lives in styles.css; no overrides are needed for it.
  for (const [name, value] of Object.entries(tokens)) {
    if (isDefault(choice)) style.removeProperty(name);
    else style.setProperty(name, value);
  }
  try {
    if (isDefault(choice)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...choice, tokens }));
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
  void paintFavicon(tokens, isDefault(choice));
}

// Shades stored by an earlier version may lack ones added since: recalculate.
if (!isDefault(read())) apply(read());

/** The accent choice, a setter that applies it at once, and whether it is the default. */
export function useAccent(): [AccentChoice, (choice: AccentChoice) => void, boolean] {
  const [choice, setChoice] = useState<AccentChoice>(read);
  const change = useCallback((next: AccentChoice) => {
    apply(next);
    setChoice(next);
  }, []);
  return [choice, change, isDefault(choice)];
}
