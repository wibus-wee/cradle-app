// Polyfill ResizeObserver for jsdom (required by @dnd-kit/dom)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
