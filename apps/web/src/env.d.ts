/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PACKAGE_VERSION?: string
  readonly CRADLE_E2E?: string
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Stub out Electron-only window properties so devtool code compiles in web context.
// These features are non-functional in the web build but won't crash.
interface Window {
  // eslint-disable-next-line ts/no-explicit-any
  ipcDevtool: any
  // eslint-disable-next-line ts/no-explicit-any
  electron: any
  cradle?: {
    ipc: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, handler: (...args: unknown[]) => void) => () => void
    }
    env: {
      serverUrl: string
      sessionId: string | null
      isTearoff: boolean
      surface: string | null
      surfaceRoute: unknown
      platform: 'darwin' | 'win32' | 'linux'
      isElectron: true
    }
    window: {
      minimize: () => Promise<unknown>
      maximize: () => Promise<unknown>
      close: () => Promise<unknown>
      startPointerMonitor: () => Promise<unknown>
      stopPointerMonitor: () => Promise<unknown>
      onTearoffSurfaceClosed: (handler: (surfaceId: string) => void) => () => void
      onPointerOutsideWindow: (handler: (screenX: number, screenY: number) => void) => () => void
    }
    desktopUpdate: {
      onStatusChanged: (handler: (status: unknown) => void) => () => void
    }
    desktopAppBadge?: {
      setUnreadCount: (count: number) => Promise<unknown>
    }
    browser?: {
      open: (input: {
        threadId: string
        initialUrl?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      close: (input: {
        threadId: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      hide: (input: { threadId: string }) => Promise<void>
      getState: (input: {
        threadId: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      setBounds: (input: {
        threadId: string
        surface?: 'native'
        bounds: { x: number, y: number, width: number, height: number } | null
      }) => void
      captureScreenshot: (input: { threadId: string, tabId?: string }) => Promise<{
        name: string
        mimeType: 'image/png'
        sizeBytes: number
        bytes: Uint8Array
      }>
      copyScreenshotToClipboard: (input: { threadId: string, tabId?: string }) => Promise<void>
      applyAnnotationDesign: (input: {
        threadId: string
        tabId?: string
        selector: string
        designChange: import('~/store/browser-panel').BrowserAnnotationDesignChange
      }) => Promise<import('~/store/browser-panel').BrowserAnnotationElement | null>
      clearAnnotationDesign: (input: { threadId: string, tabId?: string }) => Promise<void>
      startAnnotationRuntime: (input: {
        threadId: string
        tabId?: string
        annotations?: Array<{
          id: string
          anchor: import('~/store/browser-panel').BrowserAnnotationAnchor
          body: string
          designChange?: import('~/store/browser-panel').BrowserAnnotationDesignChange | null
          status?: 'saved' | 'sent'
        }>
        editAnnotationId?: string | null
        layoutHints?: import('~/store/browser-panel').BrowserAnnotationLayoutHint[]
      }) => Promise<void>
      stopAnnotationRuntime: (input: { threadId: string, tabId?: string }) => Promise<void>
      notifyAnnotationRuntime: (input: {
        threadId: string
        tabId?: string
        message: string
        tone?: 'neutral' | 'success' | 'error'
      }) => Promise<void>
      executeCdp: (input: {
        threadId: string
        tabId?: string
        method: string
        params?: Record<string, unknown>
      }) => Promise<unknown>
      discoverLocalServers: () => Promise<Array<{
        port: number
        url: string
        title: string
        statusCode: number | null
      }>>
      navigate: (input: {
        threadId: string
        tabId?: string
        url: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      reload: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      goBack: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      goForward: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      newTab: (input: {
        threadId: string
        url?: string
        activate?: boolean
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      closeTab: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      selectTab: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      openDevTools: (input: { threadId: string, tabId?: string }) => Promise<void>
      onState: (
        handler: (state: import('~/store/browser-panel').ThreadBrowserState) => void,
      ) => () => void
      onPromptRequested: (
        handler: (request: {
          threadId: string
          tabId: string
          text: string
          attachments: Array<{
            filename?: string
            mediaType?: string
            url: string
          }>
          sourceUrl: string | null
          sourceTitle: string | null
        }) => void,
      ) => () => void
      onAnnotationRuntimeEvent: (
        handler: (event: {
          threadId: string
          tabId: string
          type:
            | 'ready'
            | 'selected-element'
            | 'save'
            | 'submit'
            | 'cancel'
            | 'closed'
            | 'toggle'
            | 'copy'
            | 'clear'
            | 'delete'
            | 'edit'
            | 'layout-sync'
          anchor?: import('~/store/browser-panel').BrowserAnnotationAnchor
          annotationId?: string
          runtimeAnnotationId?: string
          selectedElement?: import('~/store/browser-panel').BrowserAnnotationElement | null
          body?: string
          output?: string
          annotations?: Array<{
            id: string
            anchor: import('~/store/browser-panel').BrowserAnnotationAnchor
            body: string
            designChange?: import('~/store/browser-panel').BrowserAnnotationDesignChange | null
            status?: 'saved' | 'sent'
          }>
          layoutHints?: import('~/store/browser-panel').BrowserAnnotationLayoutHint[]
          attachedImages?: Array<{
            filename?: string
            mediaType?: string
            url: string
          }>
          designChange?: import('~/store/browser-panel').BrowserAnnotationDesignChange | null
          elements?: import('~/store/browser-panel').BrowserAnnotationElement[]
          surfaceSize?: { width: number, height: number }
          sourceUrl: string | null
          sourceTitle: string | null
        }) => void,
      ) => () => void
    }
    // eslint-disable-next-line ts/no-explicit-any
    chatStream?: any
    // eslint-disable-next-line ts/no-explicit-any
    chatEventTail?: any
    desktopTray: {
      performAction: (actionId: string, payload?: unknown) => Promise<unknown>
      consumePendingActionRequests: () => Promise<unknown>
      onActionRequested: (handler: (request: unknown) => void) => () => void
    }
  }
  codex?: {
    sendPrompt: (
      input:
        | string
        | {
            attachments?: Array<
              | string
              | Blob
              | {
                  dataURL?: string
                  dataUrl?: string
                  filename?: string
                  mediaType?: string
                  mimeType?: string
                  name?: string
                  type?: string
                  url?: string
                }
            >
            files?: Array<
              | string
              | Blob
              | {
                  dataURL?: string
                  dataUrl?: string
                  filename?: string
                  mediaType?: string
                  mimeType?: string
                  name?: string
                  type?: string
                  url?: string
                }
            >
            prompt?: string
            text?: string
          },
      attachments?: Array<
        | string
        | Blob
        | {
            dataURL?: string
            dataUrl?: string
            filename?: string
            mediaType?: string
            mimeType?: string
            name?: string
            type?: string
            url?: string
          }
      >,
    ) => Promise<void>
  }
  __cradleBrowserUseCreateTab?: (url?: string) => string | Promise<string>
  __cradleBrowserUseActivateTab?: (tabId: string) => boolean | Promise<boolean>
  __cradleBrowserUseGoOffScreen?: (tabId?: string) => boolean | Promise<boolean>
  __cradleBrowserUseGetActiveTab?: () => string | undefined | Promise<string | undefined>
  __CRADLE_RENDERER_DIAGNOSTICS__?: () => Record<string, unknown>
  // eslint-disable-next-line ts/no-explicit-any
  __CRADLE_TAB_STORE__?: any
  // eslint-disable-next-line ts/no-explicit-any
  ipc: any
}
