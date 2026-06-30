export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type KeyEventType = 'keyDown' | 'keyUp'

const modifierBits: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
}

const specialKeys: Record<string, { key: string, code: string, keyCode: number }> = {
  'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
  'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
  'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
  'Esc': { key: 'Escape', code: 'Escape', keyCode: 27 },
  'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
  'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  'Home': { key: 'Home', code: 'Home', keyCode: 36 },
  'End': { key: 'End', code: 'End', keyCode: 35 },
  'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  'Space': { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
}

export interface ScrollState {
  found: boolean
  x: number
  y: number
  scrollX: number
  scrollY: number
  maxScrollX: number
  maxScrollY: number
}

export interface ScrollWaitResult extends ScrollState {
  canMove: boolean
  moved: boolean
}

export interface ScrollActionResult extends ScrollState {
  canMove: boolean
  moved: boolean
  beforeScrollX: number
  beforeScrollY: number
}

export function buildDocumentReadyExpression(): string {
  return `(() => new Promise((resolve) => {
    const done = () => resolve({
      readyState: document.readyState,
      url: location.href,
      title: document.title,
    });
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      done();
      return;
    }
    const timer = setTimeout(done, 5000);
    document.addEventListener('DOMContentLoaded', () => {
      clearTimeout(timer);
      done();
    }, { once: true });
  }))()`
}

export function modifierMask(modifiers?: string[]): number {
  let mask = 0
  for (const modifier of modifiers ?? []) {
    mask |= modifierBits[modifier.toLowerCase()] ?? 0
  }
  return mask
}

export function createKeyEventPayload(
  type: KeyEventType,
  keyInput: string,
  modifiers?: string[],
): Record<string, unknown> {
  const modifiersMask = modifierMask(modifiers)
  const normalizedKey = normalizeKeyName(keyInput)
  const special = specialKeys[normalizedKey]

  if (special) {
    return {
      type,
      key: special.key,
      code: special.code,
      windowsVirtualKeyCode: special.keyCode,
      nativeVirtualKeyCode: special.keyCode,
      modifiers: modifiersMask,
    }
  }

  if (/^[a-z]$/i.test(keyInput)) {
    const upper = keyInput.toUpperCase()
    const text = modifiersMask === 0 ? keyInput : undefined
    return {
      type,
      key: keyInput.toLowerCase(),
      code: `Key${upper}`,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      nativeVirtualKeyCode: upper.charCodeAt(0),
      modifiers: modifiersMask,
      ...(type === 'keyDown' && text ? { text } : {}),
    }
  }

  if (/^\d$/.test(keyInput)) {
    return {
      type,
      key: keyInput,
      code: `Digit${keyInput}`,
      windowsVirtualKeyCode: keyInput.charCodeAt(0),
      nativeVirtualKeyCode: keyInput.charCodeAt(0),
      modifiers: modifiersMask,
      ...(type === 'keyDown' && modifiersMask === 0 ? { text: keyInput } : {}),
    }
  }

  return {
    type,
    key: keyInput,
    code: keyInput,
    modifiers: modifiersMask,
  }
}

export function isRecoverableNavigationAbort(
  err: unknown,
  requestedUrl: string,
  finalUrl: string,
): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ERR_ABORTED') && urlsEquivalent(requestedUrl, finalUrl)
}

export function urlsEquivalent(left: string, right: string): boolean {
  if (left === right) {
    return true
  }

  try {
    const leftUrl = new URL(left)
    const rightUrl = new URL(right)
    if (leftUrl.protocol !== rightUrl.protocol || leftUrl.host !== rightUrl.host) {
      return false
    }
    return normalizePath(leftUrl) === normalizePath(rightUrl)
      && leftUrl.search === rightUrl.search
      && leftUrl.hash === rightUrl.hash
  }
  catch {
    return false
  }
}

export function buildElementCenterExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`
}

export function buildElementClickExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, clicked: false };
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
      button: 0,
    };
    el.dispatchEvent(new MouseEvent('mouseover', eventInit));
    el.dispatchEvent(new MouseEvent('mousemove', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    if (typeof el.click === 'function') {
      el.click();
    }
    else {
      el.dispatchEvent(new MouseEvent('click', eventInit));
    }
    return { found: true, clicked: true };
  })()`
}

export function buildEditableSelectionExpression(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, editable: false };
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      try {
        el.select();
      }
      catch {
        try {
          el.setSelectionRange(0, el.value.length);
        }
        catch {
          return { found: true, editable: false };
        }
      }
      return {
        found: true,
        editable: true,
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return { found: true, editable: true, value: el.textContent ?? '' };
    }
    if (el instanceof HTMLElement && typeof el.focus === 'function') {
      el.focus();
    }
    return { found: true, editable: false };
  })()`
}

export function buildTextReplacementExpression(selector: string, text: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const text = ${JSON.stringify(text)};
    if (!el) return { found: false, editable: false };
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.value = text;
      el.setSelectionRange?.(text.length, text.length);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, editable: true, value: el.value };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, editable: true, value: el.textContent ?? '' };
    }
    if (el instanceof HTMLElement && typeof el.focus === 'function') {
      el.focus();
    }
    return { found: true, editable: false };
  })()`
}

export function buildFocusedEditableStateExpression(): string {
  return `(() => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return {
        editable: true,
        kind: 'value',
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      const selection = window.getSelection();
      return {
        editable: true,
        kind: 'contenteditable',
        value: el.textContent ?? '',
        selectionText: selection?.toString() ?? '',
      };
    }
    return { editable: false };
  })()`
}

