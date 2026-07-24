import { createContext, useContext, useEffect } from 'react'

interface OverlayEnvironment {
  acquireHostSurfaceSuppression?: () => () => void
}

const OverlayEnvironmentContext = createContext<OverlayEnvironment>({})

export interface OverlayEnvironmentProviderProps extends OverlayEnvironment {
  children: React.ReactNode
}

/** Narrow host adapter for overlays that must suppress out-of-DOM native surfaces. */
export function OverlayEnvironmentProvider({
  acquireHostSurfaceSuppression,
  children,
}: OverlayEnvironmentProviderProps) {
  return (
    <OverlayEnvironmentContext value={{ acquireHostSurfaceSuppression }}>
      {children}
    </OverlayEnvironmentContext>
  )
}

export function useSuppressOverlayHostSurfaces(active: boolean): void {
  const { acquireHostSurfaceSuppression } = useContext(OverlayEnvironmentContext)

  useEffect(() => {
    if (!active) {
      return
    }
    return acquireHostSurfaceSuppression?.()
  }, [acquireHostSurfaceSuppression, active])
}
