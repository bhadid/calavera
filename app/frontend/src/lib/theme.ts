import { useCallback, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "calavera-theme";

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(next: Theme) {
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
}

/** The theme preference, a function that cycles system -> light -> dark, and one that sets it. */
export function useTheme(): [Theme, () => void, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  const cycle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "system" ? "light" : current === "light" ? "dark" : "system";
      apply(next);
      return next;
    });
  }, []);
  const set = useCallback((next: Theme) => {
    apply(next);
    setTheme(next);
  }, []);
  return [theme, cycle, set];
}
