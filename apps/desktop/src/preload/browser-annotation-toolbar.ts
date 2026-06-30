export interface BrowserAnnotationToolbarButtonInput {
  id: string
  label: string
  shortcut?: string
  icon: BrowserAnnotationToolbarIcon
  active?: boolean
  danger?: boolean
  disabled?: boolean
  badge?: number
  onClick: () => void
}

export type BrowserAnnotationToolbarIcon
  = | 'copy'
    | 'cursor'
    | 'exit'
    | 'eye'
    | 'gear'
    | 'layout'
    | 'pause'
    | 'play'
    | 'sparkle'
    | 'trash'

export interface BrowserAnnotationToolbarInput {
  buttons: BrowserAnnotationToolbarButtonInput[]
  count: number
  expanded: boolean
  entrance: boolean
  tooltipBelow: boolean
  position: { x: number, y: number } | null
  onCollapsedClick: () => void
  onPointerDown: (event: PointerEvent, toolbar: HTMLDivElement) => void
}

const TOOLBAR_BUTTON_SIZE = 34
const TOOLBAR_BUTTON_GAP = 6
const TOOLBAR_HORIZONTAL_PADDING = 12
const TOOLBAR_DIVIDER_WIDTH = 1
const TOOLBAR_EXPANDED_MIN_WIDTH = 297

export const BROWSER_ANNOTATION_TOOLBAR_CSS = `
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar] svg[fill="none"] {
    fill: none !important;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar] svg[fill="none"] :not([fill]) {
    fill: none !important;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls] :where(button, input, select, textarea, label) {
    background: unset;
    border: unset;
    border-radius: unset;
    padding: unset;
    margin: unset;
    color: unset;
    font-family: unset;
    font-weight: unset;
    font-style: unset;
    line-height: unset;
    letter-spacing: unset;
    text-transform: unset;
    text-decoration: unset;
    box-shadow: unset;
    outline: unset;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar] {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    left: auto;
    top: auto;
    z-index: 10;
    width: var(--cradle-browser-comment-toolbar-width, 297px);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
    transition: left 0s, top 0s, right 0s, bottom 0s;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container] {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    color: #fff;
    background: #1a1a1a;
    border: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    user-select: none;
    transition:
      width 0.4s cubic-bezier(0.19, 1, 0.22, 1),
      transform 0.4s cubic-bezier(0.19, 1, 0.22, 1);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-entrance="true"] {
    animation: cradle-browser-comment-toolbar-enter 0.5s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-expanded="false"] {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    padding: 0;
    cursor: pointer;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-expanded="false"] svg {
    margin-top: -1px;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-expanded="false"]:hover {
    background: #2a2a2a;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-expanded="false"]:active {
    transform: scale(0.95);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-container][data-expanded="true"] {
    width: var(--cradle-browser-comment-toolbar-width, 297px);
    height: 44px;
    border-radius: 1.5rem;
    padding: 0.375rem;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-toggle],
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls] {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-toggle] {
    position: absolute;
    transition: opacity 0.1s cubic-bezier(0.19, 1, 0.22, 1);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-toggle][data-visible="false"] {
    opacity: 0;
    pointer-events: none;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-toggle][data-visible="true"] {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls] {
    gap: 0.375rem;
    transition:
      filter 0.8s cubic-bezier(0.19, 1, 0.22, 1),
      opacity 0.8s cubic-bezier(0.19, 1, 0.22, 1),
      transform 0.6s cubic-bezier(0.19, 1, 0.22, 1);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls][data-visible="true"] {
    opacity: 1;
    filter: blur(0);
    transform: scale(1);
    visibility: visible;
    pointer-events: auto;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls][data-visible="false"] {
    opacity: 0;
    filter: blur(10px);
    transform: scale(0.4);
    pointer-events: none;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-badge] {
    position: absolute;
    top: -13px;
    right: -13px;
    min-width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    padding: 0 5px;
    color: #fff;
    background: var(--cradle-browser-comment-accent);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    font: 600 0.625rem/18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    user-select: none;
    opacity: 1;
    transform: scale(1);
    transition: transform 0.3s ease, opacity 0.2s ease;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-badge][data-fade-out="true"] {
    opacity: 0;
    transform: scale(0);
    pointer-events: none;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button-wrapper] {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button] {
    position: relative;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.85);
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease,
      opacity 0.2s ease;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button]:hover:not(:disabled):not([data-active="true"]) {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button]:active:not(:disabled) {
    transform: scale(0.92);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button]:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button][data-active="true"] {
    color: var(--cradle-browser-comment-blue);
    background: color-mix(in srgb, var(--cradle-browser-comment-blue) 25%, transparent);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button][data-danger="true"]:hover:not(:disabled):not([data-active="true"]) {
    color: var(--cradle-browser-comment-red);
    background: color-mix(in srgb, var(--cradle-browser-comment-red) 25%, transparent);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-button-badge] {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    padding: 0 4px;
    color: #fff;
    background: var(--cradle-browser-comment-accent);
    box-shadow: 0 0 0 2px #1a1a1a, 0 1px 3px rgba(0, 0, 0, 0.2);
    font-size: 0.625rem;
    font-weight: 600;
    pointer-events: none;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-button-tooltip] {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    z-index: 100001;
    padding: 6px 10px;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.9);
    background: #1a1a1a;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateX(-50%) scale(0.95);
    transition:
      opacity 0.135s ease,
      transform 0.135s ease,
      visibility 0.135s ease;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-button-tooltip]::after {
    position: absolute;
    top: calc(100% - 4px);
    left: 50%;
    width: 8px;
    height: 8px;
    border-radius: 0 0 2px 0;
    background: #1a1a1a;
    content: "";
    transform: translateX(-50%) rotate(45deg);
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls][data-tooltip-below="true"] [data-cradle-browser-comment-button-tooltip] {
    top: calc(100% + 14px);
    bottom: auto;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-controls][data-tooltip-below="true"] [data-cradle-browser-comment-button-tooltip]::after {
    top: -4px;
    border-radius: 2px 0 0 0;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button-wrapper]:hover [data-cradle-browser-comment-button-tooltip] {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) scale(1);
    transition-delay: 0.85s;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-button-wrapper]:has([data-cradle-browser-comment-toolbar-button]:disabled):hover [data-cradle-browser-comment-button-tooltip] {
    opacity: 0;
    visibility: hidden;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-shortcut] {
    margin-left: 4px;
    opacity: 0.5;
  }
  #cradle-browser-comment-root [data-cradle-browser-comment-toolbar-divider] {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.14);
  }
`

