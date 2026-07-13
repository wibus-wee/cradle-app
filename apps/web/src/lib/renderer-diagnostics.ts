import { useBrowserPanelStore } from '~/store/browser-panel'
import { getChatStoreTelemetrySnapshot } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'

import { getLongTaskSnapshots, getPaintSnapshots, getPerfSnapshots, getUserTimingStats, getWebVitals } from './perf-monitor'

declare global {
  interface Window {
    __CRADLE_RENDERER_DIAGNOSTICS__?: () => Record<string, unknown>
  }
}

function readPerformanceMemory(): Record<string, number> | null {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number
      totalJSHeapSize?: number
      jsHeapSizeLimit?: number
    }
  }).memory
  if (!memory) {
    return null
  }
  return {
    usedJSHeapSize: memory.usedJSHeapSize ?? 0,
    totalJSHeapSize: memory.totalJSHeapSize ?? 0,
    jsHeapSizeLimit: memory.jsHeapSizeLimit ?? 0,
  }
}

function readDocumentMetrics(): Record<string, number> {
  const root = document.getElementById('app') ?? document.body
  return {
    nodeCount: document.getElementsByTagName('*').length,
    appNodeCount: root.getElementsByTagName('*').length,
    messageBubbleCount: document.querySelectorAll('[data-testid^="message-bubble-"]').length,
    toolCallCount: document.querySelectorAll('[data-testid^="chat-tool-call-"]').length,
    codeBlockCount: document.querySelectorAll('pre, .sd-code-block, .shiki').length,
    shikiSpanCount: document.querySelectorAll('.shiki span').length,
    streamdownRootCount: document.querySelectorAll('.streamdown-root').length,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }
}

function readBrowserPanelDiagnostics(): Record<string, unknown> {
  const layoutState = useLayoutStore.getState()
  const browserPanelState = useBrowserPanelStore.getState()
  const activeOwnerId = browserPanelState.activeOwnerId
  const ownerState = browserPanelState.owners[activeOwnerId] ?? null

  const browserPanelTabs = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="browser-panel"] [aria-current], [data-testid="browser-panel"] button'),
  ).map(element => ({
    text: element.textContent?.trim() ?? '',
    ariaCurrent: element.getAttribute('aria-current'),
    className: element.getAttribute('class'),
  }))

  const rightAside = document.querySelector<HTMLElement>('[data-testid="right-aside"]')
  const rightAsideTabs = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="right-aside-tab-"]'),
  ).map(element => ({
    testId: element.getAttribute('data-testid'),
    active: element.getAttribute('data-active'),
    label: element.getAttribute('aria-label'),
    className: element.getAttribute('class'),
  }))

  return {
    layout: {
      asideOpen: layoutState.asideOpen,
      asideActiveTab: layoutState.asideActiveTab,
    },
    browserPanelStore: {
      activeOwnerId: browserPanelState.activeOwnerId,
      open: browserPanelState.open,
      topLevelActiveTabId: browserPanelState.activeTabId,
      topLevelTabs: browserPanelState.tabs.map(tab => ({ id: tab.id, kind: tab.kind })),
      owner: ownerState
        ? {
            activeTabId: ownerState.activeTabId,
            open: ownerState.open,
            tabs: ownerState.tabs.map(tab => ({ id: tab.id, kind: tab.kind, title: tab.title })),
            requestedTab: ownerState.requestedTab,
            annotationCount: ownerState.annotations.length,
          }
        : null,
    },
    dom: {
      browserPanelCount: document.querySelectorAll('[data-testid="browser-panel"]').length,
      browserPanelTabs,
      rightAside: rightAside
        ? {
            visible: rightAside.getAttribute('data-visible'),
            activeTab: rightAside.getAttribute('data-active-tab'),
          }
        : null,
      rightAsideTabs,
    },
  }
}

export function readRendererDiagnostics(): Record<string, unknown> {
  return {
    sampledAt: Date.now(),
    location: {
      href: window.location.href,
      hash: window.location.hash,
      pathname: window.location.pathname,
    },
    electron: {
      isElectron: window.cradle?.env?.isElectron === true,
      isTearoff: window.cradle?.env?.isTearoff === true,
      sessionId: window.cradle?.env?.sessionId ?? null,
      surface: window.cradle?.env?.surface ?? null,
    },
    rendererMemory: {
      current: readPerformanceMemory(),
      recentSamples: getPerfSnapshots().slice(-20),
      webVitals: getWebVitals().slice(-20),
      longTasks: getLongTaskSnapshots().slice(-20),
      paints: getPaintSnapshots().slice(-20),
      userTiming: getUserTimingStats(),
    },
    document: readDocumentMetrics(),
    browserPanel: readBrowserPanelDiagnostics(),
    chatStore: getChatStoreTelemetrySnapshot(),
  }
}

export function installRendererDiagnostics(): void {
  window.__CRADLE_RENDERER_DIAGNOSTICS__ = readRendererDiagnostics
}
