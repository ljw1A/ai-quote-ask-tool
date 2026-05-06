(function () {
  "use strict";

  const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown"];
  const USER_SCROLL_IDLE_MS = 900;
  const SCROLL_KEYS = new Set([
    "ArrowDown",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
    " ",
    "Spacebar"
  ]);

  function create(options = {}) {
    let active = false;
    let userScrolling = false;
    let scrollTarget = null;
    let lockedLeft = 0;
    let lockedTop = 0;
    let restoring = false;
    let relockTimer = 0;
    const getTarget = typeof options.getTarget === "function" ? options.getTarget : getDefaultTarget;

    function lock() {
      unlock();
      scrollTarget = resolveTarget();
      active = true;
      userScrolling = false;
      const position = getPosition(scrollTarget);
      lockedLeft = position.left;
      lockedTop = position.top;
      USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, handleUserScrollIntent, {
        capture: true,
        passive: true
      }));
      addScrollListener(scrollTarget);
    }

    function unlock() {
      if (relockTimer) {
        clearTimeout(relockTimer);
        relockTimer = 0;
      }
      removeScrollListener(scrollTarget);
      active = false;
      userScrolling = false;
      restoring = false;
      scrollTarget = null;
      USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, handleUserScrollIntent, true));
    }

    function handleUserScrollIntent(event) {
      if (!active) {
        return;
      }
      if (event.type === "keydown" && !SCROLL_KEYS.has(event.key)) {
        return;
      }
      if (event.type !== "keydown" && !isEventInsideScrollTarget(event)) {
        return;
      }
      pauseForUserScroll();
    }

    function handleScroll() {
      if (!active || userScrolling || restoring) {
        return;
      }
      restoreLockedPosition();
    }

    function pauseForUserScroll() {
      userScrolling = true;
      if (relockTimer) {
        clearTimeout(relockTimer);
      }
      relockTimer = setTimeout(() => {
        relockTimer = 0;
        if (!active) {
          return;
        }
        const position = getPosition(scrollTarget);
        lockedLeft = position.left;
        lockedTop = position.top;
        userScrolling = false;
      }, USER_SCROLL_IDLE_MS);
    }

    function restoreLockedPosition() {
      const position = getPosition(scrollTarget);
      if (position.left === lockedLeft && position.top === lockedTop) {
        return;
      }
      restoring = true;
      setPosition(scrollTarget, { left: lockedLeft, top: lockedTop });
      requestAnimationFrame(() => {
        restoring = false;
      });
    }

    function resolveTarget() {
      const target = getTarget();
      if (isUsableElement(target) || target === window) {
        return target;
      }
      return getDefaultTarget();
    }

    function getDefaultTarget() {
      return document.scrollingElement || document.documentElement || window;
    }

    function isUsableElement(target) {
      return target && target.nodeType === Node.ELEMENT_NODE;
    }

    function isWindowTarget(target) {
      return target === window;
    }

    function addScrollListener(target) {
      if (isWindowTarget(target)) {
        window.addEventListener("scroll", handleScroll, true);
        return;
      }
      target.addEventListener("scroll", handleScroll, { passive: true });
    }

    function removeScrollListener(target) {
      if (!target) {
        return;
      }
      if (isWindowTarget(target)) {
        window.removeEventListener("scroll", handleScroll, true);
        return;
      }
      target.removeEventListener("scroll", handleScroll);
    }

    function getPosition(target) {
      if (isWindowTarget(target)) {
        return {
          left: window.scrollX,
          top: window.scrollY
        };
      }
      return {
        left: target.scrollLeft,
        top: target.scrollTop
      };
    }

    function setPosition(target, position) {
      if (isWindowTarget(target)) {
        window.scrollTo(position.left, position.top);
        return;
      }
      target.scrollLeft = position.left;
      target.scrollTop = position.top;
    }

    function isEventInsideScrollTarget(event) {
      if (isWindowTarget(scrollTarget)) {
        return !isInsidePluginUi(event.target);
      }
      const element = event.target && event.target.nodeType === Node.TEXT_NODE
        ? event.target.parentElement
        : event.target;
      return Boolean(element && !isInsidePluginUi(element) && (element === scrollTarget || scrollTarget.contains(element)));
    }

    function isInsidePluginUi(node) {
      const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return Boolean(element && element.closest(".cgqa-root"));
    }

    return {
      lock,
      unlock
    };
  }

  globalThis.CGQAScrollLock = { create };
})();
