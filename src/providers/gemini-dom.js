(function () {
  "use strict";

  const MARK_SELECTOR = ".cgqa-quote-mark";
  const CHIP_SELECTOR = ".cgqa-quote-chip";
  const HIDDEN_TURN_CLASS = "cgqa-main-turn-hidden";
  const HIDDEN_COMPOSER_CLASS = "cgqa-composer-hidden";
  const HIDDEN_NATIVE_CONTROL_CLASS = "cgqa-native-control-hidden";
  const BLOCK_REFERENCE_SELECTOR = "pre, code-block, table-block, table";
  const SURFACE_SELECTOR = ".math-block[data-math], [data-math], .katex, math";
  const COMPLEX_SELECTOR = `${SURFACE_SELECTOR}, ${BLOCK_REFERENCE_SELECTOR}`;
  const SURFACE_MARK_CLASS = "cgqa-quote-mark-surface";
  const BLOCK_REFERENCE_BAR_CLASS = "cgqa-block-reference-bar";
  const BLOCK_REFERENCE_CHIP_CLASS = "cgqa-block-reference-chip";
  const BLOCK_REFERENCE_MORE_CLASS = "cgqa-block-reference-more";
  const BLOCK_REFERENCE_VISIBLE_LIMIT = 2;
  const TURN_SELECTOR = ".conversation-container";
  const MARKDOWN_SELECTOR = [
    "model-response message-content .markdown",
    "model-response .markdown.markdown-main-panel",
    "model-response .model-response-text .markdown"
  ].join(",");
  const BAD_SELECTION_SELECTOR = [
    ".cgqa-root",
    ".cgqa-selection-menu",
    `.${BLOCK_REFERENCE_BAR_CLASS}`,
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
  const inputBlocker = CGQAProviderInputBlocker.create({
    getTarget: () => getComposerHideContainer(),
    isTargetHidden: (target) => target.classList.contains(HIDDEN_COMPOSER_CLASS)
  });

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

  function getSharedBlockReferenceTarget(markdown, range) {
    const startBlock = getBlockReferenceTarget(markdown, range.startContainer);
    const endBlock = getBlockReferenceTarget(markdown, range.endContainer);
    if (!startBlock || !endBlock || startBlock !== endBlock || !markdown.contains(startBlock)) {
      return null;
    }
    return startBlock;
  }

  function getBlockReferenceTarget(markdown, node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) {
      return null;
    }

    const table = element.closest("table-block, table");
    if (table) {
      return getMarkdownDirectChild(markdown, table) || table;
    }

    const codeBlock = element.closest("code-block, pre");
    if (!codeBlock) {
      return null;
    }
    return getMarkdownDirectChild(markdown, codeBlock) || codeBlock;
  }

  function getMarkdownDirectChild(markdown, node) {
    if (!markdown || !node || !markdown.contains(node)) {
      return null;
    }

    let current = node;
    while (current && current.parentElement && current.parentElement !== markdown) {
      current = current.parentElement;
    }
    return current && current.parentElement === markdown ? current : null;
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
      `.${BLOCK_REFERENCE_BAR_CLASS}`,
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
        if (parent && parent.closest(`${CHIP_SELECTOR}, .${BLOCK_REFERENCE_BAR_CLASS}, model-thoughts, button, script, style`)) {
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

  function clearQuotePartDataset(element) {
    delete element.dataset.quoteId;
    delete element.dataset.threadId;
    delete element.dataset.displayIndex;
    delete element.dataset.draft;
  }

  function promoteQuotePart(element, thread) {
    delete element.dataset.draft;
    element.dataset.displayIndex = String(thread.displayIndex || "");
  }

  function createMarkElement(thread, options = {}) {
    const mark = document.createElement("span");
    mark.className = "cgqa-quote-mark";
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

  function createBlockReferenceChip(thread, options = {}) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = BLOCK_REFERENCE_CHIP_CLASS;
    applyQuotePartDataset(chip, thread, options);
    chip.textContent = getChipText(thread);
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      globalThis.CGQAApp && globalThis.CGQAApp.openThread(thread.threadId);
    });
    return chip;
  }

  function createBlockReferenceMoreButton(hiddenChips) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = BLOCK_REFERENCE_MORE_CLASS;
    more.textContent = `更多 ${hiddenChips.length}`;
    more.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const threads = hiddenChips.map((chip) => {
        return globalThis.CGQAApp && globalThis.CGQAApp.getThread
          ? globalThis.CGQAApp.getThread(chip.dataset.threadId)
          : null;
      }).filter(Boolean);
      if (threads.length === 1) {
        globalThis.CGQAApp.openThread(threads[0].threadId);
        return;
      }
      if (threads.length > 1) {
        CGQASidebar.showThreadChoiceMenu(more.getBoundingClientRect(), threads, (threadId) => {
          globalThis.CGQAApp && globalThis.CGQAApp.openThread(threadId);
        });
      }
    });
    return more;
  }

  function applySurfaceMark(block, thread, options = {}) {
    block.classList.add("cgqa-quote-mark", SURFACE_MARK_CLASS);
    applyQuotePartDataset(block, thread, options);
  }

  function clearSurfaceMark(mark) {
    mark.classList.remove("cgqa-quote-mark", SURFACE_MARK_CLASS, "is-active");
    clearQuotePartDataset(mark);
  }

  function createBlockReferenceBar(block) {
    const bar = document.createElement("div");
    bar.className = BLOCK_REFERENCE_BAR_CLASS;
    bar.dataset.cgqaBlockReferenceKind = getBlockReferenceKind(block);
    const chips = document.createElement("div");
    chips.className = "cgqa-block-reference-chips";
    const note = document.createElement("span");
    note.className = "cgqa-block-reference-note";
    note.textContent = getBlockReferenceNote(block);
    bar.append(chips, note);
    block.parentNode.insertBefore(bar, block);
    return bar;
  }

  function getBlockReferenceBar(block) {
    const previous = block.previousElementSibling;
    if (previous && previous.classList.contains(BLOCK_REFERENCE_BAR_CLASS)) {
      return previous;
    }
    return createBlockReferenceBar(block);
  }

  function getBlockReferenceKind(block) {
    return block && (block.matches("table, table-block") || block.querySelector("table, table-block")) ? "table" : "code";
  }

  function getBlockReferenceNote(block) {
    return getBlockReferenceKind(block) === "table" ? "引用自下方表格" : "引用自下方代码块";
  }

  function getBlockReferenceChips(bar) {
    return Array.from(bar.querySelectorAll(`.${BLOCK_REFERENCE_CHIP_CLASS}`));
  }

  function updateBlockReferenceBar(bar) {
    const chips = getBlockReferenceChips(bar);
    const oldMore = bar.querySelector(`.${BLOCK_REFERENCE_MORE_CLASS}`);
    if (oldMore) {
      oldMore.remove();
    }

    chips.forEach((chip, index) => {
      chip.hidden = index >= BLOCK_REFERENCE_VISIBLE_LIMIT;
    });

    const hiddenChips = chips.slice(BLOCK_REFERENCE_VISIBLE_LIMIT);
    if (hiddenChips.length > 0) {
      const note = bar.querySelector(".cgqa-block-reference-note");
      bar.insertBefore(createBlockReferenceMoreButton(hiddenChips), note || null);
    }
  }

  function removeBlockReferenceChip(chip) {
    const bar = chip.closest(`.${BLOCK_REFERENCE_BAR_CLASS}`);
    chip.remove();
    if (!bar) {
      return;
    }
    if (getBlockReferenceChips(bar).length === 0) {
      bar.remove();
      return;
    }
    updateBlockReferenceBar(bar);
  }

  function getChipText(thread) {
    const count = (thread.messages || []).filter((message) => message.role === "user").length;
    return count > 0 ? `提问 ${thread.displayIndex} · ${count}` : `提问 ${thread.displayIndex}`;
  }

  function updateMarkChip(thread) {
    document.querySelectorAll(getThreadChipSelector(thread.threadId)).forEach((chip) => {
      chip.textContent = getChipText(thread);
    });
    document.querySelectorAll(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(thread.threadId)}']`).forEach((chip) => {
      chip.textContent = getChipText(thread);
      const bar = chip.closest(`.${BLOCK_REFERENCE_BAR_CLASS}`);
      if (bar) {
        updateBlockReferenceBar(bar);
      }
    });
  }

  function unwrapMark(mark) {
    if (mark.classList.contains(SURFACE_MARK_CLASS)) {
      clearSurfaceMark(mark);
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
    document.querySelectorAll(`.${BLOCK_REFERENCE_BAR_CLASS}`).forEach((bar) => bar.remove());
    document.querySelectorAll(MARK_SELECTOR).forEach((mark) => unwrapMark(mark));
  }

  function removeThreadMark(threadId) {
    if (!threadId) {
      return;
    }
    document.querySelectorAll(getThreadChipSelector(threadId)).forEach((chip) => chip.remove());
    document.querySelectorAll(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(threadId)}']`).forEach(removeBlockReferenceChip);
    document.querySelectorAll(getThreadMarkSelector(threadId)).forEach(unwrapMark);
  }

  function promoteThreadMark(thread) {
    const marks = document.querySelectorAll(getThreadMarkSelector(thread.threadId));
    marks.forEach((mark) => promoteQuotePart(mark, thread));
    document.querySelectorAll(getThreadChipSelector(thread.threadId)).forEach((chip) => promoteQuotePart(chip, thread));
    document.querySelectorAll(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(thread.threadId)}']`).forEach((chip) => promoteQuotePart(chip, thread));
    updateMarkChip(thread);
    return marks.length > 0 || Boolean(document.querySelector(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(thread.threadId)}']`));
  }

  function hasThreadMark(threadId) {
    return Boolean(threadId && (
      document.querySelector(getThreadMarkSelector(threadId))
      || document.querySelector(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(threadId)}']`)
    ));
  }

  function setActiveMark(threadId) {
    document.querySelectorAll(MARK_SELECTOR).forEach((mark) => {
      mark.classList.toggle("is-active", mark.dataset.threadId === threadId);
    });
    document.querySelectorAll(`.${BLOCK_REFERENCE_CHIP_CLASS}`).forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.threadId === threadId);
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

    const mark = createMarkElement(thread, options);
    selectedNode.parentNode.insertBefore(mark, selectedNode);
    mark.insertBefore(selectedNode, mark.firstChild);
    if (includeChip) {
      const anchor = getInlineCodeAncestor(mark) || mark;
      anchor.parentNode.insertBefore(createChipElement(thread, options), anchor.nextSibling);
    }
  }

  function markSurfaceBlock(markdown, range, thread, options = {}) {
    const block = getSurfaceTarget(markdown, range.commonAncestorContainer);
    if (!block || !markdown.contains(block) || block.closest(MARK_SELECTOR) || block.querySelector(MARK_SELECTOR)) {
      return false;
    }

    applySurfaceMark(block, thread, options);
    return true;
  }

  function getSurfaceTarget(markdown, node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) {
      return null;
    }

    const mathBlock = element.closest(".math-block[data-math], [data-math]");
    if (mathBlock && markdown.contains(mathBlock)) {
      return mathBlock;
    }

    const surface = element.closest(SURFACE_SELECTOR);
    return surface && markdown.contains(surface) ? surface : null;
  }

  function markSurfaceByAnchor(markdown, thread, options = {}) {
    const block = findSurfaceByAnchor(markdown, thread.anchor || {});
    if (!block || block.closest(MARK_SELECTOR) || block.querySelector(MARK_SELECTOR)) {
      return false;
    }

    applySurfaceMark(block, thread, options);
    return true;
  }

  function findSurfaceByAnchor(markdown, anchor) {
    const exactText = normalizeText(anchor && anchor.exactText || "").trim();
    if (!markdown || !exactText || !isFormulaLikeText(exactText)) {
      return null;
    }

    const matches = getSurfaceCandidates(markdown).filter((surface) => {
      return isSurfaceTextMatch(surface, exactText);
    });

    return matches.length === 1 ? matches[0] : null;
  }

  function getSurfaceCandidates(markdown) {
    const seen = new Set();
    return Array.from(markdown.querySelectorAll(SURFACE_SELECTOR)).map((surface) => {
      return getSurfaceTarget(markdown, surface) || surface;
    }).filter((surface) => {
      if (!surface || seen.has(surface)) {
        return false;
      }
      seen.add(surface);
      return true;
    });
  }

  function isSurfaceTextMatch(surface, exactText) {
    const surfaceTexts = [
      getSurfaceText(surface),
      surface.getAttribute("data-math") || ""
    ].map(normalizeFormulaComparable).filter(Boolean);
    const exact = normalizeFormulaComparable(exactText);
    return Boolean(exact && surfaceTexts.some((surfaceText) => {
      return surfaceText === exact || surfaceText.includes(exact) || exact.includes(surfaceText);
    }));
  }

  function getSurfaceText(surface) {
    const clone = surface.cloneNode(true);
    normalizeKatexNodes(clone, { keepFallbackText: true });
    return normalizeText(clone.innerText || clone.textContent || "").trim();
  }

  function normalizeFormulaComparable(text) {
    return normalizeText(text)
      .replace(/\\left|\\right/g, "")
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2")
      .replace(/[\\{}\s\u200b]/g, "")
      .trim();
  }

  function isFormulaLikeText(text) {
    return /[=+\-*/^_()\\]|\\frac|\\sqrt|\\sum|\\int/.test(text);
  }

  function markBlockReference(markdown, range, thread, options = {}) {
    const block = getSharedBlockReferenceTarget(markdown, range);
    if (!block || !block.parentNode) {
      return false;
    }
    const bar = getBlockReferenceBar(block);
    if (bar.querySelector(`.${BLOCK_REFERENCE_CHIP_CLASS}[data-thread-id='${CSS.escape(thread.threadId)}']`)) {
      return false;
    }
    const chips = bar.querySelector(".cgqa-block-reference-chips");
    chips.append(createBlockReferenceChip(thread, options));
    updateBlockReferenceBar(bar);
    return true;
  }

  function markComplexContent(markdown, range, thread, options = {}) {
    if (getSharedBlockReferenceTarget(markdown, range)) {
      return markBlockReference(markdown, range, thread, options);
    }

    return markSurfaceBlock(markdown, range, thread, options);
  }

  function renderThreadMark(thread) {
    const turn = findTurnForThread(thread);
    const markdown = getMarkdownNode(turn);
    if (!markdown || hasThreadMark(thread.threadId)) {
      return false;
    }

    const range = resolveAnchorRange(markdown, thread.anchor || {});
    if (!range) {
      return markSurfaceByAnchor(markdown, thread);
    }
    if (isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer)) {
      return markComplexContent(markdown, range, thread);
    }
    return wrapRange(markdown, range, thread);
  }

  function renderDraftThreadMark(thread, markdown, range) {
    if (!thread || !markdown || !range || hasThreadMark(thread.threadId)) {
      return false;
    }
    if (isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer)) {
      return markComplexContent(markdown, range, thread, { draft: true });
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

  function syncKnownHiddenMainTurns(targets) {
    const targetByPromptToken = new Map(normalizeHiddenTargets(targets).map((target) => {
      return [target.promptToken, target];
    }));

    document.querySelectorAll(`.${HIDDEN_TURN_CLASS}`).forEach((turn) => {
      const target = targetByPromptToken.get(turn.dataset.cgqaHiddenPromptToken || "");
      if (!target) {
        return;
      }
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
    const editors = Array.from(document.querySelectorAll([
      "rich-textarea .ql-editor[contenteditable='true'][role='textbox']",
      ".ql-editor[contenteditable='true'][aria-label*='Gemini']",
      ".ql-editor[contenteditable='true']"
    ].join(","))).filter((editor) => !editor.closest(".cgqa-root"));
    return editors.find(isVisibleElement) || editors[editors.length - 1] || null;
  }

  function getComposerContainer() {
    const editor = getPromptEditor();
    const textField = editor && editor.closest(".text-input-field");
    const richTextarea = editor && editor.closest("rich-textarea");
    const scopes = [
      editor && editor.closest("input-container"),
      editor && editor.closest("input-area-v2"),
      editor && editor.closest(".input-area-container"),
      richTextarea && richTextarea.closest("input-container"),
      richTextarea && richTextarea.closest("input-area-v2"),
      richTextarea && richTextarea.closest(".input-area-container"),
      textField && textField.parentElement,
      textField,
      document.querySelector("input-container"),
      document.querySelector("input-area-v2"),
      document.querySelector(".input-area-container")
    ].filter((scope, index, list) => {
      return scope
        && scope.nodeType === Node.ELEMENT_NODE
        && !scope.closest(".cgqa-root")
        && list.indexOf(scope) === index;
    });
    return scopes.find((scope) => scope.querySelector("button, [role='button']")) || scopes[0] || null;
  }

  function getComposerHideContainer() {
    const composer = getComposerContainer();
    return composer && composer.closest("input-container")
      || composer && composer.closest(".input-area-container")
      || composer;
  }

  function getScrollContainer() {
    const chatHistoryScroller = Array.from(document.querySelectorAll("infinite-scroller.chat-history")).find(isScrollableElement);
    return chatHistoryScroller || document.scrollingElement || document.documentElement;
  }

  function isScrollableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 8;
  }

  function setMainComposerHidden(hidden) {
    const composer = hidden ? getComposerHideContainer() : null;
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
    const stopButton = findStopButton();
    if (stopButton) {
      hideNativeGenerationControl(stopButton);
    }
  }

  function syncPendingResponseState(state) {
    inputBlocker.setBlocked(Boolean(state && state.active));
  }

  function isResponseGenerating() {
    return isVisibleIgnoringPluginHiddenClass(findStopButton());
  }

  async function stopGeneration() {
    document.querySelectorAll(`.${HIDDEN_NATIVE_CONTROL_CLASS}`).forEach(unhideNativeGenerationControl);
    const button = findStopButton();
    if (!button) {
      return false;
    }
    unhideNativeGenerationControl(button);
    clickElement(button);
    if (typeof button.click === "function") {
      button.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    return true;
  }

  function isVisibleIgnoringPluginHiddenClass(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const hadHiddenClass = element.classList.contains(HIDDEN_NATIVE_CONTROL_CLASS);
    if (hadHiddenClass) {
      element.classList.remove(HIDDEN_NATIVE_CONTROL_CLASS);
    }
    try {
      return isVisibleElement(element);
    } finally {
      if (hadHiddenClass) {
        element.classList.add(HIDDEN_NATIVE_CONTROL_CLASS);
      }
    }
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden";
  }

  function getNodeControlText(node) {
    return [
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || "",
      node.getAttribute("data-testid") || "",
      node.getAttribute("class") || "",
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
    editor.click();
    dispatchPromptPaste(editor, text);
    selectEditorContents(editor);

    const inserted = document.execCommand && document.execCommand("insertText", false, text);
    if (!inserted || !doesPromptContainText(text)) {
      setEditorPlainText(editor, text);
    }
    dispatchEditorInput(editor, text);
    return doesPromptContainText(text);
  }

  function dispatchPromptPaste(editor, text) {
    if (!editor || typeof DataTransfer !== "function" || typeof ClipboardEvent !== "function") {
      return;
    }
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      editor.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData
      }));
    } catch (_error) {
      // Synthetic paste support varies between Chromium builds; insertText handles the fallback.
    }
  }

  function selectEditorContents(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setEditorPlainText(editor, text) {
    editor.replaceChildren();
    const lines = String(text || "").split(/\r?\n/);
    lines.forEach((line) => {
      const paragraph = document.createElement("p");
      if (line) {
        paragraph.textContent = line;
      } else {
        paragraph.append(document.createElement("br"));
      }
      editor.append(paragraph);
    });
  }

  function dispatchEditorInput(editor, text) {
    const targets = [
      editor,
      editor.closest("rich-textarea"),
      getComposerContainer(),
      getComposerHideContainer()
    ].filter((target, index, list) => {
      return target
        && target.nodeType === Node.ELEMENT_NODE
        && !target.closest(".cgqa-root")
        && list.indexOf(target) === index;
    });
    targets.forEach((target) => {
      try {
        target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      } catch (_error) {
        target.dispatchEvent(new Event("beforeinput", { bubbles: true, composed: true }));
      }
      try {
        target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      } catch (_error) {
        target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }
      target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      try {
        target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, composed: true, data: text }));
      } catch (_error) {
        target.dispatchEvent(new Event("compositionend", { bubbles: true, composed: true }));
      }
    });
  }

  function doesPromptContainText(text) {
    const promptText = getPromptText();
    const trackingToken = extractTrackingToken(text);
    if (trackingToken) {
      return promptText.includes(trackingToken);
    }
    const expected = normalizeText(String(text || "")).trim();
    return Boolean(expected && promptText.includes(expected.slice(0, Math.min(expected.length, 48))));
  }

  function findSendButton() {
    const editor = getPromptEditor();
    const composer = getComposerContainer();
    const preferred = findSendButtonInScope(composer);
    if (preferred) {
      return preferred;
    }

    const editorRect = editor ? editor.getBoundingClientRect() : null;
    const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter((button) => {
      if (button.closest(".cgqa-root") || !isSendButton(button) || !isSendButtonEnabled(button)) {
        return false;
      }
      if (!editorRect) {
        return true;
      }
      const rect = button.getBoundingClientRect();
      return rect.bottom >= editorRect.top - 120
        && rect.top <= editorRect.bottom + 180
        && rect.right >= editorRect.left - 80
        && rect.left <= editorRect.right + 260;
    });
    return buttons.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.left - rectA.left || rectB.top - rectA.top;
    })[0] || null;
  }

  function findSendButtonInScope(scope) {
    if (!scope || !scope.querySelector) {
      return null;
    }
    return [
      "button.send-button.submit",
      "button[aria-label*='发送'].send-button",
      "button[aria-label*='Send'].send-button",
      "button[aria-label*='发送消息']",
      "button[aria-label*='Send message']",
      "button[type='submit']",
      "[role='button'][aria-label*='发送']",
      "[role='button'][aria-label*='Send']"
    ].map((selector) => scope.querySelector(selector)).find((button) => {
      return isSendButton(button) && isSendButtonEnabled(button);
    }) || null;
  }

  function isSendButton(button) {
    if (!button) {
      return false;
    }
    if (button.closest(".cgqa-root")) {
      return false;
    }
    const text = getNodeControlText(button);
    const className = String(button.className || "");
    if (/停止|stop|上传|附件|attach|麦克风|语音|voice|图片|image/.test(text)) {
      return false;
    }
    return /发送|send|submit/.test(text)
      || className.includes("send-button")
      || button.matches("button[type='submit']");
  }

  function isSendButtonEnabled(button) {
    return Boolean(button
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && isVisibleElement(button));
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
    setMainComposerHidden(false);
    setNativeGenerationControlsHidden(false);
    inputBlocker.setBlocked(false);

    if (!setPromptText(text)) {
      throw new Error("找不到 Gemini 主输入框。");
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    const initialResponseGenerating = isResponseGenerating();
    const initialUserTurnCount = getUserTurnCount();
    const button = await waitForSendButton();
    if (button) {
      clickElement(button);
      if (await waitForSubmissionStarted(initialUserTurnCount, text, initialResponseGenerating, 4200)) {
        blurActiveElement();
        return;
      }
      if (typeof button.click === "function") {
        button.click();
      }
      if (await waitForSubmissionStarted(initialUserTurnCount, text, initialResponseGenerating, 2500)) {
        blurActiveElement();
        return;
      }
    }

    pressEnterOnPrompt();
    if (await waitForSubmissionStarted(initialUserTurnCount, text, initialResponseGenerating, 3000)) {
      blurActiveElement();
      return;
    }

    submitComposerForm();
    if (await waitForSubmissionStarted(initialUserTurnCount, text, initialResponseGenerating, 2500)) {
      blurActiveElement();
      return;
    }

    throw new Error("无法触发 Gemini 发送，请手动点击主输入框发送按钮。");
  }

  async function completePendingResponse() {
    await new Promise((resolve) => setTimeout(resolve, 350));
    blurActiveElement();
  }

  function findStopButton() {
    const composer = getComposerContainer() || document;
    const preferred = composer.querySelector("button.send-button.stop[aria-label*='停止'], button.send-button.stop");
    if (isStopButton(preferred)) {
      return preferred;
    }
    return Array.from(composer.querySelectorAll("[role='button'], button")).find(isStopButton)
      || Array.from(document.querySelectorAll("[role='button'], button")).find(isStopButton)
      || null;
  }

  function isStopButton(button) {
    return Boolean(button
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && /停止|stop|中止|cancel/i.test(getNodeControlText(button))
      && !/上传|upload|附件|attach|麦克风|microphone|语音|voice|图片|image/.test(getNodeControlText(button)));
  }

  function clearPromptText() {
    const editor = getPromptEditor();
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    const deleted = document.execCommand && document.execCommand("delete", false);
    if (!deleted || getPromptText()) {
      editor.innerHTML = "<p><br></p>";
    }
    editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
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
      composed: true,
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
      cancelable: true,
      composed: true
    };
    editor.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    editor.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    editor.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  function submitComposerForm() {
    const editor = getPromptEditor();
    const composer = getComposerContainer();
    const form = editor && editor.closest("form") || composer && composer.closest("form");
    if (!form || form.closest(".cgqa-root")) {
      return false;
    }
    const button = findSendButton();
    try {
      if (typeof form.requestSubmit === "function") {
        if (button && button.type === "submit") {
          form.requestSubmit(button);
        } else {
          form.requestSubmit();
        }
        return true;
      }
    } catch (_error) {
      // Fall through to dispatching a submit event for custom form wrappers.
    }
    try {
      form.dispatchEvent(new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        composed: true,
        submitter: button || null
      }));
    } catch (_error) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true, composed: true }));
    }
    return true;
  }

  async function waitForSubmissionStarted(initialUserTurnCount, promptText, initialResponseGenerating, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (hasSubmissionStarted(initialUserTurnCount, promptText, initialResponseGenerating)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  function hasSubmissionStarted(initialUserTurnCount, promptText, initialResponseGenerating) {
    const trackingToken = extractTrackingToken(promptText);
    if (trackingToken && getAllTurnRecords().some((record) => {
      return record.role === "user" && record.text.includes(trackingToken);
    })) {
      return true;
    }
    if (getUserTurnCount() > initialUserTurnCount) {
      return true;
    }
    if (getPromptText() === "") {
      return true;
    }
    return Boolean(
      !initialResponseGenerating
      && isResponseGenerating()
      && getPromptText() === ""
    );
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
    syncKnownHiddenMainTurns,
    setMainComposerHidden,
    setNativeGenerationControlsHidden,
    syncPendingResponseState,
    isResponseGenerating,
    stopGeneration,
    completePendingResponse,
    getScrollContainer,
    submitPrompt
  };
})();
