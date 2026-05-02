(function () {
  "use strict";

  const STORAGE_PREFIX = "cgqa:v2:";

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

  async function readConversation(conversationId) {
    const key = getStorageKey(conversationId);
    return (await readChrome(key)) || { threads: [] };
  }

  async function writeConversation(conversationId, data) {
    const key = getStorageKey(conversationId);
    const value = {
      threads: Array.isArray(data && data.threads) ? data.threads : [],
      updatedAt: Date.now()
    };

    await writeChrome(key, value);
    return value;
  }

  async function listThreads(conversationId) {
    const data = await readConversation(conversationId);
    return data.threads || [];
  }

  async function saveThread(thread) {
    const data = await readConversation(thread.sourceConversationId);
    const threads = data.threads || [];
    const index = threads.findIndex((item) => item.threadId === thread.threadId);
    const nextThread = { ...thread, updatedAt: Date.now() };

    if (index >= 0) {
      threads[index] = nextThread;
    } else {
      threads.push(nextThread);
    }

    await writeConversation(thread.sourceConversationId, { threads });
    return nextThread;
  }

  async function deleteThread(conversationId, threadId) {
    const data = await readConversation(conversationId);
    const threads = (data.threads || []).filter((thread) => thread.threadId !== threadId);
    await writeConversation(conversationId, { threads });
    return threads;
  }

  globalThis.CGQAStorage = {
    listThreads,
    saveThread,
    deleteThread
  };
})();