export function buildKeyboardTextFallbackExpression(key: string, modifiers?: string[]): string {
  const mask = modifierMask(modifiers)
  const text = key.length === 1 && (mask & 7) === 0
    ? ((mask & 8) !== 0 ? key.toUpperCase() : key)
    : ''

  return `(() => {
    const text = ${JSON.stringify(text)};
    if (!text) return { applied: false, reason: 'non-printable' };
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { applied: true, value: el.value };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.deleteFromDocument();
        selection.getRangeAt(0).insertNode(document.createTextNode(text));
        selection.collapseToEnd();
      }
      else {
        el.textContent = (el.textContent ?? '') + text;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { applied: true, value: el.textContent ?? '' };
    }
    return { applied: false, reason: 'not-editable' };
  })()`
}

export function buildScrollStateExpression(selector?: string): string {
  return `(() => {
    const readPage = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      return {
        found: true,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        maxScrollX: Math.max(0, scrolling.scrollWidth - window.innerWidth),
        maxScrollY: Math.max(0, scrolling.scrollHeight - window.innerHeight),
      };
    };
    ${selector
      ? `const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, x: 0, y: 0, scrollX: 0, scrollY: 0, maxScrollX: 0, maxScrollY: 0 };
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return {
      found: true,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      scrollX: el.scrollLeft ?? 0,
      scrollY: el.scrollTop ?? 0,
      maxScrollX: Math.max(0, (el.scrollWidth ?? 0) - (el.clientWidth ?? 0)),
      maxScrollY: Math.max(0, (el.scrollHeight ?? 0) - (el.clientHeight ?? 0)),
    };`
      : `return readPage();`}
  })()`
}

export function buildScrollActionExpression(
  selector: string | undefined,
  direction: ScrollDirection,
  amount: number,
): string {
  return `(() => {
    const direction = ${JSON.stringify(direction)};
    const amount = ${JSON.stringify(amount)};
    const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    ${selector
      ? `const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) {
      return { found: false, x: 0, y: 0, scrollX: 0, scrollY: 0, maxScrollX: 0, maxScrollY: 0, canMove: false, moved: false, beforeScrollX: 0, beforeScrollY: 0 };
    }
    target.scrollIntoView?.({ block: 'center', inline: 'center' });
    const read = () => {
      const r = target.getBoundingClientRect();
      return {
        found: true,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        scrollX: target.scrollLeft ?? 0,
        scrollY: target.scrollTop ?? 0,
        maxScrollX: Math.max(0, (target.scrollWidth ?? 0) - (target.clientWidth ?? 0)),
        maxScrollY: Math.max(0, (target.scrollHeight ?? 0) - (target.clientHeight ?? 0)),
      };
    };
    const before = read();
    const canMove = direction === 'down'
      ? before.scrollY < before.maxScrollY
      : direction === 'up'
        ? before.scrollY > 0
        : direction === 'right'
          ? before.scrollX < before.maxScrollX
          : before.scrollX > 0;
    if (canMove) {
      target.scrollLeft += deltaX;
      target.scrollTop += deltaY;
    }`
      : `const scrolling = document.scrollingElement || document.documentElement;
    const read = () => ({
      found: true,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      maxScrollX: Math.max(0, scrolling.scrollWidth - window.innerWidth),
      maxScrollY: Math.max(0, scrolling.scrollHeight - window.innerHeight),
    });
    const before = read();
    const canMove = direction === 'down'
      ? before.scrollY < before.maxScrollY
      : direction === 'up'
        ? before.scrollY > 0
        : direction === 'right'
          ? before.scrollX < before.maxScrollX
          : before.scrollX > 0;
    if (canMove) {
      window.scrollBy(deltaX, deltaY);
    }`}
    const after = read();
    return {
      ...after,
      canMove,
      moved: after.scrollX !== before.scrollX || after.scrollY !== before.scrollY,
      beforeScrollX: before.scrollX,
      beforeScrollY: before.scrollY,
    };
  })()`
}

export function buildScrollWaitExpression(
  selector: string | undefined,
  direction: ScrollDirection,
  before: ScrollState,
): string {
  return `(() => new Promise((resolve) => {
    const before = ${JSON.stringify(before)};
    const direction = ${JSON.stringify(direction)};
    const read = () => {
      ${selector
        ? `const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { found: false, x: 0, y: 0, scrollX: 0, scrollY: 0, maxScrollX: 0, maxScrollY: 0 };
      const r = el.getBoundingClientRect();
      return {
        found: true,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        scrollX: el.scrollLeft ?? 0,
        scrollY: el.scrollTop ?? 0,
        maxScrollX: Math.max(0, (el.scrollWidth ?? 0) - (el.clientWidth ?? 0)),
        maxScrollY: Math.max(0, (el.scrollHeight ?? 0) - (el.clientHeight ?? 0)),
      };`
        : `const scrolling = document.scrollingElement || document.documentElement;
      return {
        found: true,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        maxScrollX: Math.max(0, scrolling.scrollWidth - window.innerWidth),
        maxScrollY: Math.max(0, scrolling.scrollHeight - window.innerHeight),
      };`}
    };
    const canMove = () => {
      if (direction === 'down') return before.scrollY < before.maxScrollY;
      if (direction === 'up') return before.scrollY > 0;
      if (direction === 'right') return before.scrollX < before.maxScrollX;
      return before.scrollX > 0;
    };
    const start = Date.now();
    const tick = () => {
      const current = read();
      const moved = current.scrollX !== before.scrollX || current.scrollY !== before.scrollY;
      if (moved || !canMove() || Date.now() - start > 750) {
        resolve({ ...current, moved, canMove: canMove() });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }))()`
}

function normalizeKeyName(key: string): string {
  if (key.length === 1) {
    return key
  }
  return key[0].toUpperCase() + key.slice(1)
}

function normalizePath(url: URL): string {
  return url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
}
