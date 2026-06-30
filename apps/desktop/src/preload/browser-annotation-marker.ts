export const BROWSER_ANNOTATION_MARKER_CSS = `
  @keyframes cradle-browser-comment-marker-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.3);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }
  @keyframes cradle-browser-comment-marker-out {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.3);
    }
  }
  @keyframes cradle-browser-comment-marker-renumber {
    from {
      opacity: 0;
      transform: translateX(-40%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  @keyframes cradle-browser-comment-tooltip-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(2px) scale(0.891);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(0.909);
    }
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker] {
    position: absolute;
    z-index: 1;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    background: var(--cradle-browser-comment-accent);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.2),
      inset 0 0 0 1px rgba(0, 0, 0, 0.04);
    font-size: 0.6875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    pointer-events: auto;
    user-select: none;
    cursor: pointer;
    contain: layout style;
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
    will-change: transform, opacity;
    animation: cradle-browser-comment-marker-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
    transition:
      background-color 0.15s ease,
      transform 0.1s ease,
      opacity 0.15s ease;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker]:hover {
    z-index: 2;
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.24),
      inset 0 0 0 1px rgba(0, 0, 0, 0.04);
    transform: translate(-50%, -50%) scale(1.1);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker][data-multi="true"] {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--cradle-browser-comment-green);
    font-size: 0.75rem;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker][data-hidden="true"],
  #cradle-browser-comment-root [data-cradle-browser-comment-marker][data-exiting="true"] {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.3);
    pointer-events: none;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker][data-exiting="true"] {
    animation: cradle-browser-comment-marker-out 0.2s ease-out both;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker][data-editing="true"] {
    cursor: default;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker-number] {
    display: block;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker-number][data-renumbered="true"] {
    animation: cradle-browser-comment-marker-renumber 0.2s ease-out both;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker-tooltip] {
    position: absolute;
    top: calc(100% + 10px);
    left: 50%;
    z-index: 100002;
    min-width: 120px;
    max-width: 200px;
    padding: 8px 0.75rem;
    border-radius: 0.75rem;
    color: #fff;
    background: #1a1a1a;
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-weight: 400;
    pointer-events: none;
    cursor: default;
    transform: translateX(-50%) scale(0.909);
    animation: cradle-browser-comment-tooltip-in 0.1s ease-out both;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker-tooltip] small {
    display: block;
    margin-bottom: 0.3125rem;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    font-style: italic;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-marker-tooltip] span {
    display: block;
    overflow: hidden;
    color: #fff;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 2px;
  }
`
