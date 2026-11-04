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

/** The appearance preference (system, light or dark) and a function that sets it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  const set = useCallback((next: Theme) => {
    apply(next);
    setTheme(next);
  }, []);
  return [theme, set];
}
