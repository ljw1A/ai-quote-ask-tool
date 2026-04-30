(function () {
  "use strict";

  if (globalThis.CGQAContentLoaded) {
    return;
  }
  globalThis.CGQAContentLoaded = true;

  const state = {
    conversationId: "",
    threads: [],
    activeThreadId: "",
    pendingSelection: null,
    pendingResponse: null,
    observer: null,
    restoreTimer: 0,
    restoring: false,
    creatingThread: false
  };

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
      onDeleteThread: deleteActiveThread,
      onClearConversation: clearConversation
    });

    await loadThreads();
    bindEvents();
    scheduleRestore();
  }

  async function loadThreads() {
    state.conversationId = CGQADom.getConversationId();
    state.threads = await CGQAStorage.listThreads(state.conversationId);
    normalizeDisplayIndexes();
  }

  function normalizeDisplayIndexes() {
    let changed = false;
    state.threads.forEach((thread, index) => {
      if (!thread.displayIndex) {
        thread.displayIndex = index + 1;
        changed = true;
      }
    });
    if (changed) {
      state.threads.forEach((thread) => CGQAStorage.saveThread(thread));
    }
  }

  function bindEvents() {
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        CGQASidebar.hideSelectionMenu();
      }
    });
    document.addEventListener("click", onQuoteMarkClick, true);
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "CGQA_TOGGLE_PANEL") {
        togglePanel();
      }
    });

    state.observer = new MutationObserver(() => {
      if (state.restoring) {
        return;
      }
      const nextConversationId = CGQADom.getConversationId();
      if (nextConversationId !== state.conversationId) {
        loadThreads().then(scheduleRestore);
        return;
      }
      scheduleRestore();
      capturePendingAssistantIfReady();
      foldPluginPrompts();
    });
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function onMouseUp(event) {
    if (eventTargetIsPluginUi(event.target)) {
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
      const rect = result.range.getBoundingClientRect();
      CGQASidebar.showSelectionMenu(rect, createThreadFromSelection);
    }, 0);
  }

  function eventTargetIsPluginUi(target) {
    return Boolean(target && target.closest && target.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-toast"));
  }

  async function createThreadFromSelection() {
    if (state.creatingThread) {
      return;
    }

    state.creatingThread = true;
    const selection = state.pendingSelection;
    CGQASidebar.hideSelectionMenu();
    if (!selection || !selection.ok) {
      state.creatingThread = false;
      return;
    }

    try {
      if (selection.complex) {
        CGQASidebar.showToast("当前选区包含公式或代码结构，将使用保守标记。");
      }

      const now = Date.now();
      const quoteId = uid("quote");
      const threadId = uid("thread");
      const thread = {
        threadId,
        quoteId,
        quoteText: selection.exactText || selection.selectedText,
        sourceConversationId: state.conversationId,
        sourceTurnId: CGQADom.getTurnId(selection.turn),
        sourceMessageId: CGQADom.getMessageId(selection.turn),
        displayIndex: state.threads.length + 1,
        anchor: {
          quoteId,
          sourceConversationId: state.conversationId,
          sourceTurnId: CGQADom.getTurnId(selection.turn),
          sourceMessageId: CGQADom.getMessageId(selection.turn),
          startOffset: selection.startOffset,
          endOffset: selection.endOffset,
          exactText: selection.exactText || selection.selectedText,
          prefixText: selection.prefixText || "",
          suffixText: selection.suffixText || "",
          threadId
        },
        messages: [],
        createdAt: now,
        updatedAt: now
      };

      state.threads.push(thread);
      openThread(threadId);

      CGQAStorage.saveThread(thread).catch((error) => {
        console.error("[CGQA] save thread failed", error);
        CGQASidebar.showToast("批注已打开，但本地保存失败。");
      });

      try {
        const rendered = CGQADom.renderThreadMark(thread);
        if (!rendered) {
          CGQASidebar.showToast("已创建批注，但当前 DOM 无法安全渲染正文标记。");
        }
      } catch (error) {
        console.error("[CGQA] render mark failed", error);
        CGQASidebar.showToast("已打开批注小窗，但正文标记渲染失败。");
      }

      const currentSelection = window.getSelection();
      if (currentSelection) {
        currentSelection.removeAllRanges();
      }
    } catch (error) {
      console.error("[CGQA] create thread failed", error);
      CGQASidebar.showToast("创建批注失败，请刷新页面后重试。");
    } finally {
      state.creatingThread = false;
    }
  }

  function openThread(threadId) {
    const thread = getThread(threadId);
    if (!thread) {
      return;
    }

    state.activeThreadId = threadId;
    CGQADom.setActiveMark(threadId);
    sidebar.render(thread);
    sidebar.focusInput();
  }

  function onQuoteMarkClick(event) {
    const path = event.composedPath ? event.composedPath() : [];
    const marks = path.filter((node) => node && node.classList && node.classList.contains("cgqa-quote-mark"));
    if (marks.length === 0) {
      return;
    }

    const uniqueThreadIds = [...new Set(marks.map((mark) => mark.dataset.threadId).filter(Boolean))];
    if (uniqueThreadIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (uniqueThreadIds.length === 1) {
      openThread(uniqueThreadIds[0]);
      return;
    }

    const threads = uniqueThreadIds.map(getThread).filter(Boolean);
    const target = marks[0];
    CGQASidebar.showThreadChoiceMenu(target.getBoundingClientRect(), threads, openThread);
  }

  function closeSidebar() {
    state.activeThreadId = "";
    CGQADom.setActiveMark("");
    sidebar.render(null);
  }

  function togglePanel() {
    if (state.activeThreadId) {
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
    await CGQAStorage.saveThread(thread);
    CGQADom.updateMarkChip(thread);
    if (thread.threadId === state.activeThreadId) {
      sidebar.render(thread);
    }
  }

  function buildPrompt(thread, question) {
    return [
      `围绕 引用 ${thread.displayIndex} 的批注提问`,
      "",
      "你正在回答用户围绕某段引用的追问。请只回答用户问题，不要复述这段系统说明。",
      "",
      "<quote>",
      thread.quoteText,
      "</quote>",
      "",
      "<user_question>",
      question,
      "</user_question>"
    ].join("\n");
  }

  async function sendQuestion(rawQuestion) {
    const question = (rawQuestion || "").trim();
    const thread = getThread(state.activeThreadId);
    if (!thread || !question) {
      return;
    }

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
      status: "generating"
    };
    thread.messages.push(userMessage, assistantMessage);
    await saveAndRenderThread(thread);

    state.pendingResponse = {
      threadId: thread.threadId,
      knownMessageIds: new Set(CGQADom.getAssistantMessageRecords().map((record) => record.messageId).filter(Boolean))
    };
    try {
      await CGQADom.submitPrompt(buildPrompt(thread, question));
    } catch (error) {
      state.pendingResponse = null;
      assistantMessage.content = error.message || "发送失败。";
      assistantMessage.status = "failed";
      await saveAndRenderThread(thread);
      CGQASidebar.showToast(assistantMessage.content);
    }
  }

  function capturePendingAssistantIfReady() {
    if (!state.pendingResponse) {
      return;
    }

    const thread = getThread(state.pendingResponse.threadId);
    if (!thread) {
      return;
    }
    const generating = [...thread.messages].reverse().find((message) => message.role === "assistant" && message.status === "generating");
    if (!generating) {
      return;
    }

    const newRecord = CGQADom.getAssistantMessageRecords().find((record) => {
      return record.messageId && !state.pendingResponse.knownMessageIds.has(record.messageId);
    });
    if (!newRecord || !newRecord.text) {
      return;
    }

    clearTimeout(capturePendingAssistantIfReady.timer);
    capturePendingAssistantIfReady.timer = setTimeout(async () => {
      const latest = CGQADom.getAssistantMessageRecords().find((record) => record.messageId === newRecord.messageId);
      const text = latest ? latest.text : newRecord.text;
      if (!text || text === generating.content || text === thread.quoteText) {
        return;
      }
      generating.content = text;
      generating.status = "completed";
      state.pendingResponse = null;
      await saveAndRenderThread(thread);
    }, 1200);
  }

  async function deleteActiveThread() {
    const threadId = state.activeThreadId;
    if (!threadId) {
      return;
    }

    state.threads = state.threads.filter((thread) => thread.threadId !== threadId);
    await CGQAStorage.deleteThread(state.conversationId, threadId);
    closeSidebar();
    scheduleRestore();
  }

  async function clearConversation() {
    await CGQAStorage.clearConversation(state.conversationId);
    state.threads = [];
    closeSidebar();
    CGQADom.clearRenderedMarks();
    CGQASidebar.showToast("已清除当前会话的批注引用。");
  }

  function scheduleRestore() {
    clearTimeout(state.restoreTimer);
    state.restoreTimer = setTimeout(() => {
      state.restoring = true;
      CGQADom.clearRenderedMarks();
      state.threads.forEach((thread) => CGQADom.renderThreadMark(thread));
      if (state.activeThreadId) {
        CGQADom.setActiveMark(state.activeThreadId);
      }
      setTimeout(() => {
        state.restoring = false;
      }, 0);
    }, 250);
  }

  function foldPluginPrompts() {
    CGQADom.getAllTurns()
      .filter((turn) => turn.getAttribute("data-turn") === "user" && !turn.dataset.cgqaFolded)
      .forEach((turn) => {
        const text = turn.textContent || "";
        const match = text.match(/围绕 引用 (\d+) 的批注提问/);
        if (!match) {
          return;
        }

        const content = turn.querySelector("[data-testid='collapsible-user-message-content'], .whitespace-pre-wrap") || turn;
        const details = document.createElement("details");
        details.className = "cgqa-folded-prompt";
        const summary = document.createElement("summary");
        summary.textContent = `围绕 引用 ${match[1]} 的批注提问 - 已收纳到右侧小窗`;
        const pre = document.createElement("pre");
        pre.textContent = text;
        details.append(summary, pre);
        content.textContent = "";
        content.append(details);
        turn.dataset.cgqaFolded = "true";
      });
  }

  globalThis.CGQAApp = {
    openThread
  };

  init().catch((error) => {
    console.error("[CGQA] init failed", error);
  });
})();
