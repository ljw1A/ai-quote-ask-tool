# ChatGPT Quote Annotation

Chrome/Edge Manifest V3 browser extension for lightweight quote annotation threads on ChatGPT.

## Install for Development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Click "Load unpacked".
4. Select this project directory.
5. Open `https://chatgpt.com/`.

Clicking the extension icon opens a small menu. Use `打开提问管理` to open the standalone local management page.

## MVP Behavior

- Select text inside a ChatGPT assistant reply.
- Click the `提问` button attached to ChatGPT's native selection toolbar.
- The selected reply text receives a lightweight `提问 N` marker.
- A draggable floating annotation panel opens for that quote.
- The ChatGPT main composer is visually hidden while a quote panel is open, so follow-up questions go through the panel while the underlying composer remains mounted for scripted submission.
- Questions typed in the panel are saved in the quote thread and sent through the ChatGPT main composer with the quote as hidden context.
- The panel can remember a global reply style: default, longer, shorter, or a custom instruction inserted into the generated prompt.
- Plugin-generated main-chat prompts and their replies are hidden while the quote thread exists, then restored when the quote is deleted.
- Threads are stored locally with `chrome.storage.local`, grouped by conversation id, and indexed for the standalone management page.
- The management page can view saved conversations, delete a single question thread, delete all saved threads in a conversation, and open the original conversation URL.

## Internal Flow

The extension is split into these responsibilities:

- `src/content.js` is the orchestration layer. It owns lifecycle, event binding, thread state, and the quote flow: validate selection -> build thread -> register thread -> open panel -> persist thread -> render marker.
- `src/providers/chatgpt-dom.js` is the current ChatGPT DOM driver. It owns ChatGPT selectors, selection offsets, quote marker rendering/restoration, prompt filling, send button lookup, and assistant response capture.
- `src/providers/chatgpt.js` wraps the ChatGPT DOM driver as a provider. Future AI sites should add their own provider registration plus DOM driver instead of adding host-specific branches to `content.js`.
- `src/provider.js` resolves the active page provider for the current host.
- `src/sidebar.js` is the panel and selection-action renderer. It rebuilds the overlay panel on open and attaches the `提问` action to ChatGPT's native selection toolbar.
- `src/storage.js` owns the provider-aware persisted conversation/thread shape and the conversation index used by the management page.
- `src/sanitize.js` owns shared safe HTML rendering for saved assistant replies across the sidebar and management page.
- `popup.html` and `src/popup.js` own the extension action menu.
- `manager.html` and `src/manager.js` own the standalone local management page.

When changing behavior, keep the order above intact. Opening the panel should stay independent from storage and marker rendering; those failures should degrade with a toast instead of blocking the visible annotation thread.

Provider code should reuse the shared business flow, not force a shared DOM implementation. Keep lifecycle, storage, sidebar rendering, management, sanitization, and pending-response capture provider-neutral. Keep page-specific DOM selection, quote marking, composer submission, reply extraction, and main-page hiding inside each provider driver, because different AI sites can have very different DOM structures and interaction constraints.

## Notes

- The extension does not call OpenAI APIs directly.
- Data stays local unless ChatGPT itself receives a question through the page composer.
- Saved conversations are keyed by provider id and conversation id so future AI-page adapters can share the same manager without id collisions.
- Code blocks and formulas are handled conservatively so the extension does not corrupt ChatGPT's rendered DOM.
- If a saved quote cannot be matched safely after refresh or response switching, the extension does not render a marker.
