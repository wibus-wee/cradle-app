---
name: cradle-plugin-browser-use
description: Control Cradle's in-app browser via MCP tools. Use when the Claude Agent needs to navigate websites, click elements, type text, take screenshots, read page content, or inspect DOM structure within the Cradle desktop app's embedded browser panel. Triggers on "open URL", "navigate to", "click the button", "fill the form", "take a screenshot", "what's on the page", "scroll down", "wait for element", "press Enter". This is for the IN-APP browser only — not for external browser automation. Invoke as /cradle-plugin-browser-use.
---

# Browser Use — Cradle In-App Browser Control

## Overview

The Browser Use plugin gives Claude Agent direct control over Cradle's embedded browser panel (the `<webview>` in the desktop app). It uses Chrome DevTools Protocol (CDP) for real input events — clicks, keystrokes, and scrolls behave exactly as if a human performed them.

## Available MCP Tools

### Navigation & Page

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_navigate` | Navigate to a URL | `url` (required), `tabId` |
| `browser_screenshot` | Capture page screenshot (PNG base64) | `fullPage`, `tabId` |
| `browser_get_text` | Get text content of page or element | `selector`, `tabId` |
| `browser_dom_snapshot` | Get accessibility tree (semantic nodes) | `tabId` |
| `browser_eval` | Execute arbitrary JavaScript expression | `expression` (required), `tabId` |

### Interaction

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_click` | Click an element (real mouse event) | `selector` (required), `tabId` |
| `browser_type` | Type text into a focused element | `selector` (required), `text` (required), `tabId` |
| `browser_hover` | Hover over an element | `selector` (required), `tabId` |
| `browser_scroll` | Scroll page or element | `direction` (required: up/down/left/right), `amount`, `selector`, `tabId` |
| `browser_keyboard` | Press key or key combination | `key` (required), `modifiers` (array: ctrl/alt/shift/meta), `tabId` |

### Tab Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_tabs_list` | List all open tabs | (none) |
| `browser_tabs_new` | Open a new browser tab and optionally navigate it | `url` |
| `browser_tabs_close` | Close a browser tab by ID | `tabId` |
| `browser_wait_for_selector` | Wait for element to appear | `selector` (required), `timeout` (ms, default 5000), `tabId` |

## Workflow Pattern

```
1. Open or navigate to URL
2. Wait for key element (if needed)
3. Read page structure (dom_snapshot or get_text)
4. Interact (click, type, scroll)
5. Verify result (screenshot or get_text)
```

## Example Sequences

### Fill a form and submit

```
browser_tabs_new → url: "https://example.com/login"
browser_wait_for_selector → selector: "input[name=email]"
browser_click → selector: "input[name=email]"
browser_type → selector: "input[name=email]", text: "user@example.com"
browser_click → selector: "input[name=password]"
browser_type → selector: "input[name=password]", text: "secret"
browser_click → selector: "button[type=submit]"
browser_wait_for_selector → selector: ".dashboard"
```

### Read and understand a page

```
browser_navigate → url: "https://example.com/docs"
browser_dom_snapshot → (returns accessibility tree with roles, names, values)
browser_get_text → selector: "main" (get text content of main area)
```

### Scroll and find content

```
browser_navigate → url: "https://example.com/long-page"
browser_scroll → direction: "down", amount: 500
browser_screenshot → fullPage: false
browser_get_text → selector: ".target-section"
```

## Key Details

- **Selectors**: Standard CSS selectors (e.g., `#id`, `.class`, `button[type=submit]`, `a[href*=login]`)
- **Real events**: Click and type use CDP Input domain — they trigger all event listeners, work with CSP, and behave identically to human interaction
- **Accessibility tree**: `browser_dom_snapshot` returns semantic nodes with `role`, `name`, `value`, `description` — great for understanding page structure without needing screenshots
- **Tab management**: `browser_tabs_new` returns a tab ID. Pass that `tabId` to follow-up commands when working across multiple pages.
- **Timeouts**: `browser_wait_for_selector` defaults to 5000ms. Increase for slow-loading pages.

## Limitations

- Only works when Cradle desktop app is running with browser panel open
- No cookie/storage manipulation (use `browser_eval` with `document.cookie` if needed)
- No network interception or request mocking
- Screenshots are PNG only
