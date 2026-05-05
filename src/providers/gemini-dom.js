(function () {
  "use strict";

  const MARK_SELECTOR = ".cgqa-quote-mark";
  const CHIP_SELECTOR = ".cgqa-quote-chip";
  const HIDDEN_TURN_CLASS = "cgqa-main-turn-hidden";
  const HIDDEN_COMPOSER_CLASS = "cgqa-composer-hidden";
  const HIDDEN_NATIVE_CONTROL_CLASS = "cgqa-native-control-hidden";
  const TURN_SELECTOR = ".conversation-container";
  const MARKDOWN_SELECTOR = [
    "model-response message-content .markdown",
    "model-response .markdown.markdown-main-panel",
    "model-response .model-response-text .markdown"
  ].join(",");
  const BAD_SELECTION_SELECTOR = [
    ".cgqa-root",
    ".cgqa-selection-menu",
    ".cgqa-toast",
    "model-thoughts",
    ".thoughts-container",
    ".response-footer",
    ".response-container-header",
    ".message-actions",
    ".action-button-container",
    "button",
    "[role='button']"
  ].join(",");
  const COMPLEX_SELECTOR = ".katex, math, pre, code-block, table-block";

  function getConversationId() {
    const match = location.pathname.match(/\/app\/([^/?#]+)/);
    return match ? match[1] : "new-chat";
  }

  function getTurn(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      return null;
    }
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element ? element.closest(TURN_SELECTOR) : null;
  }

  function getAssistantTurn(node) {
    const turn = getTurn(node);
    return turn && getMarkdownNode(turn) ? turn : null;
  }

  function getMarkdownNode(turn) {
    return turn ? turn.querySelector(MARKDOWN_SELECTOR) : null;
  }

  function getMessageNode(turn) {
    return turn ? turn.querySelector("model-response") : null;
  }

  function getUserNode(turn) {
    return turn ? turn.querySelector("user-query") : null;
  }

  function getMessageId(turn) {
    const markdown = getMarkdownNode(turn);
    if (markdown && markdown.id) {
      return markdown.id.replace(/^model-response-message-content/, "");
    }
    const messageContent = turn && turn.querySelector("message-content[id]");
    if (messageContent) {
      return messageContent.id.replace(/^message-content-id-/, "");
    }
    return turn ? turn.id || "" : "";
  }

  function getTurnId(turn) {
    const userBubble = turn && turn.querySelector("[data-turn-id]");
    return turn ? turn.id || userBubble && userBubble.getAttribute("data-turn-id") || "" : "";
  }

  function isInMarkdown(markdown, node) {
    if (!markdown || !node) {
      return false;
    }
    return node.nodeType === Node.TEXT_NODE ? markdown.contains(node) : markdown === node || markdown.contains(node);
  }

  function isInsideComplexContent(node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return Boolean(element && element.closest(COMPLEX_SELECTOR));
  }

  function getInlineCodeAncestor(node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const code = element && element.closest("code");
    return code && !code.closest("pre, code-block") ? code : null;
  }

  function isBadSelectionNode(node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return Boolean(element && element.closest(BAD_SELECTION_SELECTOR));
  }

  function normalizeText(text) {
    return (text || "").replace(/\u00a0/g, " ");
  }

  function getLinearText(root) {
    const walker = createTextWalker(root);
    let text = "";
    let node = walker.nextNode();
    while (node) {
      text += node.nodeValue;
      node = walker.nextNode();
    }
    return normalizeText(text);
  }

  function getReadableText(root) {
    const clone = root.cloneNode(true);
    prepareReadableClone(clone);
    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function prepareReadableClone(root) {
    removeNonContentNodes(root);
    normalizeKatexNodes(root, { keepFallbackText: true });
  }

  function getSanitizedHtml(root) {
    if (!root) {
      return "";
    }

    const clone = root.cloneNode(true);
    prepareSnapshotClone(clone);
    return CGQASanitize.sanitizeMessageHtml(clone.innerHTML);
  }

  function prepareSnapshotClone(root) {
    removeNonContentNodes(root);
    root.querySelectorAll(MARK_SELECTOR).forEach((node) => unwrapElement(node));
    normalizeKatexNodes(root, { keepFallbackText: false });
  }

  function removeNonContentNodes(root) {
    root.querySelectorAll([
      CHIP_SELECTOR,
      "model-thoughts",
      "tts-control",
      "bard-avatar",
      "sources-list",
      "button",
      "svg",
      "mat-icon",
      "script",
      "style",
      "textarea",
      "input",
      "select",
      "[role='button']",
      ".response-footer",
      ".response-container-header",
      ".message-actions",
      ".action-button-container",
      ".code-block-decoration",
      ".table-block-decoration",
      "[data-test-id*='copy']",
      "[data-test-id*='thumb']",
      "[data-test-id*='share']"
    ].join(",")).forEach((node) => node.remove());
  }

  function normalizeKatexNodes(root, options = {}) {
    root.querySelectorAll(".katex").forEach((node) => {
      const annotation = node.querySelector("annotation[encoding='application/x-tex']");
      if (annotation) {
        node.textContent = annotation.textContent || (options.keepFallbackText ? node.textContent || "" : "");
      }
    });
  }

  function unwrapElement(element) {
    const parent = element.parentNode;
    if (!parent) {
      return;
    }
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    element.remove();
  }

  function createTextWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (parent && parent.closest(`${CHIP_SELECTOR}, model-thoughts, button, script, style`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
  }

  function getTextOffset(root, targetNode, targetOffset) {
    if (!root || !targetNode || !isInMarkdown(root, targetNode)) {
      return -1;
    }

    try {
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEnd(targetNode, clampDomOffset(targetNode, targetOffset));
      return getLinearText(range.cloneContents()).length;
    } catch (_error) {
      return -1;
    }
  }

  function clampDomOffset(node, offset) {
    const maxOffset = node.nodeType === Node.TEXT_NODE ? node.nodeValue.length : node.childNodes.length;
    return clampNumber(offset, 0, maxOffset);
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  function getRangeOffsets(root, range) {
    return trimTextOffsets(root, {
      startOffset: getTextOffset(root, range.startContainer, range.startOffset),
      endOffset: getTextOffset(root, range.endContainer, range.endOffset)
    });
  }

  function trimTextOffsets(root, offsets) {
    let startOffset = offsets.startOffset;
    let endOffset = offsets.endOffset;
    if (startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
      return { startOffset, endOffset };
    }

    const text = getLinearText(root);
    startOffset = clampNumber(startOffset, 0, text.length);
    endOffset = clampNumber(endOffset, 0, text.length);

    while (startOffset < endOffset && /\s/.test(text[startOffset] || "")) {
      startOffset += 1;
    }
    while (endOffset > startOffset && /\s/.test(text[endOffset - 1] || "")) {
      endOffset -= 1;
    }

    return { startOffset, endOffset };
  }

  function makeAnchorText(root, startOffset, endOffset) {
    const text = getLinearText(root);
    return {
      exactText: text.slice(startOffset, endOffset),
      prefixText: text.slice(Math.max(0, startOffset - 40), startOffset),
      suffixText: text.slice(endOffset, Math.min(text.length, endOffset + 40))
    };
  }

  function createAnchorFromRange(markdown, range) {
    const offsets = getRangeOffsets(markdown, range);
    if (!isValidTextSpan(offsets)) {
      return null;
    }
    return {
      ...offsets,
      ...makeAnchorText(markdown, offsets.startOffset, offsets.endOffset)
    };
  }

  function isValidTextSpan(offsets) {
    return Boolean(offsets && offsets.startOffset >= 0 && offsets.endOffset > offsets.startOffset);
  }

  function validateSelection(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return { ok: false, reason: "请先选择一段 Gemini 回复正文。" };
    }

    const range = selection.getRangeAt(0);
    const startTurn = getAssistantTurn(range.startContainer);
    const endTurn = getAssistantTurn(range.endContainer);

    if (!startTurn || !endTurn || startTurn !== endTurn) {
      return { ok: false, reason: "暂不支持跨回复提问，请重新选择同一条回复中的内容。" };
    }

    const markdown = getMarkdownNode(startTurn);
    if (!markdown || !isInMarkdown(markdown, range.startContainer) || !isInMarkdown(markdown, range.endContainer)) {
      return { ok: false, reason: "请只选择 Gemini 回复正文，不要选择思考提示或操作按钮。" };
    }

    if (isBadSelectionNode(range.startContainer) || isBadSelectionNode(range.endContainer)) {
      return { ok: false, reason: "请只选择 Gemini 回复正文内容。" };
    }

    const selectedText = normalizeText(selection.toString()).trim();
    if (!selectedText) {
      return { ok: false, reason: "选择内容为空。" };
    }

    const anchor = createAnchorFromRange(markdown, range);
    if (!anchor) {
      return { ok: false, reason: "当前选区结构过于复杂，无法稳定定位。" };
    }

    return {
      ok: true,
      range,
      turn: startTurn,
      markdown,
      selectedText,
      complex: isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer),
      ...anchor
    };
  }

  function findTextPosition(root, offset) {
    const walker = createTextWalker(root);
    let currentOffset = 0;
    let node = walker.nextNode();

    while (node) {
      const nextOffset = currentOffset + node.nodeValue.length;
      if (offset <= nextOffset) {
        return { node, offset: Math.max(0, offset - currentOffset) };
      }
      currentOffset = nextOffset;
      node = walker.nextNode();
    }

    return null;
  }

  function createRangeFromOffsets(root, startOffset, endOffset) {
    const start = findTextPosition(root, startOffset);
    const end = findTextPosition(root, endOffset);
    if (!start || !end) {
      return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }

  function getThreadMarkSelector(threadId) {
    return `${MARK_SELECTOR}[data-thread-id='${CSS.escape(threadId)}']`;
  }

  function getThreadChipSelector(threadId) {
    return `${CHIP_SELECTOR}[data-thread-id='${CSS.escape(threadId)}']`;
  }

  function applyQuotePartDataset(element, thread, options = {}) {
    element.dataset.quoteId = thread.quoteId;
    element.dataset.threadId = thread.threadId;
    element.dataset.displayIndex = String(thread.displayIndex || "");
    if (options.draft) {
      element.dataset.draft = "true";
    }
  }

  function promoteQuotePart(element, thread) {
    delete element.dataset.draft;
    element.dataset.displayIndex = String(thread.displayIndex || "");
  }

  function createMarkElement(thread, blockMode, options = {}) {
    const mark = document.createElement(blockMode ? "div" : "span");
    mark.className = blockMode ? "cgqa-quote-mark cgqa-quote-mark-block" : "cgqa-quote-mark";
    applyQuotePartDataset(mark, thread, options);
    return mark;
  }

  function createChipElement(thread, options = {}) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cgqa-quote-chip";
    applyQuotePartDataset(chip, thread, options);
    chip.textContent = getChipText(thread);
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      globalThis.CGQAApp && globalThis.CGQAApp.openThread(thread.threadId);
    });
    return chip;
  }

  function getChipText(thread) {
    const count = (thread.messages || []).filter((message) => message.role === "user").length;
    return count > 0 ? `提问 ${thread.displayIndex} · ${count}` : `提问 ${thread.displayIndex}`;
  }

  function updateMarkChip(thread) {
    document.querySelectorAll(getThreadChipSelector(thread.threadId)).forEach((chip) => {
      chip.textContent = getChipText(thread);
    });
  }

  function unwrapMark(mark) {
    if (mark.classList.contains("cgqa-quote-mark-block")) {
      mark.remove();
      return;
    }

    const parent = mark.parentNode;
    if (!parent) {
      mark.remove();
      return;
    }

    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    mark.remove();
    parent.normalize();
  }

  function clearRenderedMarks() {
    document.querySelectorAll(CHIP_SELECTOR).forEach((chip) => chip.remove());
    document.querySelectorAll(MARK_SELECTOR).forEach((mark) => unwrapMark(mark));
  }

  function removeThreadMark(threadId) {
    if (!threadId) {
      return;
    }
    document.querySelectorAll(getThreadChipSelector(threadId)).forEach((chip) => chip.remove());
    document.querySelectorAll(getThreadMarkSelector(threadId)).forEach(unwrapMark);
  }

  function promoteThreadMark(thread) {
    const marks = document.querySelectorAll(getThreadMarkSelector(thread.threadId));
    marks.forEach((mark) => promoteQuotePart(mark, thread));
    document.querySelectorAll(getThreadChipSelector(thread.threadId)).forEach((chip) => promoteQuotePart(chip, thread));
    updateMarkChip(thread);
    return marks.length > 0;
  }

  function hasThreadMark(threadId) {
    return Boolean(threadId && document.querySelector(getThreadMarkSelector(threadId)));
  }

  function setActiveMark(threadId) {
    document.querySelectorAll(MARK_SELECTOR).forEach((mark) => {
      mark.classList.toggle("is-active", mark.dataset.threadId === threadId);
    });
  }

  function wrapRange(markdown, range, thread, options = {}) {
    const offsets = getRangeOffsets(markdown, range);
    const slices = offsets.startOffset >= 0 && offsets.endOffset > offsets.startOffset
      ? getTextSlicesByOffsets(markdown, offsets.startOffset, offsets.endOffset)
      : [];
    if (slices.length === 0) {
      return false;
    }

    try {
      for (let index = slices.length - 1; index >= 0; index -= 1) {
        wrapTextSlice(slices[index], thread, index === slices.length - 1, options);
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function getTextSlicesByOffsets(root, startOffset, endOffset) {
    const slices = [];
    const trimmed = trimTextOffsets(root, { startOffset, endOffset });
    startOffset = trimmed.startOffset;
    endOffset = trimmed.endOffset;
    if (startOffset < 0 || endOffset <= startOffset) {
      return slices;
    }

    const walker = createTextWalker(root);
    let currentOffset = 0;
    let node = walker.nextNode();
    while (node) {
      const nextOffset = currentOffset + node.nodeValue.length;
      if (nextOffset > startOffset && currentOffset < endOffset) {
        const start = Math.max(0, startOffset - currentOffset);
        const end = Math.min(node.nodeValue.length, endOffset - currentOffset);
        if (end > start && !/^\s+$/.test(node.nodeValue.slice(start, end))) {
          slices.push({ node, start, end });
        }
      }
      if (nextOffset >= endOffset) {
        break;
      }
      currentOffset = nextOffset;
      node = walker.nextNode();
    }
    return slices;
  }

  function wrapTextSlice(slice, thread, includeChip, options = {}) {
    let selectedNode = slice.node;
    if (slice.end < selectedNode.nodeValue.length) {
      selectedNode.splitText(slice.end);
    }
    if (slice.start > 0) {
      selectedNode = selectedNode.splitText(slice.start);
    }

    const mark = createMarkElement(thread, false, options);
    selectedNode.parentNode.insertBefore(mark, selectedNode);
    mark.insertBefore(selectedNode, mark.firstChild);
    if (includeChip) {
      const anchor = getInlineCodeAncestor(mark) || mark;
      anchor.parentNode.insertBefore(createChipElement(thread, options), anchor.nextSibling);
    }
  }

  function markBlock(markdown, range, thread, options = {}) {
    const complex = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const block = complex ? complex.closest(COMPLEX_SELECTOR) : null;
    if (!block || !markdown.contains(block)) {
      return false;
    }

    const mark = createMarkElement(thread, true, options);
    mark.append(createChipElement(thread, options));
    block.insertAdjacentElement("afterend", mark);
    return true;
  }

  function renderThreadMark(thread) {
    const turn = findTurnForThread(thread);
    const markdown = getMarkdownNode(turn);
    if (!markdown || markdown.querySelector(`${MARK_SELECTOR}[data-thread-id='${CSS.escape(thread.threadId)}']`)) {
      return false;
    }

    const range = resolveAnchorRange(markdown, thread.anchor || {});
    if (!range) {
      return false;
    }
    if (isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer)) {
      return markBlock(markdown, range, thread);
    }
    return wrapRange(markdown, range, thread);
  }

  function renderDraftThreadMark(thread, markdown, range) {
    if (!thread || !markdown || !range || hasThreadMark(thread.threadId)) {
      return false;
    }
    if (isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer)) {
      return markBlock(markdown, range, thread, { draft: true });
    }
    return wrapRange(markdown, range, thread, { draft: true });
  }

  function resolveAnchorRange(markdown, anchor) {
    return findRangeByOffsets(markdown, anchor) || findRangeByContext(markdown, anchor);
  }

  function findRangeByOffsets(markdown, anchor) {
    if (!Number.isInteger(anchor.startOffset) || !Number.isInteger(anchor.endOffset)) {
      return null;
    }
    const trimmed = trimTextOffsets(markdown, {
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset
    });
    if (!isValidTextSpan(trimmed)) {
      return null;
    }
    const exact = getLinearText(markdown).slice(trimmed.startOffset, trimmed.endOffset);
    if (exact !== anchor.exactText) {
      return null;
    }
    return createRangeFromOffsets(markdown, trimmed.startOffset, trimmed.endOffset);
  }

  function findTurnForThread(thread) {
    const anchor = thread.anchor || {};
    const messageId = anchor.sourceMessageId || thread.sourceMessageId || "";
    if (messageId) {
      const id = CSS.escape(messageId);
      const markdown = document.getElementById(`model-response-message-content${messageId}`)
        || document.getElementById(`model-response-message-content${messageId.replace(/^r_/, "")}`)
        || document.getElementById(`message-content-id-${messageId}`)
        || document.querySelector(`[id='model-response-message-content${id}'], [id='message-content-id-${id}']`);
      const turn = markdown && getTurn(markdown);
      if (turn) {
        return turn;
      }
    }

    const turnId = anchor.sourceTurnId || thread.sourceTurnId || "";
    if (turnId) {
      const turn = document.getElementById(turnId)
        || Array.from(document.querySelectorAll(TURN_SELECTOR)).find((item) => {
          return item.querySelector(`[data-turn-id='${CSS.escape(turnId)}']`);
        });
      if (turn) {
        return turn;
      }
    }

    return null;
  }

  function findRangeByContext(markdown, anchor) {
    const text = getLinearText(markdown);
    const exactText = anchor.exactText || "";
    if (!exactText) {
      return null;
    }

    const matches = [];
    let index = text.indexOf(exactText);
    while (index >= 0) {
      const prefix = text.slice(Math.max(0, index - (anchor.prefixText || "").length), index);
      const suffix = text.slice(index + exactText.length, index + exactText.length + (anchor.suffixText || "").length);
      if ((!anchor.prefixText || prefix === anchor.prefixText) && (!anchor.suffixText || suffix === anchor.suffixText)) {
        matches.push(index);
      }
      index = text.indexOf(exactText, index + 1);
    }

    return matches.length === 1 ? createRangeFromOffsets(markdown, matches[0], matches[0] + exactText.length) : null;
  }

  function getAllTurns() {
    return Array.from(document.querySelectorAll(TURN_SELECTOR)).filter((turn) => getUserNode(turn) || getMessageNode(turn));
  }

  function getUserText(turn) {
    const query = turn && turn.querySelector(".query-text");
    return query ? getReadableText(query).replace(/^你说\s*/, "").trim() : "";
  }

  function getAssistantText(turn) {
    const markdown = getMarkdownNode(turn);
    return markdown ? getReadableText(markdown).trim() : "";
  }

  function getAllTurnRecords() {
    const records = [];
    getAllTurns().forEach((turn) => {
      const user = getUserNode(turn);
      if (user) {
        records.push({
          index: records.length,
          turn,
          role: "user",
          turnId: getTurnId(turn),
          messageId: getTurnId(turn),
          text: getUserText(turn),
          html: "",
          contentFormat: "text"
        });
      }
      const markdown = getMarkdownNode(turn);
      if (markdown) {
        records.push({
          index: records.length,
          turn,
          role: "assistant",
          turnId: getTurnId(turn),
          messageId: getMessageId(turn),
          text: getAssistantText(turn),
          html: getSanitizedHtml(markdown),
          contentFormat: "html"
        });
      }
    });
    return records.filter((record) => record.role && record.turn);
  }

  function getAssistantMessageRecords() {
    return getAllTurns().map((turn, index) => {
      const markdown = getMarkdownNode(turn);
      return markdown ? {
        index,
        turn,
        turnId: getTurnId(turn),
        messageId: getMessageId(turn),
        text: getAssistantText(turn),
        html: getSanitizedHtml(markdown),
        contentFormat: "html"
      } : null;
    }).filter((record) => record && (record.messageId || record.text));
  }

  function syncHiddenMainTurns(targets) {
    const normalizedTargets = normalizeHiddenTargets(targets);
    const records = getAllTurnRecords();
    const turnsToDecorate = new Map();

    records.forEach((record, index) => {
      if (record.role !== "user" || !record.text) {
        return;
      }
      const target = findHideTargetForText(record.text, normalizedTargets);
      if (!target) {
        return;
      }
      turnsToDecorate.set(record.turn, target);
      const assistantRecord = findNextAssistantRecord(records, index);
      if (assistantRecord) {
        turnsToDecorate.set(assistantRecord.turn, target);
      }
    });

    document.querySelectorAll(`.${HIDDEN_TURN_CLASS}`).forEach((turn) => {
      if (!turnsToDecorate.has(turn)) {
        unhideMainTurn(turn);
      }
    });
    turnsToDecorate.forEach((target, turn) => {
      if (target.unload) {
        removeMainTurn(turn);
        return;
      }
      hideMainTurn(turn, target);
    });
  }

  function normalizeHiddenTargets(targets) {
    const seen = new Set();
    return (Array.isArray(targets) ? targets : []).map((target) => {
      const value = target && typeof target === "object" ? target : {};
      return { ...value, unload: Boolean(value.unload) };
    }).filter((target) => {
      if (!target.promptToken || seen.has(target.promptToken)) {
        return false;
      }
      seen.add(target.promptToken);
      return true;
    });
  }

  function findHideTargetForText(text, targets) {
    return targets.find((target) => text.includes(target.promptToken)) || null;
  }

  function findNextAssistantRecord(records, startIndex) {
    for (let index = startIndex + 1; index < records.length; index += 1) {
      if (records[index].role === "assistant") {
        return records[index];
      }
      if (records[index].role === "user") {
        return null;
      }
    }
    return null;
  }

  function hideMainTurn(turn, target) {
    turn.classList.add(HIDDEN_TURN_CLASS);
    turn.dataset.cgqaHiddenThreadId = target.threadId || "";
    turn.dataset.cgqaHiddenPromptToken = target.promptToken || "";
  }

  function removeMainTurn(turn) {
    if (!turn || turn.closest(".cgqa-root")) {
      return;
    }
    turn.remove();
  }

  function unhideMainTurn(turn) {
    turn.classList.remove(HIDDEN_TURN_CLASS);
    delete turn.dataset.cgqaHiddenThreadId;
    delete turn.dataset.cgqaHiddenPromptToken;
  }

  function getPromptEditor() {
    return document.querySelector("rich-textarea .ql-editor[contenteditable='true'][role='textbox']")
      || document.querySelector(".ql-editor[contenteditable='true'][aria-label*='Gemini']");
  }

  function getComposerContainer() {
    const editor = getPromptEditor();
    return editor && editor.closest("input-area-v2, .text-input-field, .input-area-container")
      || document.querySelector("input-area-v2")
      || null;
  }

  function setMainComposerHidden(hidden) {
    const composer = hidden ? getComposerContainer() : null;
    document.querySelectorAll(`.${HIDDEN_COMPOSER_CLASS}`).forEach((node) => {
      if (!hidden || node !== composer) {
        node.classList.remove(HIDDEN_COMPOSER_CLASS);
        delete node.dataset.cgqaComposerHidden;
      }
    });
    if (!hidden || !composer || composer.closest(".cgqa-root")) {
      return;
    }
    composer.classList.add(HIDDEN_COMPOSER_CLASS);
    composer.dataset.cgqaComposerHidden = "true";
  }

  function setNativeGenerationControlsHidden(hidden) {
    document.querySelectorAll(`.${HIDDEN_NATIVE_CONTROL_CLASS}`).forEach(unhideNativeGenerationControl);
    if (!hidden) {
      return;
    }
    getNativeGenerationControlCandidates().forEach(hideNativeGenerationControl);
  }

  function getNativeGenerationControlCandidates() {
    return Array.from(document.querySelectorAll("button, [role='button']")).filter((node) => {
      if (node.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-toast")) {
        return false;
      }
      return /停止|stop/.test(getNodeControlText(node));
    });
  }

  function getNodeControlText(node) {
    return [
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || "",
      node.textContent || ""
    ].join(" ").toLowerCase();
  }

  function hideNativeGenerationControl(node) {
    node.classList.add(HIDDEN_NATIVE_CONTROL_CLASS);
    node.dataset.cgqaNativeControlHidden = "true";
  }

  function unhideNativeGenerationControl(node) {
    node.classList.remove(HIDDEN_NATIVE_CONTROL_CLASS);
    delete node.dataset.cgqaNativeControlHidden;
  }

  function getPromptText() {
    const editor = getPromptEditor();
    return editor ? normalizeText(editor.innerText || editor.textContent || "").trim() : "";
  }

  function setPromptText(text) {
    const editor = getPromptEditor();
    if (!editor) {
      return false;
    }

    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand && document.execCommand("insertText", false, text);
    if (!inserted) {
      editor.textContent = text;
    }
    editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  function findSendButton() {
    const composer = getComposerContainer() || document;
    const preferred = composer.querySelector("button.send-button.submit[aria-label*='发送'], button[aria-label*='发送'].send-button");
    if (preferred && isSendButtonEnabled(preferred)) {
      return preferred;
    }
    return Array.from(composer.querySelectorAll("button")).find((button) => {
      return /发送|send/i.test(`${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`) && isSendButtonEnabled(button);
    }) || null;
  }

  function isSendButtonEnabled(button) {
    return Boolean(button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.tabIndex !== -1);
  }

  async function waitForSendButton() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2500) {
      const button = findSendButton();
      if (button) {
        return button;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function submitPrompt(text) {
    if (!setPromptText(text)) {
      throw new Error("找不到 Gemini 主输入框。");
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    const initialUserTurnCount = getUserTurnCount();
    const button = await waitForSendButton();
    if (button) {
      clickElement(button);
      if (await waitForSubmissionStarted(initialUserTurnCount, text, 4200)) {
        blurActiveElement();
        return;
      }
    }

    pressEnterOnPrompt();
    if (await waitForSubmissionStarted(initialUserTurnCount, text, 2200)) {
      blurActiveElement();
      return;
    }

    throw new Error("无法触发 Gemini 发送，请手动点击主输入框发送按钮。");
  }

  function getUserTurnCount() {
    return getAllTurnRecords().filter((record) => record.role === "user").length;
  }

  function clickElement(element) {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    element.dispatchEvent(new PointerEvent("pointerover", { ...eventInit, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseover", eventInit));
    element.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));
  }

  function pressEnterOnPrompt() {
    const editor = getPromptEditor();
    if (!editor) {
      return;
    }
    editor.focus();
    const eventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    editor.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    editor.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    editor.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  async function waitForSubmissionStarted(initialUserTurnCount, promptText, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (hasSubmissionStarted(initialUserTurnCount, promptText)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  function hasSubmissionStarted(initialUserTurnCount, promptText) {
    if (getUserTurnCount() > initialUserTurnCount || getPromptText() === "") {
      return true;
    }
    const trackingToken = extractTrackingToken(promptText);
    return Boolean(trackingToken && getAllTurnRecords().some((record) => {
      return record.role === "user" && record.text.includes(trackingToken);
    }));
  }

  function extractTrackingToken(text) {
    const match = String(text || "").match(/\bCGQA_PROMPT:[\w:-]+/);
    return match ? match[0] : "";
  }

  function blurActiveElement() {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === "function") {
      active.blur();
    }
  }

  globalThis.CGQAGeminiDom = {
    validateSelection,
    getConversationId,
    getTurnId,
    getMessageId,
    renderThreadMark,
    renderDraftThreadMark,
    clearRenderedMarks,
    removeThreadMark,
    promoteThreadMark,
    setActiveMark,
    updateMarkChip,
    getAllTurnRecords,
    getAssistantMessageRecords,
    syncHiddenMainTurns,
    setMainComposerHidden,
    setNativeGenerationControlsHidden,
    submitPrompt
  };
})();
