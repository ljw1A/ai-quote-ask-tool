(function () {
  "use strict";

  const DEFAULT_THEME = "green";
  const THEMES = [
    { id: "green", label: "默认绿" },
    { id: "pink", label: "淡粉色" },
    { id: "blue", label: "淡蓝色" },
    { id: "gold", label: "淡金色" },
    { id: "slate", label: "石墨灰" }
  ];
  const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

  function normalizeTheme(theme) {
    const value = String(theme || "").trim();
    return THEME_IDS.has(value) ? value : DEFAULT_THEME;
  }

  function getThemeLabel(theme) {
    const normalized = normalizeTheme(theme);
    const found = THEMES.find((item) => item.id === normalized);
    return found ? found.label : THEMES[0].label;
  }

  function applyTheme(theme, root = document.documentElement) {
    if (!root) {
      return DEFAULT_THEME;
    }
    const normalized = normalizeTheme(theme);
    root.dataset.cgqaTheme = normalized;
    return normalized;
  }

  function renderThemeOptions(select, selectedTheme) {
    if (!select) {
      return;
    }
    const normalized = normalizeTheme(selectedTheme);
    select.replaceChildren();
    THEMES.forEach((theme) => {
      const option = document.createElement("option");
      option.value = theme.id;
      option.textContent = theme.label;
      option.selected = theme.id === normalized;
      select.append(option);
    });
  }

  globalThis.CGQATheme = {
    DEFAULT_THEME,
    THEMES,
    normalizeTheme,
    getThemeLabel,
    applyTheme,
    renderThemeOptions
  };
})();
