import { useCallback, useEffect, useRef, useState } from 'react'

export interface BrowserLocalServer {
  port: number
  url: string
  title: string
  statusCode: number | null
}

const EMPTY_SERVERS: BrowserLocalServer[] = []

export function useLocalServers(enabled = true) {
  const requestRef = useRef(0)
  const [servers, setServers] = useState<BrowserLocalServer[]>(EMPTY_SERVERS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    const bridge = window.cradle?.browser
    if (!bridge) {
      setServers(EMPTY_SERVERS)
      setError('Local discovery is available in the desktop app.')
      return
    }
    setLoading(true)
    setError(null)
    void bridge.discoverLocalServers()
      .then((result) => {
        if (requestRef.current !== requestId) { return }
        setServers(result.filter(server => server.statusCode !== null && server.statusCode >= 200 && server.statusCode < 300))
      })
      .catch((cause) => {
        if (requestRef.current !== requestId) { return }
        setServers(EMPTY_SERVERS)
        setError(cause instanceof Error ? cause.message : 'Local discovery failed.')
      })
      .finally(() => {
        if (requestRef.current === requestId) { setLoading(false) }
      })
  }, [])

  useEffect(() => {
    if (enabled) { refresh() }
    return () => {
      requestRef.current += 1
    }
  }, [enabled, refresh])

  return { servers, loading, error, refresh }
}
