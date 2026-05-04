# Project Instructions

## Engineering Standard

- Do not add feature code or bug fixes as scattered patches. Before editing, identify the owning module, the lifecycle/state model, and the single abstraction that should absorb the change.
- Prefer systematic changes over local conditionals. If a bug requires touching more than one call site, create or refine a named helper that describes the behavior.
- Treat cleanup as part of each feature or bug-fix commit. Do not leave temporary compatibility branches, duplicated state handling, or one-off DOM patches for a later "cleanup only" commit unless the user explicitly asks to split the work.
- When changing behavior, update the nearest lifecycle helper and this checklist if the new behavior creates a recurring regression risk.
- Keep behavior ownership clear:
  - `src/content.js` owns runtime state, thread lifecycle, persistence timing, and ChatGPT send/capture orchestration.
  - `src/dom.js` owns ChatGPT DOM queries, selection validation, quote anchoring, mark rendering, main composer operations, and assistant message extraction.
  - `src/sidebar.js` owns plugin UI rendering and panel interactions.
  - `src/storage.js` owns persisted thread data shape and migration/reset policy.
  - `src/sanitize.js` owns shared safe HTML rendering for saved assistant replies. Do not duplicate sanitizer allowlists in page-specific modules.
  - `src/styles.css` owns visual states only; do not encode behavior in CSS class hacks without a JS state owner.
  - `popup.html` / `src/popup.js` own the extension action menu.
  - `manager.html` / `src/manager.js` own the standalone management page.
- Do not introduce a build chain, framework, CDN, or runtime dependency unless the project direction explicitly changes. This is a native Manifest V3 extension.
- Read and write text files as UTF-8.

## Quote Mark Lifecycle

- First visible quote mark rendering must use the live user selection/range whenever possible. Do not delay the first mark render until anchor restoration.
- A newly opened follow-up without any sent question is a draft thread:
  - render a draft mark immediately,
  - keep draft and final marks visually consistent,
  - remove the draft mark if the user closes or abandons it,
  - promote the draft mark when the first question is sent.
- Inline quote chips must be siblings after the text mark, not children inside `.cgqa-quote-mark`. The text mark owns highlight styling; the chip owns button styling.
- Normal DOM mutation recovery should fill in missing persisted marks. Avoid clearing all rendered marks on every mutation, because that can turn a good live mark into a fragile anchor-restore attempt.
- Only clear all rendered marks during initialization, conversation switch, teardown, or explicit deletion.

## Capture And Rendering Rules

- Assistant capture must ignore transient thinking/status text such as `正在思考`, `思考中`, `Thinking`, and similar one-line status labels.
- Plugin-injected marks, chips, buttons, controls, and hidden main-chat prompts must not leak into captured assistant text or sanitized HTML.
- When rendering assistant content in the sidebar, preserve safe HTML structure for Markdown-derived output. Keep sanitization allowlists explicit.

## UI Rules

- Use inline SVG for plugin icons; do not depend on external icon CDNs.
- Use the project green theme for focus, hover, active, and accent states. Avoid browser default blue focus outlines.
- The floating follow-up panel and attached follow-up button should feel native to ChatGPT, but their behavior must remain isolated from ChatGPT's own controls.

## Regression Checklist

Before committing changes that touch quote selection, mark rendering, sending, capture, or sidebar display, verify these cases manually or with focused tests:

- Select normal text, click `提问`, and confirm text highlight plus chip appear immediately.
- Close the panel without sending; the draft mark disappears.
- Send the first question; the draft mark remains, is promoted, and chip count updates.
- Refresh the page; persisted marks restore conservatively without duplicate chips.
- Select a full line or list item; the chip stays after the selected text and is not wrapped by the green text highlight.
- Select inline code such as `<code>mypipe 数组长度太短</code>`; it should render a normal text highlight and chip. Block code inside `pre` should remain conservative.
- Delete a thread; both the text mark and sibling chip are removed.
- Use a thinking model; the sidebar does not capture `正在思考` as the final answer.
- Captured sidebar output does not include plugin chips, hidden prompts, or tracking tokens.
- Saving or deleting a thread updates the storage conversation index used by the management page.
- The management page reads structured storage data only; do not scan ChatGPT DOM to reconstruct question history.
