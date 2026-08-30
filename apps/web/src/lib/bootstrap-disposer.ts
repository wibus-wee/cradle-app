export interface BootstrapDisposerRegistry {
  add: (cleanup: () => void) => void
  dispose: () => void
}

export function createBootstrapDisposerRegistry(
  onError: (error: unknown) => void = error => console.error('[bootstrap] cleanup failed:', error),
): BootstrapDisposerRegistry {
  const cleanups = new Set<() => void>()
  let disposed = false

  const run = (cleanup: () => void): void => {
    try {
      cleanup()
    }
    catch (error) {
      onError(error)
    }
  }

  return {
    add(cleanup) {
      if (disposed) {
        run(cleanup)
        return
      }
      cleanups.add(cleanup)
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      for (const cleanup of cleanups) {
        run(cleanup)
      }
      cleanups.clear()
    },
  }
}
