(function () {
  "use strict";

  const state = {
    conversations: [],
    activeConversationId: "",
    loading: false,
    queuedLoadOptions: null
  };

  const listEl = document.getElementById("conversation-list");
  const countEl = document.getElementById("conversation-count");
  const emptyEl = document.getElementById("thread-empty");
  const detailEl = document.getElementById("thread-detail");
  const conversationTemplate = document.getElementById("conversation-template");

  document.getElementById("refresh").addEventListener("click", () => load({ rebuildIndex: true }));

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && Object.keys(changes).some((key) => key.startsWith("cgqa:"))) {
        load();
      }
    });
  }

  async function load(options = {}) {
    if (state.loading) {
      state.queuedLoadOptions = {
        rebuildIndex: Boolean(state.queuedLoadOptions && state.queuedLoadOptions.rebuildIndex || options.rebuildIndex)
      };
      return;
    }

    state.loading = true;
    try {
      state.conversations = options.rebuildIndex
        ? await CGQAStorage.rebuildConversationIndex()
        : await CGQAStorage.listConversations();
      if (!state.conversations.some((item) => item.conversationId === state.activeConversationId)) {
        state.activeConversationId = state.conversations[0] && state.conversations[0].conversationId || "";
      }
      renderConversations();
      await renderActiveConversation();
    } finally {
      state.loading = false;
      if (state.queuedLoadOptions) {
        const nextOptions = state.queuedLoadOptions;
        state.queuedLoadOptions = null;
        await load(nextOptions);
      }
    }
  }

  function renderConversations() {
    listEl.replaceChildren();
    countEl.textContent = String(state.conversations.length);

    state.conversations.forEach((conversation) => {
      const item = conversationTemplate.content.firstElementChild.cloneNode(true);
      item.classList.toggle("is-active", conversation.conversationId === state.activeConversationId);
      item.querySelector(".conversation-title").textContent = conversation.title || "未命名会话";
      item.querySelector(".conversation-meta").textContent = `${conversation.threadCount || 0} 个提问 · ${formatTime(conversation.updatedAt)}`;
      item.addEventListener("click", async () => {
        state.activeConversationId = conversation.conversationId;
        renderConversations();
        await renderActiveConversation();
      });
      listEl.append(item);
    });
  }

  async function renderActiveConversation() {
    if (!state.activeConversationId) {
      showEmpty();
      return;
    }

    const conversation = await CGQAStorage.getConversation(state.activeConversationId);
    if (!conversation.threads.length) {
      showEmpty();
      return;
    }

    emptyEl.hidden = true;
    detailEl.hidden = false;
    detailEl.replaceChildren(
      renderConversationSummary(conversation),
      renderThreadList(conversation)
    );
  }

  function showEmpty() {
    emptyEl.hidden = false;
    detailEl.hidden = true;
    detailEl.replaceChildren();
  }

  function renderConversationSummary(conversation) {
    const section = createElement("section", "conversation-summary");
    const text = createElement("div");
    text.append(
      createElement("h2", "", conversation.title || "未命名会话"),
      createElement("div", "summary-meta", `${conversation.threadCount} 个提问 · ${conversation.messageCount} 条用户追问 · 更新于 ${formatTime(conversation.updatedAt)}`)
    );

    const actions = createElement("div", "summary-actions");
    if (conversation.url) {
      const open = createElement("a", "open-link", "打开原会话");
      open.href = conversation.url;
      open.target = "_blank";
      open.rel = "noreferrer";
      actions.append(open);
    }

    const remove = createElement("button", "danger-button", "删除会话记录");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm("删除当前会话下的所有提问记录？")) {
        return;
      }
      await CGQAStorage.deleteConversation(conversation.conversationId);
      state.activeConversationId = "";
      await load();
    });
    actions.append(remove);
    section.append(text, actions);
    return section;
  }

  function renderThreadList(conversation) {
    const list = createElement("div", "thread-list");
    conversation.threads
      .slice()
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .forEach((thread) => list.append(renderThreadCard(conversation, thread)));
    return list;
  }

  function renderThreadCard(conversation, thread) {
    const card = createElement("article", "thread-card");
    const header = createElement("header", "thread-card-header");
    const titleWrap = createElement("div");
    titleWrap.append(
      createElement("h3", "thread-card-title", `提问 ${thread.displayIndex || ""}`),
      createElement("div", "thread-card-time", formatTime(thread.updatedAt || thread.createdAt))
    );
    const remove = createElement("button", "danger-button", "删除提问");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm("删除这条提问记录？")) {
        return;
      }
      await CGQAStorage.deleteThread(conversation.conversationId, thread.threadId);
      await load();
    });
    header.append(titleWrap, remove);

    const quote = createElement("blockquote", "quote-block", thread.quoteText || "");
    const messages = createElement("div", "message-list");
    (thread.messages || []).forEach((message) => messages.append(renderMessage(message)));
    card.append(header, quote, messages);
    return card;
  }

  function renderMessage(message) {
    const item = createElement("section", `message-item message-${message.role || "assistant"}`);
    item.append(
      createElement("div", "message-label", message.role === "user" ? "你" : "ChatGPT"),
      createMessageBody(message)
    );
    return item;
  }

  function createMessageBody(message) {
    const body = createElement("div", "message-body");
    const html = getRenderableMessageHtml(message);
    if (html) {
      const htmlBody = createElement("div", "message-html");
      htmlBody.innerHTML = html;
      body.classList.add("is-html");
      body.append(htmlBody);
    } else {
      body.append(document.createTextNode(message.content || ""));
    }
    const time = createElement("time", "message-time", formatClock(message.createdAt));
    const date = getValidDate(message.createdAt);
    if (date) {
      time.dateTime = date.toISOString();
    }
    body.append(time);
    return body;
  }

  function getRenderableMessageHtml(message) {
    if (
      !message
      || message.role !== "assistant"
      || message.status !== "completed"
      || message.contentFormat !== "html"
      || !message.html
      || !globalThis.CGQASanitize
      || typeof CGQASanitize.sanitizeMessageHtml !== "function"
    ) {
      return "";
    }
    return CGQASanitize.sanitizeMessageHtml(message.html);
  }

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

  function formatTime(timestamp) {
    const date = getValidDate(timestamp);
    if (!date) {
      return "未知时间";
    }
    return date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatClock(timestamp) {
    const date = getValidDate(timestamp);
    return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  }

  function getValidDate(timestamp) {
    const date = new Date(Number(timestamp) || 0);
    return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? null : date;
  }

  load().catch((error) => {
    console.error("[CGQA] manager load failed", error);
    showEmpty();
  });
})();
