(function () {
  "use strict";

  const STORAGE_PREFIX = "cgqa:v2:";
  const INDEX_KEY = "cgqa:index:v1";

  function getStorageKey(conversationId) {
    return `${STORAGE_PREFIX}${conversationId || "unknown"}`;
  }

  function readChrome(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result[key] || null);
      });
    });
  }

  function writeChrome(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function readAllChrome() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(result || {});
      });
    });
  }

  function removeChrome(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function getConversationIdFromKey(key) {
    return key && key.startsWith(STORAGE_PREFIX) ? key.slice(STORAGE_PREFIX.length) : "";
  }

  async function readConversation(conversationId) {
    const key = getStorageKey(conversationId);
    const data = await readChrome(key);
    return normalizeConversationData(conversationId, data);
  }

  async function writeConversation(conversationId, data) {
    const key = getStorageKey(conversationId);
    const threads = Array.isArray(data && data.threads) ? data.threads : [];
    const meta = normalizeConversationMeta(conversationId, data && data.meta, threads);
    const value = {
      meta,
      threads,
      updatedAt: Date.now()
    };

    await writeChrome(key, value);
    await upsertConversationSummary(buildConversationSummary(conversationId, value));
    return value;
  }

  function normalizeConversationData(conversationId, data) {
    const threads = Array.isArray(data && data.threads) ? data.threads : [];
    return {
      meta: normalizeConversationMeta(conversationId, data && data.meta, threads),
      threads,
      updatedAt: Number(data && data.updatedAt) || getLatestThreadTime(threads)
    };
  }

  function normalizeConversationMeta(conversationId, meta, threads = []) {
    const firstThread = threads[0] || {};
    const title = String(meta && meta.title || firstThread.sourceTitle || "").trim();
    const url = String(meta && meta.url || firstThread.sourceUrl || getConversationUrl(conversationId)).trim();
    return {
      conversationId,
      title: title || getFallbackTitle(conversationId),
      url,
      createdAt: Number(meta && meta.createdAt) || getEarliestThreadTime(threads) || Date.now(),
      updatedAt: Number(meta && meta.updatedAt) || getLatestThreadTime(threads) || Date.now()
    };
  }

  function getConversationUrl(conversationId) {
    return conversationId && conversationId !== "new-chat" ? `https://chatgpt.com/c/${conversationId}` : "";
  }

  function getFallbackTitle(conversationId) {
    if (!conversationId || conversationId === "new-chat") {
      return "新会话";
    }
    return `会话 ${conversationId.slice(0, 8)}`;
  }

  function getEarliestThreadTime(threads) {
    return threads.reduce((earliest, thread) => {
      const value = Number(thread && thread.createdAt) || 0;
      return value && (!earliest || value < earliest) ? value : earliest;
    }, 0);
  }

  function getLatestThreadTime(threads) {
    return threads.reduce((latest, thread) => {
      const value = Number(thread && (thread.updatedAt || thread.createdAt)) || 0;
      return value > latest ? value : latest;
    }, 0);
  }

  function getUserMessageCount(threads) {
    return threads.reduce((count, thread) => {
      return count + (Array.isArray(thread && thread.messages)
        ? thread.messages.filter((message) => message && message.role === "user").length
        : 0);
    }, 0);
  }

  function buildConversationSummary(conversationId, data) {
    const normalized = normalizeConversationData(conversationId, data);
    return {
      conversationId,
      title: normalized.meta.title,
      url: normalized.meta.url,
      threadCount: normalized.threads.length,
      messageCount: getUserMessageCount(normalized.threads),
      createdAt: normalized.meta.createdAt,
      updatedAt: normalized.updatedAt || normalized.meta.updatedAt
    };
  }

  async function readIndex() {
    const index = await readChrome(INDEX_KEY);
    return {
      conversations: Array.isArray(index && index.conversations) ? index.conversations : []
    };
  }

  async function writeIndex(conversations) {
    const value = {
      conversations: conversations
        .filter((item) => item && item.conversationId && item.threadCount > 0)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)),
      updatedAt: Date.now()
    };
    await writeChrome(INDEX_KEY, value);
    return value;
  }

  async function upsertConversationSummary(summary) {
    const index = await readIndex();
    const conversations = index.conversations.filter((item) => item.conversationId !== summary.conversationId);
    conversations.push(summary);
    await writeIndex(conversations);
  }

  async function removeConversationSummary(conversationId) {
    const index = await readIndex();
    await writeIndex(index.conversations.filter((item) => item.conversationId !== conversationId));
  }

  async function rebuildConversationIndex() {
    const values = await readAllChrome();
    const conversations = Object.keys(values)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map((key) => {
        const conversationId = getConversationIdFromKey(key);
        return buildConversationSummary(conversationId, values[key]);
      })
      .filter((summary) => summary.threadCount > 0);
    await writeIndex(conversations);
    return conversations.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  }

  async function listConversations() {
    const indexed = (await readIndex()).conversations;
    if (indexed.length > 0) {
      return indexed.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    }
    return rebuildConversationIndex();
  }

  async function getConversation(conversationId) {
    const data = await readConversation(conversationId);
    return {
      ...buildConversationSummary(conversationId, data),
      meta: data.meta,
      threads: data.threads
    };
  }

  async function listThreads(conversationId) {
    const data = await readConversation(conversationId);
    return data.threads || [];
  }

  async function saveThread(thread, conversationMeta = {}) {
    const data = await readConversation(thread.sourceConversationId);
    const threads = data.threads || [];
    const index = threads.findIndex((item) => item.threadId === thread.threadId);
    const nextThread = {
      ...thread,
      sourceTitle: conversationMeta.title || thread.sourceTitle || data.meta.title,
      sourceUrl: conversationMeta.url || thread.sourceUrl || data.meta.url,
      updatedAt: Date.now()
    };
    const meta = normalizeConversationMeta(thread.sourceConversationId, {
      ...data.meta,
      ...conversationMeta,
      updatedAt: nextThread.updatedAt
    }, threads);

    if (index >= 0) {
      threads[index] = nextThread;
    } else {
      threads.push(nextThread);
    }

    await writeConversation(thread.sourceConversationId, { meta, threads });
    return nextThread;
  }

  async function deleteThread(conversationId, threadId) {
    const data = await readConversation(conversationId);
    const threads = (data.threads || []).filter((thread) => thread.threadId !== threadId);
    if (threads.length === 0) {
      await removeChrome(getStorageKey(conversationId));
      await removeConversationSummary(conversationId);
      return [];
    }
    await writeConversation(conversationId, { meta: data.meta, threads });
    return threads;
  }

  async function deleteConversation(conversationId) {
    await removeChrome(getStorageKey(conversationId));
    await removeConversationSummary(conversationId);
  }

  globalThis.CGQAStorage = {
    listConversations,
    getConversation,
    listThreads,
    saveThread,
    deleteThread,
    deleteConversation,
    rebuildConversationIndex
  };
})();