const ICONS: Record<BrowserAnnotationToolbarIcon, string> = {
  sparkle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M11.5 12L5.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 6.75L5.5 6.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.25 17.25L5.5 17.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 12.75L16.5179 13.9677C16.8078 14.6494 17.3506 15.1922 18.0323 15.4821L19.25 16L18.0323 16.5179C17.3506 16.8078 16.8078 17.3506 16.5179 18.0323L16 19.25L15.4821 18.0323C15.1922 17.3506 14.6494 16.8078 13.9677 16.5179L12.75 16L13.9677 15.4821C14.6494 15.1922 15.1922 14.6494 15.4821 13.9677L16 12.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  pause: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 6L8 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16 18L16 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  play: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M17.75 10.701C18.75 11.2783 18.75 12.7217 17.75 13.299L8.75 18.4952C7.75 19.0725 6.5 18.3509 6.5 17.1962L6.5 6.80384C6.5 5.64914 7.75 4.92746 8.75 5.50481L17.75 10.701Z" stroke="currentColor" stroke-width="1.5"/></svg>`,
  layout: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="9" y1="9" x2="9" y2="21" stroke="currentColor" stroke-width="1.5"/></svg>`,
  eye: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3.91752 12.7539C3.65127 12.2996 3.65037 11.7515 3.9149 11.2962C4.9042 9.59346 7.72688 5.49994 12 5.49994C16.2731 5.49994 19.0958 9.59346 20.0851 11.2962C20.3496 11.7515 20.3487 12.2996 20.0825 12.7539C19.0908 14.4459 16.2694 18.4999 12 18.4999C7.73064 18.4999 4.90918 14.4459 3.91752 12.7539Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 14.8261C13.5608 14.8261 14.8261 13.5608 14.8261 12C14.8261 10.4392 13.5608 9.17392 12 9.17392C10.4392 9.17392 9.17391 10.4392 9.17391 12C9.17391 13.5608 10.4392 14.8261 12 14.8261Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4.75 11.25C4.75 10.4216 5.42157 9.75 6.25 9.75H12.75C13.5784 9.75 14.25 10.4216 14.25 11.25V17.75C14.25 18.5784 13.5784 19.25 12.75 19.25H6.25C5.42157 19.25 4.75 18.5784 4.75 17.75V11.25Z" stroke="currentColor" stroke-width="1.5"/><path d="M17.25 14.25H17.75C18.5784 14.25 19.25 13.5784 19.25 12.75V6.25C19.25 5.42157 18.5784 4.75 17.75 4.75H11.25C10.4216 4.75 9.75 5.42157 9.75 6.25V6.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  cursor: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6.25 4.75L18.25 12.25L12.92 13.43L10.58 18.75L6.25 4.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12.75 13.25L16.75 17.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  trash: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M13.5 4C14.7426 4 15.75 5.00736 15.75 6.25V7H18.5C18.9142 7 19.25 7.33579 19.25 7.75C19.25 8.16421 18.9142 8.5 18.5 8.5H17.9678L17.6328 16.2217C17.61 16.7475 17.5912 17.1861 17.5469 17.543C17.5015 17.9087 17.4225 18.2506 17.2461 18.5723C16.9747 19.0671 16.5579 19.4671 16.0518 19.7168C15.7227 19.8791 15.3772 19.9422 15.0098 19.9717C14.6514 20.0004 14.2126 20 13.6865 20H10.3135C9.78735 20 9.34856 20.0004 8.99023 19.9717C8.62278 19.9422 8.27729 19.8791 7.94824 19.7168C7.44205 19.4671 7.02532 19.0671 6.75391 18.5723C6.57751 18.2506 6.49853 17.9087 6.45312 17.543C6.40883 17.1861 6.39005 16.7475 6.36719 16.2217L6.03223 8.5H5.5C5.08579 8.5 4.75 8.16421 4.75 7.75C4.75 7.33579 5.08579 7 5.5 7H8.25V6.25C8.25 5.00736 9.25736 4 10.5 4H13.5Z" fill="currentColor"/></svg>`,
  gear: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M10.6504 5.81117C10.9939 4.39628 13.0061 4.39628 13.3496 5.81117C13.5715 6.72517 14.6187 7.15891 15.4219 6.66952C16.6652 5.91193 18.0881 7.33479 17.3305 8.57815C16.8411 9.38134 17.2748 10.4285 18.1888 10.6504C19.6037 10.9939 19.6037 13.0061 18.1888 13.3496C17.2748 13.5715 16.8411 14.6187 17.3305 15.4219C18.0881 16.6652 16.6652 18.0881 15.4219 17.3305C14.6187 16.8411 13.5715 17.2748 13.3496 18.1888C13.0061 19.6037 10.9939 19.6037 10.6504 18.1888C10.4285 17.2748 9.38135 16.8411 8.57815 17.3305C7.33479 18.0881 5.91193 16.6652 6.66952 15.4219C7.15891 14.6187 6.72517 13.5715 5.81117 13.3496C4.39628 13.0061 4.39628 10.9939 5.81117 10.6504C6.72517 10.4285 7.15891 9.38134 6.66952 8.57815C5.91193 7.33479 7.33479 5.91192 8.57815 6.66952C9.38135 7.15891 10.4285 6.72517 10.6504 5.81117Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  exit: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M16.7198 6.21973C17.0127 5.92683 17.4874 5.92683 17.7803 6.21973C18.0732 6.51262 18.0732 6.9874 17.7803 7.28027L13.0606 12L17.7803 16.7197C18.0732 17.0126 18.0732 17.4874 17.7803 17.7803C17.4875 18.0731 17.0127 18.0731 16.7198 17.7803L12.0001 13.0605L7.28033 17.7803C6.98746 18.0731 6.51268 18.0731 6.21979 17.7803C5.92689 17.4874 5.92689 17.0126 6.21979 16.7197L10.9395 12L6.21979 7.28027C5.92689 6.98738 5.92689 6.51262 6.21979 6.21973C6.51268 5.92683 6.98744 5.92683 7.28033 6.21973L12.0001 10.9395L16.7198 6.21973Z" fill="currentColor"/></svg>`,
}

