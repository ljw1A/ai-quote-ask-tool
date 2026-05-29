(function () {
  "use strict";

  const PROVIDER_ID = "chatgpt";
  const PROVIDER_LABEL = "ChatGPT";

  function matchesLocation(locationObject = location) {
    return isChatGPTHost(locationObject.hostname) && isSupportedConversationPath(locationObject.pathname);
  }

  function isChatGPTHost(hostname) {
    return /(^|\.)chatgpt\.com$/i.test(hostname)
      || /(^|\.)chat\.openai\.com$/i.test(hostname);
  }

  function isSupportedConversationPath(pathname) {
    return /^\/c(?:\/|$)/.test(pathname) || /^\/g(?:\/|$)/.test(pathname);
  }

  function getConversationMeta() {
    const conversationId = CGQAChatGPTDom.getConversationId();
    const title = String(document.title || "").replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim();
    return {
      providerId: PROVIDER_ID,
      providerLabel: PROVIDER_LABEL,
      conversationId,
      title: title || getFallbackTitle(conversationId),
      url: location.href
    };
  }

  function getFallbackTitle(conversationId) {
    if (!conversationId || conversationId === "new-chat") {
      return "新会话";
    }
    return `会话 ${conversationId.slice(0, 8)}`;
  }

  function createChatGPTProvider() {
    if (!globalThis.CGQAChatGPTDom) {
      return null;
    }

    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      matchesLocation,
      getConversationId: CGQAChatGPTDom.getConversationId,
      getConversationMeta,
      validateSelection: CGQAChatGPTDom.validateSelection,
      attachSelectionAction: CGQAChatGPTDom.attachSelectionAction,
      getTurnId: CGQAChatGPTDom.getTurnId,
      getMessageId: CGQAChatGPTDom.getMessageId,
      renderThreadMark: CGQAChatGPTDom.renderThreadMark,
      renderDraftThreadMark: CGQAChatGPTDom.renderDraftThreadMark,
      clearRenderedMarks: CGQAChatGPTDom.clearRenderedMarks,
      removeThreadMark: CGQAChatGPTDom.removeThreadMark,
      promoteThreadMark: CGQAChatGPTDom.promoteThreadMark,
      setActiveMark: CGQAChatGPTDom.setActiveMark,
      updateMarkChip: CGQAChatGPTDom.updateMarkChip,
      getAllTurnRecords: CGQAChatGPTDom.getAllTurnRecords,
      getAssistantMessageRecords: CGQAChatGPTDom.getAssistantMessageRecords,
      syncHiddenMainTurns: CGQAChatGPTDom.syncHiddenMainTurns,
      syncKnownHiddenMainTurns: CGQAChatGPTDom.syncKnownHiddenMainTurns,
      setMainComposerHidden: CGQAChatGPTDom.setMainComposerHidden,
      setNativeGenerationControlsHidden: CGQAChatGPTDom.setNativeGenerationControlsHidden,
      syncPendingResponseState: CGQAChatGPTDom.syncPendingResponseState,
      isResponseGenerating: CGQAChatGPTDom.isResponseGenerating,
      stopGeneration: CGQAChatGPTDom.stopGeneration,
      getScrollContainer: CGQAChatGPTDom.getScrollContainer,
      submitPrompt: CGQAChatGPTDom.submitPrompt
    };
  }

  const provider = createChatGPTProvider();
  if (!provider) {
    return;
  }

  globalThis.CGQAProviders = Array.isArray(globalThis.CGQAProviders) ? globalThis.CGQAProviders : [];
  globalThis.CGQAProviders.push(provider);
})();
