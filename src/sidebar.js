(function () {
  "use strict";

  const PANEL_POSITION_KEY = "cgqa:panel-position";
  const PANEL_MARGIN = 12;
  const PANEL_DEFAULT_RIGHT = 28;
  const PANEL_DEFAULT_TOP = 140;
  const INPUT_MAX_HEIGHT = 96;
  const OFFICIAL_SELECTION_ATTACH_TIMEOUT_MS = 900;
  const ATTACHED_SELECTION_BUTTON_CLASS = "cgqa-selection-attached-button";

  let panelPosition = readPanelPosition();
  let selectionAttachTimer = 0;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function appendOverlayRoot(node) {
    (document.body || document.documentElement).appendChild(node);
  }

  function removePanel() {
    document.querySelectorAll(".cgqa-root").forEach((node) => node.remove());
  }

  function applyPanelStyle(panel) {
    panel.style.cssText = [
      "all: initial !important",
      "box-sizing: border-box !important",
      "position: fixed !important",
      "top: 0 !important",
      "left: 0 !important",
      "right: auto !important",
      "z-index: 2147483647 !important",
      "display: flex !important",
      "flex-direction: column !important",
      "width: min(408px, calc(100vw - 24px)) !important",
      "max-height: min(632px, calc(100vh - 48px)) !important",
      "overflow: hidden !important",
      "visibility: visible !important",
      "opacity: 1 !important",
      "pointer-events: auto !important",
      "color: #1f2933 !important",
      "background: rgba(255,255,255,0.97) !important",
      "border: 1px solid rgba(229,231,235,0.95) !important",
      "border-radius: 22px !important",
      "box-shadow: 0 20px 54px rgba(15,23,42,0.14), 0 4px 14px rgba(15,23,42,0.08) !important",
      "font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important"
    ].join(";");
  }

  function buildSidebar(callbacks) {
    let root = null;
    let input = null;

    function render(thread) {
      if (!thread) {
        removePanel();
        root = null;
        input = null;
        return;
      }

      root = createPanel(callbacks, thread);
      input = root.querySelector(".cgqa-input");
      syncPanelToViewport(root);
    }

    function renderHelp() {
      root = createPanel(callbacks, {
        displayIndex: "",
        quoteText: "在 ChatGPT 的回复正文里划选文字，然后点击浮动的“批注”按钮。创建后，同一引用的追问会保存在这里。",
        messages: [],
        help: true
      });
      input = root.querySelector(".cgqa-input");
      syncPanelToViewport(root);
      if (input) {
        input.disabled = true;
      }
    }

    function focusInput() {
      if (!input) {
        return;
      }
      if (root && root.dataset.cgqaInputDisabled === "true") {
        return;
      }
      input.disabled = false;
      input.focus();
    }

    function isOpen() {
      return Boolean(root && root.isConnected);
    }

    function handleResize() {
      if (root && root.isConnected) {
        syncPanelToViewport(root);
      }
    }

    function destroy() {
      window.removeEventListener("resize", handleResize);
      removePanel();
      root = null;
      input = null;
    }

    window.addEventListener("resize", handleResize);

    return { render, renderHelp, focusInput, isOpen, destroy };
  }

  function createPanel(callbacks, thread) {
    removePanel();

    const panel = createElement("aside", "cgqa-root is-open");
    panel.id = "cgqa-root";
    panel.setAttribute("aria-live", "polite");
    applyPanelStyle(panel);
    const inputDisabled = Boolean(thread.help || hasGeneratingMessage(thread));
    panel.dataset.cgqaInputDisabled = inputDisabled ? "true" : "false";

    const header = createElement("header", "cgqa-panel-header");
    const titleWrap = createElement("div", "cgqa-panel-title-wrap");
    const title = createElement("h2", "cgqa-panel-title", thread.help ? "批注引用" : `引用 ${thread.displayIndex}`);
    const subtitle = createElement("div", "cgqa-panel-subtitle", thread.help ? "先选择一段 ChatGPT 回复" : "围绕该引用继续提问");
    const close = createElement("button", "cgqa-icon-button", "×");
    close.type = "button";
    close.title = "关闭";
    close.addEventListener("click", () => callbacks.onClose());
    titleWrap.append(title, subtitle);
    header.append(titleWrap, close);
    bindPanelDrag(panel, header);

    const quote = createElement("blockquote", "cgqa-quote-preview", thread.quoteText || "");
    quote.hidden = Boolean(thread.help);
    const messages = createElement("div", "cgqa-messages");
    if (thread.help) {
      messages.append(createElement("div", "cgqa-empty", "当前会话还没有批注引用。"));
    } else if (!thread.messages || thread.messages.length === 0) {
      messages.append(createElement("div", "cgqa-empty", "还没有围绕这个引用的追问。"));
    } else {
      thread.messages.forEach((message) => messages.append(renderMessage(message)));
    }

    const footer = createElement("footer", "cgqa-panel-footer");
    const inputRow = createElement("div", "cgqa-input-row");
    const input = createElement("textarea", "cgqa-input");
    input.placeholder = "继续追问这个引用...";
    input.rows = 1;
    input.disabled = inputDisabled;
    const send = createElement("button", "cgqa-send-button", "↑");
    send.type = "button";
    send.title = "发送";
    send.disabled = true;
    const submitQuestion = () => {
      if (!canSubmitInput(input, inputDisabled)) {
        updateSendState(input, send, inputDisabled);
        return;
      }
      send.disabled = true;
      input.disabled = true;
      callbacks.onSend(input.value);
    };
    send.addEventListener("click", submitQuestion);
    input.addEventListener("input", () => {
      autoResizeInput(input);
      updateSendState(input, send, inputDisabled);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitQuestion();
      }
    });
    inputRow.append(input, send);

    const actions = createElement("div", "cgqa-panel-actions");
    const deleteThread = createElement("button", "cgqa-text-button", "删除引用");
    deleteThread.type = "button";
    deleteThread.addEventListener("click", () => callbacks.onDeleteThread());
    actions.append(deleteThread);
    footer.append(inputRow, actions);

    panel.append(header, quote, messages, footer);
    appendOverlayRoot(panel);
    autoResizeInput(input);
    updateSendState(input, send, inputDisabled);
    messages.scrollTop = messages.scrollHeight;
    return panel;
  }

  function canSubmitInput(input, inputDisabled) {
    return Boolean(input && !inputDisabled && !input.disabled && input.value.trim());
  }

  function updateSendState(input, send, inputDisabled) {
    if (!send) {
      return;
    }
    send.disabled = !canSubmitInput(input, inputDisabled);
  }

  function autoResizeInput(input) {
    if (!input) {
      return;
    }
    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }

  function bindPanelDrag(panel, handle) {
    handle.classList.add("cgqa-panel-drag-handle");
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const pointerId = event.pointerId;
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;

      panel.classList.add("is-dragging");
      handle.setPointerCapture(pointerId);

      const move = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const nextPosition = clampPanelPosition(panel, {
          x: moveEvent.clientX - offsetX,
          y: moveEvent.clientY - offsetY
        });
        panelPosition = nextPosition;
        applyPanelPosition(panel, nextPosition);
      };

      const stop = (stopEvent) => {
        if (stopEvent.pointerId !== pointerId) {
          return;
        }
        panel.classList.remove("is-dragging");
        savePanelPosition(panelPosition);
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      event.preventDefault();
    });
  }

  function isInteractiveDragTarget(target) {
    return Boolean(target && target.closest && target.closest("button, input, textarea, select, a, [contenteditable='true']"));
  }

  function syncPanelToViewport(panel) {
    const nextPosition = clampPanelPosition(panel, panelPosition || getDefaultPanelPosition(panel));
    panelPosition = nextPosition;
    applyPanelPosition(panel, nextPosition);
  }

  function getDefaultPanelPosition(panel) {
    const size = getPanelSize(panel);
    return {
      x: window.innerWidth - size.width - PANEL_DEFAULT_RIGHT,
      y: PANEL_DEFAULT_TOP
    };
  }

  function getPanelSize(panel) {
    const rect = panel.getBoundingClientRect();
    return {
      width: rect.width || Math.min(408, window.innerWidth - PANEL_MARGIN * 2),
      height: rect.height || Math.min(632, window.innerHeight - PANEL_MARGIN * 2)
    };
  }

  function clampPanelPosition(panel, position) {
    const size = getPanelSize(panel);
    const maxX = Math.max(PANEL_MARGIN, window.innerWidth - size.width - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, window.innerHeight - size.height - PANEL_MARGIN);
    return {
      x: clamp(Number(position && position.x), PANEL_MARGIN, maxX),
      y: clamp(Number(position && position.y), PANEL_MARGIN, maxY)
    };
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  function applyPanelPosition(panel, position) {
    panel.style.setProperty("left", `${Math.round(position.x)}px`, "important");
    panel.style.setProperty("top", `${Math.round(position.y)}px`, "important");
    panel.style.setProperty("right", "auto", "important");
  }

  function readPanelPosition() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || "null");
      if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return parsed;
      }
    } catch (_error) {
      // Ignore invalid saved positions.
    }
    return null;
  }

  function savePanelPosition(position) {
    if (!position) {
      return;
    }
    try {
      localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position));
    } catch (_error) {
      // Position persistence is a convenience; dragging should still work.
    }
  }

  function hasGeneratingMessage(thread) {
    return Boolean(thread && Array.isArray(thread.messages) && thread.messages.some((message) => {
      return message.role === "assistant" && message.status === "generating";
    }));
  }

  function renderMessage(message) {
    const item = createElement("article", `cgqa-message cgqa-message-${message.role}`);
    const content = createElement("div", "cgqa-message-content");
    const labelRow = createElement("div", "cgqa-message-label-row");
    const meta = createElement("div", "cgqa-message-meta", message.role === "user" ? "你" : "ChatGPT");
    const body = createElement("div", "cgqa-message-body");
    const createdAt = getValidDate(message.createdAt);
    const time = createElement("time", "cgqa-message-time", formatMessageTime(createdAt));
    if (createdAt) {
      time.dateTime = createdAt.toISOString();
    }
    if (message.status === "generating") {
      body.classList.add("is-generating");
    }
    if (message.status === "failed") {
      body.classList.add("is-failed");
    }
    renderMessageBody(body, message);
    labelRow.append(meta);
    body.append(time);
    content.append(labelRow, body);
    item.append(content);
    return item;
  }

  function renderMessageBody(body, message) {
    const html = getRenderableMessageHtml(message);
    if (html) {
      const htmlBody = createElement("div", "cgqa-message-html");
      htmlBody.innerHTML = html;
      body.classList.add("is-html");
      body.append(htmlBody);
      return;
    }

    body.append(document.createTextNode(message.content || ""));
  }

  function getRenderableMessageHtml(message) {
    if (
      !message
      || message.role !== "assistant"
      || message.status !== "completed"
      || message.contentFormat !== "html"
      || !message.html
      || !globalThis.CGQADom
      || typeof CGQADom.sanitizeMessageHtml !== "function"
    ) {
      return "";
    }
    return CGQADom.sanitizeMessageHtml(message.html);
  }

  function getValidDate(timestamp) {
    if (!timestamp) {
      return null;
    }
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatMessageTime(date) {
    if (!date) {
      return "";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function showSelectionMenu(rect, onAnnotate) {
    hideSelectionMenu();
    const button = createSelectionButton(onAnnotate);
    attachSelectionButtonToOfficialToolbar(button, rect);
  }

  function createSelectionButton(onAnnotate) {
    const button = createElement("button", ATTACHED_SELECTION_BUTTON_CLASS, "批注提问");
    button.type = "button";
    const submit = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.submitted === "true") {
        return;
      }
      button.dataset.submitted = "true";
      onAnnotate();
    };
    button.addEventListener("pointerdown", submit);
    button.addEventListener("click", submit);
    return button;
  }

  function attachSelectionButtonToOfficialToolbar(button, rect) {
    const startedAt = Date.now();
    const tryAttach = () => {
      const target = findOfficialSelectionButtonGroup();
      if (target) {
        if (button.parentElement !== target) {
          target.append(button);
        }
      }

      if (Date.now() - startedAt >= OFFICIAL_SELECTION_ATTACH_TIMEOUT_MS) {
        if (!button.isConnected && hasActiveTextSelection()) {
          showStandaloneSelectionMenu(rect, button);
        }
        return;
      }

      selectionAttachTimer = window.setTimeout(tryAttach, 50);
    };

    tryAttach();
  }

  function findOfficialSelectionButtonGroup() {
    const buttons = Array.from(document.querySelectorAll("button")).filter((button) => {
      if (
        button.closest(".cgqa-root, .cgqa-selection-menu")
        || button.classList.contains(ATTACHED_SELECTION_BUTTON_CLASS)
        || button.classList.contains("cgqa-quote-chip")
      ) {
        return false;
      }
      const text = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
      return /询问\s*ChatGPT|Ask\s*ChatGPT/i.test(text)
        || (isInsideOfficialSelectionToolbar(button) && /引用|Quote/i.test(text));
    });
    const officialButton = buttons.find(isVisibleElement);
    if (!officialButton || !officialButton.parentElement) {
      return null;
    }
    return officialButton.parentElement;
  }

  function isInsideOfficialSelectionToolbar(button) {
    return Boolean(
      button.closest(".fixed.select-none")
      || button.parentElement && /\bshadow-long\b/.test(button.parentElement.className || "")
    );
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasActiveTextSelection() {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  }

  function showStandaloneSelectionMenu(rect, button) {
    hideSelectionMenu();
    const menu = createElement("div", "cgqa-selection-menu");
    menu.append(button);
    appendOverlayRoot(menu);

    const top = Math.max(8, window.scrollY + rect.top - menu.offsetHeight - 10);
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - menu.offsetWidth - 12);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, left)}px`;
  }

  function hideSelectionMenu() {
    clearTimeout(selectionAttachTimer);
    selectionAttachTimer = 0;
    document.querySelectorAll(`.${ATTACHED_SELECTION_BUTTON_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(".cgqa-selection-menu").forEach((node) => node.remove());
  }

  function showThreadChoiceMenu(rect, threads, onChoose) {
    hideSelectionMenu();
    const menu = createElement("div", "cgqa-selection-menu cgqa-thread-choice-menu");
    threads.forEach((thread) => {
      const button = createElement("button", "", `引用 ${thread.displayIndex}: ${(thread.quoteText || "").slice(0, 28)}`);
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        hideSelectionMenu();
        onChoose(thread.threadId);
      });
      menu.append(button);
    });
    appendOverlayRoot(menu);

    const top = Math.min(window.scrollY + rect.bottom + 8, window.scrollY + window.innerHeight - menu.offsetHeight - 12);
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - menu.offsetWidth - 12);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, left)}px`;
  }

  function showToast(message) {
    let toast = document.querySelector(".cgqa-toast");
    if (!toast) {
      toast = createElement("div", "cgqa-toast");
      appendOverlayRoot(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  globalThis.CGQASidebar = {
    buildSidebar,
    showSelectionMenu,
    showThreadChoiceMenu,
    hideSelectionMenu,
    showToast
  };
})();
