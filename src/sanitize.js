(function () {
  "use strict";

  const ALLOWED_TAGS = new Set([
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
    const sanitized = sanitizeNode(sourceNode);
    if (sanitized) {
      parent.append(sanitized);
    }
  }

  function sanitizeNode(sourceNode) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(sourceNode.nodeValue || "");
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const tagName = sourceNode.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      Array.from(sourceNode.childNodes).forEach((child) => appendSanitizedNode(fragment, child));
      return fragment;
    }

    const element = document.createElement(tagName);
    copySafeAttributes(sourceNode, element, tagName);
    Array.from(sourceNode.childNodes).forEach((child) => appendSanitizedNode(element, child));
    return element;
  }

  function copySafeAttributes(sourceNode, targetNode, tagName) {
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

  globalThis.CGQASanitize = {
    sanitizeMessageHtml
  };
})();
