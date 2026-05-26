(function () {
  "use strict";

  const PROVIDER_ID = "gemini";
  const PROVIDER_LABEL = "Gemini";

  function matchesLocation(locationObject = location) {
    return isGeminiHost(locationObject.hostname) && isSupportedConversationPath(locationObject.pathname);
  }

  function isGeminiHost(hostname) {
    return /(^|\.)gemini\.google\.com$/i.test(hostname);
  }

  function isSupportedConversationPath(pathname) {
    return /^\/app(?:\/|$)/.test(pathname);
  }

  function getConversationMeta() {
    const conversationId = CGQAGeminiDom.getConversationId();
    const title = String(document.title || "").replace(/\s*[-|]\s*Gemini\s*$/i, "").trim();
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

  function createGeminiProvider() {
    if (!globalThis.CGQAGeminiDom) {
      return null;
    }

    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      matchesLocation,
      getConversationId: CGQAGeminiDom.getConversationId,
      getConversationMeta,
      validateSelection: CGQAGeminiDom.validateSelection,
      getTurnId: CGQAGeminiDom.getTurnId,
      getMessageId: CGQAGeminiDom.getMessageId,
      renderThreadMark: CGQAGeminiDom.renderThreadMark,
      renderDraftThreadMark: CGQAGeminiDom.renderDraftThreadMark,
      clearRenderedMarks: CGQAGeminiDom.clearRenderedMarks,
      removeThreadMark: CGQAGeminiDom.removeThreadMark,
      promoteThreadMark: CGQAGeminiDom.promoteThreadMark,
      setActiveMark: CGQAGeminiDom.setActiveMark,
      updateMarkChip: CGQAGeminiDom.updateMarkChip,
      getAllTurnRecords: CGQAGeminiDom.getAllTurnRecords,
      getAssistantMessageRecords: CGQAGeminiDom.getAssistantMessageRecords,
      syncHiddenMainTurns: CGQAGeminiDom.syncHiddenMainTurns,
      syncKnownHiddenMainTurns: CGQAGeminiDom.syncKnownHiddenMainTurns,
      setMainComposerHidden: CGQAGeminiDom.setMainComposerHidden,
      setNativeGenerationControlsHidden: CGQAGeminiDom.setNativeGenerationControlsHidden,
      syncPendingResponseState: CGQAGeminiDom.syncPendingResponseState,
      isResponseGenerating: CGQAGeminiDom.isResponseGenerating,
      completePendingResponse: CGQAGeminiDom.completePendingResponse,
      getScrollContainer: CGQAGeminiDom.getScrollContainer,
      submitPrompt: CGQAGeminiDom.submitPrompt
    };
  }

  const provider = createGeminiProvider();
  if (!provider) {
    return;
  }

  globalThis.CGQAProviders = Array.isArray(globalThis.CGQAProviders) ? globalThis.CGQAProviders : [];
  globalThis.CGQAProviders.push(provider);
})();
