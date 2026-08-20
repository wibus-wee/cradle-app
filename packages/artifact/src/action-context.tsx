import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

export interface ArtifactActionContextValue {
  /**
   * Run a follow-up prompt in the owning chat session (host-provided).
   * Returns false when the host could not accept the prompt (e.g. session not ready).
   */
  runPrompt: (prompt: string) => boolean
}

const ArtifactActionContext = createContext<ArtifactActionContextValue | null>(null)

export function ArtifactActionProvider({
  value,
  children,
}: {
  value: ArtifactActionContextValue
  children: ReactNode
}) {
  return (
    <ArtifactActionContext.Provider value={value}>
      {children}
    </ArtifactActionContext.Provider>
  )
}

// Hook is part of the public agent kit API alongside the provider.
// eslint-disable-next-line react-refresh/only-export-components -- kit exports provider + hook together
export function useArtifactAction(): ArtifactActionContextValue | null {
  return useContext(ArtifactActionContext)
}
