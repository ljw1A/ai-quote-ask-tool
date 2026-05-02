(function () {
  "use strict";

  const CONTENT_VERSION = "0.4.6-stable-capture-timer";
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
    addEvent(window, "CGQA_DEBUG", logDebugSnapshot);

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
    clearTimeout(capturePendingAssistantIfReady.timer);
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

      const thread = buildThread(selection);
      registerThread(thread);
      openThread(thread.threadId);
      persistThread(thread);
      renderThreadMark(thread, { notify: true });
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

  function persistThread(thread) {
    CGQAStorage.saveThread(thread).catch((error) => {
      console.error("[CGQA] save thread failed", error);
      CGQASidebar.showToast("批注已打开，但本地保存失败。");
    });
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
    state.activeThreadId = "";
    CGQADom.setActiveMark("");
    sidebar.render(null);
    syncPageDecorations();
  }

  function togglePanel() {
    if (sidebar.isOpen && sidebar.isOpen()) {
      closeSidebar();
      return;
    }

    const latest = state.threads[state.threads.length - 1];
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
    CGQADom.updateMarkChip(thread);
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
      baselineCount: baselineRecords.length,
      knownSignatures: new Set(baselineRecords.map(getAssistantRecordSignature)),
      baselineTextBySignature,
      candidateSignature: "",
      startedAt: Date.now(),
      lastText: ""
    };
  }

  function capturePendingAssistantIfReady() {
    if (!state.pendingResponse) {
      return;
    }

    const thread = getThread(state.pendingResponse.threadId);
    if (!thread) {
      state.pendingResponse = null;
      return;
    }

    const generating = [...thread.messages].reverse().find((message) => {
      return message.role === "assistant" && message.status === "generating";
    });
    if (!generating) {
      return;
    }

    if (Date.now() - state.pendingResponse.startedAt > RESPONSE_TIMEOUT_MS) {
      generating.content = generating.content === "生成中..." ? "回答等待超时，请在主聊天中查看结果。" : generating.content;
      generating.status = "failed";
      state.pendingResponse = null;
      stopPendingCapturePoll();
      saveAndRenderThread(thread).then(syncPageDecorations).catch((error) => {
        console.error("[CGQA] save timeout state failed", error);
      });
      return;
    }

    const newRecord = findPendingAssistantRecord(thread);
    if (!newRecord || !newRecord.text) {
      return;
    }

    const signature = getAssistantRecordSignature(newRecord);
    if (
      capturePendingAssistantIfReady.timer
      && state.pendingResponse.candidateSignature === signature
      && state.pendingResponse.lastText === newRecord.text
    ) {
      return;
    }

    state.pendingResponse.candidateSignature = signature;
    state.pendingResponse.lastText = newRecord.text;
    clearTimeout(capturePendingAssistantIfReady.timer);
    capturePendingAssistantIfReady.timer = setTimeout(async () => {
      capturePendingAssistantIfReady.timer = 0;
      const latest = findAssistantRecordBySignature(signature) || findPendingAssistantRecord(thread);
      const text = latest ? latest.text : newRecord.text;
      if (!text || text === generating.content || text === thread.quoteText) {
        return;
      }
      generating.content = text;
      generating.html = latest && latest.html || newRecord.html || "";
      generating.contentFormat = generating.html ? "html" : "text";
      generating.status = "completed";
      state.pendingResponse = null;
      stopPendingCapturePoll();
      await saveAndRenderThread(thread);
      syncPageDecorations();
    }, RESPONSE_STABLE_DELAY_MS);
  }

  function findPendingAssistantRecord(thread) {
    const records = CGQADom.getAssistantMessageRecords();
    const tracker = state.pendingResponse;
    if (!tracker) {
      return null;
    }

    const explicitNewRecord = records.find((record) => {
      return record.text
        && !tracker.knownSignatures.has(getAssistantRecordSignature(record))
        && isUsableAssistantAnswer(record.text, thread);
    });
    if (explicitNewRecord) {
      return explicitNewRecord;
    }

    if (records.length > tracker.baselineCount) {
      const appendedRecord = records[records.length - 1];
      if (appendedRecord && appendedRecord.text && isUsableAssistantAnswer(appendedRecord.text, thread)) {
        return appendedRecord;
      }
    }

    const changedKnownRecord = [...records].reverse().find((record) => {
      const signature = getAssistantRecordSignature(record);
      const baselineText = tracker.baselineTextBySignature && tracker.baselineTextBySignature[signature] || "";
      return tracker.knownSignatures.has(signature)
        && record.text
        && record.text !== baselineText
        && isUsableAssistantAnswer(record.text, thread);
    });
    if (changedKnownRecord) {
      return changedKnownRecord;
    }

    const followupRecord = findAssistantRecordAfterPromptToken(thread, records, tracker.promptToken);
    if (followupRecord) {
      return followupRecord;
    }

    return null;
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

  function logDebugSnapshot() {
    const snapshot = buildDebugSnapshot();
    console.group("[CGQA] debug snapshot");
    console.log(snapshot);
    console.groupEnd();
    return snapshot;
  }

  function buildDebugSnapshot() {
    const allRecords = CGQADom.getAllTurnRecords();
    const assistantRecords = CGQADom.getAssistantMessageRecords();
    const activeThread = getThread(state.activeThreadId);
    const promptToken = getDebugPromptToken(activeThread);
    const promptIndex = promptToken ? findLastPromptUserRecordIndex(allRecords, promptToken) : -1;
    const followingRecords = promptIndex >= 0
      ? allRecords.slice(promptIndex + 1, promptIndex + 4).map(summarizeTurnRecord)
      : [];

    return {
      version: CONTENT_VERSION,
      url: location.href,
      conversationId: state.conversationId,
      activeThreadId: state.activeThreadId,
      threadCount: state.threads.length,
      pendingResponse: summarizePendingResponse(),
      activeThread: summarizeThread(activeThread),
      promptToken,
      promptUserRecordIndex: promptIndex,
      promptUserRecord: promptIndex >= 0 ? summarizeTurnRecord(allRecords[promptIndex]) : null,
      recordsAfterPrompt: followingRecords,
      allTurnCount: allRecords.length,
      assistantRecordCount: assistantRecords.length,
      allTurnRecords: allRecords.map(summarizeTurnRecord),
      assistantRecords: assistantRecords.map(summarizeTurnRecord)
    };
  }

  function getDebugPromptToken(activeThread) {
    if (state.pendingResponse && state.pendingResponse.promptToken) {
      return state.pendingResponse.promptToken;
    }
    const items = getMainChatItems(activeThread);
    return items.length > 0 ? items[items.length - 1].promptToken : "";
  }

  function summarizePendingResponse() {
    if (!state.pendingResponse) {
      return null;
    }
    return {
      threadId: state.pendingResponse.threadId,
      promptToken: state.pendingResponse.promptToken,
      baselineCount: state.pendingResponse.baselineCount,
      knownSignatureCount: state.pendingResponse.knownSignatures ? state.pendingResponse.knownSignatures.size : 0,
      candidateSignature: state.pendingResponse.candidateSignature,
      lastTextPreview: previewText(state.pendingResponse.lastText),
      ageMs: Date.now() - state.pendingResponse.startedAt
    };
  }

  function summarizeThread(thread) {
    if (!thread) {
      return null;
    }
    return {
      threadId: thread.threadId,
      displayIndex: thread.displayIndex,
      quotePreview: previewText(thread.quoteText),
      messageCount: Array.isArray(thread.messages) ? thread.messages.length : 0,
      messages: (thread.messages || []).map((message) => ({
        role: message.role,
        status: message.status,
        contentFormat: message.contentFormat || "text",
        contentPreview: previewText(message.content)
      })),
      mainChatItems: getMainChatItems(thread)
    };
  }

  function summarizeTurnRecord(record) {
    if (!record) {
      return null;
    }
    return {
      index: record.index,
      role: record.role,
      turnId: record.turnId,
      messageId: record.messageId,
      signature: getAssistantRecordSignature(record),
      textLength: record.text ? record.text.length : 0,
      textPreview: previewText(record.text),
      htmlLength: record.html ? record.html.length : 0,
      contentFormat: record.contentFormat || "text"
    };
  }

  function previewText(text, maxLength = 160) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
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
    if (!normalized || normalized === "生成中..." || normalized === thread.quoteText) {
      return false;
    }
    return true;
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
      clearTimeout(capturePendingAssistantIfReady.timer);
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
      state.threads.forEach((thread) => renderThreadMark(thread));
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
    clearTimeout(capturePendingAssistantIfReady.timer);
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
    togglePanel,
    debug: logDebugSnapshot
  };
  globalThis.CGQAApp = globalThis[RUNTIME_KEY];
  globalThis.CGQAContentVersion = CONTENT_VERSION;

  init().catch((error) => {
    console.error("[CGQA] init failed", error);
  });
})();
