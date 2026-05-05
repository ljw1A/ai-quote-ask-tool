(function () {
  "use strict";

  const PROVIDER_ID = "chatgpt";
  const PROVIDER_LABEL = "ChatGPT";

  function matchesLocation(locationObject = location) {
    return /(^|\.)chatgpt\.com$/i.test(locationObject.hostname)
      || /(^|\.)chat\.openai\.com$/i.test(locationObject.hostname);
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
      setMainComposerHidden: CGQAChatGPTDom.setMainComposerHidden,
      setNativeGenerationControlsHidden: CGQAChatGPTDom.setNativeGenerationControlsHidden,
      syncPendingResponseState: CGQAChatGPTDom.syncPendingResponseState,
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
