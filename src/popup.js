(function () {
  "use strict";

  const themeSelect = document.getElementById("theme-select");
  const providerList = document.getElementById("provider-list");
  const repairButton = document.getElementById("repair-page");
  const repairHelp = document.getElementById("repair-help");
  const repairStatus = document.getElementById("repair-status");
  const sendVisibilityToggle = document.getElementById("send-visibility-toggle");
  const sendVisibilityHelp = document.getElementById("send-visibility-help");
  const PROVIDERS = [
    { id: "chatgpt", label: "ChatGPT" },
    { id: "gemini", label: "Gemini" },
    {
      id: "deepseek",
      label: "DeepSeek",
      beta: true,
      description: "测试版：DeepSeek 页面公式 DOM 较脆弱，建议需要时再开启。"
    }
  ];

  document.getElementById("open-manager").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
    window.close();
  });

  repairHelp.innerHTML = getHelpIconSvg();
  sendVisibilityHelp.innerHTML = getHelpIconSvg();

  repairButton.addEventListener("click", async () => {
    setRepairStatus("running", "正在整理当前页面...");
    repairButton.disabled = true;
    try {
      const response = await sendRepairCommand();
      if (response && response.ok) {
        setRepairStatus("success", response.message || "已尝试整理当前页面。");
        return;
      }
      setRepairStatus("failed", response && response.message || "当前页面未启用提问助手。");
    } catch (error) {
      setRepairStatus("failed", error && error.message || "当前页面无法接收整理命令。");
    } finally {
      repairButton.disabled = false;
    }
  });

  themeSelect.addEventListener("change", async () => {
    const savedTheme = await CGQAStorage.saveThemeSettings(themeSelect.value);
    applyTheme(savedTheme);
  });

  providerList.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.providerId === undefined) {
      return;
    }
    await CGQAStorage.saveProviderSettings({
      [input.dataset.providerId]: input.checked
    });
  });

  sendVisibilityToggle.addEventListener("change", async () => {
    const settings = await CGQAStorage.saveCompatibilitySettings({
      keepProviderUiVisibleDuringSend: sendVisibilityToggle.checked
    });
    renderCompatibilitySettings(settings);
  });

  function applyTheme(theme) {
    const normalized = CGQATheme.applyTheme(theme);
    CGQATheme.renderThemeOptions(themeSelect, normalized);
  }

  function renderProviderSettings(settings) {
    providerList.textContent = "";
    PROVIDERS.forEach((provider) => {
      providerList.append(createProviderToggle(provider, Boolean(settings && settings[provider.id])));
    });
  }

  function renderCompatibilitySettings(settings) {
    sendVisibilityToggle.checked = Boolean(settings && settings.keepProviderUiVisibleDuringSend);
  }

  function createProviderToggle(provider, checked) {
    const label = document.createElement("label");
    label.className = "popup-provider-row";

    const text = document.createElement("span");
    text.className = "popup-provider-text";
    const name = document.createElement("span");
    name.className = "popup-provider-name";
    name.textContent = provider.label;
    text.append(name);

    if (provider.beta) {
      const badge = document.createElement("span");
      badge.className = "popup-provider-beta";
      badge.textContent = "测试版";
      text.append(badge);
      text.append(createHelpIcon(provider.description));
    }

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset.providerId = provider.id;
    input.setAttribute("aria-label", `启用 ${provider.label}`);

    const switchTrack = document.createElement("span");
    switchTrack.className = "popup-switch";
    switchTrack.setAttribute("aria-hidden", "true");
    switchTrack.append(document.createElement("span"));

    label.append(text, input, switchTrack);
    return label;
  }

  function createHelpIcon(description) {
    const help = document.createElement("span");
    help.className = "popup-help";
    help.title = description || "";
    help.setAttribute("aria-label", description || "提示");
    help.innerHTML = getHelpIconSvg();
    return help;
  }

  function getHelpIconSvg() {
    return [
      '<svg viewBox="0 0 24 24" aria-hidden="true">',
      '<circle cx="12" cy="12" r="9"></circle>',
      '<path d="M9.6 9.2a2.6 2.6 0 0 1 5.05.85c0 1.75-1.55 2.22-2.2 3.18-.2.3-.3.63-.3 1.02"></path>',
      '<path d="M12 17.5h.01"></path>',
      '</svg>'
    ].join("");
  }

  async function sendRepairCommand() {
    const tab = await getActiveTab();
    if (!tab || !Number.isInteger(tab.id)) {
      throw new Error("找不到当前标签页。");
    }
    return sendMessageToTab(tab.id, { type: "CGQA_REPAIR_PAGE" });
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(tabs && tabs[0] || null);
      });
    });
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("当前页面未加载提问助手，或该页面不受支持。"));
          return;
        }
        resolve(response || null);
      });
    });
  }

  function setRepairStatus(kind, text) {
    repairStatus.textContent = text || "";
    repairStatus.dataset.state = kind || "";
  }

  Promise.all([
    CGQAStorage.getThemeSettings(),
    CGQAStorage.getProviderSettings(),
    CGQAStorage.getCompatibilitySettings()
  ]).then(([theme, providers, compatibility]) => {
    applyTheme(theme);
    renderProviderSettings(providers);
    renderCompatibilitySettings(compatibility);
  }).catch((error) => console.error("[CGQA] popup settings load failed", error));
})();
