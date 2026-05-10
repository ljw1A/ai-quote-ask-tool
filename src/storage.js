(function () {
  "use strict";

  const STORAGE_PREFIX = "cgqa:v3:";
  const INDEX_KEY = "cgqa:index:v3";
  const SETTINGS_KEY = "cgqa:settings:v1";
  const DEFAULT_PROVIDER_ID = "chatgpt";
  const DEFAULT_PROVIDER_LABEL = "ChatGPT";
  const REPLY_STYLE_MODES = new Set(["default", "longer", "shorter", "custom"]);
  const THEME_MODES = new Set(["green", "pink", "blue", "gold", "slate"]);
  const DEFAULT_THEME = "green";
  const PROVIDER_IDS = ["chatgpt", "gemini", "deepseek"];
  const DEFAULT_PROVIDER_ENABLED = {
    chatgpt: true,
    gemini: true,
    deepseek: false
  };

  function normalizeConversationRef(ref) {
    if (ref && typeof ref === "object") {
      const providerId = normalizeId(ref.providerId || DEFAULT_PROVIDER_ID, DEFAULT_PROVIDER_ID);
      const conversationId = normalizeId(ref.conversationId, "unknown");
      return {
        providerId,
        providerLabel: String(ref.providerLabel || getFallbackProviderLabel(providerId)).trim(),
        conversationId,
        storageId: makeStorageId(providerId, conversationId)
      };
    }

    const conversationId = normalizeId(ref, "unknown");
    return {
      providerId: DEFAULT_PROVIDER_ID,
      providerLabel: DEFAULT_PROVIDER_LABEL,
      conversationId,
      storageId: makeStorageId(DEFAULT_PROVIDER_ID, conversationId)
    };
  }

  function normalizeId(value, fallback) {
    const normalized = String(value || "").trim();
    return normalized || fallback;
  }

  function getFallbackProviderLabel(providerId) {
    return providerId === DEFAULT_PROVIDER_ID ? DEFAULT_PROVIDER_LABEL : providerId;
  }

  function makeStorageId(providerId, conversationId) {
    return `${providerId}:${conversationId}`;
  }

  function getStorageKey(ref) {
    const normalized = normalizeConversationRef(ref);
    return `${STORAGE_PREFIX}${encodeKeyPart(normalized.providerId)}:${encodeKeyPart(normalized.conversationId)}`;
  }

  function encodeKeyPart(value) {
    return encodeURIComponent(String(value || ""));
  }

  function decodeKeyPart(value) {
    try {
      return decodeURIComponent(value || "");
    } catch (_error) {
      return value || "";
    }
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

  function getConversationRefFromKey(key) {
    if (key && key.startsWith(STORAGE_PREFIX)) {
      const rest = key.slice(STORAGE_PREFIX.length);
      const separatorIndex = rest.indexOf(":");
      if (separatorIndex < 0) {
        return null;
      }
      return normalizeConversationRef({
        providerId: decodeKeyPart(rest.slice(0, separatorIndex)),
        conversationId: decodeKeyPart(rest.slice(separatorIndex + 1))
      });
    }

    return null;
  }

  async function readConversation(ref) {
    const conversationRef = normalizeConversationRef(ref);
    const key = getStorageKey(conversationRef);
    const data = await readChrome(key);
    return normalizeConversationData(conversationRef, data);
  }

  async function writeConversation(ref, data) {
    const conversationRef = normalizeConversationRef(ref);
    const key = getStorageKey(conversationRef);
    const threads = Array.isArray(data && data.threads) ? data.threads : [];
    const meta = normalizeConversationMeta(conversationRef, data && data.meta, threads);
    const value = {
      meta,
      threads,
      updatedAt: Date.now()
    };

    await writeChrome(key, value);
    await upsertConversationSummary(buildConversationSummary(conversationRef, value));
    return value;
  }

  function normalizeConversationData(ref, data) {
    const conversationRef = normalizeConversationRef(ref);
    const threads = Array.isArray(data && data.threads) ? data.threads.map((thread) => {
      return normalizeThreadProvider(thread, conversationRef);
    }) : [];
    return {
      meta: normalizeConversationMeta(conversationRef, data && data.meta, threads),
      threads,
      updatedAt: Number(data && data.updatedAt) || getLatestThreadTime(threads)
    };
  }

  function normalizeThreadProvider(thread, conversationRef) {
    if (!thread || typeof thread !== "object") {
      return thread;
    }
    return {
      ...thread,
      sourceProviderId: thread.sourceProviderId || conversationRef.providerId,
      sourceProviderLabel: thread.sourceProviderLabel || conversationRef.providerLabel,
      sourceConversationId: thread.sourceConversationId || conversationRef.conversationId
    };
  }

  function normalizeConversationMeta(ref, meta, threads = []) {
    const conversationRef = normalizeConversationRef({
      ...ref,
      providerLabel: meta && meta.providerLabel || ref.providerLabel
    });
    const firstThread = threads[0] || {};
    const title = String(meta && meta.title || firstThread.sourceTitle || "").trim();
    const url = String(meta && meta.url || firstThread.sourceUrl || getConversationUrl(conversationRef)).trim();
    return {
      providerId: conversationRef.providerId,
      providerLabel: conversationRef.providerLabel,
      conversationId: conversationRef.conversationId,
      storageId: conversationRef.storageId,
      title: title || getFallbackTitle(conversationRef),
      url,
      createdAt: Number(meta && meta.createdAt) || getEarliestThreadTime(threads) || Date.now(),
      updatedAt: Number(meta && meta.updatedAt) || getLatestThreadTime(threads) || Date.now()
    };
  }

  function getConversationUrl(ref) {
    if (ref.providerId !== DEFAULT_PROVIDER_ID) {
      return "";
    }
    return ref.conversationId && ref.conversationId !== "new-chat" ? `https://chatgpt.com/c/${ref.conversationId}` : "";
  }

  function getFallbackTitle(ref) {
    if (!ref.conversationId || ref.conversationId === "new-chat") {
      return "新会话";
    }
    return `会话 ${ref.conversationId.slice(0, 8)}`;
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

  function buildConversationSummary(ref, data) {
    const conversationRef = normalizeConversationRef(ref);
    const normalized = normalizeConversationData(conversationRef, data);
    return {
      providerId: normalized.meta.providerId,
      providerLabel: normalized.meta.providerLabel,
      conversationId: normalized.meta.conversationId,
      storageId: normalized.meta.storageId,
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
      conversations: Array.isArray(index && index.conversations)
        ? index.conversations.map(normalizeConversationSummary).filter(Boolean)
        : []
    };
  }

  function normalizeConversationSummary(summary) {
    if (!summary || !summary.conversationId) {
      return null;
    }
    const ref = normalizeConversationRef({
      providerId: summary.providerId || DEFAULT_PROVIDER_ID,
      providerLabel: summary.providerLabel || getFallbackProviderLabel(summary.providerId || DEFAULT_PROVIDER_ID),
      conversationId: summary.conversationId
    });
    return {
      ...summary,
      providerId: ref.providerId,
      providerLabel: ref.providerLabel,
      conversationId: ref.conversationId,
      storageId: ref.storageId
    };
  }

  async function writeIndex(conversations) {
    const value = {
      conversations: conversations
        .map(normalizeConversationSummary)
        .filter((item) => item && item.storageId && item.threadCount > 0)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)),
      updatedAt: Date.now()
    };
    await writeChrome(INDEX_KEY, value);
    return value;
  }

  async function upsertConversationSummary(summary) {
    const normalized = normalizeConversationSummary(summary);
    if (!normalized) {
      return;
    }
    const index = await readIndex();
    const conversations = index.conversations.filter((item) => item.storageId !== normalized.storageId);
    conversations.push(normalized);
    await writeIndex(conversations);
  }

  async function removeConversationSummary(ref) {
    const conversationRef = normalizeConversationRef(ref);
    const index = await readIndex();
    await writeIndex(index.conversations.filter((item) => item.storageId !== conversationRef.storageId));
  }

  async function rebuildConversationIndex() {
    const values = await readAllChrome();
    const conversations = Object.keys(values)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map((key) => {
        const ref = getConversationRefFromKey(key);
        return ref ? buildConversationSummary(ref, values[key]) : null;
      })
      .filter((summary) => summary && summary.threadCount > 0);
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

  async function getConversation(ref) {
    const conversationRef = normalizeConversationRef(ref);
    const data = await readConversation(conversationRef);
    return {
      ...buildConversationSummary(conversationRef, data),
      meta: data.meta,
      threads: data.threads
    };
  }

  async function listThreads(ref) {
    const data = await readConversation(ref);
    return data.threads || [];
  }

  async function saveThread(thread, conversationMeta = {}) {
    const conversationRef = normalizeConversationRef({
      providerId: thread.sourceProviderId || conversationMeta.providerId || DEFAULT_PROVIDER_ID,
      providerLabel: thread.sourceProviderLabel || conversationMeta.providerLabel || DEFAULT_PROVIDER_LABEL,
      conversationId: thread.sourceConversationId
    });
    const data = await readConversation(conversationRef);
    const threads = data.threads || [];
    const index = threads.findIndex((item) => item.threadId === thread.threadId);
    const nextThread = {
      ...thread,
      sourceProviderId: conversationRef.providerId,
      sourceProviderLabel: conversationRef.providerLabel,
      sourceConversationId: conversationRef.conversationId,
      sourceTitle: conversationMeta.title || thread.sourceTitle || data.meta.title,
      sourceUrl: conversationMeta.url || thread.sourceUrl || data.meta.url,
      updatedAt: Date.now()
    };
    const meta = normalizeConversationMeta(conversationRef, {
      ...data.meta,
      ...conversationMeta,
      providerId: conversationRef.providerId,
      providerLabel: conversationRef.providerLabel,
      conversationId: conversationRef.conversationId,
      updatedAt: nextThread.updatedAt
    }, threads);

    if (index >= 0) {
      threads[index] = nextThread;
    } else {
      threads.push(nextThread);
    }

    await writeConversation(conversationRef, { meta, threads });
    return nextThread;
  }

  async function deleteThread(ref, threadId) {
    const conversationRef = normalizeConversationRef(ref);
    const data = await readConversation(conversationRef);
    const threads = (data.threads || []).filter((thread) => thread.threadId !== threadId);
    if (threads.length === 0) {
      await removeChrome(getStorageKey(conversationRef));
      await removeConversationSummary(conversationRef);
      return [];
    }
    await writeConversation(conversationRef, { meta: data.meta, threads });
    return threads;
  }

  async function deleteConversation(ref) {
    const conversationRef = normalizeConversationRef(ref);
    await removeChrome(getStorageKey(conversationRef));
    await removeConversationSummary(conversationRef);
  }

  function normalizeSettings(settings) {
    const replyStyle = settings && settings.replyStyle || {};
    const customPrompt = String(replyStyle.customPrompt || "").trim();
    const selectedMode = REPLY_STYLE_MODES.has(replyStyle.mode) ? replyStyle.mode : "default";
    const mode = selectedMode === "custom" && !customPrompt ? "default" : selectedMode;
    return {
      replyStyle: {
        mode,
        customPrompt
      },
      theme: normalizeTheme(settings && settings.theme),
      providers: normalizeProviderSettings(settings && settings.providers)
    };
  }

  function normalizeProviderSettings(providers) {
    const normalized = {};
    PROVIDER_IDS.forEach((providerId) => {
      const value = providers && Object.prototype.hasOwnProperty.call(providers, providerId)
        ? providers[providerId]
        : DEFAULT_PROVIDER_ENABLED[providerId];
      normalized[providerId] = Boolean(value);
    });
    return normalized;
  }

  async function getSettings() {
    return normalizeSettings(await readChrome(SETTINGS_KEY));
  }

  async function saveSettings(settings) {
    const nextSettings = normalizeSettings(settings);
    await writeChrome(SETTINGS_KEY, {
      ...nextSettings,
      updatedAt: Date.now()
    });
    return nextSettings;
  }

  async function getReplyStyleSettings() {
    return (await getSettings()).replyStyle;
  }

  async function saveReplyStyleSettings(replyStyle) {
    const current = await getSettings();
    const saved = await saveSettings({
      ...current,
      replyStyle
    });
    return saved.replyStyle;
  }

  function normalizeTheme(theme) {
    if (globalThis.CGQATheme && typeof CGQATheme.normalizeTheme === "function") {
      return CGQATheme.normalizeTheme(theme);
    }
    const value = String(theme || "").trim();
    return THEME_MODES.has(value) ? value : DEFAULT_THEME;
  }

  async function getThemeSettings() {
    return (await getSettings()).theme;
  }

  async function saveThemeSettings(theme) {
    const current = await getSettings();
    const saved = await saveSettings({
      ...current,
      theme
    });
    return saved.theme;
  }

  async function getProviderSettings() {
    return (await getSettings()).providers;
  }

  async function saveProviderSettings(providers) {
    const current = await getSettings();
    const saved = await saveSettings({
      ...current,
      providers: {
        ...current.providers,
        ...providers
      }
    });
    return saved.providers;
  }

  async function isProviderEnabled(providerId) {
    const providers = await getProviderSettings();
    return Boolean(providers && providers[providerId]);
  }

  globalThis.CGQAStorage = {
    listConversations,
    getConversation,
    listThreads,
    saveThread,
    deleteThread,
    deleteConversation,
    rebuildConversationIndex,
    getSettings,
    saveSettings,
    getReplyStyleSettings,
    saveReplyStyleSettings,
    getThemeSettings,
    saveThemeSettings,
    getProviderSettings,
    saveProviderSettings,
    isProviderEnabled
  };
})();
