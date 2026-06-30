const suppressedRouteSurfaceSyncSurfaceIds = new Set<string>()

export function createRouteSurfaceSyncRouteKey(input: {
  href?: string
  pathname: string
  search?: unknown
}): string {
  return input.href ?? `${input.pathname}:${JSON.stringify(input.search ?? {})}`
}

export function suppressRouteSurfaceSync(surfaceId: string): void {
  suppressedRouteSurfaceSyncSurfaceIds.add(surfaceId)
}

export function clearRouteSurfaceSyncSuppressionForSurface(surfaceId: string): void {
  suppressedRouteSurfaceSyncSurfaceIds.delete(surfaceId)
}

export function isRouteSurfaceSyncSuppressed(surfaceId: string): boolean {
  return suppressedRouteSurfaceSyncSurfaceIds.has(surfaceId)
}
