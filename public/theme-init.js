// Applies the saved (or system) theme before first paint, so there is no light flash in dark mode.
// Loaded as a same-origin file because the Content-Security-Policy forbids inline scripts.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("s2h-theme");
  } catch (e) {
    /* private mode or blocked storage: fall through to the device setting */
  }
  var dark =
    saved === "dark" || saved === "light"
      ? saved === "dark"
      : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
