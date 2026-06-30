/* Settings data hooks for the Nowledge Mem plugin. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { useCallback, useEffect, useState } from 'react'

import type {
  ConfigFormState,
  NowledgePluginConfig,
  NowledgeStatusData,
  RouteResponse,
} from './types'

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

export async function fetchStatus(routes: WebPluginContext['routes']): Promise<NowledgeStatusData> {
  return unwrap<NowledgeStatusData>(await routes.fetch('/status'))
}

export async function putConfig(
  routes: WebPluginContext['routes'],
  form: ConfigFormState,
): Promise<NowledgePluginConfig> {
  const res = await routes.fetch('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiUrl: form.apiUrl.trim() || undefined,
      mcpUrl: deriveMcp(form.apiUrl.trim()),
      spaceId: form.spaceId.trim() || null,
      enabled: form.enabled,
    }),
  })
  return unwrap<NowledgePluginConfig>(res)
}

function deriveMcp(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/+$/, '')
  return `${base || 'http://127.0.0.1:14242'}/mcp`
}

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export function useNowledgeConfig(routes: WebPluginContext['routes'], enabled: boolean) {
  const [config, setConfig] = useState<NowledgePluginConfig | null>(null)
  const [loading, setLoading] = useState(false)
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
    if (!enabled) { return }
    queueMicrotask(() => void refresh())
  }, [enabled, refresh])

  const save = useCallback(async (next: ConfigFormState) => {
    setLoading(true)
    setError(null)
    try {
      const updated = await putConfig(routes, next)
      setConfig(updated)
      return updated
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      throw err
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  return { config, loading, error, refresh, save }
}

export function useNowledgeStatus(routes: WebPluginContext['routes'], enabled: boolean) {
  const [data, setData] = useState<NowledgeStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchStatus(routes))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    if (!enabled) { return }
    queueMicrotask(() => void refresh())
  }, [enabled, refresh])

  return { data, loading, error, refresh }
}
