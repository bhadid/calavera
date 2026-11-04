// Apply a saved theme and accent colour before first paint to avoid a flash
// of the wrong one.
// The interface (src/lib/ui.ts): the page background differs between them.
var ui = "bento";
try {
  var asked = new URLSearchParams(location.search).get("ui");
  var kept = localStorage.getItem("calavera-ui");
  ui = asked === "classic" || asked === "bento" ? asked : kept === "classic" ? "classic" : "bento";
} catch (e) {
  // Storage unavailable: the default interface.
}
document.documentElement.dataset.ui = ui;
try {
  var saved = localStorage.getItem("calavera-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch (e) {
  // Storage unavailable: follow the system theme.
}
try {
  // Shades calculated and stored by src/lib/accent.ts, which also recolours
  // the browser-tab icon once the app has loaded.
  var tokens = (JSON.parse(localStorage.getItem("calavera-accent")) || {}).tokens || {};
  for (var name in tokens) {
    if (/^--ac-[a-z-]+$/.test(name) && /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(tokens[name])) {
      document.documentElement.style.setProperty(name, tokens[name]);
    }
  }
} catch (e) {
  // Storage unavailable or damaged: use the default accent.
}
