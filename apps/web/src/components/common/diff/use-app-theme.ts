import { useSyncExternalStore } from 'react'

export type AppThemeType = 'light' | 'dark'

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

/**
 * Pierre resolves `themeType: 'system'` against the OS preference, but this
 * app themes via the `.dark` class on `<html>` (which can disagree with the
 * OS). Track that class so diffs always match the app chrome.
 */
export function useAppThemeType(): AppThemeType {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    () => 'light',
  )
}
