(function () {
  "use strict";

  const USER_SCROLL_EVENTS = ["wheel", "mousewheel", "touchstart", "touchmove", "keydown", "pointerdown", "mousedown"];
  const USER_SCROLL_GESTURE_END_EVENTS = ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"];
  const USER_SCROLL_GRACE_MS = 1200;
  const USER_SCROLL_IDLE_MS = 900;
  const USER_SCROLL_GESTURE_START_EVENTS = new Set(["touchstart", "pointerdown", "mousedown"]);
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
    let userScrollGestureActive = false;
    let userScrollAllowedUntil = 0;
    const getTarget = typeof options.getTarget === "function" ? options.getTarget : getDefaultTarget;

    function lock(options = {}) {
      const nextTarget = resolveTarget();
      if (active && nextTarget === scrollTarget) {
        if (options.resetPosition) {
          resetUserScrollState();
          const position = getPosition(scrollTarget);
          lockedLeft = position.left;
          lockedTop = position.top;
          return;
        }
        restoreLockedPosition();
        return;
      }

      unlock();
      scrollTarget = nextTarget;
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
      removeScrollListener(scrollTarget);
      active = false;
      resetUserScrollState();
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
      if (!isUserScrollIntentTarget(event)) {
        return;
      }
      if (USER_SCROLL_GESTURE_START_EVENTS.has(event.type)) {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }
        pauseForUserScroll({ untilGestureEnd: true });
        return;
      }
      pauseForUserScroll();
    }

    function handleScroll() {
      if (!active || restoring) {
        return;
      }
      const position = getPosition(scrollTarget);
      if (userScrolling) {
        adoptScrollPosition(position);
        return;
      }
      if (isUserScrollGraceActive()) {
        adoptScrollPosition(position);
        return;
      }
      if (adoptUnpromptedUpwardScroll(position)) {
        return;
      }
      restoreLockedPosition(position);
    }

    function pauseForUserScroll(options = {}) {
      userScrolling = true;
      userScrollAllowedUntil = Date.now() + USER_SCROLL_GRACE_MS;
      clearRelockTimer();
      if (options.untilGestureEnd) {
        beginUserScrollGesture();
        return;
      }
      if (!userScrollGestureActive) {
        scheduleRelockAfterUserScroll();
      }
    }

    function beginUserScrollGesture() {
      if (userScrollGestureActive) {
        return;
      }
      userScrollGestureActive = true;
      USER_SCROLL_GESTURE_END_EVENTS.forEach((type) => window.addEventListener(type, handleUserScrollGestureEnd, {
        capture: true,
        passive: true
      }));
    }

    function handleUserScrollGestureEnd() {
      if (!userScrollGestureActive) {
        return;
      }
      userScrollGestureActive = false;
      removeUserScrollGestureEndListeners();
      if (active) {
        scheduleRelockAfterUserScroll();
      }
    }

    function scheduleRelockAfterUserScroll() {
      clearRelockTimer();
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

    function restoreLockedPosition(position = getPosition(scrollTarget)) {
      if (position.left === lockedLeft && position.top === lockedTop) {
        return;
      }
      restoring = true;
      setPosition(scrollTarget, { left: lockedLeft, top: lockedTop });
      requestAnimationFrame(() => {
        restoring = false;
      });
    }

    function adoptUnpromptedUpwardScroll(position) {
      if (position.left >= lockedLeft && position.top >= lockedTop) {
        return false;
      }
      adoptScrollPosition(position);
      return true;
    }

    function adoptScrollPosition(position) {
      lockedLeft = position.left;
      lockedTop = position.top;
    }

    function isUserScrollGraceActive() {
      return userScrollAllowedUntil && Date.now() < userScrollAllowedUntil;
    }

    function resetUserScrollState() {
      clearRelockTimer();
      removeUserScrollGestureEndListeners();
      userScrollGestureActive = false;
      userScrolling = false;
      userScrollAllowedUntil = 0;
    }

    function clearRelockTimer() {
      if (!relockTimer) {
        return;
      }
      clearTimeout(relockTimer);
      relockTimer = 0;
    }

    function removeUserScrollGestureEndListeners() {
      USER_SCROLL_GESTURE_END_EVENTS.forEach((type) => window.removeEventListener(type, handleUserScrollGestureEnd, true));
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

    function isUserScrollIntentTarget(event) {
      if (isInsidePluginUi(event.target)) {
        return false;
      }
      if (event.type === "keydown") {
        return true;
      }
      if (isWindowTarget(scrollTarget)) {
        return true;
      }
      const element = getElementFromNode(event.target);
      return Boolean(element && (element === scrollTarget || scrollTarget.contains(element) || document.documentElement.contains(element)));
    }

    function isInsidePluginUi(node) {
      const element = getElementFromNode(node);
      return Boolean(element && element.closest(".cgqa-root"));
    }

    function getElementFromNode(node) {
      if (!node) {
        return null;
      }
      if (node === window || node === document) {
        return document.documentElement;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement;
      }
      return node.nodeType === Node.ELEMENT_NODE ? node : null;
    }

    return {
      lock,
      unlock
    };
  }

  globalThis.CGQAScrollLock = { create };
})();