export function renderBrowserAnnotationToolbar(input: BrowserAnnotationToolbarInput): HTMLDivElement {
  const toolbar = document.createElement('div')
  toolbar.setAttribute('data-cradle-browser-comment-toolbar', 'true')
  toolbar.setAttribute('data-agentation-toolbar', 'true')
  toolbar.style.setProperty('--cradle-browser-comment-toolbar-width', `${expandedToolbarWidth(input.buttons.length)}px`)
  if (input.position) {
    toolbar.style.left = `${input.position.x}px`
    toolbar.style.top = `${input.position.y}px`
    toolbar.style.right = 'auto'
    toolbar.style.bottom = 'auto'
  }

  const container = document.createElement('div')
  container.setAttribute('data-cradle-browser-comment-toolbar-container', 'true')
  container.setAttribute('data-expanded', String(input.expanded))
  container.setAttribute('data-entrance', String(input.entrance))
  container.addEventListener('pointerdown', event => input.onPointerDown(event, toolbar))
  if (!input.expanded) {
    container.setAttribute('role', 'button')
    container.tabIndex = 0
    container.title = 'Start feedback mode'
    container.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      input.onCollapsedClick()
    })
  }

  const toggle = document.createElement('div')
  toggle.setAttribute('data-cradle-browser-comment-toolbar-toggle', 'true')
  toggle.setAttribute('data-visible', String(!input.expanded))
  toggle.innerHTML = ICONS.sparkle
  if (input.count > 0) {
    const badge = document.createElement('span')
    badge.setAttribute('data-cradle-browser-comment-toolbar-badge', 'true')
    badge.setAttribute('data-fade-out', String(input.expanded))
    badge.textContent = String(input.count)
    toggle.appendChild(badge)
  }

  const controls = document.createElement('div')
  controls.setAttribute('data-cradle-browser-comment-toolbar-controls', 'true')
  controls.setAttribute('data-visible', String(input.expanded))
  controls.setAttribute('data-tooltip-below', String(input.tooltipBelow))
  input.buttons.forEach((buttonInput, index) => {
    if (index === input.buttons.length - 1) {
      const divider = document.createElement('div')
      divider.setAttribute('data-cradle-browser-comment-toolbar-divider', 'true')
      controls.appendChild(divider)
    }
    controls.appendChild(createToolbarButton(buttonInput))
  })

  container.append(toggle, controls)
  toolbar.appendChild(container)
  return toolbar
}

