import { lazy, Suspense } from "react";
import { currentUi } from "./lib/ui";

// Each interface is its own bundle with its own stylesheet, so a browser
// loads only the one it shows.
const Bento = lazy(() => import("./bento/BentoApp"));
const Classic = lazy(() => import("./ClassicApp"));

export function App() {
  const ui = currentUi();
  document.documentElement.dataset.ui = ui;
  return <Suspense fallback={null}>{ui === "bento" ? <Bento /> : <Classic />}</Suspense>;
}
