// Which interface this browser shows: "bento" (tiles) or "classic" (the
// terminal look). Kept per browser like the theme; ?ui=classic or ?ui=bento
// in the address switches and remembers. public/theme.js reads the same key
// before first paint.
export type Ui = "bento" | "classic";
const KEY = "calavera-ui";
export const DEFAULT_UI: Ui = "bento";

export function currentUi(): Ui {
  try {
    const asked = new URLSearchParams(location.search).get("ui");
    if (asked === "bento" || asked === "classic") {
      localStorage.setItem(KEY, asked);
      return asked;
    }
    const stored = localStorage.getItem(KEY);
    if (stored === "bento" || stored === "classic") return stored;
  } catch {
    // Storage unavailable: the default.
  }
  return DEFAULT_UI;
}

/** Switch interface. The page reloads, so that only one interface's styles are loaded. */
export function switchUi(ui: Ui) {
  try {
    localStorage.setItem(KEY, ui);
  } catch {
    // Without storage the choice cannot outlive the reload; ask by address.
  }
  const url = new URL(location.href);
  url.searchParams.set("ui", ui);
  location.replace(url.toString());
}
