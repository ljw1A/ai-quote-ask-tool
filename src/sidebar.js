(function () {
  "use strict";

  const PANEL_POSITION_KEY = "cgqa:panel-position";
  const PANEL_MARGIN = 12;
  const PANEL_DEFAULT_RIGHT = 28;
  const PANEL_DEFAULT_TOP = 140;
  const INPUT_MAX_HEIGHT = 96;
  const MESSAGE_SCROLL_BOTTOM_THRESHOLD = 6;
  const ATTACHED_SELECTION_BUTTON_CLASS = "cgqa-selection-attached-button";

  let panelPosition = readPanelPosition();
  let selectionCleanup = null;

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

  function createSvgIcon(name, className = "cgqa-svg-icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    getIconPaths(name).forEach((pathData) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    });

    return svg;
  }

  function getIconPaths(name) {
    const icons = {
      arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
      arrowUp: ["M12 19V5", "M5 12l7-7 7 7"],
      chevronUp: ["M6 15l6-6 6 6"],
      refresh: ["M21 12a9 9 0 0 1-15.4 6.4L3 16", "M3 21v-5h5", "M3 12A9 9 0 0 1 18.4 5.6L21 8", "M21 3v5h-5"],
      sparkles: [
        "M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15l-1.6-4.2L6 9.2l4.4-1.6L12 3z",
        "M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"
      ],
      square: ["M6 6h12v12H6z"],
      message: [
        "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
        "M8 9h8",
        "M8 13h5"
      ]
    };
    return icons[name] || [];
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
      "border: 1px solid rgba(218,226,223,0.96) !important",
      "border-radius: 24px !important",
      "box-shadow: 0 26px 70px rgba(15,23,42,0.13), 0 12px 30px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05) !important",
      "font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important"
    ].join(";");
  }

  function buildSidebar(callbacks) {
    let root = null;
    let input = null;
    let renderedThreadId = "";
    let pendingMessageScrollMode = "";
    const messageScrollByThreadId = {};

    function render(thread, options = {}) {
      if (!thread) {
        removePanel();
        root = null;
        input = null;
        renderedThreadId = "";
        pendingMessageScrollMode = "";
        return;
      }

      const sameThread = Boolean(thread.threadId && thread.threadId === renderedThreadId);
      const previousMessageScroll = sameThread
        ? captureMessageScroll(root) || messageScrollByThreadId[thread.threadId] || null
        : messageScrollByThreadId[thread.threadId] || null;
      const requestedScrollMode = normalizeMessageScrollMode(options.messageScrollMode);
      const messageScrollMode = pendingMessageScrollMode === "bottom" || requestedScrollMode === "bottom" || !sameThread
        ? "bottom"
        : "preserve";
      pendingMessageScrollMode = "";

      root = createPanel(callbacks, thread, {
        messageScrollMode,
        previousMessageScroll,
        onMessageScroll: (scrollState) => rememberMessageScroll(thread.threadId, scrollState),
        onRequestMessageScrollToBottom: requestMessageScrollToBottom
      });
      input = root.querySelector(".cgqa-input");
      renderedThreadId = thread.threadId || "";
      syncPanelToViewport(root);
    }

    function requestMessageScrollToBottom() {
      pendingMessageScrollMode = "bottom";
      const messages = getMessageScrollElement(root);
      if (messages && !isMessageScrollAtBottom(messages)) {
        scrollMessagesToBottom(messages);
        rememberMessageScroll(renderedThreadId, captureMessagesScroll(messages));
      }
    }

    function rememberMessageScroll(threadId, scrollState) {
      if (!threadId || !scrollState) {
        return;
      }
      messageScrollByThreadId[threadId] = scrollState;
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
      renderedThreadId = "";
      pendingMessageScrollMode = "";
    }

    window.addEventListener("resize", handleResize);

    return { render, focusInput, isOpen, destroy };
  }

  function createPanel(callbacks, thread, options = {}) {
    removePanel();

    const panel = createElement("aside", "cgqa-root is-open");
    panel.id = "cgqa-root";
    panel.setAttribute("aria-live", "polite");
    applyPanelStyle(panel);
    const inputDisabled = hasGeneratingMessage(thread);
    panel.dataset.cgqaInputDisabled = inputDisabled ? "true" : "false";

    const header = createElement("header", "cgqa-panel-header");
    const titleWrap = createElement("div", "cgqa-panel-title-wrap");
    const title = createElement("h2", "cgqa-panel-title", `提问 ${thread.displayIndex}`);
    const subtitle = createElement("div", "cgqa-panel-subtitle", "围绕该内容继续追问");
    const close = createElement("button", "cgqa-icon-button", "×");
    close.type = "button";
    close.title = "关闭";
    close.addEventListener("click", () => callbacks.onClose());
    titleWrap.append(title, subtitle);
    header.append(titleWrap, close);
    bindPanelDrag(panel, header);

    const quote = createElement("blockquote", "cgqa-quote-preview", thread.quoteText || "");
    const messagesShell = createElement("div", "cgqa-messages-shell");
    const messages = createElement("div", "cgqa-messages");
    const assistantLabel = getAssistantLabel(callbacks, thread);
    const generating = hasGeneratingMessage(thread);
    if (!thread.messages || thread.messages.length === 0) {
      messages.append(createElement("div", "cgqa-empty", "还没有围绕这段内容的提问。"));
    } else {
      thread.messages.forEach((message, index) => {
        messages.append(renderMessage(message, assistantLabel, callbacks, thread, index));
      });
    }

    const footer = createElement("footer", "cgqa-panel-footer");
    const inputRow = createElement("div", "cgqa-input-row");
    const input = createElement("textarea", "cgqa-input");
    input.placeholder = "继续追问...";
    input.rows = 1;
    input.disabled = inputDisabled;
    const send = createElement("button", "cgqa-send-button");
    send.type = "button";
    renderSendButtonState(send, inputDisabled);
    send.disabled = true;
    const submitQuestion = () => {
      if (inputDisabled) {
        if (typeof callbacks.onStopGeneration === "function") {
          callbacks.onStopGeneration();
        }
        return;
      }
      if (!canSubmitInput(input, inputDisabled)) {
        updateSendState(input, send, inputDisabled);
        return;
      }
      if (typeof options.onRequestMessageScrollToBottom === "function") {
        options.onRequestMessageScrollToBottom();
      }
      if (callbacks.onBeforeSend) {
        callbacks.onBeforeSend();
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
    const deleteThread = createElement("button", "cgqa-text-button", "删除提问");
    deleteThread.type = "button";
    deleteThread.addEventListener("click", () => callbacks.onDeleteThread());
    const replyStyle = createReplyStyleControls(callbacks);
    actions.append(deleteThread, replyStyle.control, replyStyle.editor);
    footer.append(inputRow, actions);

    const scrollStatus = createMessageScrollStatusButton(generating, () => {
      scrollMessagesToBottom(messages);
      reportMessageScroll(messages, options);
      updateMessageScrollStatus(messages, scrollStatus, generating);
    });
    messagesShell.append(messages, scrollStatus);
    panel.append(header, quote, messagesShell, footer);
    bindMessageScroll(messages, options, scrollStatus, generating);
    appendOverlayRoot(panel);
    autoResizeInput(input);
    updateSendState(input, send, inputDisabled);
    applyMessageScroll(messages, options);
    updateMessageScrollStatus(messages, scrollStatus, generating);
    return panel;
  }

  function getMessageScrollElement(root) {
    return root && root.querySelector(".cgqa-messages");
  }

  function captureMessageScroll(root) {
    const messages = getMessageScrollElement(root);
    return captureMessagesScroll(messages);
  }

  function captureMessagesScroll(messages) {
    if (!messages) {
      return null;
    }
    return {
      top: messages.scrollTop
    };
  }

  function normalizeMessageScrollMode(mode) {
    return mode === "bottom" || mode === "preserve" ? mode : "";
  }

  function applyMessageScroll(messages, options = {}) {
    if (!messages) {
      return;
    }
    if (options.messageScrollMode === "preserve" && options.previousMessageScroll) {
      restoreMessageScroll(messages, options.previousMessageScroll);
      reportMessageScroll(messages, options);
      return;
    }
    scrollMessagesToBottom(messages);
    reportMessageScroll(messages, options);
  }

  function restoreMessageScroll(messages, scrollState) {
    const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
    const top = Number(scrollState && scrollState.top);
    messages.scrollTop = Number.isFinite(top) ? Math.min(Math.max(0, top), maxTop) : 0;
  }

  function scrollMessagesToBottom(messages) {
    messages.scrollTop = messages.scrollHeight;
  }

  function isMessageScrollAtBottom(messages) {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= MESSAGE_SCROLL_BOTTOM_THRESHOLD;
  }

  function bindMessageScroll(messages, options = {}, scrollStatus, generating) {
    messages.addEventListener("scroll", () => {
      reportMessageScroll(messages, options);
      updateMessageScrollStatus(messages, scrollStatus, generating);
    }, { passive: true });
    messages.addEventListener("wheel", (event) => {
      const deltaY = getWheelDeltaY(event, messages);
      if (!deltaY) {
        return;
      }
      const previousTop = messages.scrollTop;
      const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      const nextTop = Math.min(Math.max(0, previousTop + deltaY), maxTop);
      if (nextTop === previousTop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      messages.scrollTop = nextTop;
      reportMessageScroll(messages, options);
      updateMessageScrollStatus(messages, scrollStatus, generating);
    }, { passive: false });
  }

  function getWheelDeltaY(event, messages) {
    if (!event) {
      return 0;
    }
    if (event.deltaMode === 2) {
      return event.deltaY * messages.clientHeight;
    }
    if (event.deltaMode === 1) {
      return event.deltaY * 18;
    }
    return event.deltaY;
  }

  function reportMessageScroll(messages, options = {}) {
    if (typeof options.onMessageScroll === "function") {
      options.onMessageScroll(captureMessagesScroll(messages));
    }
  }

  function createMessageScrollStatusButton(generating, onClick) {
    const button = createElement("button", "cgqa-message-scroll-status");
    button.type = "button";
    button.addEventListener("click", onClick);
    renderMessageScrollStatusButton(button, generating);
    return button;
  }

  function updateMessageScrollStatus(messages, button, generating) {
    if (!button || !messages) {
      return;
    }
    button.hidden = !hasHiddenMessageContentBelow(messages);
    renderMessageScrollStatusButton(button, generating);
  }

  function hasHiddenMessageContentBelow(messages) {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight > MESSAGE_SCROLL_BOTTOM_THRESHOLD;
  }

  function renderMessageScrollStatusButton(button, generating) {
    const state = generating ? "generating" : "ready";
    if (button.dataset.state !== state || !button.firstChild) {
      button.replaceChildren(generating ? createStatusDots() : createSvgIcon("arrowDown", "cgqa-svg-icon cgqa-message-scroll-icon"));
      button.dataset.state = state;
    }
    const label = generating ? "正在生成，点击滚动到底部" : "滚动到底部";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function createStatusDots() {
    const dots = createElement("span", "cgqa-scroll-status-dots");
    for (let index = 0; index < 3; index += 1) {
      dots.append(createElement("span", "cgqa-scroll-status-dot"));
    }
    return dots;
  }

  function canSubmitInput(input, inputDisabled) {
    return Boolean(input && !inputDisabled && !input.disabled && input.value.trim());
  }

  function createReplyStyleControls(callbacks) {
    const current = normalizeReplyStyle(callbacks.getReplyStyle && callbacks.getReplyStyle());
    const wrap = createElement("div", "cgqa-reply-style");
    const editor = createReplyStyleInlineEditor(callbacks, wrap);
    const toggle = createElement("button", "cgqa-reply-style-toggle");
    toggle.type = "button";
    toggle.title = "回复风格";
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    const toggleLabel = createElement("span", "cgqa-reply-style-label");
    toggle.append(toggleLabel, createSvgIcon("chevronUp", "cgqa-svg-icon cgqa-reply-style-icon"));

    const menu = createElement("div", "cgqa-reply-style-menu");
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    getReplyStyleOptions().forEach((option) => {
      const item = createElement("button", "cgqa-reply-style-option");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.dataset.mode = option.mode;
      item.setAttribute("aria-checked", option.mode === current.mode ? "true" : "false");
      item.textContent = option.label;
      item.addEventListener("click", () => {
        const latest = normalizeReplyStyle(callbacks.getReplyStyle && callbacks.getReplyStyle());
        setReplyStyleMenuOpen(wrap, false);
        if (option.mode === "custom") {
          startReplyStyleEditing(editor, latest.customPrompt);
          return;
        }
        applyReplyStyleSelection(callbacks, wrap, {
          mode: option.mode,
          customPrompt: latest.customPrompt
        });
      });
      menu.append(item);
    });

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      setReplyStyleMenuOpen(wrap, !expanded);
    });
    wrap.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setReplyStyleMenuOpen(wrap, false);
        toggle.focus();
      }
    });
    wrap.append(toggle, menu);
    updateReplyStyleControl(wrap, current);
    return { control: wrap, editor };
  }

  function createReplyStyleInlineEditor(callbacks, wrap) {
    const editor = createElement("div", "cgqa-reply-style-editor");
    editor.hidden = true;
    const input = createElement("input", "cgqa-reply-style-editor-input");
    input.type = "text";
    input.placeholder = "输入你希望遵循的回复风格...";
    const save = createElement("button", "cgqa-reply-style-editor-save", "↵");
    save.type = "button";
    save.title = "保存回复风格";

    const finish = (saveValue) => finishReplyStyleEditing(callbacks, wrap, editor, saveValue);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    save.addEventListener("mousedown", (event) => event.preventDefault());
    save.addEventListener("click", () => finish(true));
    editor.append(input, save);
    return editor;
  }

  function startReplyStyleEditing(editor, initialValue) {
    const actions = editor.closest(".cgqa-panel-actions");
    const input = editor.querySelector(".cgqa-reply-style-editor-input");
    if (!actions || !input) {
      return;
    }
    actions.classList.add("is-reply-style-editing");
    editor.hidden = false;
    editor.dataset.editing = "true";
    input.value = initialValue || "";
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function finishReplyStyleEditing(callbacks, wrap, editor, saveValue) {
    if (editor.dataset.editing !== "true") {
      return;
    }

    editor.dataset.editing = "false";
    const actions = editor.closest(".cgqa-panel-actions");
    const input = editor.querySelector(".cgqa-reply-style-editor-input");
    const value = input ? input.value.trim() : "";
    if (actions) {
      actions.classList.remove("is-reply-style-editing");
    }
    editor.hidden = true;

    if (!saveValue) {
      updateReplyStyleControl(wrap, callbacks.getReplyStyle && callbacks.getReplyStyle());
      return;
    }

    applyReplyStyleSelection(callbacks, wrap, value ? {
      mode: "custom",
      customPrompt: value
    } : {
      mode: "default",
      customPrompt: ""
    });
  }

  function getReplyStyleOptions() {
    return [
      { mode: "default", label: "默认" },
      { mode: "longer", label: "长一点" },
      { mode: "shorter", label: "短一点" },
      { mode: "custom", label: "自定义" }
    ];
  }

  function normalizeReplyStyle(replyStyle) {
    const modes = new Set(getReplyStyleOptions().map((option) => option.mode));
    const customPrompt = String(replyStyle && replyStyle.customPrompt || "").trim();
    const selectedMode = modes.has(replyStyle && replyStyle.mode) ? replyStyle.mode : "default";
    const mode = selectedMode === "custom" && !customPrompt ? "default" : selectedMode;
    return {
      mode,
      customPrompt
    };
  }

  function getReplyStyleLabel(mode) {
    const option = getReplyStyleOptions().find((item) => item.mode === mode);
    return option ? option.label : "默认";
  }

  function setReplyStyleMenuOpen(wrap, open) {
    const toggle = wrap.querySelector(".cgqa-reply-style-toggle");
    const menu = wrap.querySelector(".cgqa-reply-style-menu");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    menu.hidden = !open;
  }

  function updateReplyStyleControl(wrap, replyStyle) {
    const style = normalizeReplyStyle(replyStyle);
    const label = wrap.querySelector(".cgqa-reply-style-label");
    const displayLabel = getReplyStyleDisplayLabel(style);
    label.textContent = displayLabel;
    label.title = displayLabel;
    wrap.querySelector(".cgqa-reply-style-toggle").title = displayLabel;
    wrap.querySelectorAll(".cgqa-reply-style-option").forEach((option) => {
      option.setAttribute("aria-checked", option.dataset.mode === style.mode ? "true" : "false");
    });
    wrap.classList.toggle("is-custom", style.mode === "custom");
  }

  function getReplyStyleDisplayLabel(style) {
    if (style.mode === "custom" && style.customPrompt) {
      return `自定义：${style.customPrompt}`;
    }
    return getReplyStyleLabel(style.mode);
  }

  function applyReplyStyleSelection(callbacks, wrap, replyStyle) {
    const next = normalizeReplyStyle(replyStyle);
    updateReplyStyleControl(wrap, next);
    Promise.resolve(callbacks.onReplyStyleChange && callbacks.onReplyStyleChange(next))
      .then((saved) => {
        if (saved) {
          updateReplyStyleControl(wrap, saved);
        }
      })
      .catch((error) => console.error("[CGQA] reply style update failed", error));
  }

  function updateSendState(input, send, inputDisabled) {
    if (!send) {
      return;
    }
    renderSendButtonState(send, inputDisabled);
    send.disabled = inputDisabled ? false : !canSubmitInput(input, inputDisabled);
  }

  function renderSendButtonState(send, generating) {
    const state = generating ? "generating" : "ready";
    if (send.dataset.state !== state || !send.firstChild) {
      send.replaceChildren(createSvgIcon(generating ? "square" : "arrowUp", "cgqa-svg-icon cgqa-send-icon"));
      send.dataset.state = state;
    }
    send.classList.toggle("is-generating", generating);
    send.title = generating ? "正在生成" : "发送";
    send.setAttribute("aria-label", send.title);
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

  function getAssistantLabel(callbacks, thread) {
    const value = callbacks.getAssistantLabel && callbacks.getAssistantLabel();
    return String(value || thread && thread.sourceProviderLabel || "AI").trim() || "AI";
  }

  function renderMessage(message, assistantLabel, callbacks, thread, messageIndex) {
    const item = createElement("article", `cgqa-message cgqa-message-${message.role}`);
    const content = createElement("div", "cgqa-message-content");
    const labelRow = createElement("div", "cgqa-message-label-row");
    const meta = createElement("div", "cgqa-message-meta", message.role === "user" ? "你" : assistantLabel);
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
    if (shouldShowAssistantActions(message, callbacks)) {
      content.append(renderAssistantActions(callbacks, thread, messageIndex, message));
    }
    item.append(content);
    return item;
  }

  function shouldShowAssistantActions(message, callbacks) {
    return shouldShowRefreshButton(message, callbacks) || shouldShowRegenerateButton(message, callbacks);
  }

  function shouldShowRefreshButton(message, callbacks) {
    return Boolean(
      message
      && message.role === "assistant"
      && message.status !== "generating"
      && typeof callbacks.onRefreshAssistantMessage === "function"
    );
  }

  function shouldShowRegenerateButton(message, callbacks) {
    return Boolean(
      message
      && message.role === "assistant"
      && message.status !== "generating"
      && typeof callbacks.onRegenerateAssistantMessage === "function"
    );
  }

  function renderAssistantActions(callbacks, thread, messageIndex, message) {
    const actions = createElement("div", "cgqa-message-actions");
    if (shouldShowRefreshButton(message, callbacks)) {
      actions.append(renderAssistantActionButton({
        className: "cgqa-message-action-button cgqa-message-refresh",
        iconName: "refresh",
        label: "重新获取回复",
        onClick: () => callbacks.onRefreshAssistantMessage(thread.threadId, messageIndex)
      }));
    }
    if (shouldShowRegenerateButton(message, callbacks)) {
      actions.append(renderAssistantActionButton({
        className: "cgqa-message-action-button cgqa-message-regenerate",
        iconName: "sparkles",
        label: "重新生成",
        onClick: () => callbacks.onRegenerateAssistantMessage(thread.threadId, messageIndex)
      }));
    }
    return actions;
  }

  function renderAssistantActionButton(options) {
    const button = createElement("button", options.className);
    button.type = "button";
    button.title = options.label;
    button.setAttribute("aria-label", options.label);
    button.append(createSvgIcon(options.iconName, "cgqa-svg-icon cgqa-message-action-icon"));
    button.addEventListener("click", () => {
      button.disabled = true;
      button.classList.add("is-loading");
      Promise.resolve(options.onClick()).finally(() => {
        button.disabled = false;
        button.classList.remove("is-loading");
      });
    });
    return button;
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
      || message.contentFormat !== "html"
      || !message.html
      || !globalThis.CGQASanitize
      || typeof CGQASanitize.sanitizeMessageHtml !== "function"
    ) {
      return "";
    }
    return CGQASanitize.sanitizeMessageHtml(message.html);
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

  function showSelectionMenu(rect, onAnnotate, options = {}) {
    hideSelectionMenu();
    const button = createSelectionButton(onAnnotate);
    const context = {
      rect,
      onFallback: () => showFloatingSelectionButton(rect, button),
      showToast
    };

    if (typeof options.attachSelectionAction === "function") {
      const cleanup = options.attachSelectionAction(button, context);
      selectionCleanup = typeof cleanup === "function" ? cleanup : null;
      return;
    }

    showFloatingSelectionButton(rect, button);
  }

  function createSelectionButton(onAnnotate) {
    const button = createElement("button", ATTACHED_SELECTION_BUTTON_CLASS);
    button.type = "button";
    const label = createElement("span", "cgqa-selection-label", "提问");
    button.append(createSvgIcon("message", "cgqa-svg-icon cgqa-selection-icon"), label);
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

  function showFloatingSelectionButton(rect, button) {
    const menu = createElement("div", "cgqa-selection-menu cgqa-floating-selection-menu");
    button.classList.add("cgqa-selection-floating-button");
    menu.append(button);
    appendOverlayRoot(menu);

    const position = getFloatingSelectionMenuPosition(rect, menu);
    menu.style.top = `${position.top}px`;
    menu.style.left = `${position.left}px`;
    return menu;
  }

  function getFloatingSelectionMenuPosition(rect, menu) {
    const viewportMargin = 8;
    const sourceRect = rect && Number.isFinite(rect.left) ? rect : {
      left: window.innerWidth / 2,
      right: window.innerWidth / 2,
      top: window.innerHeight / 2,
      bottom: window.innerHeight / 2
    };
    const top = window.scrollY + sourceRect.top - menu.offsetHeight - 8;
    const fallbackTop = window.scrollY + sourceRect.bottom + 8;
    const maxTop = window.scrollY + window.innerHeight - menu.offsetHeight - viewportMargin;
    const maxLeft = window.scrollX + window.innerWidth - menu.offsetWidth - viewportMargin;
    return {
      top: Math.max(viewportMargin, Math.min(top > window.scrollY ? top : fallbackTop, maxTop)),
      left: Math.max(viewportMargin, Math.min(window.scrollX + sourceRect.left, maxLeft))
    };
  }

  function hideSelectionMenu() {
    if (selectionCleanup) {
      selectionCleanup();
      selectionCleanup = null;
    }
    document.querySelectorAll(`.${ATTACHED_SELECTION_BUTTON_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(".cgqa-selection-menu").forEach((node) => node.remove());
  }

  function showThreadChoiceMenu(rect, threads, onChoose) {
    hideSelectionMenu();
    const menu = createElement("div", "cgqa-selection-menu cgqa-thread-choice-menu");
    threads.forEach((thread) => {
      const button = createElement("button", "", `提问 ${thread.displayIndex}: ${(thread.quoteText || "").slice(0, 28)}`);
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
