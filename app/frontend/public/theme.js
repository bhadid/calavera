// Apply a saved theme before first paint to avoid a flash of the wrong one.
try {
  var saved = localStorage.getItem("calavera-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch (e) {
  // Storage unavailable: follow the system theme.
}
