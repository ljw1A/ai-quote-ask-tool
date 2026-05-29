(function () {
  "use strict";

  const MARK_SELECTOR = ".cgqa-quote-mark";
  const CHIP_SELECTOR = ".cgqa-quote-chip";
  const HIDDEN_TURN_CLASS = "cgqa-main-turn-hidden";
  const HIDDEN_COMPOSER_CLASS = "cgqa-composer-hidden";
  const HIDDEN_NATIVE_CONTROL_CLASS = "cgqa-native-control-hidden";
  const ATTACHED_SELECTION_BUTTON_CLASS = "cgqa-selection-attached-button";
  const ATTACHED_SELECTION_GROUP_CLASS = "cgqa-selection-button-group";
  const OFFICIAL_SELECTION_ATTACH_TIMEOUT_MS = 900;
  const BLOCK_REFERENCE_SELECTOR = "pre, table, .cm-editor, .cm-content";
  const SURFACE_SELECTOR = ".katex, math";
  const COMPLEX_SELECTOR = `${SURFACE_SELECTOR}, ${BLOCK_REFERENCE_SELECTOR}`;
  const SURFACE_MARK_CLASS = "cgqa-quote-mark-surface";
  const BLOCK_REFERENCE_BAR_CLASS = "cgqa-block-reference-bar";
  const BLOCK_REFERENCE_CHIP_CLASS = "cgqa-block-reference-chip";
  const BLOCK_REFERENCE_MORE_CLASS = "cgqa-block-reference-more";
  const BLOCK_REFERENCE_VISIBLE_LIMIT = 2;
  const BAD_SELECTION_SELECTOR = [
    ".cgqa-root",
    ".cgqa-selection-menu",
    `.${BLOCK_REFERENCE_BAR_CLASS}`,
    ".cgqa-toast",
    "button[disabled]",
    "[aria-label='回复操作']",
    "[aria-label='你的消息操作']"
  ].join(",");
  const TURN_SELECTOR = [
    "section[data-turn]",
    "[data-testid^='conversation-turn-'][data-turn]",
    "[data-message-author-role]"
  ].join(",");
  const inputBlocker = CGQAProviderInputBlocker.create({
    getTarget: () => getComposerContainer(),
    isTargetHidden: (target) => target.classList.contains(HIDDEN_COMPOSER_CLASS)
  });
  function getConversationId() {
    const chatMatch = location.pathname.match(/^\/c\/([^/?#]+)/);
    if (chatMatch) {
      return chatMatch[1];
    }

    const gMatch = location.pathname.match(/^\/g\/(.+)/);
    if (gMatch) {
      return `g/${gMatch[1].replace(/\/$/, "")}`;
    }

    return "new-chat";
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
      return getTurnContainerForMessageNode(message);
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
    return getMessageNodesByRole(turn, role)[0] || null;
  }

  function getMessageNode(turn) {
    return getMessageNodeByRole(turn, "assistant");
  }

  function getMessageNodesByRole(turn, role) {
    if (!turn || !role) {
      return [];
    }
    if (turn.matches(`[data-message-author-role='${role}']`)) {
      return [turn];
    }
    return Array.from(turn.querySelectorAll(`[data-message-author-role='${role}']`)).filter((message) => {
      return !message.parentElement || !message.parentElement.closest("[data-message-author-role]");
    });
  }

  function getMarkdownNodes(turn) {
    const markdowns = getMessageNodesByRole(turn, "assistant").flatMap((message) => {
      return Array.from(message.querySelectorAll(".markdown.prose, .markdown-new-styling, .markdown"));
    });
    return markdowns.filter((markdown) => {
      return !markdown.parentElement || !markdown.parentElement.closest(".markdown.prose, .markdown-new-styling, .markdown");
    });
  }

  function getMessageNodeForMarkdown(markdown) {
    return markdown ? markdown.closest("[data-message-author-role='assistant']") : null;
  }

  function getMessageIdFromNode(message) {
    return message ? message.getAttribute("data-message-id") || "" : "";
  }

  function getMarkdownNodeContainingNode(turn, node) {
    return getMarkdownNodes(turn).find((markdown) => isInMarkdown(markdown, node)) || null;
  }

  function getMarkdownNodeIndex(turn, markdown) {
    return getMarkdownNodes(turn).indexOf(markdown);
  }

  function getMessageId(turn) {
    const message = getMessageNode(turn);
    return getMessageIdFromNode(message);
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

    const codeLike = element.closest("pre, .cm-editor, .cm-content");
    if (!codeLike) {
      return null;
    }

    const preAncestors = [];
    let current = codeLike;
    while (current && current !== markdown) {
      if (current.matches && current.matches("pre")) {
        preAncestors.push(current);
      }
      current = current.parentElement;
    }
    const codeBlock = preAncestors[preAncestors.length - 1] || codeLike;
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

  function createTextWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (parent && parent.closest(`${CHIP_SELECTOR}, .${BLOCK_REFERENCE_BAR_CLASS}`)) {
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

  function createAnchorFromRange(markdown, range, markdownIndex) {
    const offsets = getRangeOffsets(markdown, range);
    if (!isValidTextSpan(offsets)) {
      return null;
    }
    return {
      ...offsets,
      markdownIndex,
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

    const startMarkdown = getMarkdownNodeContainingNode(startTurn, range.startContainer);
    const endMarkdown = getMarkdownNodeContainingNode(startTurn, range.endContainer);
    if (!startMarkdown || !endMarkdown) {
      return { ok: false, reason: "请只选择 ChatGPT 回复正文，不要选择思考提示或操作按钮。" };
    }
    if (startMarkdown !== endMarkdown) {
      return { ok: false, reason: "暂不支持跨思考分段选择，请只选择同一段回复正文。" };
    }

    const markdown = startMarkdown;
    const markdownIndex = getMarkdownNodeIndex(startTurn, markdown);
    const sourceMessage = getMessageNodeForMarkdown(markdown);

    if (isBadSelectionNode(range.startContainer) || isBadSelectionNode(range.endContainer)) {
      return { ok: false, reason: "请只选择 ChatGPT 回复正文内容。" };
    }

    const selectedText = normalizeText(selection.toString()).trim();
    if (!selectedText) {
      return { ok: false, reason: "选择内容为空。" };
    }

    const anchor = createAnchorFromRange(markdown, range, markdownIndex);
    if (!anchor) {
      return { ok: false, reason: "当前选区结构过于复杂，无法稳定定位。" };
    }

    const complex = isInsideComplexContent(range.startContainer) || isInsideComplexContent(range.endContainer);

    return {
      ok: true,
      range,
      turn: startTurn,
      markdown,
      markdownIndex,
      sourceMessageId: getMessageIdFromNode(sourceMessage),
      selectedText,
      complex,
      ...anchor
    };
  }

  function attachSelectionAction(button, context = {}) {
    let timer = 0;
    let attachedGroup = null;
    const startedAt = Date.now();

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (attachedGroup) {
        attachedGroup.classList.remove(ATTACHED_SELECTION_GROUP_CLASS);
        attachedGroup.style.removeProperty("--cgqa-selection-toolbar-height");
        attachedGroup = null;
      }
    };

    const tryAttach = () => {
      const target = findOfficialSelectionButtonGroup();
      if (target) {
        if (attachedGroup && attachedGroup !== target.group) {
          attachedGroup.classList.remove(ATTACHED_SELECTION_GROUP_CLASS);
          attachedGroup.style.removeProperty("--cgqa-selection-toolbar-height");
        }
        attachedGroup = target.group;
        prepareOfficialSelectionGroup(target.group, target.officialButton);
        if (button.parentElement !== target.group) {
          target.group.append(button);
        }
      }

      if (Date.now() - startedAt >= OFFICIAL_SELECTION_ATTACH_TIMEOUT_MS) {
        if (!button.isConnected && hasActiveTextSelection() && typeof context.showToast === "function") {
          context.showToast("未找到 ChatGPT 选择工具条，请重新选择正文内容。");
        }
        return;
      }

      timer = window.setTimeout(tryAttach, 50);
    };

    tryAttach();
    return cleanup;
  }

  function findOfficialSelectionButtonGroup() {
    const buttons = Array.from(document.querySelectorAll("button")).filter((button) => {
      if (
        button.closest(".cgqa-root, .cgqa-selection-menu")
        || button.classList.contains(ATTACHED_SELECTION_BUTTON_CLASS)
        || button.classList.contains("cgqa-quote-chip")
      ) {
        return false;
      }
      const text = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
      return /询问\s*ChatGPT|Ask\s*ChatGPT/i.test(text)
        || (isInsideOfficialSelectionToolbar(button) && /引用|Quote/i.test(text));
    });
    const officialButton = buttons.find(isVisibleElement);
    if (!officialButton || !officialButton.parentElement) {
      return null;
    }
    return {
      group: officialButton.parentElement,
      officialButton
    };
  }

  function prepareOfficialSelectionGroup(group, officialButton) {
    const buttonHeight = Math.round(officialButton.getBoundingClientRect().height);
    group.classList.add(ATTACHED_SELECTION_GROUP_CLASS);
    if (buttonHeight > 0) {
      group.style.setProperty("--cgqa-selection-toolbar-height", `${buttonHeight}px`);
    }
  }

  function isInsideOfficialSelectionToolbar(button) {
    return Boolean(
      button.closest(".fixed.select-none")
      || button.parentElement && /\bshadow-long\b/.test(button.parentElement.className || "")
    );
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasActiveTextSelection() {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
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
    document.querySelectorAll(`.${BLOCK_REFERENCE_BAR_CLASS}`).forEach((bar) => {
      bar.remove();
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
        const includeChip = options.includeChip !== false && index === slices.length - 1;
        wrapTextSlice(slices[index], thread, includeChip, options);
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

    const mark = createMarkElement(thread, options);
    selectedNode.parentNode.insertBefore(mark, selectedNode);
    mark.insertBefore(selectedNode, mark.firstChild);
    if (includeChip) {
      const anchor = getInlineCodeAncestor(mark) || mark;
      anchor.parentNode.insertBefore(createChipElement(thread, options), anchor.nextSibling);
    }
  }

  function markSurfaceBlock(markdown, range, thread, options = {}) {
    const complex = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const block = complex ? complex.closest(SURFACE_SELECTOR) : null;
    if (!block || !markdown.contains(block) || block.closest(MARK_SELECTOR) || block.querySelector(MARK_SELECTOR)) {
      return false;
    }

    applySurfaceMark(block, thread, options);
    return true;
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
    if (!turn || hasThreadMark(thread.threadId)) {
      return false;
    }

    const resolved = resolveAnchorMarkdownAndRange(turn, thread.anchor || {});
    if (!resolved) {
      return false;
    }
    const { markdown, range } = resolved;

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
    const offsetRange = findRangeByOffsets(markdown, anchor);
    return offsetRange || findRangeByContext(markdown, anchor);
  }

  function resolveAnchorMarkdownAndRange(turn, anchor) {
    const markdowns = getMarkdownNodes(turn);
    const preferredIndex = Number.isInteger(anchor.markdownIndex) ? anchor.markdownIndex : -1;
    const candidates = preferredIndex >= 0 && markdowns[preferredIndex]
      ? [markdowns[preferredIndex]]
      : markdowns;

    for (const markdown of candidates) {
      const range = resolveAnchorRange(markdown, anchor);
      if (range) {
        return { markdown, range };
      }
    }

    return null;
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
    const sectionTurns = Array.from(document.querySelectorAll("section[data-testid^='conversation-turn-'][data-turn], section[data-turn]"))
      .map(getTurnContainerForMessageNode);
    const messageTurns = Array.from(document.querySelectorAll("[data-message-author-role='user'], [data-message-author-role='assistant']"))
      .map(getTurnContainerForMessageNode);
    return sortElementsByDocumentOrder(uniqueElements([...sectionTurns, ...messageTurns]));
  }

  function getTurnText(turn) {
    const role = getTurnRole(turn);
    const message = getMessageNodeByRole(turn, role) || turn;
    if (role === "assistant") {
      return getMarkdownText(getMarkdownNodes(turn));
    }
    return getReadableText(message).trim();
  }

  function getMarkdownText(markdowns) {
    return markdowns.map((markdown) => getReadableText(markdown).trim()).filter(Boolean).join("\n\n");
  }

  function getMarkdownHtml(markdowns) {
    return markdowns.map((markdown) => getSanitizedHtml(markdown)).filter(Boolean).join("");
  }

  function getAllTurnRecords() {
    return getAllTurns().map((turn, index) => {
      const role = getTurnRole(turn);
      const message = getMessageNodeByRole(turn, role);
      const markdowns = role === "assistant" ? getMarkdownNodes(turn) : [];
      const html = getMarkdownHtml(markdowns);
      return {
        index,
        turn,
        role,
        turnId: getTurnId(turn),
        messageId: getMessageIdFromNode(message),
        text: getTurnText(turn),
        html,
        contentFormat: html ? "html" : "text"
      };
    }).filter((record) => record.role && record.turn);
  }

  function getAssistantTurns() {
    const sectionTurns = Array.from(document.querySelectorAll("section[data-turn='assistant']"))
      .map(getTurnContainerForMessageNode);
    const messageTurns = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"))
      .map(getTurnContainerForMessageNode);
    return sortElementsByDocumentOrder(uniqueElements([...sectionTurns, ...messageTurns]));
  }

  function getUserTurnCount() {
    return getAllTurns().filter((turn) => getTurnRole(turn) === "user").length;
  }

  function getTurnContainerForMessageNode(node) {
    return getVisualTurnShell(node)
      || node.closest("section[data-turn], section[data-testid^='conversation-turn-'], [data-testid^='conversation-turn-']")
      || node;
  }

  function getVisualTurnShell(node) {
    return node ? node.closest(".agent-turn, .user-turn, [class*='group/turn-messages']") : null;
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
      const markdowns = getMarkdownNodes(turn);
      const text = getMarkdownText(markdowns);
      const html = getMarkdownHtml(markdowns);
      return {
        index,
        turn,
        turnId: getTurnId(turn),
        messageId: getMessageIdFromNode(message),
        text,
        html,
        contentFormat: html ? "html" : "text"
      };
    }).filter((record) => record.text);
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
      getAssistantRecordsBeforeNextUser(records, index).forEach((assistantRecord) => {
        turnsToDecorate.set(assistantRecord.turn, target);
      });
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
      return {
        ...value,
        unload: Boolean(value.unload)
      };
    }).filter((target) => {
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

  function getAssistantRecordsBeforeNextUser(records, startIndex) {
    const assistantRecords = [];
    for (let index = startIndex + 1; index < records.length; index += 1) {
      const record = records[index];
      if (record.role === "user") {
        break;
      }
      if (record.role === "assistant") {
        assistantRecords.push(record);
      }
    }
    return assistantRecords;
  }

  function hideMainTurn(turn, target) {
    if (!turn.classList.contains(HIDDEN_TURN_CLASS)) {
      turn.classList.add(HIDDEN_TURN_CLASS);
    }
    hideThoughtControlsForTurn(turn);
    if (turn.dataset.cgqaHiddenThreadId !== (target.threadId || "")) {
      turn.dataset.cgqaHiddenThreadId = target.threadId || "";
    }
    if (turn.dataset.cgqaHiddenPromptToken !== (target.promptToken || "")) {
      turn.dataset.cgqaHiddenPromptToken = target.promptToken || "";
    }
  }

  function removeMainTurn(turn) {
    if (!turn || turn.closest(".cgqa-root")) {
      return;
    }
    hideThoughtControlsForTurn(turn);
    turn.remove();
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
    unhideThoughtControlsForTurn(turn);
  }

  function hideThoughtControlsForTurn(turn) {
    getThoughtControlCandidates(turn).forEach((node) => {
      node.classList.add(HIDDEN_NATIVE_CONTROL_CLASS);
      node.dataset.cgqaHiddenThoughtControl = "true";
    });
  }

  function unhideThoughtControlsForTurn(turn) {
    getThoughtControlCandidates(turn).forEach((node) => {
      if (node.dataset.cgqaHiddenThoughtControl === "true") {
        node.classList.remove(HIDDEN_NATIVE_CONTROL_CLASS);
        delete node.dataset.cgqaHiddenThoughtControl;
      }
    });
  }

  function getThoughtControlCandidates(turn) {
    if (!turn) {
      return [];
    }
    const shell = getVisualTurnShell(turn) || turn;
    return Array.from(shell.querySelectorAll("button")).filter(isThoughtControl);
  }

  function isThoughtControl(button) {
    const text = getNodeControlText(button).replace(/\s+/g, " ").trim();
    return /^thought for\b/i.test(text)
      || /^thoughts?$/i.test(text)
      || /^已思考\b/.test(text)
      || /^思考(过程|详情)?$/.test(text);
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

  function getScrollContainer() {
    const chatScrollRoot = Array.from(document.querySelectorAll("[class*='group/scroll-root']")).find(isScrollableElement);
    return chatScrollRoot || document.scrollingElement || document.documentElement;
  }

  function isScrollableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 8;
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

  function syncPendingResponseState(state) {
    inputBlocker.setBlocked(Boolean(state && state.active));
  }

  function isResponseGenerating() {
    return getNativeGenerationControlCandidates().some(isVisibleIgnoringPluginHiddenClass);
  }

  async function stopGeneration() {
    document.querySelectorAll(`.${HIDDEN_NATIVE_CONTROL_CLASS}`).forEach((node) => {
      unhideNativeGenerationControl(node);
    });
    const button = findNativeGenerationButton();
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

  function findNativeGenerationButton() {
    const selectors = [
      "button[data-testid*='stop' i]",
      "[role='button'][data-testid*='stop' i]",
      "button[aria-label*='stop' i]",
      "[role='button'][aria-label*='stop' i]",
      "button[aria-label*='停止']",
      "[role='button'][aria-label*='停止']"
    ];
    return selectors.map((selector) => {
      try {
        return document.querySelector(selector);
      } catch (_error) {
        return null;
      }
    }).find(isGenerationControlButton)
      || Array.from(document.querySelectorAll("button, [role='button']")).find(isGenerationControlButton)
      || null;
  }

  function isGenerationControlButton(node) {
    return Boolean(
      node
      && node.nodeType === Node.ELEMENT_NODE
      && !node.closest(".cgqa-root, .cgqa-selection-menu, .cgqa-toast")
      && !node.disabled
      && node.getAttribute("aria-disabled") !== "true"
      && isGenerationControlText(getNodeControlText(node))
    );
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

  function isGenerationControlText(text) {
    return /停止|stop|中止|cancel/.test(text)
      && !/上传|upload|附件|attach|麦克风|microphone|语音|voice|图片|image/.test(text);
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

  globalThis.CGQAChatGPTDom = {
    validateSelection,
    attachSelectionAction,
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
    getScrollContainer,
    submitPrompt
  };
})();