function expandedToolbarWidth(buttonCount: number): number {
  const dividerCount = buttonCount > 0 ? 1 : 0
  return Math.max(
    TOOLBAR_EXPANDED_MIN_WIDTH,
    TOOLBAR_HORIZONTAL_PADDING
    + buttonCount * TOOLBAR_BUTTON_SIZE
    + Math.max(0, buttonCount - 1 + dividerCount) * TOOLBAR_BUTTON_GAP
    + dividerCount * TOOLBAR_DIVIDER_WIDTH,
  )
}

function createToolbarButton(input: BrowserAnnotationToolbarButtonInput): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-cradle-browser-comment-toolbar-button-wrapper', 'true')

  const button = document.createElement('button')
  button.type = 'button'
  button.title = input.label
  button.setAttribute('aria-label', input.label)
  button.setAttribute('data-cradle-browser-comment-toolbar-button', 'true')
  button.setAttribute('data-toolbar-button-id', input.id)
  button.innerHTML = ICONS[input.icon]
  button.disabled = Boolean(input.disabled)
  if (input.active) {
    button.setAttribute('data-active', 'true')
  }
  if (input.danger) {
    button.setAttribute('data-danger', 'true')
  }
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!button.disabled) {
      input.onClick()
    }
  })

  if (input.badge !== undefined && input.badge > 0) {
    const badge = document.createElement('span')
    badge.setAttribute('data-cradle-browser-comment-button-badge', 'true')
    badge.textContent = String(input.badge)
    button.appendChild(badge)
  }

  const tooltip = document.createElement('span')
  tooltip.setAttribute('data-cradle-browser-comment-button-tooltip', 'true')
  tooltip.append(document.createTextNode(input.label))
  if (input.shortcut) {
    const shortcut = document.createElement('span')
    shortcut.setAttribute('data-cradle-browser-comment-shortcut', 'true')
    shortcut.textContent = input.shortcut
    tooltip.appendChild(shortcut)
  }

  wrapper.append(button, tooltip)
  return wrapper
}
