(function () {
  "use strict";

  const BLOCKER_CLASS = "cgqa-provider-input-blocker";
  const DEFAULT_TEXT = "AI 正在回复，暂时锁定主输入";

  function create(options = {}) {
    let blocker = null;
    let cleanup = null;

    function setBlocked(blocked) {
      if (!blocked) {
        remove();
        return;
      }
      ensure();
      update();
    }

    function ensure() {
      if (!blocker) {
        blocker = document.createElement("div");
        blocker.className = BLOCKER_CLASS;
        blocker.setAttribute("aria-hidden", "true");
        blocker.textContent = options.text || DEFAULT_TEXT;
        document.body.append(blocker);
      }
      if (!cleanup) {
        window.addEventListener("resize", update, true);
        window.addEventListener("scroll", update, true);
        cleanup = () => {
          window.removeEventListener("resize", update, true);
          window.removeEventListener("scroll", update, true);
        };
      }
    }

    function update() {
      if (!blocker) {
        return;
      }

      const target = typeof options.getTarget === "function" ? options.getTarget() : null;
      const isHidden = target && typeof options.isTargetHidden === "function" && options.isTargetHidden(target);
      if (!target || isHidden) {
        blocker.hidden = true;
        return;
      }

      const rect = target.getBoundingClientRect();
      blocker.hidden = rect.width <= 0 || rect.height <= 0;
      Object.assign(blocker.style, {
        left: `${Math.max(0, rect.left)}px`,
        top: `${Math.max(0, rect.top)}px`,
        width: `${Math.max(0, rect.width)}px`,
        height: `${Math.max(0, rect.height)}px`
      });
    }

    function remove() {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      if (blocker) {
        blocker.remove();
        blocker = null;
      }
    }

    return {
      setBlocked,
      update,
      remove
    };
  }

  globalThis.CGQAProviderInputBlocker = { create };
})();
