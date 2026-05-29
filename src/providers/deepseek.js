(function () {
  "use strict";

  const PROVIDER_ID = "deepseek";
  const PROVIDER_LABEL = "DeepSeek";

  function matchesLocation(locationObject = location) {
    return isDeepSeekHost(locationObject.hostname) && isSupportedConversationPath(locationObject.pathname);
  }

  function isDeepSeekHost(hostname) {
    return /(^|\.)chat\.deepseek\.com$/i.test(hostname);
  }

  function isSupportedConversationPath(pathname) {
    return /^\/a\/chat\/s\/[^/]+(?:\/|$)/.test(pathname);
  }

  function getConversationMeta() {
    const conversationId = CGQADeepSeekDom.getConversationId();
    const title = String(document.title || "").replace(/\s*[-|]\s*DeepSeek\s*$/i, "").trim();
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

  function createDeepSeekProvider() {
    if (!globalThis.CGQADeepSeekDom) {
      return null;
    }

    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      matchesLocation,
      getConversationId: CGQADeepSeekDom.getConversationId,
      getConversationMeta,
      validateSelection: CGQADeepSeekDom.validateSelection,
      getTurnId: CGQADeepSeekDom.getTurnId,
      getMessageId: CGQADeepSeekDom.getMessageId,
      renderThreadMark: CGQADeepSeekDom.renderThreadMark,
      renderDraftThreadMark: CGQADeepSeekDom.renderDraftThreadMark,
      clearRenderedMarks: CGQADeepSeekDom.clearRenderedMarks,
      removeThreadMark: CGQADeepSeekDom.removeThreadMark,
      promoteThreadMark: CGQADeepSeekDom.promoteThreadMark,
      setActiveMark: CGQADeepSeekDom.setActiveMark,
      updateMarkChip: CGQADeepSeekDom.updateMarkChip,
      getAllTurnRecords: CGQADeepSeekDom.getAllTurnRecords,
      getAssistantMessageRecords: CGQADeepSeekDom.getAssistantMessageRecords,
      syncHiddenMainTurns: CGQADeepSeekDom.syncHiddenMainTurns,
      syncKnownHiddenMainTurns: CGQADeepSeekDom.syncKnownHiddenMainTurns,
      setMainComposerHidden: CGQADeepSeekDom.setMainComposerHidden,
      setNativeGenerationControlsHidden: CGQADeepSeekDom.setNativeGenerationControlsHidden,
      syncPendingResponseState: CGQADeepSeekDom.syncPendingResponseState,
      isResponseGenerating: CGQADeepSeekDom.isResponseGenerating,
      stopGeneration: CGQADeepSeekDom.stopGeneration,
      completePendingResponse: CGQADeepSeekDom.completePendingResponse,
      getScrollContainer: CGQADeepSeekDom.getScrollContainer,
      submitPrompt: CGQADeepSeekDom.submitPrompt
    };
  }

  const provider = createDeepSeekProvider();
  if (!provider) {
    return;
  }

  globalThis.CGQAProviders = Array.isArray(globalThis.CGQAProviders) ? globalThis.CGQAProviders : [];
  globalThis.CGQAProviders.push(provider);
})();
