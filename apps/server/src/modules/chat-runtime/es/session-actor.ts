type SessionActorTask<T> = () => T | Promise<T>

const sessionChains = new Map<string, Promise<void>>()

export function runSessionActorTask<T>(sessionId: string, task: SessionActorTask<T>): Promise<T> {
  const previous = sessionChains.get(sessionId)
  const result = previous ? previous.catch(() => undefined).then(task) : runTaskImmediately(task)
  const next = result.then(
    () => undefined,
    () => undefined,
  )
  sessionChains.set(sessionId, next)
  void next.finally(() => {
    if (sessionChains.get(sessionId) === next) {
      sessionChains.delete(sessionId)
    }
  })
  return result
}

function runTaskImmediately<T>(task: SessionActorTask<T>): Promise<T> {
  try {
    return Promise.resolve(task())
  }
 catch (error) {
    return Promise.reject(error)
  }
}
