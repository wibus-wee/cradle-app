import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { useCallback } from 'react'

import { useNowledgeConfig } from '../hooks'
import type { NowledgeConfigUpdate } from '../types'
import { ConfigTabView } from './config-tab-view'

interface ConfigTabProps {
  ctx: WebPluginContext
}

export function ConfigTab({ ctx }: ConfigTabProps) {
  const { config, loading, error, refresh, save } = useNowledgeConfig(ctx.routes)

  const handleSave = useCallback(async (update: NowledgeConfigUpdate) => {
    try {
      const next = await save(update)
      ctx.notifications.show({ title: 'Nowledge Mem settings saved', type: 'success' })
      return next
    }
    catch (err) {
      ctx.notifications.show({
        title: 'Could not save Nowledge Mem settings',
        description: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
      throw err
    }
  }, [ctx.notifications, save])

  return (
    <ConfigTabView
      config={config}
      loading={loading}
      error={error}
      onRefresh={refresh}
      onSave={handleSave}
    />
  )
}
