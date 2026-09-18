// Applies the saved (or system) theme before first paint, so there is no light flash in dark mode.
// Loaded as a same-origin file because the Content-Security-Policy forbids inline scripts.
(function () {
  try {
    var saved = localStorage.getItem("s2h-theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* private mode or blocked storage: fall back to the light theme */
  }
})();
