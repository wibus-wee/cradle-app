import { createContext, useContext } from 'react'

export const WorkspaceSessionListNowContext = createContext<number | null>(null)

export function useWorkspaceSessionListNow(): number {
  return useContext(WorkspaceSessionListNowContext) ?? Date.now()
}
