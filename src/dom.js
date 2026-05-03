(function () {
  "use strict";

  const MARK_SELECTOR = ".cgqa-quote-mark";
  const CHIP_SELECTOR = ".cgqa-quote-chip";
  const HIDDEN_TURN_CLASS = "cgqa-main-turn-hidden";
  const HIDDEN_COMPOSER_CLASS = "cgqa-composer-hidden";
  const HIDDEN_NATIVE_CONTROL_CLASS = "cgqa-native-control-hidden";
  const BAD_SELECTION_SELECTOR = [
    ".cgqa-root",
    ".cgqa-selection-menu",
    ".cgqa-toast",
    "button[disabled]",
    "[aria-label='回复操作']",
    "[aria-label='你的消息操作']"
  ].join(",");
  const COMPLEX_SELECTOR = ".katex, math, pre, code, .cm-editor, .cm-content";
  const TURN_SELECTOR = [
    "section[data-turn]",
    "[data-testid^='conversation-turn-'][data-turn]",
    "[data-message-author-role]"
  ].join(",");
  const SNAPSHOT_ALLOWED_TAGS = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul"
  ]);

  function getConversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : "new-chat";
  }

  function getTurn(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      return null;
    }
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) {
      return null;
    }

    const message = element.closest("[data-message-author-role]");
    if (message) {
      return message.closest("section[data-turn], [data-testid^='conversation-turn-']") || message;
    }

    return element.closest(TURN_SELECTOR);
  }

  function getAssistantTurn(node) {
    const turn = getTurn(node);
    if (!turn) {
      return null;
    }
    if (turn.getAttribute("data-turn") === "assistant") {
      return turn;
    }
    const message = turn.matches("[data-message-author-role]")
      ? turn
      : turn.querySelector("[data-message-author-role]");
    return message && message.getAttribute("data-message-author-role") === "assistant" ? turn : null;
  }

  function getTurnRole(turn) {
    if (!turn) {
      return "";
    }
    const explicitRole = turn.getAttribute("data-turn");
    if (explicitRole === "assistant" || explicitRole === "user") {
      return explicitRole;
    }
    const message = turn.matches("[data-message-author-role]")
      ? turn
      : turn.querySelector("[data-message-author-role]");
    return message ? message.getAttribute("data-message-author-role") || "" : "";
  }

  function getMessageNodeByRole(turn, role) {
    if (!turn || !role) {
      return null;
    }
    if (turn.matches(`[data-message-author-role='${role}']`)) {
      return turn;
    }
    return turn.querySelector(`[data-message-author-role='${role}']`);
  }

  function getMessageNode(turn) {
    if (!turn) {
      return null;
    }
    if (turn.matches("[data-message-author-role='assistant']")) {
      return turn;
    }
    return turn.querySelector("[data-message-author-role='assistant']");
  }

  function getMarkdownNode(turn) {
    const message = getMessageNode(turn);
    if (!message) {
      return null;
    }
    return message.querySelector(".markdown.prose, .markdown-new-styling, .markdown") || message;
  }

  function getMessageId(turn) {
    const message = getMessageNode(turn);
    return message ? message.getAttribute("data-message-id") : "";
  }

  function getTurnId(turn) {
    return turn ? turn.getAttribute("data-turn-id") || turn.getAttribute("data-testid") || "" : "";
  }

  function isInMarkdown(markdown, node) {
    if (!markdown || !node) {
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return markdown.contains(node);
    }
    return markdown === node || markdown.contains(node);
  }

  function isInsideComplexContent(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return Boolean(element && element.closest(COMPLEX_SELECTOR));
  }

  function isBadSelectionNode(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
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
    return sanitizeMessageHtml(Array.from(clone.childNodes).map((node) => {
      const container = document.createElement("div");
      appendSanitizedNode(container, node);
      return container.innerHTML;
    }).join(""));
  }

  function prepareSnapshotClone(root) {
    removeNonContentNodes(root);
    root.querySelectorAll(MARK_SELECTOR).forEach((node) => unwrapElement(node));
    normalizeKatexNodes(root, { keepFallbackText: false });
  }

  function removeNonContentNodes(root) {
    root.querySelectorAll([
      CHIP_SELECTOR,
      "button",
      "svg",
      "script",
      "style",
      "textarea",
      "input",
      "select",
      "[role='button']",
      "[aria-label='回复操作']",
      "[aria-label='你的消息操作']",
      "[data-testid*='copy']",
      "[data-testid*='feedback']",
      "[data-testid*='share']"
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

  function sanitizeMessageHtml(html) {
    if (!html) {
      return "";
    }

    const template = document.createElement("template");
    template.innerHTML = String(html);
    const container = document.createElement("div");
    Array.from(template.content.childNodes).forEach((node) => appendSanitizedNode(container, node));
    return container.innerHTML.trim();
  }

  function appendSanitizedNode(parent, sourceNode) {
    const sanitized = sanitizeSnapshotNode(sourceNode);
    if (sanitized) {
      parent.append(sanitized);
    }
  }

  function sanitizeSnapshotNode(sourceNode) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(sourceNode.nodeValue || "");
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const tagName = sourceNode.tagName.toLowerCase();
    if (!SNAPSHOT_ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      Array.from(sourceNode.childNodes).forEach((child) => appendSanitizedNode(fragment, child));
      return fragment;
    }

    const element = document.createElement(tagName);
    copySafeSnapshotAttributes(sourceNode, element, tagName);
    Array.from(sourceNode.childNodes).forEach((child) => appendSanitizedNode(element, child));
    return element;
  }

  function copySafeSnapshotAttributes(sourceNode, targetNode, tagName) {
    if (tagName === "a") {
      const href = sourceNode.getAttribute("href") || "";
      if (isSafeLinkHref(href)) {
        targetNode.setAttribute("href", href);
        targetNode.setAttribute("target", "_blank");
        targetNode.setAttribute("rel", "noopener noreferrer");
      }
      const title = sourceNode.getAttribute("title");
      if (title) {
        targetNode.setAttribute("title", title);
      }
    }

    if (tagName === "code") {
      const className = getSafeCodeClass(sourceNode.getAttribute("class") || "");
      if (className) {
        targetNode.setAttribute("class", className);
      }
    }

    if (tagName === "td" || tagName === "th") {
      copyPositiveIntegerAttribute(sourceNode, targetNode, "colspan");
      copyPositiveIntegerAttribute(sourceNode, targetNode, "rowspan");
    }

    if (tagName === "ol") {
      copyPositiveIntegerAttribute(sourceNode, targetNode, "start");
    }
  }

  function isSafeLinkHref(href) {
    return /^(https?:|mailto:)/i.test(href);
  }

  function getSafeCodeClass(className) {
    const safeClasses = className.split(/\s+/).filter((name) => /^language-[\w-]+$/.test(name));
    return safeClasses.join(" ");
  }

  function copyPositiveIntegerAttribute(sourceNode, targetNode, attributeName) {
    const value = sourceNode.getAttribute(attributeName);
    if (/^[1-9]\d{0,2}$/.test(value || "")) {
      targetNode.setAttribute(attributeName, value);
    }
  }

  function createTextWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (parent && parent.closest(".cgqa-quote-chip")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!parent && node.parentNode !== root) {
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
    const maxOffset = node.nodeType === Node.TEXT_NODE
      ? node.nodeValue.length
      : node.childNodes.length;
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

    while (startOffset < endOffset && isBoundaryWhitespace(text[startOffset])) {
      startOffset += 1;
    }
    while (endOffset > startOffset && isBoundaryWhitespace(text[endOffset - 1])) {
      endOffset -= 1;
    }

    return { startOffset, endOffset };
  }

  function isBoundaryWhitespace(character) {
    return /\s/.test(character || "");
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
      return { ok: false, reason: "请先选择一段 ChatGPT 回复正文。" };
    }

    const range = selection.getRangeAt(0);
    const startTurn = getAssistantTurn(range.startContainer);
    const endTurn = getAssistantTurn(range.endContainer);

    if (!startTurn || !endTurn || startTurn !== endTurn) {
      return { ok: false, reason: "暂不支持跨回复提问，请重新选择同一条回复中的内容。" };
    }

    const markdown = getMarkdownNode(startTurn);
    if (!markdown || !isInMarkdown(markdown, range.startContainer) || !isInMarkdown(markdown, range.endContainer)) {
      return { ok: false, reason: "请只选择 ChatGPT 回复正文，不要选择思考提示或操作按钮。" };
    }

    if (isBadSelectionNode(range.startContainer) || isBadSelectionNode(range.endContainer)) {
      return { ok: false, reason: "请只选择 ChatGPT 回复正文内容。" };
    }

    const selectedText = normalizeText(selection.toString()).trim();
    if (!selectedText) {
      return { ok: false, reason: "选择内容为空。" };
    }

    const anchor = createAnchorFromRange(markdown, range);
    if (!anchor) {
      return { ok: false, reason: "当前选区结构过于复杂，无法稳定定位。" };
    }

    const complex = isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer);

    return {
      ok: true,
      range,
      turn: startTurn,
      markdown,
      selectedText,
      complex,
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
      const child = mark.firstChild;
      parent.insertBefore(child, mark);
    }
    mark.remove();
    parent.normalize();
  }

  function clearRenderedMarks() {
    document.querySelectorAll(CHIP_SELECTOR).forEach((chip) => {
      chip.remove();
    });
    document.querySelectorAll(MARK_SELECTOR).forEach((mark) => {
      unwrapMark(mark);
    });
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
        if (end > start && !isWhitespaceOnly(node.nodeValue.slice(start, end))) {
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

  function isWhitespaceOnly(text) {
    return !text || /^\s+$/.test(text);
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
      mark.parentNode.insertBefore(createChipElement(thread, options), mark.nextSibling);
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
    const offsetRange = findRangeByOffsets(markdown, anchor);
    return offsetRange || findRangeByContext(markdown, anchor);
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
    const messageId = CSS.escape(anchor.sourceMessageId || thread.sourceMessageId || "");
    if (messageId) {
      const message = document.querySelector(`[data-message-author-role='assistant'][data-message-id='${messageId}']`);
      if (message) {
        return getAssistantTurn(message);
      }
    }

    const turnId = anchor.sourceTurnId || thread.sourceTurnId || "";
    if (turnId) {
      const turn = Array.from(document.querySelectorAll("section[data-turn='assistant'], [data-message-author-role='assistant']")).find((item) => {
        return item.getAttribute("data-turn-id") === turnId || item.getAttribute("data-testid") === turnId;
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

    if (matches.length !== 1) {
      return null;
    }

    return createRangeFromOffsets(markdown, matches[0], matches[0] + exactText.length);
  }

  function getAllTurns() {
    const sectionTurns = Array.from(document.querySelectorAll("section[data-testid^='conversation-turn-'][data-turn], section[data-turn]"));
    const messageTurns = Array.from(document.querySelectorAll("[data-message-author-role='user'], [data-message-author-role='assistant']"))
      .map(getTurnContainerForMessageNode);
    return sortElementsByDocumentOrder(uniqueElements([...sectionTurns, ...messageTurns]));
  }

  function getTurnText(turn) {
    const role = getTurnRole(turn);
    const message = getMessageNodeByRole(turn, role) || turn;
    if (role === "assistant") {
      const markdown = getMarkdownNode(turn);
      return markdown ? getReadableText(markdown).trim() : getReadableText(message).trim();
    }
    return getReadableText(message).trim();
  }

  function getAllTurnRecords() {
    return getAllTurns().map((turn, index) => {
      const role = getTurnRole(turn);
      const message = getMessageNodeByRole(turn, role);
      const markdown = role === "assistant" ? getMarkdownNode(turn) : null;
      return {
        index,
        turn,
        role,
        turnId: getTurnId(turn),
        messageId: message ? message.getAttribute("data-message-id") || "" : "",
        text: getTurnText(turn),
        html: markdown ? getSanitizedHtml(markdown) : "",
        contentFormat: markdown ? "html" : "text"
      };
    }).filter((record) => record.role && record.turn);
  }

  function getAssistantTurns() {
    const sectionTurns = Array.from(document.querySelectorAll("section[data-turn='assistant']"));
    const messageTurns = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"))
      .map(getTurnContainerForMessageNode);
    return sortElementsByDocumentOrder(uniqueElements([...sectionTurns, ...messageTurns]));
  }

  function getUserTurnCount() {
    return getAllTurns().filter((turn) => getTurnRole(turn) === "user").length;
  }

  function getTurnContainerForMessageNode(node) {
    return node.closest("section[data-turn], section[data-testid^='conversation-turn-'], [data-testid^='conversation-turn-']")
      || node;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function sortElementsByDocumentOrder(elements) {
    return elements.sort((a, b) => {
      if (a === b) {
        return 0;
      }
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
  }

  function getAssistantMessageRecords() {
    return getAssistantTurns().map((turn, index) => {
      const message = getMessageNode(turn);
      const markdown = getMarkdownNode(turn);
      const text = markdown ? getReadableText(markdown).trim() : "";
      const html = markdown ? getSanitizedHtml(markdown) : "";
      return {
        index,
        turn,
        turnId: getTurnId(turn),
        messageId: message ? message.getAttribute("data-message-id") || "" : "",
        text,
        html,
        contentFormat: html ? "html" : "text"
      };
    }).filter((record) => record.messageId || record.text);
  }

  function syncHiddenMainTurns(targets) {
    const normalizedTargets = normalizeHiddenTargets(targets);
    const records = getAllTurnRecords();
    const turnsToHide = new Map();

    records.forEach((record, index) => {
      if (record.role !== "user" || !record.text) {
        return;
      }

      const target = findHideTargetForText(record.text, normalizedTargets);
      if (!target) {
        return;
      }

      turnsToHide.set(record.turn, target);
      const assistantRecord = findNextAssistantRecord(records, index);
      if (assistantRecord) {
        turnsToHide.set(assistantRecord.turn, target);
      }
    });

    document.querySelectorAll(`.${HIDDEN_TURN_CLASS}`).forEach((turn) => {
      if (!turnsToHide.has(turn)) {
        unhideMainTurn(turn);
      }
    });

    turnsToHide.forEach((target, turn) => hideMainTurn(turn, target));
  }

  function normalizeHiddenTargets(targets) {
    const seen = new Set();
    return (Array.isArray(targets) ? targets : []).filter((target) => {
      const promptToken = target && target.promptToken;
      if (!promptToken || seen.has(promptToken)) {
        return false;
      }
      seen.add(promptToken);
      return true;
    });
  }

  function findHideTargetForText(text, targets) {
    return targets.find((target) => text.includes(target.promptToken)) || null;
  }

  function findNextAssistantRecord(records, startIndex) {
    for (let index = startIndex + 1; index < records.length; index += 1) {
      const record = records[index];
      if (record.role === "assistant") {
        return record;
      }
      if (record.role === "user") {
        return null;
      }
    }
    return null;
  }

  function hideMainTurn(turn, target) {
    if (!turn.classList.contains(HIDDEN_TURN_CLASS)) {
      turn.classList.add(HIDDEN_TURN_CLASS);
    }
    if (turn.dataset.cgqaHiddenThreadId !== (target.threadId || "")) {
      turn.dataset.cgqaHiddenThreadId = target.threadId || "";
    }
    if (turn.dataset.cgqaHiddenPromptToken !== (target.promptToken || "")) {
      turn.dataset.cgqaHiddenPromptToken = target.promptToken || "";
    }
  }

  function unhideMainTurn(turn) {
    if (turn.classList.contains(HIDDEN_TURN_CLASS)) {
      turn.classList.remove(HIDDEN_TURN_CLASS);
    }
    if (turn.dataset.cgqaHiddenThreadId !== undefined) {
      delete turn.dataset.cgqaHiddenThreadId;
    }
    if (turn.dataset.cgqaHiddenPromptToken !== undefined) {
      delete turn.dataset.cgqaHiddenPromptToken;
    }
  }

  function getPromptEditor() {
    return document.querySelector("#prompt-textarea[contenteditable='true'][role='textbox']")
      || document.querySelector("textarea[name='prompt-textarea']");
  }

  function getComposerContainer() {
    const editor = getPromptEditor();
    if (editor) {
      return findComposerScope(editor);
    }
    return document.querySelector("form[data-type='unified-composer']")
      || document.querySelector("[data-composer-surface]")?.parentElement
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

    if (!hidden) {
      return;
    }

    if (!composer || composer === document || composer.closest(".cgqa-root")) {
      return;
    }
    if (!composer.classList.contains(HIDDEN_COMPOSER_CLASS)) {
      composer.classList.add(HIDDEN_COMPOSER_CLASS);
    }
    if (composer.dataset.cgqaComposerHidden !== "true") {
      composer.dataset.cgqaComposerHidden = "true";
    }
  }

  function setNativeGenerationControlsHidden(hidden) {
    document.querySelectorAll(`.${HIDDEN_NATIVE_CONTROL_CLASS}`).forEach((node) => {
      unhideNativeGenerationControl(node);
    });

    if (!hidden) {
      return;
    }

    getNativeGenerationControlCandidates().forEach((node) => {
      hideNativeGenerationControl(node);
    });
  }

  function getNativeGenerationControlCandidates() {
    const nodes = Array.from(document.querySelectorAll([
      "button",
      "[role='button']",
      "[role='tooltip']",
      "[data-radix-popper-content-wrapper]"
    ].join(",")));
    const candidates = new Set();

    nodes.forEach((node) => {
      if (node.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-toast")) {
        return;
      }

      const text = getNodeControlText(node);
      if (!isGenerationControlText(text)) {
        return;
      }

      const tooltipWrapper = node.getAttribute("role") === "tooltip"
        ? node.closest("[data-radix-popper-content-wrapper]")
        : null;
      candidates.add(tooltipWrapper || node);
    });

    return Array.from(candidates);
  }

  function getNodeControlText(node) {
    return [
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || "",
      node.textContent || ""
    ].join(" ").toLowerCase();
  }

  function isGenerationControlText(text) {
    return /停止|stop/.test(text) && /流式|stream|生成|generat/.test(text);
  }

  function hideNativeGenerationControl(node) {
    if (!node || node.classList.contains(HIDDEN_NATIVE_CONTROL_CLASS)) {
      return;
    }
    node.classList.add(HIDDEN_NATIVE_CONTROL_CLASS);
    node.dataset.cgqaNativeControlHidden = "true";
  }

  function unhideNativeGenerationControl(node) {
    if (!node) {
      return;
    }
    node.classList.remove(HIDDEN_NATIVE_CONTROL_CLASS);
    if (node.dataset.cgqaNativeControlHidden !== undefined) {
      delete node.dataset.cgqaNativeControlHidden;
    }
  }

  function getPromptText() {
    const editor = getPromptEditor();
    if (!editor) {
      return "";
    }
    if (editor.tagName === "TEXTAREA") {
      return editor.value || "";
    }
    return editor.innerText || editor.textContent || "";
  }

  function setPromptText(text) {
    const editor = getPromptEditor();
    if (!editor) {
      return false;
    }

    editor.focus();
    if (editor.tagName === "TEXTAREA") {
      editor.value = text;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand && document.execCommand("insertText", false, text);
    if (!inserted) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return true;
  }

  function findSendButton(options = {}) {
    const editor = getPromptEditor();
    const composer = editor ? findComposerScope(editor) : document;
    const scope = composer || document;
    const hasPromptText = Boolean(options.hasPromptText) || getPromptText().trim().length > 0;
    const allowVoiceLabel = Boolean(options.allowVoiceLabel);
    const preferred = scope.querySelector([
      "[data-testid='send-button']:not([disabled])",
      "[data-testid='composer-submit-button']:not([disabled])",
      "button[type='submit']:not([disabled])",
      "button[aria-label*='发送']:not([disabled])",
      "button[aria-label*='Send']:not([disabled])",
      "button[class*='composer-submit-button-color']:not([disabled])"
    ].join(","));
    if (preferred && isSendCandidate(preferred, { hasPromptText, allowVoiceLabel })) {
      return preferred;
    }

    const buttons = Array.from(scope.querySelectorAll("button:not([disabled])"));
    const editorRect = editor ? editor.getBoundingClientRect() : null;
    const candidates = buttons.filter((button) => {
      if (!isSendCandidate(button, { hasPromptText, allowVoiceLabel })) {
        return false;
      }
      if (!editorRect) {
        return true;
      }
      const rect = button.getBoundingClientRect();
      const nearComposer = rect.bottom >= editorRect.top - 80
        && rect.top <= editorRect.bottom + 120
        && rect.right >= editorRect.left
        && rect.left <= editorRect.right + 220;
      return nearComposer;
    });

    return candidates.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.left - rectA.left || rectB.top - rectA.top;
    })[0] || null;
  }

  function isSendCandidate(button, options) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
    const className = String(button.className || "");
    const hasSubmitClass = className.includes("composer-submit-button-color");

    if (/添加|文件|attach|听写|model|模型|工具|tool|分享|share|export/.test(label)) {
      return false;
    }
    if (/voice|语音/.test(label) && !options.allowVoiceLabel) {
      return false;
    }
    if (isExplicitSendButton(button)) {
      return true;
    }
    return Boolean(options.hasPromptText && hasSubmitClass);
  }

  function findComposerScope(editor) {
    return editor.closest("form[data-type='unified-composer']")
      || editor.closest("form")
      || editor.closest("[data-composer-surface]")?.parentElement
      || editor.closest("[class*='composer']")
      || document;
  }

  function isExplicitSendButton(button) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
    return /send|发送|submit|提交/.test(label)
      || button.matches("[data-testid='send-button'], [data-testid='composer-submit-button'], button[type='submit']");
  }

  async function waitForSendButton(options = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2500) {
      const allowVoiceLabel = Date.now() - startedAt > 900;
      const button = findSendButton({ ...options, allowVoiceLabel });
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        return button;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function submitPrompt(text) {
    if (!setPromptText(text)) {
      throw new Error("找不到 ChatGPT 主输入框。");
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    const initialUserTurnCount = getUserTurnCount();
    const button = await waitForSendButton({ hasPromptText: Boolean(text && text.trim()) });
    if (button) {
      clickElement(button);
      if (await waitForSubmissionStarted(initialUserTurnCount, text, 4200)) {
        blurActiveElement();
        return;
      }
      if (!shouldRetrySubmission(text)) {
        blurActiveElement();
        return;
      }
    }

    pressEnterOnPrompt();
    if (await waitForSubmissionStarted(initialUserTurnCount, text, 2200)) {
      blurActiveElement();
      return;
    }
    if (!shouldRetrySubmission(text)) {
      blurActiveElement();
      return;
    }

    submitComposerForm();
    if (await waitForSubmissionStarted(initialUserTurnCount, text, 2200)) {
      blurActiveElement();
      return;
    }

    throw new Error("无法触发 ChatGPT 发送，请手动点击主输入框发送按钮。");
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

  function submitComposerForm() {
    const editor = getPromptEditor();
    const form = editor ? editor.closest("form") : null;
    if (!form) {
      return;
    }
    if (typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit();
        return;
      } catch (_error) {
        // Fall through to a synthetic submit event.
      }
    }
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  async function waitForSubmissionStarted(initialUserTurnCount, promptText, timeoutMs = 1800) {
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
    if (getUserTurnCount() > initialUserTurnCount || getPromptText().trim() === "") {
      return true;
    }

    const trackingToken = extractTrackingToken(promptText);
    if (trackingToken && getAllTurnRecords().some((record) => {
      return record.role === "user" && record.text.includes(trackingToken);
    })) {
      return true;
    }

    return getNativeGenerationControlCandidates().length > 0;
  }

  function shouldRetrySubmission(promptText) {
    if (hasSubmissionStarted(getUserTurnCount(), promptText)) {
      return false;
    }

    const currentPrompt = getPromptText().trim();
    if (!currentPrompt || currentPrompt !== String(promptText || "").trim()) {
      return false;
    }

    return Boolean(findSendButton({ hasPromptText: true }));
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

  globalThis.CGQADom = {
    validateSelection,
    getConversationId,
    getTurnId,
    getMessageId,
    sanitizeMessageHtml,
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
