(function () {
  "use strict";

  const CONTENT_VERSION = "0.7.13-streaming-panel";
  const RUNTIME_KEY = "CGQAContentRuntime";

  const existingRuntime = globalThis[RUNTIME_KEY];
  if (existingRuntime && existingRuntime.version === CONTENT_VERSION) {
    return;
  }
  if (existingRuntime && typeof existingRuntime.destroy === "function") {
    existingRuntime.destroy();
  }

  const state = {
    providerId: "",
    providerLabel: "",
    conversationId: "",
    threads: [],
    activeThreadId: "",
    pendingSelection: null,
    pendingResponse: null,
    pendingCaptureObserver: null,
    restoreTimers: [],
    locationCheckTimers: [],
    pendingCaptureTimer: 0,
    pendingCaptureMutationTimer: 0,
    pendingStableTimer: 0,
    pendingStreamSaveTimer: 0,
    pendingStreamSaveThreadId: "",
    active: false,
    creatingThread: false,
    loadingConversation: false,
    restoring: false,
    replyStyle: {
      mode: "default",
      customPrompt: ""
    },
    theme: "green",
    cleanupTasks: [],
    activeCleanupTasks: []
  };

  const RESPONSE_STABLE_DELAY_MS = 1400;
  const RESPONSE_TIMEOUT_MS = 120000;
  const STREAM_SAVE_DELAY_MS = 2000;
  const RESTORE_DELAYS_MS = [250, 1000, 2500, 5000];
  const LOCATION_CHECK_DELAYS_MS = [0, 250, 1000];
  const PROMPT_TOKEN_PREFIX = "CGQA_PROMPT";

  let sidebar = null;
  let provider = null;
  let pendingScrollLock = null;

  function uid(prefix) {
    if (crypto && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function init() {
    bindNavigationEvents();
    bindSettingsEvents();
    await reconcileLocation();
  }

  async function activateProvider(nextProvider) {
    provider = nextProvider;
    globalThis.CGQAProvider = provider;
    state.active = true;
    pendingScrollLock = CGQAScrollLock.create({
      getTarget: () => provider && provider.getScrollContainer ? provider.getScrollContainer() : null
    });
    syncProviderState();
    state.replyStyle = await loadReplyStyle();
    state.theme = await loadTheme();
    applyTheme(state.theme);
    sidebar = CGQASidebar.buildSidebar({
      onClose: closeSidebar,
      onBeforeSend: lockPendingScroll,
      onSend: sendQuestion,
      onRefreshAssistantMessage: refreshAssistantMessage,
      onDeleteThread: deleteActiveThread,
      getAssistantLabel: () => state.providerLabel,
      getReplyStyle: () => state.replyStyle,
      onReplyStyleChange: saveReplyStyle
    });

    await loadThreads();
    bindEvents();
    provider.clearRenderedMarks();
    scheduleRestoreBurst();
    syncPageDecorations();
  }

  function getPageProvider() {
    const providers = Array.isArray(globalThis.CGQAProviders) ? globalThis.CGQAProviders : [];
    return providers.find((item) => {
      return item && typeof item.matchesLocation === "function" && item.matchesLocation(location);
    }) || null;
  }

  function syncProviderState() {
    state.providerId = provider.id;
    state.providerLabel = provider.label;
    state.conversationId = provider.getConversationId();
  }

  async function loadReplyStyle() {
    try {
      return normalizeReplyStyle(await CGQAStorage.getReplyStyleSettings());
    } catch (error) {
      console.error("[CGQA] load reply style failed", error);
      return { mode: "default", customPrompt: "" };
    }
  }

  async function loadTheme() {
    try {
      return normalizeTheme(await CGQAStorage.getThemeSettings());
    } catch (error) {
      console.error("[CGQA] load theme failed", error);
      return "green";
    }
  }

  function applyTheme(theme) {
    state.theme = normalizeTheme(theme);
    if (globalThis.CGQATheme && typeof CGQATheme.applyTheme === "function") {
      CGQATheme.applyTheme(state.theme);
    } else {
      document.documentElement.dataset.cgqaTheme = state.theme;
    }
  }

  async function loadThreads() {
    syncProviderState();
    const storedThreads = await CGQAStorage.listThreads(getConversationRef());
    state.threads = storedThreads.map(normalizeThread).filter(Boolean);
  }

  function getConversationRef() {
    return {
      providerId: state.providerId,
      providerLabel: state.providerLabel,
      conversationId: state.conversationId
    };
  }

  function normalizeThread(thread) {
    if (!isCurrentThreadShape(thread)) {
      return null;
    }

    return {
      ...thread,
      sourceProviderId: thread.sourceProviderId || state.providerId,
      sourceProviderLabel: thread.sourceProviderLabel || state.providerLabel,
      quoteText: String(thread.quoteText || ""),
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      mainChatItems: getMainChatItems(thread)
    };
  }

  function isCurrentThreadShape(thread) {
    return Boolean(
      thread
      && thread.threadId
      && thread.quoteId
      && thread.quoteText !== undefined
      && thread.sourceConversationId
      && Number.isInteger(thread.displayIndex)
      && thread.anchor
      && thread.anchor.threadId === thread.threadId
      && thread.anchor.quoteId === thread.quoteId
      && Number.isInteger(thread.anchor.startOffset)
      && Number.isInteger(thread.anchor.endOffset)
      && typeof thread.anchor.exactText === "string"
    );
  }

  function bindEvents() {
    addActiveEvent(document, "mouseup", handleMouseUp, true);
    addActiveEvent(document, "keydown", handleKeydown, true);
    addActiveEvent(document, "click", handleQuoteMarkClick, true);
  }

  function bindSettingsEvents() {
    if (!chrome.storage || !chrome.storage.onChanged) {
      return;
    }

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== "local" || !changes["cgqa:settings:v1"]) {
        return;
      }
      if (state.active) {
        loadTheme().then(applyTheme).catch((error) => {
          console.error("[CGQA] apply changed theme failed", error);
        });
        loadReplyStyle().then((replyStyle) => {
          state.replyStyle = replyStyle;
          sidebar && sidebar.render(getThread(state.activeThreadId) || null);
        }).catch((error) => {
          console.error("[CGQA] apply changed reply style failed", error);
        });
      }
      reconcileLocation().catch((error) => {
        console.error("[CGQA] reconcile provider setting failed", error);
      });
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    state.cleanupTasks.push(() => chrome.storage.onChanged.removeListener(handleStorageChange));
  }

  function addRuntimeEvent(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.cleanupTasks.push(() => target.removeEventListener(type, handler, options));
  }

  function addActiveEvent(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.activeCleanupTasks.push(() => target.removeEventListener(type, handler, options));
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      CGQASidebar.hideSelectionMenu();
    }
  }

  function bindNavigationEvents() {
    const scheduleCheck = () => scheduleConversationCheckBurst();
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      scheduleCheck();
      return result;
    };
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleCheck();
      return result;
    };

    state.cleanupTasks.push(() => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    });
    addRuntimeEvent(window, "popstate", scheduleCheck);
    addRuntimeEvent(window, "pageshow", scheduleCheck);
    addRuntimeEvent(window, "focus", scheduleCheck);
    addRuntimeEvent(document, "click", scheduleCheck, true);
  }

  function scheduleConversationCheckBurst() {
    clearLocationCheckTimers();
    state.locationCheckTimers = LOCATION_CHECK_DELAYS_MS.map((delay) => {
      return setTimeout(() => {
        reconcileLocation().catch((error) => {
          console.error("[CGQA] reconcile location failed", error);
        });
      }, delay);
    });
  }

  async function reconcileLocation() {
    if (state.loadingConversation) {
      return;
    }

    const nextProvider = getPageProvider();
    const providerEnabled = nextProvider ? await isProviderEnabled(nextProvider.id) : false;
    if (!nextProvider || !providerEnabled) {
      if (state.active) {
        deactivateProvider();
      } else {
        delete globalThis.CGQAProvider;
      }
      return;
    }

    if (!state.active || !provider || provider.id !== nextProvider.id) {
      if (state.active) {
        deactivateProvider();
      }
      state.loadingConversation = true;
      try {
        await activateProvider(nextProvider);
      } finally {
        state.loadingConversation = false;
      }
      return;
    }

    const nextConversationId = provider.getConversationId();
    if (nextConversationId !== state.conversationId) {
      await switchConversation();
    }
  }

  async function isProviderEnabled(providerId) {
    if (!CGQAStorage || typeof CGQAStorage.isProviderEnabled !== "function") {
      return true;
    }
    try {
      return await CGQAStorage.isProviderEnabled(providerId);
    } catch (error) {
      console.error("[CGQA] load provider setting failed", error);
      return true;
    }
  }

  async function switchConversation() {
    state.loadingConversation = true;
    resetTransientState();
    closeSidebar();
    CGQASidebar.hideSelectionMenu();
    provider.clearRenderedMarks();
    syncMainChatVisibility([]);

    try {
      await loadThreads();
      scheduleRestoreBurst();
      syncPageDecorations();
    } finally {
      state.loadingConversation = false;
    }
  }

  function deactivateProvider() {
    resetTransientState();
    closeSidebar();
    CGQASidebar.hideSelectionMenu();
    if (provider && provider.clearRenderedMarks) {
      provider.clearRenderedMarks();
    }
    if (provider && provider.syncHiddenMainTurns) {
      provider.syncHiddenMainTurns([]);
    }
    if (provider && provider.setMainComposerHidden) {
      provider.setMainComposerHidden(false);
    }
    if (provider && provider.setNativeGenerationControlsHidden) {
      provider.setNativeGenerationControlsHidden(false);
    }
    if (provider && provider.syncPendingResponseState) {
      provider.syncPendingResponseState({ active: false, threadId: "", promptToken: "" });
    }
    state.activeCleanupTasks.splice(0).forEach((cleanup) => cleanup());
    if (sidebar && typeof sidebar.destroy === "function") {
      sidebar.destroy();
    } else if (sidebar) {
      sidebar.render(null);
    }
    sidebar = null;
    pendingScrollLock = null;
    provider = null;
    delete globalThis.CGQAProvider;
    state.active = false;
    state.providerId = "";
    state.providerLabel = "";
    state.conversationId = "";
    state.threads = [];
    state.activeThreadId = "";
  }

  function resetTransientState() {
    state.pendingSelection = null;
    state.pendingResponse = null;
    stopPendingCaptureWatcher();
    unlockPendingScroll();
    clearPendingStableTimer();
    clearPendingStreamSaveTimer();
  }

  function handleMouseUp(event) {
    if (isPluginUi(event.target)) {
      return;
    }
    if (!state.active || !provider) {
      return;
    }

    setTimeout(() => {
      if (!state.active || !provider) {
        return;
      }
      const selection = window.getSelection();
      const result = provider.validateSelection(selection);
      if (!result.ok) {
        CGQASidebar.hideSelectionMenu();
        if (selection && !selection.isCollapsed && result.reason) {
          CGQASidebar.showToast(result.reason);
        }
        return;
      }

      state.pendingSelection = result;
      CGQASidebar.showSelectionMenu(result.range.getBoundingClientRect(), createThreadFromSelection, {
        attachSelectionAction: provider.attachSelectionAction
      });
    }, 0);
  }

  function isPluginUi(target) {
    return Boolean(target && target.closest && target.closest([
      ".cgqa-root",
      ".cgqa-selection-menu",
      ".cgqa-selection-attached-button",
      ".cgqa-block-reference-bar",
      ".cgqa-block-reference-chip",
      ".cgqa-block-reference-more",
      ".cgqa-toast"
    ].join(",")));
  }

  function createThreadFromSelection() {
    if (state.creatingThread) {
      return;
    }

    state.creatingThread = true;
    CGQASidebar.hideSelectionMenu();

    try {
      const selection = state.pendingSelection;
      if (!selection || !selection.ok) {
        return;
      }

      if (selection.complex) {
        CGQASidebar.showToast("当前选区包含公式或代码结构，将使用保守标记。");
      }

      startDraftThread(selection);
    } catch (error) {
      console.error("[CGQA] create thread failed", error);
      CGQASidebar.showToast("创建批注失败，请刷新页面后重试。");
    } finally {
      state.creatingThread = false;
    }
  }

  function buildThread(selection) {
    const now = Date.now();
    const quoteId = uid("quote");
    const threadId = uid("thread");
    const sourceTurnId = provider.getTurnId(selection.turn);
    const sourceMessageId = selection.sourceMessageId || provider.getMessageId(selection.turn);
    const quoteText = selection.exactText || selection.selectedText;
    const conversationMeta = getConversationMeta();

    return {
      threadId,
      quoteId,
      quoteText,
      sourceProviderId: state.providerId,
      sourceProviderLabel: state.providerLabel,
      sourceConversationId: state.conversationId,
      sourceTurnId,
      sourceMessageId,
      displayIndex: getNextDisplayIndex(),
      anchor: {
        quoteId,
        sourceProviderId: state.providerId,
        sourceConversationId: state.conversationId,
        sourceTurnId,
        sourceMessageId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        markdownIndex: Number.isInteger(selection.markdownIndex) ? selection.markdownIndex : 0,
        exactText: quoteText,
        prefixText: selection.prefixText || "",
        suffixText: selection.suffixText || "",
        threadId
      },
      messages: [],
      mainChatItems: [],
      createdAt: now,
      updatedAt: now,
      sourceTitle: conversationMeta.title,
      sourceUrl: conversationMeta.url
    };
  }

  function getConversationMeta() {
    return provider.getConversationMeta();
  }

  function startDraftThread(selection) {
    discardEmptyActiveThread();
    const thread = buildThread(selection);
    registerThread(thread);
    renderDraftThreadMark(thread, selection);
    openThread(thread.threadId);
    clearCurrentSelection();
    state.pendingSelection = null;
  }

  function registerThread(thread) {
    state.threads.push(thread);
  }

  function getNextDisplayIndex() {
    return state.threads.reduce((max, thread) => {
      return Math.max(max, Number(thread.displayIndex) || 0);
    }, 0) + 1;
  }

  function renderThreadMark(thread, options = {}) {
    try {
      const rendered = provider.renderThreadMark(thread);
      if (!rendered && options.notify) {
        CGQASidebar.showToast("已创建批注，但当前 DOM 无法安全渲染正文标记。");
      }
    } catch (error) {
      console.error("[CGQA] render mark failed", error);
      if (options.notify) {
        CGQASidebar.showToast("已打开批注小窗，但正文标记渲染失败。");
      }
    }
  }

  function renderDraftThreadMark(thread, selection) {
    try {
      const rendered = provider.renderDraftThreadMark(thread, selection.markdown, selection.range);
      if (!rendered && selection.complex) {
        CGQASidebar.showToast("已打开提问小窗，复杂选区将在发送后尝试恢复标记。");
      }
    } catch (error) {
      console.error("[CGQA] render draft mark failed", error);
    }
  }

  function ensurePersistedThreadMark(thread, options = {}) {
    const promoted = provider.promoteThreadMark(thread);
    if (!promoted) {
      renderThreadMark(thread, options);
    }
    provider.updateMarkChip(thread);
  }

  function clearCurrentSelection() {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
  }

  function openThread(threadId) {
    const thread = getThread(threadId);
    if (!thread) {
      console.warn("[CGQA] openThread missing thread", threadId);
      return;
    }

    state.activeThreadId = threadId;
    lockPendingScroll({ resetPosition: true });
    provider.setActiveMark(threadId);
    sidebar.render(thread);
    sidebar.focusInput();
    syncPanelDecorations();
  }

  function handleQuoteMarkClick(event) {
    const path = event.composedPath ? event.composedPath() : [];
    const marks = path.filter((node) => node && node.classList && node.classList.contains("cgqa-quote-mark"));
    if (marks.length === 0) {
      return;
    }

    const threadIds = [...new Set(marks.map((mark) => mark.dataset.threadId).filter(Boolean))];
    if (threadIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (threadIds.length === 1) {
      openThread(threadIds[0]);
      return;
    }

    const threads = threadIds.map(getThread).filter(Boolean);
    CGQASidebar.showThreadChoiceMenu(marks[0].getBoundingClientRect(), threads, openThread);
  }

  function closeSidebar() {
    const activeThread = getThread(state.activeThreadId);
    const shouldSyncKnownMainChatAfterClose = Boolean(
      activeThread
      && hasThreadStarted(activeThread)
      && !state.loadingConversation
    );

    discardEmptyActiveThread();
    state.activeThreadId = "";
    provider.setActiveMark("");
    sidebar.render(null);
    syncPanelDecorations();
    if (shouldSyncKnownMainChatAfterClose) {
      syncKnownMainChatVisibility(getMainChatHideTargets());
    }
    unlockPanelScrollIfIdle();
  }

  function discardEmptyActiveThread() {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    const thread = getThread(threadId);
    if (thread && !hasThreadStarted(thread)) {
      removeThreadFromRuntime(threadId);
    }
  }

  function removeThreadFromRuntime(threadId) {
    provider.removeThreadMark(threadId);
    state.threads = state.threads.filter((thread) => thread.threadId !== threadId);
  }

  function restorePersistedMarks() {
    state.threads.filter(hasThreadStarted).forEach((thread) => ensurePersistedThreadMark(thread));
  }

  function getThread(threadId) {
    return state.threads.find((thread) => thread.threadId === threadId);
  }

  async function saveAndRenderThread(thread) {
    try {
      const savedThread = await CGQAStorage.saveThread(thread, getConversationMeta());
      replaceThread(savedThread);
      renderSavedThread(savedThread);
      return savedThread;
    } catch (error) {
      console.error("[CGQA] save thread failed", error);
      CGQASidebar.showToast(getSaveThreadErrorMessage(error));
      replaceThread(thread);
      renderSavedThread(thread);
      return thread;
    }
  }

  function getSaveThreadErrorMessage(error) {
    const message = String(error && (error.message || error.toString && error.toString()) || "");
    if (/extension context invalidated/i.test(message)) {
      return "扩展刚刚重新加载过，请刷新当前页面后再保存提问。";
    }
    return "本地保存失败，本次批注仍会保留在当前页面。";
  }

  function replaceThread(nextThread) {
    const index = state.threads.findIndex((thread) => thread.threadId === nextThread.threadId);
    if (index >= 0) {
      state.threads[index] = nextThread;
      return;
    }
    state.threads.push(nextThread);
  }

  function renderSavedThread(thread) {
    if (hasThreadStarted(thread)) {
      ensurePersistedThreadMark(thread, { notify: true });
    }
    if (thread.threadId === state.activeThreadId) {
      sidebar.render(thread);
    }
  }

  function buildPrompt(thread, question, promptToken) {
    const styleInstruction = getReplyStyleInstruction();
    const lines = [
      `围绕 提问 ${thread.displayIndex} 的批注提问`,
      "",
      "这是插件生成的临时批注追问，用于围绕当前引用片段继续提问。",
      "请优先根据本次 <quote> 和 <user_question> 回答；为理解引用来源、术语或上下文关系，可以参考主线正文和前文上下文。",
      "如果当前问题延续了同一批注线程，可以参考前面相关的批注追问和回答。",
      "这段批注任务说明只适用于当前带有 <tracking_token> 的插件追问，不应改变或延续到后续用户在主对话中的普通提问。",
      "请不要在回答中提及或输出追踪标记。",
    ];
    if (styleInstruction) {
      lines.push(styleInstruction);
    }
    return [
      ...lines,
      "",
      "<quote>",
      thread.quoteText,
      "</quote>",
      "",
      "<user_question>",
      question,
      "</user_question>",
      "",
      "<tracking_token>",
      promptToken,
      "</tracking_token>"
    ].join("\n");
  }

  function getReplyStyleInstruction() {
    const mode = state.replyStyle && state.replyStyle.mode || "default";
    if (mode === "longer") {
      return "回复风格要求：在保持准确和相关的前提下，回答得稍微完整、展开一些。";
    }
    if (mode === "shorter") {
      return "回复风格要求：请尽量简洁回答，只保留必要信息。";
    }
    if (mode === "custom") {
      const customPrompt = String(state.replyStyle && state.replyStyle.customPrompt || "").trim();
      return customPrompt ? `回复风格要求：${customPrompt}` : "";
    }
    return "";
  }

  async function saveReplyStyle(replyStyle) {
    state.replyStyle = normalizeReplyStyle(replyStyle);
    try {
      state.replyStyle = await CGQAStorage.saveReplyStyleSettings(state.replyStyle);
    } catch (error) {
      console.error("[CGQA] save reply style failed", error);
      CGQASidebar.showToast("回复风格保存失败，本页临时生效。");
    }
    return state.replyStyle;
  }

  function normalizeReplyStyle(replyStyle) {
    const allowedModes = new Set(["default", "longer", "shorter", "custom"]);
    const customPrompt = String(replyStyle && replyStyle.customPrompt || "").trim();
    const selectedMode = allowedModes.has(replyStyle && replyStyle.mode) ? replyStyle.mode : "default";
    const mode = selectedMode === "custom" && !customPrompt ? "default" : selectedMode;
    return {
      mode,
      customPrompt
    };
  }

  function normalizeTheme(theme) {
    if (globalThis.CGQATheme && typeof CGQATheme.normalizeTheme === "function") {
      return CGQATheme.normalizeTheme(theme);
    }
    return ["green", "pink", "blue", "gold", "slate"].includes(theme) ? theme : "green";
  }

  async function sendQuestion(rawQuestion) {
    const question = (rawQuestion || "").trim();
    const thread = getThread(state.activeThreadId);
    if (!thread || !question) {
      unlockPanelScrollIfIdle();
      return;
    }
    if (state.pendingResponse || hasGeneratingMessage(thread)) {
      CGQASidebar.showToast("上一条追问仍在生成中，请稍后再发。");
      renderSavedThread(thread);
      sidebar.focusInput();
      if (!state.pendingResponse) {
        unlockPanelScrollIfIdle();
      }
      return;
    }

    const mainChatItem = createMainChatItem();
    thread.mainChatItems = [...getMainChatItems(thread), mainChatItem];

    const userMessage = {
      role: "user",
      content: question,
      createdAt: Date.now(),
      status: "completed"
    };
    const assistantMessage = {
      role: "assistant",
      content: "生成中...",
      createdAt: Date.now(),
      status: "generating",
      contentFormat: "text"
    };
    thread.messages.push(userMessage, assistantMessage);
    state.pendingResponse = createResponseTracker(thread.threadId, mainChatItem.promptToken);
    lockPendingScroll();

    try {
      await saveAndRenderThread(thread);
      syncPageDecorations();
      startPendingCaptureWatcher();
      await provider.submitPrompt(buildPrompt(thread, question, mainChatItem.promptToken));
      syncPageDecorations();
    } catch (error) {
      state.pendingResponse = null;
      stopPendingCaptureWatcher();
      unlockPendingScroll();
      clearPendingStableTimer();
      clearPendingStreamSaveTimer();
      assistantMessage.content = error.message || "发送失败。";
      assistantMessage.status = "failed";
      await saveAndRenderThread(thread);
      syncPageDecorations();
      CGQASidebar.showToast(assistantMessage.content);
    }
  }

  function lockPendingScroll(options = {}) {
    if (pendingScrollLock) {
      pendingScrollLock.lock(options);
    }
  }

  function unlockPendingScroll() {
    if (pendingScrollLock) {
      pendingScrollLock.unlock();
    }
  }

  function unlockPanelScrollIfIdle() {
    if (!state.activeThreadId && !state.pendingResponse) {
      unlockPendingScroll();
    }
  }

  function hasGeneratingMessage(thread) {
    return (thread.messages || []).some((message) => message.role === "assistant" && message.status === "generating");
  }

  function hasThreadStarted(thread) {
    return Boolean(thread && Array.isArray(thread.messages) && thread.messages.some((message) => {
      return message.role === "user";
    }));
  }

  function createMainChatItem() {
    return {
      promptToken: `${PROMPT_TOKEN_PREFIX}:${uid("prompt")}`,
      createdAt: Date.now()
    };
  }

  function getMainChatItems(thread) {
    if (!Array.isArray(thread && thread.mainChatItems)) {
      return [];
    }
    return thread.mainChatItems.filter((item) => item && typeof item.promptToken === "string" && item.promptToken);
  }

  function getMainChatHideTargets() {
    const targets = [];
    state.threads.forEach((thread) => {
      const mainChatItems = getMainChatItems(thread);
      const hasPendingReply = hasGeneratingMessage(thread);
      mainChatItems.forEach((item, index) => {
        if (item && item.promptToken) {
          const isLatestActiveItem = thread.threadId === state.activeThreadId && index === mainChatItems.length - 1;
          targets.push({
            threadId: thread.threadId,
            promptToken: item.promptToken,
            unload: !isLatestActiveItem && (!hasPendingReply || index < mainChatItems.length - 1)
          });
        }
      });
    });
    return targets;
  }

  function syncMainChatVisibility(targets) {
    if (!provider.syncHiddenMainTurns) {
      return;
    }
    const hasExplicitTargets = Array.isArray(targets);
    const resolvedTargets = hasExplicitTargets ? targets : getMainChatHideTargets();
    if (!hasExplicitTargets && resolvedTargets.length === 0) {
      return;
    }
    provider.syncHiddenMainTurns(resolvedTargets);
  }

  function syncKnownMainChatVisibility(targets) {
    if (!provider.syncKnownHiddenMainTurns) {
      return;
    }
    provider.syncKnownHiddenMainTurns(Array.isArray(targets) ? targets : getMainChatHideTargets());
  }

  function syncMainComposerVisibility() {
    if (!provider.setMainComposerHidden) {
      return;
    }
    provider.setMainComposerHidden(Boolean(state.activeThreadId));
  }

  function syncNativeGenerationControlsVisibility() {
    if (!provider.setNativeGenerationControlsHidden) {
      return;
    }
    provider.setNativeGenerationControlsHidden(Boolean(state.activeThreadId));
  }

  function syncProviderPendingResponseState() {
    if (!provider.syncPendingResponseState) {
      return;
    }
    provider.syncPendingResponseState({
      active: Boolean(state.pendingResponse),
      threadId: state.pendingResponse && state.pendingResponse.threadId || "",
      promptToken: state.pendingResponse && state.pendingResponse.promptToken || ""
    });
  }

  function syncPageDecorations() {
    syncMainChatVisibility();
    syncPanelDecorations();
  }

  function syncPanelDecorations() {
    syncMainComposerVisibility();
    syncNativeGenerationControlsVisibility();
    syncProviderPendingResponseState();
  }

  function createResponseTracker(threadId, promptToken) {
    const baselineRecords = provider.getAssistantMessageRecords();
    const baselineTextBySignature = {};
    baselineRecords.forEach((record) => {
      baselineTextBySignature[getAssistantRecordSignature(record)] = record.text || "";
    });
    return {
      threadId,
      promptToken,
      baselineTextBySignature,
      candidate: null,
      startedAt: Date.now(),
    };
  }

  function capturePendingAssistantIfReady() {
    if (!state.pendingResponse) {
      return;
    }

    const thread = getThread(state.pendingResponse.threadId);
    if (!thread) {
      state.pendingResponse = null;
      stopPendingCaptureWatcher();
      unlockPendingScroll();
      clearPendingStableTimer();
      clearPendingStreamSaveTimer();
      return;
    }

    const generating = [...thread.messages].reverse().find((message) => {
      return message.role === "assistant" && message.status === "generating";
    });
    if (!generating) {
      state.pendingResponse = null;
      stopPendingCaptureWatcher();
      unlockPendingScroll();
      clearPendingStableTimer();
      clearPendingStreamSaveTimer();
      return;
    }

    if (Date.now() - state.pendingResponse.startedAt > RESPONSE_TIMEOUT_MS) {
      generating.content = generating.content === "生成中..." ? "回答等待超时，请在主聊天中查看结果。" : generating.content;
      generating.status = "failed";
      state.pendingResponse = null;
      stopPendingCaptureWatcher();
      unlockPendingScroll();
      clearPendingStableTimer();
      clearPendingStreamSaveTimer();
      saveAndRenderThread(thread).then(syncPageDecorations).catch((error) => {
        console.error("[CGQA] save timeout state failed", error);
      });
      return;
    }

    const candidate = findPendingAssistantCandidate(thread);
    if (!candidate || !candidate.text) {
      return;
    }

    updateStreamingAssistantMessage(thread, generating, candidate);
    scheduleStableCandidateCapture(thread, generating, candidate);
  }

  function updateStreamingAssistantMessage(thread, generating, candidate) {
    if (!thread || !generating || !candidate || !candidate.text) {
      return;
    }

    const text = candidate.text;
    const html = candidate.html || "";
    const contentFormat = html ? "html" : "text";
    if (
      text === thread.quoteText
      || (
        generating.content === text
        && (generating.html || "") === html
        && generating.contentFormat === contentFormat
      )
    ) {
      return;
    }

    generating.content = text;
    generating.html = html;
    generating.contentFormat = contentFormat;
    thread.updatedAt = Date.now();

    if (thread.threadId === state.activeThreadId && sidebar) {
      sidebar.render(thread);
    }
    queueStreamingSave(thread);
  }

  function scheduleStableCandidateCapture(thread, generating, candidate) {
    const signature = getAssistantRecordSignature(candidate);
    const pending = state.pendingResponse;
    if (!pending) {
      return;
    }

    const candidateHtml = candidate.html || "";
    const sameCandidate = pending.candidate
      && pending.candidate.signature === signature
      && pending.candidate.text === candidate.text
      && (pending.candidate.html || "") === candidateHtml;
    if (sameCandidate && state.pendingStableTimer) {
      return;
    }

    pending.candidate = { signature, text: candidate.text, html: candidateHtml };
    clearPendingStableTimer();
    state.pendingStableTimer = setTimeout(async () => {
      state.pendingStableTimer = 0;
      if (!state.pendingResponse || state.pendingResponse.threadId !== thread.threadId) {
        return;
      }

      const latest = findAssistantRecordBySignature(signature) || findPendingAssistantCandidate(thread);
      const text = latest ? latest.text : candidate.text;
      if (!text || text === thread.quoteText) {
        return;
      }
      if (isProviderResponseStillGenerating()) {
        return;
      }
      generating.content = text;
      generating.html = latest && latest.html || candidate.html || "";
      generating.contentFormat = generating.html ? "html" : "text";
      generating.status = "completed";
      const completedResponse = state.pendingResponse;
      stopPendingCaptureWatcher();
      clearPendingStreamSaveTimer();
      await saveAndRenderThread(thread);
      await completeProviderPendingResponse(completedResponse);
      state.pendingResponse = null;
      unlockPendingScroll();
      syncPanelDecorations();
    }, RESPONSE_STABLE_DELAY_MS);
  }

  function isProviderResponseStillGenerating() {
    if (!provider || typeof provider.isResponseGenerating !== "function") {
      return false;
    }
    try {
      return Boolean(provider.isResponseGenerating());
    } catch (error) {
      console.warn("[CGQA] provider generation state check failed", error);
      return false;
    }
  }

  function queueStreamingSave(thread) {
    if (!thread || !thread.threadId) {
      return;
    }
    state.pendingStreamSaveThreadId = thread.threadId;
    if (state.pendingStreamSaveTimer) {
      return;
    }

    state.pendingStreamSaveTimer = setTimeout(async () => {
      const threadId = state.pendingStreamSaveThreadId;
      state.pendingStreamSaveTimer = 0;
      state.pendingStreamSaveThreadId = "";
      const latestThread = getThread(threadId);
      if (!latestThread || !hasGeneratingMessage(latestThread)) {
        return;
      }

      try {
        const savedThread = await CGQAStorage.saveThread(latestThread, getConversationMeta());
        replaceThread(savedThread);
        if (savedThread.threadId === state.activeThreadId && sidebar) {
          sidebar.render(savedThread);
        }
      } catch (error) {
        console.error("[CGQA] save streaming response failed", error);
      }
    }, STREAM_SAVE_DELAY_MS);
  }

  async function completeProviderPendingResponse(responseTracker) {
    if (!provider.completePendingResponse || !responseTracker) {
      return;
    }
    try {
      await provider.completePendingResponse({
        threadId: responseTracker.threadId,
        promptToken: responseTracker.promptToken
      });
    } catch (error) {
      console.warn("[CGQA] provider pending response cleanup failed", error);
    }
  }

  function findPendingAssistantCandidate(thread) {
    const records = provider.getAssistantMessageRecords();
    const tracker = state.pendingResponse;
    if (!tracker) {
      return null;
    }

    const followupRecord = findAssistantRecordAfterPromptToken(thread, records, tracker.promptToken);
    if (followupRecord) {
      return followupRecord;
    }

    return findChangedAssistantRecord(thread, records, tracker.baselineTextBySignature);
  }

  function startPendingCaptureWatcher() {
    stopPendingCaptureWatcher();
    state.pendingCaptureTimer = setInterval(() => {
      capturePendingAssistantIfReady();
    }, 1000);

    if (document.body) {
      state.pendingCaptureObserver = new MutationObserver(handlePendingMutation);
      state.pendingCaptureObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  function stopPendingCaptureWatcher() {
    if (state.pendingCaptureTimer) {
      clearInterval(state.pendingCaptureTimer);
      state.pendingCaptureTimer = 0;
    }
    if (state.pendingCaptureObserver) {
      state.pendingCaptureObserver.disconnect();
      state.pendingCaptureObserver = null;
    }
    if (state.pendingCaptureMutationTimer) {
      clearTimeout(state.pendingCaptureMutationTimer);
      state.pendingCaptureMutationTimer = 0;
    }
  }

  function handlePendingMutation() {
    if (!state.pendingResponse || state.pendingCaptureMutationTimer) {
      return;
    }

    state.pendingCaptureMutationTimer = setTimeout(() => {
      state.pendingCaptureMutationTimer = 0;
      capturePendingAssistantIfReady();
      syncPageDecorations();
    }, 120);
  }

  function clearPendingStableTimer() {
    if (!state.pendingStableTimer) {
      return;
    }
    clearTimeout(state.pendingStableTimer);
    state.pendingStableTimer = 0;
  }

  function clearPendingStreamSaveTimer() {
    if (state.pendingStreamSaveTimer) {
      clearTimeout(state.pendingStreamSaveTimer);
      state.pendingStreamSaveTimer = 0;
    }
    state.pendingStreamSaveThreadId = "";
  }

  function findChangedAssistantRecord(thread, records, baselineTextBySignature) {
    return [...records].reverse().find((record) => {
      if (!record.text || !isUsableAssistantAnswer(record.text, thread)) {
        return false;
      }

      const signature = getAssistantRecordSignature(record);
      return record.text !== (baselineTextBySignature && baselineTextBySignature[signature] || "");
    }) || null;
  }

  function findAssistantRecordAfterPromptToken(thread, assistantRecords, promptToken) {
    if (!promptToken) {
      return null;
    }

    const records = provider.getAllTurnRecords();
    const promptIndex = findLastPromptUserRecordIndex(records, promptToken);
    if (promptIndex < 0) {
      return null;
    }

    for (let index = promptIndex + 1; index < records.length; index += 1) {
      const record = records[index];
      if (record.role === "user") {
        return null;
      }
      if (record.role !== "assistant" || !isUsableAssistantAnswer(record.text, thread)) {
        continue;
      }
      return findMatchingAssistantRecord(record, assistantRecords) || record;
    }

    return null;
  }

  async function refreshAssistantMessage(threadId, messageIndex) {
    const thread = getThread(threadId);
    const message = thread && thread.messages && thread.messages[messageIndex];
    if (!thread || !message || message.role !== "assistant" || message.status === "generating") {
      return;
    }

    const promptToken = getPromptTokenForAssistantMessage(thread, messageIndex);
    if (!promptToken) {
      CGQASidebar.showToast("找不到对应的主页面回复。");
      return;
    }

    const record = findAssistantRecordAfterPromptToken(thread, provider.getAssistantMessageRecords(), promptToken);
    if (!record || !record.text) {
      CGQASidebar.showToast("暂未获取到更新内容。");
      return;
    }

    const nextHtml = record.html || "";
    const unchanged = message.content === record.text && (message.html || "") === nextHtml;
    if (unchanged) {
      CGQASidebar.showToast("当前回复已是最新。");
      return;
    }

    message.content = record.text;
    message.html = nextHtml;
    message.contentFormat = nextHtml ? "html" : "text";
    message.status = "completed";
    thread.updatedAt = Date.now();
    await saveAndRenderThread(thread);
    syncPageDecorations();
    CGQASidebar.showToast("已重新获取回复。");
  }

  function getPromptTokenForAssistantMessage(thread, messageIndex) {
    const assistantIndex = getAssistantMessageOrdinal(thread, messageIndex);
    const mainChatItems = getMainChatItems(thread);
    return mainChatItems[assistantIndex] && mainChatItems[assistantIndex].promptToken || "";
  }

  function getAssistantMessageOrdinal(thread, messageIndex) {
    return (thread.messages || []).slice(0, messageIndex + 1).filter((message) => {
      return message.role === "assistant";
    }).length - 1;
  }

  function findLastPromptUserRecordIndex(records, promptToken) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (record.role === "user" && record.text && record.text.includes(promptToken)) {
        return index;
      }
    }
    return -1;
  }

  function findMatchingAssistantRecord(targetRecord, assistantRecords) {
    const targetSignature = getAssistantRecordSignature(targetRecord);
    return assistantRecords.find((record) => {
      return getAssistantRecordSignature(record) === targetSignature;
    }) || assistantRecords.find((record) => {
      return record.turn === targetRecord.turn || record.messageId && record.messageId === targetRecord.messageId;
    }) || null;
  }

  function findAssistantRecordBySignature(signature) {
    return provider.getAssistantMessageRecords().find((record) => {
      return getAssistantRecordSignature(record) === signature;
    });
  }

  function getAssistantRecordSignature(record) {
    if (record.messageId) {
      return `message:${record.messageId}`;
    }
    if (record.turnId) {
      return `turn:${record.turnId}`;
    }
    return `index:${record.index}`;
  }

  function isUsableAssistantAnswer(text, thread) {
    const normalized = (text || "").trim();
    if (
      !normalized
      || normalized === "生成中..."
      || normalized === thread.quoteText
      || isTransientAssistantStatusText(normalized)
    ) {
      return false;
    }
    return true;
  }

  function isTransientAssistantStatusText(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const compact = normalized.replace(/\s+/g, "").toLowerCase();
    if (normalized.length > 80) {
      return false;
    }

    return /^正在思考[.。…]*$/.test(compact)
      || /^思考中[.。…]*$/.test(compact)
      || /^已思考\d*(秒|s)?$/.test(compact)
      || /^chatgpt(说|says)?[:：]?$/.test(compact)
      || /^thoughtfor(acoupleof)?\d*(second|seconds|s)?$/.test(compact)
      || /^thinking[.。…]*$/.test(compact)
      || /^reasoning[.。…]*$/.test(compact);
  }

  async function deleteActiveThread() {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    removeThreadFromRuntime(threadId);
    if (state.pendingResponse && state.pendingResponse.threadId === threadId) {
      state.pendingResponse = null;
      stopPendingCaptureWatcher();
      unlockPendingScroll();
      clearPendingStableTimer();
    }
    await CGQAStorage.deleteThread(getConversationRef(), threadId);
    syncMainChatVisibility(getMainChatHideTargets());
    closeSidebar();
    scheduleRestoreBurst();
  }

  function scheduleRestoreBurst() {
    clearRestoreTimers();
    state.restoreTimers = RESTORE_DELAYS_MS.map((delay) => {
      return setTimeout(runRestorePass, delay);
    });
  }

  function runRestorePass() {
    if (!state.active || !provider || state.loadingConversation) {
      return;
    }

    state.restoring = true;
    restorePersistedMarks();
    if (state.activeThreadId) {
      provider.setActiveMark(state.activeThreadId);
    }
    syncPageDecorations();
    setTimeout(() => {
      state.restoring = false;
    }, 0);
  }

  function clearRestoreTimers() {
    state.restoreTimers.forEach((timer) => clearTimeout(timer));
    state.restoreTimers = [];
  }

  function clearLocationCheckTimers() {
    state.locationCheckTimers.forEach((timer) => clearTimeout(timer));
    state.locationCheckTimers = [];
  }

  function destroy() {
    clearLocationCheckTimers();
    clearRestoreTimers();
    if (state.active) {
      deactivateProvider();
    }
    state.cleanupTasks.splice(0).forEach((cleanup) => cleanup());
  }

  globalThis[RUNTIME_KEY] = {
    version: CONTENT_VERSION,
    destroy,
    openThread,
    getThread
  };
  globalThis.CGQAApp = globalThis[RUNTIME_KEY];
  globalThis.CGQAContentVersion = CONTENT_VERSION;

  init().catch((error) => {
    console.error("[CGQA] init failed", error);
  });
})();
