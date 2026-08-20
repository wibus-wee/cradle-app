import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { useCallback, useEffect, useState } from 'react'

import type { NowledgeConfigUpdate, NowledgePluginConfig, RouteResponse } from './types'

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as RouteResponse<T> | null
  if (!res.ok || !body || body.ok === false) {
    const message = body && body.ok === false ? body.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body.data
}

export async function fetchConfig(routes: WebPluginContext['routes']): Promise<NowledgePluginConfig> {
  return unwrap<NowledgePluginConfig>(await routes.fetch('/config'))
}

export async function putConfig(
  routes: WebPluginContext['routes'],
  update: NowledgeConfigUpdate,
): Promise<NowledgePluginConfig> {
  return unwrap<NowledgePluginConfig>(await routes.fetch('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  }))
}

export function useNowledgeConfig(routes: WebPluginContext['routes']) {
  const [config, setConfig] = useState<NowledgePluginConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setConfig(await fetchConfig(routes))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  const save = useCallback(async (update: NowledgeConfigUpdate) => {
    setError(null)
    try {
      const next = await putConfig(routes, update)
      setConfig(next)
      return next
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      throw err
    }
  }, [routes])

  return { config, loading, error, refresh, save }
}
