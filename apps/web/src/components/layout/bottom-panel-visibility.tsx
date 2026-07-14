import { createContext, useContext } from 'react'

export const BottomPanelVisibilityContext = createContext(true)

export function useBottomPanelVisibility(): boolean {
  return useContext(BottomPanelVisibilityContext)
}
