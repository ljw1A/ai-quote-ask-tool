# ChatGPT Quote Annotation

Chrome/Edge Manifest V3 browser extension for lightweight quote annotation threads on ChatGPT.

## Install for Development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Click "Load unpacked".
4. Select this project directory.
5. Open `https://chatgpt.com/`.

## MVP Behavior

- Select text inside a ChatGPT assistant reply.
- Click the floating `批注` button.
- The selected reply text receives a lightweight `引用 N` marker.
- A right-side annotation panel opens for that quote.
- The ChatGPT main composer is hidden while a quote panel is open, so follow-up questions go through the panel.
- Questions typed in the panel are saved in the quote thread and sent through the ChatGPT main composer with the quote as hidden context.
- Plugin-generated main-chat prompts and their replies are hidden while the quote thread exists, then restored when the quote is deleted or the conversation annotations are cleared.
- Threads are stored locally with `chrome.storage.local`, grouped by conversation id.

## Internal Flow

The extension is split into three runtime responsibilities:

- `src/content.js` is the orchestration layer. It owns lifecycle, event binding, thread state, and the quote flow: validate selection -> build thread -> register thread -> open panel -> persist thread -> render marker.
- `src/dom.js` is the ChatGPT page adapter. It owns selectors, selection offsets, quote marker rendering/restoration, prompt filling, send button lookup, and assistant response capture.
- `src/sidebar.js` is the panel renderer. It rebuilds the overlay panel on open so old hidden nodes or stale injected scripts cannot keep the panel invisible.

When changing behavior, keep the order above intact. Opening the panel should stay independent from storage and marker rendering; those failures should degrade with a toast instead of blocking the visible annotation thread.

## Notes

- The extension does not call OpenAI APIs directly.
- Data stays local unless ChatGPT itself receives a question through the page composer.
- Code blocks and formulas are handled conservatively so the extension does not corrupt ChatGPT's rendered DOM.
- If a saved quote cannot be matched safely after refresh or response switching, the extension does not render a marker.
