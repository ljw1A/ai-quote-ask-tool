(function () {
  "use strict";

  const themeSelect = document.getElementById("theme-select");

  document.getElementById("open-manager").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
    window.close();
  });

  themeSelect.addEventListener("change", async () => {
    const savedTheme = await CGQAStorage.saveThemeSettings(themeSelect.value);
    applyTheme(savedTheme);
  });

  function applyTheme(theme) {
    const normalized = CGQATheme.applyTheme(theme);
    CGQATheme.renderThemeOptions(themeSelect, normalized);
  }

  CGQAStorage.getThemeSettings()
    .then(applyTheme)
    .catch((error) => console.error("[CGQA] popup theme load failed", error));
})();
