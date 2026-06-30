export type BrowserTabScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserTabScript {
  id: string
  label: string
  description: string
  runAt: BrowserTabScriptRunAt
  source: string
}

export interface BrowserTabScriptPreset extends BrowserTabScript {
  defaultEnabled: boolean
}

function loadExternalScriptOnce(globalKey: string, src: string): string {
  return `(() => {
  const key = ${JSON.stringify(globalKey)};
  if (globalThis[key]) {
    return;
  }
  globalThis[key] = true;
  const script = document.createElement('script');
  script.src = ${JSON.stringify(src)};
  script.crossOrigin = 'anonymous';
  script.async = false;
  (document.head || document.documentElement).prepend(script);
})();`
}

export const BROWSER_TAB_SCRIPT_PRESETS: BrowserTabScriptPreset[] = [
  {
    id: 'react-scan',
    label: 'React Scan',
    description: 'Highlight React render performance issues',
    runAt: 'document-start',
    defaultEnabled: false,
    source: loadExternalScriptOnce(
      '__CRADLE_REACT_SCAN_INJECTED__',
      'https://unpkg.com/react-scan/dist/auto.global.js',
    ),
  },
  {
    id: 'react-grab',
    label: 'React Grab',
    description: 'Copy UI elements for agent context',
    runAt: 'document-start',
    defaultEnabled: false,
    source: loadExternalScriptOnce(
      '__CRADLE_REACT_GRAB_INJECTED__',
      'https://unpkg.com/react-grab/dist/index.global.js',
    ),
  },
  {
    id: 'eruda',
    label: 'Eruda',
    description: 'Open mobile-style developer tools',
    runAt: 'document-idle',
    defaultEnabled: false,
    source: `(() => {
  if (globalThis.__CRADLE_ERUDA_INJECTED__) {
    globalThis.eruda?.show?.();
    return;
  }
  globalThis.__CRADLE_ERUDA_INJECTED__ = true;
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/eruda';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    globalThis.eruda?.init?.();
    globalThis.eruda?.show?.();
  };
  document.head.appendChild(script);
})();`,
  },
]

export function getDefaultEnabledBrowserTabScriptIds(): string[] {
  return BROWSER_TAB_SCRIPT_PRESETS
    .filter(script => script.defaultEnabled)
    .map(script => script.id)
}

export function getBrowserTabScriptsByIds(ids: readonly string[]): BrowserTabScript[] {
  const selectedIds = new Set(ids)
  return BROWSER_TAB_SCRIPT_PRESETS.filter(script => selectedIds.has(script.id))
}
