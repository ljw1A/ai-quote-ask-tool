(function () {
  "use strict";

  const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown"];
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

  function create() {
    let active = false;
    let userReleased = false;
    let lockedX = 0;
    let lockedY = 0;
    let restoreTimer = 0;

    function lock() {
      unlock();
      active = true;
      userReleased = false;
      lockedX = window.scrollX;
      lockedY = window.scrollY;
      USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, handleUserScrollIntent, {
        capture: true,
        passive: true
      }));
      window.addEventListener("scroll", handleScroll, true);
    }

    function unlock() {
      if (restoreTimer) {
        clearTimeout(restoreTimer);
        restoreTimer = 0;
      }
      active = false;
      userReleased = false;
      USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, handleUserScrollIntent, true));
      window.removeEventListener("scroll", handleScroll, true);
    }

    function handleUserScrollIntent(event) {
      if (!active) {
        return;
      }
      if (event.type === "keydown" && !SCROLL_KEYS.has(event.key)) {
        return;
      }
      userReleased = true;
    }

    function handleScroll() {
      if (!active || userReleased) {
        return;
      }
      if (restoreTimer) {
        return;
      }
      restoreTimer = setTimeout(() => {
        restoreTimer = 0;
        if (!active || userReleased) {
          return;
        }
        if (window.scrollX !== lockedX || window.scrollY !== lockedY) {
          window.scrollTo(lockedX, lockedY);
        }
      }, 0);
    }

    return {
      lock,
      unlock
    };
  }

  globalThis.CGQAScrollLock = { create };
})();
