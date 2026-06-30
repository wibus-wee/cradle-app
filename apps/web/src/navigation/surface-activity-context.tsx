import { createContext, use } from 'react'

const SurfaceActivityContext = createContext(true)

export function SurfaceActivityProvider({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <SurfaceActivityContext value={active}>
      {children}
    </SurfaceActivityContext>
  )
}

export function useSurfaceActive(): boolean {
  return use(SurfaceActivityContext)
}
