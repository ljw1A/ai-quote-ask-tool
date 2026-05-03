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
- Plugin-generated main-chat prompts and their replies are hidden while the quote thread exists, then restored when the quote is deleted.
- Threads are stored locally with `chrome.storage.local`, grouped by conversation id, and indexed for the standalone management page.
- The management page can view saved conversations, delete a single question thread, delete all saved threads in a conversation, and open the original conversation URL.

## Internal Flow

The extension is split into these responsibilities:

- `src/content.js` is the orchestration layer. It owns lifecycle, event binding, thread state, and the quote flow: validate selection -> build thread -> register thread -> open panel -> persist thread -> render marker.
- `src/dom.js` is the ChatGPT page adapter. It owns selectors, selection offsets, quote marker rendering/restoration, prompt filling, send button lookup, and assistant response capture.
- `src/sidebar.js` is the panel and selection-action renderer. It rebuilds the overlay panel on open and attaches the `提问` action to ChatGPT's native selection toolbar.
- `src/storage.js` owns the persisted conversation/thread shape and the conversation index used by the management page.
- `src/sanitize.js` owns shared safe HTML rendering for saved assistant replies across the sidebar and management page.
- `popup.html` and `src/popup.js` own the extension action menu.
- `manager.html` and `src/manager.js` own the standalone local management page.

When changing behavior, keep the order above intact. Opening the panel should stay independent from storage and marker rendering; those failures should degrade with a toast instead of blocking the visible annotation thread.

## Notes

- The extension does not call OpenAI APIs directly.
- Data stays local unless ChatGPT itself receives a question through the page composer.
- Code blocks and formulas are handled conservatively so the extension does not corrupt ChatGPT's rendered DOM.
- If a saved quote cannot be matched safely after refresh or response switching, the extension does not render a marker.
