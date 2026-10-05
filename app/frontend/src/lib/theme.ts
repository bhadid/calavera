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

/** The theme preference and a function that cycles system -> light -> dark. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(read);
  const cycle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "system" ? "light" : current === "light" ? "dark" : "system";
      if (next === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = next;
      try {
        if (next === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        // Private windows may refuse storage; the choice then lasts for this page only.
      }
      return next;
    });
  }, []);
  return [theme, cycle];
}
