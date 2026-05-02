(function () {
  "use strict";

  const CONTENT_VERSION = "0.5.2-mark-after-first-question";
  const RUNTIME_KEY = "CGQAContentRuntime";

  const existingRuntime = globalThis[RUNTIME_KEY];
  if (existingRuntime && existingRuntime.version === CONTENT_VERSION) {
    return;
  }
  if (existingRuntime && typeof existingRuntime.destroy === "function") {
    existingRuntime.destroy();
  }

  const state = {
    conversationId: "",
    threads: [],
    activeThreadId: "",
    pendingSelection: null,
    pendingResponse: null,
    observer: null,
    restoreTimer: 0,
    pendingCaptureTimer: 0,
    pendingStableTimer: 0,
    creatingThread: false,
    loadingConversation: false,
    restoring: false,
    cleanupTasks: []
  };

  const RESPONSE_STABLE_DELAY_MS = 1400;
  const RESPONSE_TIMEOUT_MS = 120000;
  const PROMPT_TOKEN_PREFIX = "CGQA_PROMPT";

  let sidebar = null;

  function uid(prefix) {
    if (crypto && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function init() {
    state.conversationId = CGQADom.getConversationId();
    sidebar = CGQASidebar.buildSidebar({
      onClose: closeSidebar,
      onSend: sendQuestion,
      onDeleteThread: deleteActiveThread
    });

    await loadThreads();
    bindEvents();
    scheduleRestore();
    syncPageDecorations();
  }

  async function loadThreads() {
    state.conversationId = CGQADom.getConversationId();
    const storedThreads = await CGQAStorage.listThreads(state.conversationId);
    state.threads = storedThreads.map(normalizeThread).filter(Boolean);
  }

  function normalizeThread(thread) {
    if (!isCurrentThreadShape(thread)) {
      return null;
    }

    return {
      ...thread,
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
    addEvent(document, "mouseup", handleMouseUp, true);
    addEvent(document, "keydown", handleKeydown, true);
    addEvent(document, "click", handleQuoteMarkClick, true);

    if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
      state.cleanupTasks.push(() => chrome.runtime.onMessage.removeListener(handleRuntimeMessage));
    }

    state.observer = new MutationObserver(handlePageMutation);
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function addEvent(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.cleanupTasks.push(() => target.removeEventListener(type, handler, options));
  }

  function handleRuntimeMessage(message) {
    if (message && message.type === "CGQA_TOGGLE_PANEL") {
      togglePanel();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      CGQASidebar.hideSelectionMenu();
    }
  }

  function handlePageMutation() {
    if (state.restoring || state.loadingConversation) {
      return;
    }

    const nextConversationId = CGQADom.getConversationId();
    if (nextConversationId !== state.conversationId) {
      switchConversation().catch((error) => {
        console.error("[CGQA] switch conversation failed", error);
      });
      return;
    }

    scheduleRestore();
    capturePendingAssistantIfReady();
    syncPageDecorations();
  }

  async function switchConversation() {
    state.loadingConversation = true;
    resetTransientState();
    closeSidebar();
    CGQASidebar.hideSelectionMenu();
    CGQADom.clearRenderedMarks();
    syncMainChatVisibility([]);

    try {
      await loadThreads();
      scheduleRestore();
      syncPageDecorations();
    } finally {
      state.loadingConversation = false;
    }
  }

  function resetTransientState() {
    state.pendingSelection = null;
    state.pendingResponse = null;
    stopPendingCapturePoll();
    clearPendingStableTimer();
  }

  function handleMouseUp(event) {
    if (isPluginUi(event.target)) {
      return;
    }

    setTimeout(() => {
      const selection = window.getSelection();
      const result = CGQADom.validateSelection(selection);
      if (!result.ok) {
        CGQASidebar.hideSelectionMenu();
        if (selection && !selection.isCollapsed && result.reason) {
          CGQASidebar.showToast(result.reason);
        }
        return;
      }

      state.pendingSelection = result;
      CGQASidebar.showSelectionMenu(result.range.getBoundingClientRect(), createThreadFromSelection);
    }, 0);
  }

  function isPluginUi(target) {
    return Boolean(target && target.closest && target.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-selection-attached-button, .cgqa-toast"));
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

      discardEmptyActiveThread();
      const thread = buildThread(selection);
      registerThread(thread);
      openThread(thread.threadId);
      clearCurrentSelection();
      state.pendingSelection = null;
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
    const sourceTurnId = CGQADom.getTurnId(selection.turn);
    const sourceMessageId = CGQADom.getMessageId(selection.turn);
    const quoteText = selection.exactText || selection.selectedText;

    return {
      threadId,
      quoteId,
      quoteText,
      sourceConversationId: state.conversationId,
      sourceTurnId,
      sourceMessageId,
      displayIndex: getNextDisplayIndex(),
      anchor: {
        quoteId,
        sourceConversationId: state.conversationId,
        sourceTurnId,
        sourceMessageId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        exactText: quoteText,
        prefixText: selection.prefixText || "",
        suffixText: selection.suffixText || "",
        threadId
      },
      messages: [],
      mainChatItems: [],
      createdAt: now,
      updatedAt: now
    };
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
      const rendered = CGQADom.renderThreadMark(thread);
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
    CGQADom.setActiveMark(threadId);
    sidebar.render(thread);
    sidebar.focusInput();
    syncPageDecorations();
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
    discardEmptyActiveThread();
    state.activeThreadId = "";
    CGQADom.setActiveMark("");
    sidebar.render(null);
    syncPageDecorations();
  }

  function discardEmptyActiveThread() {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    const thread = getThread(threadId);
    if (thread && !hasThreadStarted(thread)) {
      state.threads = state.threads.filter((item) => item.threadId !== threadId);
    }
  }

  function togglePanel() {
    if (sidebar.isOpen && sidebar.isOpen()) {
      closeSidebar();
      return;
    }

    const latest = [...state.threads].reverse().find(hasThreadStarted);
    if (latest) {
      openThread(latest.threadId);
      return;
    }

    sidebar.renderHelp();
  }

  function getThread(threadId) {
    return state.threads.find((thread) => thread.threadId === threadId);
  }

  async function saveAndRenderThread(thread) {
    try {
      const savedThread = await CGQAStorage.saveThread(thread);
      replaceThread(savedThread);
      renderSavedThread(savedThread);
      return savedThread;
    } catch (error) {
      console.error("[CGQA] save thread failed", error);
      CGQASidebar.showToast("本地保存失败，本次批注仍会保留在当前页面。");
      replaceThread(thread);
      renderSavedThread(thread);
      return thread;
    }
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
      renderThreadMark(thread, { notify: true });
      CGQADom.updateMarkChip(thread);
    }
    if (thread.threadId === state.activeThreadId) {
      sidebar.render(thread);
    }
  }

  function buildPrompt(thread, question, promptToken) {
    return [
      `围绕 提问 ${thread.displayIndex} 的批注提问`,
      "",
      "你正在回答用户围绕某段引用的追问。请只回答用户问题，不要复述这段系统说明。",
      "请不要在回答中提及或输出追踪标记。",
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

  async function sendQuestion(rawQuestion) {
    const question = (rawQuestion || "").trim();
    const thread = getThread(state.activeThreadId);
    if (!thread || !question) {
      return;
    }
    if (state.pendingResponse || hasGeneratingMessage(thread)) {
      CGQASidebar.showToast("上一条追问仍在生成中，请稍后再发。");
      renderSavedThread(thread);
      sidebar.focusInput();
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
    await saveAndRenderThread(thread);
    syncPageDecorations();

    state.pendingResponse = createResponseTracker(thread.threadId, mainChatItem.promptToken);
    startPendingCapturePoll();

    try {
      await CGQADom.submitPrompt(buildPrompt(thread, question, mainChatItem.promptToken));
      syncPageDecorations();
    } catch (error) {
      state.pendingResponse = null;
      stopPendingCapturePoll();
      clearPendingStableTimer();
      assistantMessage.content = error.message || "发送失败。";
      assistantMessage.status = "failed";
      await saveAndRenderThread(thread);
      syncPageDecorations();
      CGQASidebar.showToast(assistantMessage.content);
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
      getMainChatItems(thread).forEach((item) => {
        if (item && item.promptToken) {
          targets.push({
            threadId: thread.threadId,
            promptToken: item.promptToken
          });
        }
      });
    });
    return targets;
  }

  function syncMainChatVisibility(targets = getMainChatHideTargets()) {
    if (!CGQADom.syncHiddenMainTurns) {
      return;
    }
    CGQADom.syncHiddenMainTurns(targets);
  }

  function syncMainComposerVisibility() {
    if (!CGQADom.setMainComposerHidden) {
      return;
    }
    CGQADom.setMainComposerHidden(Boolean(state.activeThreadId));
  }

  function syncNativeGenerationControlsVisibility() {
    if (!CGQADom.setNativeGenerationControlsHidden) {
      return;
    }
    CGQADom.setNativeGenerationControlsHidden(Boolean(state.activeThreadId));
  }

  function syncPageDecorations() {
    syncMainChatVisibility();
    syncMainComposerVisibility();
    syncNativeGenerationControlsVisibility();
  }

  function createResponseTracker(threadId, promptToken) {
    const baselineRecords = CGQADom.getAssistantMessageRecords();
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
      stopPendingCapturePoll();
      clearPendingStableTimer();
      return;
    }

    const generating = [...thread.messages].reverse().find((message) => {
      return message.role === "assistant" && message.status === "generating";
    });
    if (!generating) {
      state.pendingResponse = null;
      stopPendingCapturePoll();
      clearPendingStableTimer();
      return;
    }

    if (Date.now() - state.pendingResponse.startedAt > RESPONSE_TIMEOUT_MS) {
      generating.content = generating.content === "生成中..." ? "回答等待超时，请在主聊天中查看结果。" : generating.content;
      generating.status = "failed";
      state.pendingResponse = null;
      stopPendingCapturePoll();
      clearPendingStableTimer();
      saveAndRenderThread(thread).then(syncPageDecorations).catch((error) => {
        console.error("[CGQA] save timeout state failed", error);
      });
      return;
    }

    const candidate = findPendingAssistantCandidate(thread);
    if (!candidate || !candidate.text) {
      return;
    }

    scheduleStableCandidateCapture(thread, generating, candidate);
  }

  function scheduleStableCandidateCapture(thread, generating, candidate) {
    const signature = getAssistantRecordSignature(candidate);
    const pending = state.pendingResponse;
    if (!pending) {
      return;
    }

    const sameCandidate = pending.candidate
      && pending.candidate.signature === signature
      && pending.candidate.text === candidate.text;
    if (sameCandidate && state.pendingStableTimer) {
      return;
    }

    pending.candidate = { signature, text: candidate.text };
    clearPendingStableTimer();
    state.pendingStableTimer = setTimeout(async () => {
      state.pendingStableTimer = 0;
      if (!state.pendingResponse || state.pendingResponse.threadId !== thread.threadId) {
        return;
      }

      const latest = findAssistantRecordBySignature(signature) || findPendingAssistantCandidate(thread);
      const text = latest ? latest.text : candidate.text;
      if (!text || text === generating.content || text === thread.quoteText) {
        return;
      }
      generating.content = text;
      generating.html = latest && latest.html || candidate.html || "";
      generating.contentFormat = generating.html ? "html" : "text";
      generating.status = "completed";
      state.pendingResponse = null;
      stopPendingCapturePoll();
      await saveAndRenderThread(thread);
      syncPageDecorations();
    }, RESPONSE_STABLE_DELAY_MS);
  }

  function findPendingAssistantCandidate(thread) {
    const records = CGQADom.getAssistantMessageRecords();
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

  function startPendingCapturePoll() {
    stopPendingCapturePoll();
    state.pendingCaptureTimer = setInterval(() => {
      capturePendingAssistantIfReady();
    }, 1000);
  }

  function stopPendingCapturePoll() {
    if (!state.pendingCaptureTimer) {
      return;
    }
    clearInterval(state.pendingCaptureTimer);
    state.pendingCaptureTimer = 0;
  }

  function clearPendingStableTimer() {
    if (!state.pendingStableTimer) {
      return;
    }
    clearTimeout(state.pendingStableTimer);
    state.pendingStableTimer = 0;
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

    const records = CGQADom.getAllTurnRecords();
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
    return CGQADom.getAssistantMessageRecords().find((record) => {
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
      || /^thoughtfor(acoupleof)?\d*(second|seconds|s)?$/.test(compact)
      || /^thinking[.。…]*$/.test(compact)
      || /^reasoning[.。…]*$/.test(compact);
  }

  async function deleteActiveThread() {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    state.threads = state.threads.filter((thread) => thread.threadId !== threadId);
    if (state.pendingResponse && state.pendingResponse.threadId === threadId) {
      state.pendingResponse = null;
      stopPendingCapturePoll();
      clearPendingStableTimer();
    }
    await CGQAStorage.deleteThread(state.conversationId, threadId);
    syncMainChatVisibility();
    closeSidebar();
    scheduleRestore();
  }

  function scheduleRestore() {
    clearTimeout(state.restoreTimer);
    state.restoreTimer = setTimeout(() => {
      state.restoring = true;
      CGQADom.clearRenderedMarks();
      state.threads.filter(hasThreadStarted).forEach((thread) => renderThreadMark(thread));
      if (state.activeThreadId) {
        CGQADom.setActiveMark(state.activeThreadId);
      }
      syncPageDecorations();
      setTimeout(() => {
        state.restoring = false;
      }, 0);
    }, 250);
  }

  function destroy() {
    clearTimeout(state.restoreTimer);
    clearPendingStableTimer();
    stopPendingCapturePoll();
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    state.cleanupTasks.splice(0).forEach((cleanup) => cleanup());
    CGQASidebar.hideSelectionMenu();
    if (sidebar && typeof sidebar.destroy === "function") {
      sidebar.destroy();
    } else if (sidebar) {
      sidebar.render(null);
    }
    if (CGQADom.syncHiddenMainTurns) {
      CGQADom.syncHiddenMainTurns([]);
    }
    if (CGQADom.setMainComposerHidden) {
      CGQADom.setMainComposerHidden(false);
    }
    if (CGQADom.setNativeGenerationControlsHidden) {
      CGQADom.setNativeGenerationControlsHidden(false);
    }
  }

  globalThis[RUNTIME_KEY] = {
    version: CONTENT_VERSION,
    destroy,
    openThread,
    togglePanel
  };
  globalThis.CGQAApp = globalThis[RUNTIME_KEY];
  globalThis.CGQAContentVersion = CONTENT_VERSION;

  init().catch((error) => {
    console.error("[CGQA] init failed", error);
  });
})();
