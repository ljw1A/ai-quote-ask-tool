(function () {
  "use strict";

  const MARK_SELECTOR = ".cgqa-quote-mark";
  const CHIP_SELECTOR = ".cgqa-quote-chip";
  const HIDDEN_TURN_CLASS = "cgqa-main-turn-hidden";
  const HIDDEN_COMPOSER_CLASS = "cgqa-composer-hidden";
  const HIDDEN_NATIVE_CONTROL_CLASS = "cgqa-native-control-hidden";
  const BLOCK_REFERENCE_SELECTOR = "pre, table";
  const SURFACE_SELECTOR = "[data-math], .math, .katex-display, .katex, math";
  const COMPLEX_SELECTOR = `${SURFACE_SELECTOR}, ${BLOCK_REFERENCE_SELECTOR}`;
  const SURFACE_MARK_CLASS = "cgqa-quote-mark-surface";
  const BLOCK_REFERENCE_BAR_CLASS = "cgqa-block-reference-bar";
  const BLOCK_REFERENCE_CHIP_CLASS = "cgqa-block-reference-chip";
  const BLOCK_REFERENCE_MORE_CLASS = "cgqa-block-reference-more";
  const BLOCK_REFERENCE_VISIBLE_LIMIT = 2;
  const TURN_SELECTOR = ".ds-virtual-list--printable [data-virtual-list-item-key]";
  const MARKDOWN_SELECTOR = ".ds-assistant-message-main-content";
  const THINKING_CONTROL_SELECTOR = "._74c0879, .ds-think-content";
  const BAD_SELECTION_SELECTOR = [
    ".cgqa-root",
    ".cgqa-selection-menu",
    `.${BLOCK_REFERENCE_BAR_CLASS}`,
    ".cgqa-toast",
    ".ds-think-content",
    ".ds-icon-button",
    ".ds-flex",
    "._74c0879",
    "button",
    "[role='button']"
  ].join(",");
  const inputBlocker = CGQAProviderInputBlocker.create({
    getTarget: () => getComposerHideContainer(),
    isTargetHidden: (target) => target.classList.contains(HIDDEN_COMPOSER_CLASS)
  });

  function getConversationId() {
    const match = location.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
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
    return findOwnedElement(turn, MARKDOWN_SELECTOR);
  }

  function getMessageNode(turn) {
    return getMarkdownNode(turn);
  }

  function getUserNode(turn) {
    return findOwnedElement(turn, ".ds-message .fbb737a4");
  }

  function findOwnedElement(turn, selector) {
    if (!turn) {
      return null;
    }
    return Array.from(turn.querySelectorAll(selector)).find((element) => {
      return getTurn(element) === turn;
    }) || null;
  }

  function getMessageId(turn) {
    return turn ? turn.getAttribute("data-virtual-list-item-key") || "" : "";
  }

  function getTurnId(turn) {
    return getMessageId(turn);
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

  function getFormulaSurfacesInRange(markdown, range) {
    if (!markdown || !range) {
      return [];
    }
    return getSurfaceCandidates(markdown).filter((surface) => {
      return isFormulaSurface(surface) && safelyIntersectsNode(range, surface);
    });
  }

  function isFormulaSurface(surface) {
    return Boolean(surface && (
      surface.matches("[data-math], .math, .math-block, .katex-display, .katex, math")
      || surface.querySelector("annotation[encoding='application/x-tex'], math, .katex")
    ));
  }

  function safelyIntersectsNode(range, node) {
    try {
      return range.intersectsNode(node);
    } catch (_error) {
      return false;
    }
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

    const table = element.closest("table");
    if (table) {
      return getMarkdownDirectChild(markdown, table) || table;
    }

    const codeBlock = element.closest("pre");
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
    return code && !code.closest("pre") ? code : null;
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
      ".ds-think-content",
      ".ds-icon-button",
      ".ds-flex",
      "button",
      "svg",
      "mat-icon",
      "script",
      "style",
      "textarea",
      "input",
      "select",
      "[role='button']",
      "[data-virtual-list-item-key] > .ds-theme",
      "[data-test-id*='copy']",
      "[data-test-id*='thumb']",
      "[data-test-id*='share']"
    ].join(",")).forEach((node) => node.remove());
  }

  function normalizeKatexNodes(root, options = {}) {
    getKatexNodes(root).forEach((node) => {
      const annotation = node.querySelector("annotation[encoding='application/x-tex']");
      if (annotation) {
        node.textContent = annotation.textContent || (options.keepFallbackText ? node.textContent || "" : "");
      }
    });
  }

  function getKatexNodes(root) {
    const nodes = [];
    if (root && root.nodeType === Node.ELEMENT_NODE && root.matches(".katex")) {
      nodes.push(root);
    }
    if (root && root.querySelectorAll) {
      nodes.push(...root.querySelectorAll(".katex"));
    }
    return nodes;
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
        if (parent && parent.closest(`${CHIP_SELECTOR}, .${BLOCK_REFERENCE_BAR_CLASS}, .ds-think-content, button, [role='button'], script, style`)) {
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
      return { ok: false, reason: "请先选择一段 DeepSeek 回复正文。" };
    }

    const range = selection.getRangeAt(0);
    const startTurn = getAssistantTurn(range.startContainer);
    const endTurn = getAssistantTurn(range.endContainer);

    if (!startTurn || !endTurn || startTurn !== endTurn) {
      return { ok: false, reason: "暂不支持跨回复提问，请重新选择同一条回复中的内容。" };
    }

    const markdown = getMarkdownNode(startTurn);
    if (!markdown || !isInMarkdown(markdown, range.startContainer) || !isInMarkdown(markdown, range.endContainer)) {
      return { ok: false, reason: "请只选择 DeepSeek 回复正文，不要选择思考提示或操作按钮。" };
    }

    if (isBadSelectionNode(range.startContainer) || isBadSelectionNode(range.endContainer)) {
      return { ok: false, reason: "请只选择 DeepSeek 回复正文内容。" };
    }

    const selectedText = normalizeText(selection.toString()).trim();
    if (!selectedText) {
      return { ok: false, reason: "选择内容为空。" };
    }

    const formulaSelection = validateFormulaSelection(markdown, range);
    if (!formulaSelection.ok) {
      return { ok: false, reason: formulaSelection.reason };
    }
    if (formulaSelection.surface) {
      return {
        ok: true,
        range,
        turn: startTurn,
        markdown,
        selectedText: formulaSelection.anchor.exactText,
        complex: true,
        ...formulaSelection.anchor
      };
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

  function validateFormulaSelection(markdown, range) {
    const surfaces = getFormulaSurfacesInRange(markdown, range);
    if (surfaces.length === 0) {
      return { ok: true, surface: null };
    }
    if (surfaces.length > 1) {
      return { ok: false, reason: "一次只支持围绕一个完整公式提问。" };
    }

    const surface = surfaces[0];
    if (!isWholeFormulaSelection(range, surface)) {
      return { ok: false, reason: "公式请选择完整公式后提问，暂不支持选择公式的一部分。" };
    }

    const anchor = createSurfaceAnchor(markdown, surface);
    if (!anchor) {
      return { ok: false, reason: "当前公式结构无法稳定定位。" };
    }
    return { ok: true, surface, anchor };
  }

  function isWholeFormulaSelection(range, surface) {
    const selected = normalizeFormulaComparable(range.toString());
    const candidates = getFormulaComparableTexts(surface);
    return Boolean(selected && candidates.some((candidate) => {
      return selected === candidate
        || selected === candidate + candidate
        || isLikelyWholeFormulaText(selected, candidate);
    }));
  }

  function isLikelyWholeFormulaText(selected, candidate) {
    const selectedCompact = selected.replace(/\//g, "");
    const candidateCompact = candidate.replace(/\//g, "");
    const shorter = Math.min(selectedCompact.length, candidateCompact.length);
    const longer = Math.max(selectedCompact.length, candidateCompact.length);
    return shorter >= 6
      && shorter / longer >= 0.75
      && selectedCompact[0] === candidateCompact[0]
      && selectedCompact[selectedCompact.length - 1] === candidateCompact[candidateCompact.length - 1];
  }

  function getFormulaComparableTexts(surface) {
    return [
      getSurfaceAnchorText(surface),
      getSurfaceText(surface),
      surface.getAttribute("data-math") || ""
    ].map(normalizeFormulaComparable).filter(Boolean);
  }

  function createSurfaceAnchor(markdown, surface) {
    const exactText = getSurfaceAnchorText(surface);
    if (!markdown || !surface || !exactText) {
      return null;
    }

    const startOffset = getTextOffset(markdown, surface, 0);
    const endOffset = getTextOffset(markdown, surface, surface.childNodes.length);
    const text = getLinearText(markdown);
    const safeStart = startOffset >= 0 ? startOffset : 0;
    const safeEnd = endOffset > safeStart ? endOffset : safeStart + exactText.length;
    return {
      startOffset: safeStart,
      endOffset: safeEnd,
      exactText,
      prefixText: text.slice(Math.max(0, safeStart - 40), safeStart),
      suffixText: text.slice(safeEnd, Math.min(text.length, safeEnd + 40))
    };
  }

  function getSurfaceAnchorText(surface) {
    return normalizeText(surface.getAttribute("data-math") || getSurfaceText(surface)).trim();
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
    return block && (block.matches("table") || block.querySelector("table")) ? "table" : "code";
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
    if (hasFormulaInRange(markdown, range)) {
      return false;
    }

    const block = getSurfaceTarget(markdown, range.commonAncestorContainer) || getSingleSurfaceInRange(markdown, range);
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
      return getMarkdownDirectChild(markdown, mathBlock) || mathBlock;
    }

    const katex = element.closest(".katex-display") || element.closest(".katex");
    if (katex && markdown.contains(katex)) {
      return getMarkdownDirectChild(markdown, katex) || katex;
    }

    const surface = element.closest(SURFACE_SELECTOR);
    return surface && markdown.contains(surface) ? getMarkdownDirectChild(markdown, surface) || surface : null;
  }

  function getSingleSurfaceInRange(markdown, range) {
    const surfaces = getFormulaSurfacesInRange(markdown, range);
    return surfaces.length === 1 ? surfaces[0] : null;
  }

  function markSurfaceByAnchor(markdown, thread, options = {}) {
    return Boolean(findSurfaceByAnchor(markdown, thread.anchor || {}));
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
    const surfaceTexts = getFormulaComparableTexts(surface);
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
      .replace(/[\\{}\s\u200b^]/g, "")
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

    if (hasFormulaInRange(markdown, range)) {
      return true;
    }

    return markSurfaceBlock(markdown, range, thread, options);
  }

  function hasFormulaInRange(markdown, range) {
    return getFormulaSurfacesInRange(markdown, range).length > 0;
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
      const turn = document.querySelector(`${TURN_SELECTOR}[data-virtual-list-item-key='${id}']`);
      if (turn) {
        return turn;
      }
    }

    const turnId = anchor.sourceTurnId || thread.sourceTurnId || "";
    if (turnId) {
      const turn = document.getElementById(turnId)
        || document.querySelector(`${TURN_SELECTOR}[data-virtual-list-item-key='${CSS.escape(turnId)}']`);
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
    const query = getUserNode(turn);
    return query ? getReadableText(query).trim() : "";
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
    return document.querySelector("textarea[placeholder*='DeepSeek']")
      || document.querySelector("textarea[name='search']");
  }

  function getComposerContainer() {
    const editor = getPromptEditor();
    return editor && editor.closest("._77cefa5, ._871cbca")
      || document.querySelector("._871cbca")
      || null;
  }

  function getComposerHideContainer() {
    const composer = getComposerContainer();
    return composer && composer.closest("._871cbca")
      || composer;
  }

  function getScrollContainer() {
    const chatScroller = Array.from(document.querySelectorAll(".ds-virtual-list--printable")).find(isScrollableElement);
    return chatScroller || document.scrollingElement || document.documentElement;
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
    const active = Boolean(state && state.active);
    inputBlocker.setBlocked(active);
    setThinkingControlsHidden(active);
  }

  function isResponseGenerating() {
    return Boolean(findStopButton());
  }

  function setThinkingControlsHidden(hidden) {
    document.querySelectorAll(THINKING_CONTROL_SELECTOR).forEach((node) => {
      if (node.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-toast")) {
        return;
      }
      if (hidden) {
        hideNativeGenerationControl(node);
        return;
      }
      unhideNativeGenerationControl(node);
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
    return editor ? normalizeText(editor.value || editor.innerText || editor.textContent || "").trim() : "";
  }

  function setPromptText(text) {
    const editor = getPromptEditor();
    if (!editor) {
      return false;
    }

    editor.focus();
    setTextAreaValue(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  function setTextAreaValue(editor, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (setter && typeof setter.set === "function") {
      setter.set.call(editor, text);
      return;
    }
    editor.value = text;
  }

  function findSendButton() {
    const composer = getComposerContainer() || document;
    const candidates = Array.from(composer.querySelectorAll("[role='button'], button")).filter(isSendButtonEnabled).filter((button) => {
      const text = getNodeControlText(button);
      const className = String(button.className || "");
      if (/深度思考|智能搜索|附件|上传|attach|search|think/.test(text)) {
        return false;
      }
      return className.includes("ds-icon-button") || /发送|send|提交|submit/.test(text);
    });
    return candidates.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.left - rectA.left || rectB.top - rectA.top;
    })[0] || null;
  }

  function isSendButtonEnabled(button) {
    const className = String(button && button.className || "");
    return Boolean(button
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && !className.includes("disabled")
      && button.tabIndex !== -1);
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
      throw new Error("找不到 DeepSeek 主输入框。");
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

    throw new Error("无法触发 DeepSeek 发送，请手动点击主输入框发送按钮。");
  }

  async function completePendingResponse() {
    await new Promise((resolve) => setTimeout(resolve, 350));
    clearPromptText();
    blurActiveElement();
  }

  function findStopButton() {
    const composer = getComposerContainer() || document;
    const preferred = Array.from(composer.querySelectorAll("[role='button'], button")).find((button) => {
      return isStopButton(button) && /停止|stop/.test(getNodeControlText(button));
    });
    if (isStopButton(preferred)) {
      return preferred;
    }
    return Array.from(composer.querySelectorAll("button")).find(isStopButton) || null;
  }

  function isStopButton(button) {
    return Boolean(button
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && /停止|stop|中止|cancel/i.test(getNodeControlText(button)));
  }

  function clearPromptText() {
    const editor = getPromptEditor();
    if (!editor) {
      return;
    }

    editor.focus();
    setTextAreaValue(editor, "");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
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

  globalThis.CGQADeepSeekDom = {
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
    completePendingResponse,
    getScrollContainer,
    submitPrompt
  };
})();
