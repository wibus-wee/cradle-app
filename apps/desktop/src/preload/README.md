# Desktop Preload

This directory owns the sandboxed Electron preload bridge exposed to renderer windows as `window.cradle`.

## Files

- `index.ts`: Exposes server URL/environment metadata, typed invoke/listener wrappers, window controls, desktop update events, desktop app badge updates, tray action events, desktop-owned chat stream IPC methods plus chunk/close/error event subscriptions, and the BrowserPanel bridge including renderer `<webview>` session/preload configuration plus attach/detach IPC.
- `browser-panel.ts`: Sandboxed guest-page preload entry for native BrowserPanel tabs. Keeps the Electron bridge thin by exposing `window.codex.sendPrompt(...)`, forwarding normalized prompt/attachment payloads, and bootstrapping the annotation runtime.
- `browser-panel-contract.ts`: BrowserPanel guest-page preload channels and runtime payload contracts shared by the thin entry, prompt bridge, and annotation runtime.
- `browser-panel-prompt.ts`: Normalizes `window.codex.sendPrompt(...)` text and attachment inputs into the desktop BrowserPanel prompt payload.
- `browser-annotation-runtime.ts`: Guest-page annotation runtime injected into the BrowserPanel `WebContentsView`; owns page DOM inspection, annotation overlay state, marker rendering, design changes, and runtime event emission.
- `browser-annotation-toolbar.ts`: HTML/CSS renderer for the injected annotation toolbar.
- `browser-annotation-marker.ts`: CSS for injected annotation markers.
