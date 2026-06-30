import type {
  PluginCapabilityRecord,
  PluginDeclaredCapabilityRecord,
  PluginDeclaredPermissionRecord,
  PluginLayer,
  PluginLayerState,
  PluginSourceDescriptor,
} from '@cradle/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getServerUrl } from '~/lib/electron'
import { usePluginStore } from '~/lib/plugin-store'

export interface PluginInfo {
  identity?: string
  routeSegment?: string
  name: string
  version: string
  displayName: string
  description?: string
  source?: PluginSourceDescriptor
  layers?: Partial<Record<PluginLayer, PluginLayerState>>
  capabilities?: PluginCapabilityRecord[]
  declaredCapabilities?: PluginDeclaredCapabilityRecord[]
  declaredPermissions?: PluginDeclaredPermissionRecord[]
  warnings?: string[]
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  serverEntry?: string
  webEntry?: string
  desktopEntry?: string
}

export function usePluginData() {
  const webLayerStates = usePluginStore(s => s.webLayerStates)
  const [serverPlugins, setServerPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activatedAtRef = useRef<Map<string, number>>(new Map())
  const plugins = useMemo(() => serverPlugins.map((plugin) => {
    const owner = plugin.identity ?? plugin.name
    const webLayerState = webLayerStates[owner]
    if (!webLayerState) { return plugin }
    return {
      ...plugin,
      layers: {
        ...plugin.layers,
        web: {
          ...plugin.layers?.web,
          ...webLayerState,
        },
      },
    }
  }), [serverPlugins, webLayerStates])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getServerUrl()}/api/plugins`)
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`)
      }
      const data = (await res.json()) as PluginInfo[]
      setServerPlugins(data)
      const now = Date.now()
      for (const p of data) {
        const key = p.identity ?? p.name
        const activatedAt
          = p.layers?.web?.activatedAt
            ?? p.layers?.server?.activatedAt
            ?? p.layers?.desktop?.activatedAt
        if (activatedAt) {
          activatedAtRef.current.set(key, Date.parse(activatedAt))
        }
 else if (!activatedAtRef.current.has(key)) {
          activatedAtRef.current.set(key, now)
        }
      }
    }
 catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
 finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh on visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refresh])

  function getActivatedAt(plugin: PluginInfo): number | undefined {
    const activatedAt
      = plugin.layers?.web?.activatedAt
        ?? plugin.layers?.server?.activatedAt
        ?? plugin.layers?.desktop?.activatedAt
    return activatedAt ? Date.parse(activatedAt) : activatedAtRef.current.get(plugin.identity ?? plugin.name)
  }

  return { plugins, loading, error, refresh, getActivatedAt }
}
