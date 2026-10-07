import { useCallback, useState } from "react";
import { accentTokens, DEFAULT_ACCENT, type AccentChoice } from "./accentColour";

// The accent choice is kept per browser, like the theme. The calculated
// shades are stored with it so that public/theme.js can apply them before
// first paint without repeating the colour maths.
const KEY = "calavera-accent";

const isDefault = (choice: AccentChoice) => !choice.mono && choice.hue === DEFAULT_ACCENT.hue;

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
}

/** The accent choice, a setter that applies it at once, and whether it is the default. */
export function useAccent(): [AccentChoice, (choice: AccentChoice) => void, boolean] {
  const [choice, setChoice] = useState<AccentChoice>(read);
  const change = useCallback((next: AccentChoice) => {
    apply(next);
    setChoice(next);
  }, []);
  return [choice, change, isDefault(choice)];
}
