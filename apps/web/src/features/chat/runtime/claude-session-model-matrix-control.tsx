import { Settings2Line as SettingsIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { MenuSub, MenuSubPopup, MenuSubTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { ClaudeModelMatrixEditor } from '~/features/agent-management/claude-model-matrix-editor'
import {
  claudeAgentAliasesFromConfig,
  loadProviderTargetModelSettings,
} from '~/features/agent-management/provider-target-model-settings'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  DEFAULT_CLAUDE_AGENT_ALIASES,
  hasClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import { supportsClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-model-aliases'
import type { ApiProviderKind, ModelDescriptor } from '~/features/agent-runtime/types'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import { useRuntimeSettings } from './use-runtime-settings'

function providerTargetModelSettingsQueryKey(providerTargetId: string | null) {
  return ['provider-target-model-settings', providerTargetId ?? 'no-provider-target'] as const
}

/**
 * Shape consumed by the composer alias menu. Models + mainModelId are sourced
 * from the picker context itself, so the slot only carries alias state.
 */
export interface ClaudeAgentModelAliasesSlot {
  aliases: ClaudeAgentModelAliases
  onChange: (next: ClaudeAgentModelAliases) => void
  loading?: boolean
}

/**
 * Alias slot for an existing chat session — reads/writes the session's runtime
 * settings via useRuntimeSettings.
 */
export function useSessionClaudeAgentModelAliases(args: {
  active: boolean
  sessionId: string
  enabled: boolean
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  fallbackAliases?: ClaudeAgentModelAliases
}): ClaudeAgentModelAliasesSlot | null {
  const { active, sessionId, enabled: enabledInput, providerTargetId, providerKind, fallbackAliases } = args
  const enabled = active
    && enabledInput
    && !!providerTargetId
    && !!sessionId
    && supportsClaudeAgentModelAliases(providerKind)
  const runtimeSettings = useRuntimeSettings(sessionId, enabled)

  return useMemo<ClaudeAgentModelAliasesSlot | null>(() => {
    if (!enabled) {
      return null
    }
    return {
      aliases: runtimeSettings.claudeAgent?.modelAliases ?? fallbackAliases ?? DEFAULT_CLAUDE_AGENT_ALIASES,
      loading: !runtimeSettings.loaded || runtimeSettings.loading,
      onChange: (next) => {
        void runtimeSettings
          .update({
            claudeAgent: hasClaudeAgentModelAliases(next)
              ? { modelAliases: next }
              : null,
          })
          .catch((error: unknown) => {
            toastManager.add({
              type: 'error',
              title: 'Save Claude aliases failed',
              description: error instanceof Error ? error.message : 'Unknown error',
            })
          })
      },
    }
  }, [enabled, fallbackAliases, runtimeSettings])
}

/**
 * Alias slot for the new-chat composer — reads/writes the per-profile
 * alias override stored in the new-chat store.
 */
export function useDraftClaudeAgentModelAliases(args: {
  active: boolean
  enabled: boolean
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  aliases: ClaudeAgentModelAliases | null
  loading?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
}): ClaudeAgentModelAliasesSlot | null {
  const { active, enabled: enabledInput, providerTargetId, providerKind, aliases, loading, onChange } = args
  const enabled = active
    && enabledInput
    && !!providerTargetId
    && supportsClaudeAgentModelAliases(providerKind)

  return useMemo<ClaudeAgentModelAliasesSlot | null>(() => {
    if (!enabled) {
      return null
    }
    return {
      aliases: aliases ?? DEFAULT_CLAUDE_AGENT_ALIASES,
      loading,
      onChange,
    }
  }, [enabled, aliases, loading, onChange])
}

/**
 * Internal — also used by the settings panel when editing a provider target's
 * default aliases. Returns aliases + loading for a given provider target.
 */
export function useProviderTargetClaudeAgentModelAliases(args: {
  providerTargetId: string | null
  providerKind: ApiProviderKind | null
  enabled: boolean
}): {
  aliases: ClaudeAgentModelAliases
  isLoading: boolean
} {
  const { providerTargetId, providerKind, enabled } = args
  const isClaudeAliasProvider = supportsClaudeAgentModelAliases(providerKind)
  const providerSettingsQuery = useQuery({
    queryKey: providerTargetModelSettingsQueryKey(providerTargetId),
    queryFn: () => loadProviderTargetModelSettings({ id: providerTargetId! }),
    enabled: enabled && isClaudeAliasProvider && !!providerTargetId,
    staleTime: 10_000,
    retry: false,
  })

  const aliases = useMemo(
    () => providerSettingsQuery.data
      ? claudeAgentAliasesFromConfig(providerSettingsQuery.data.connectionConfigJson)
      : DEFAULT_CLAUDE_AGENT_ALIASES,
    [providerSettingsQuery.data],
  )

  return {
    aliases,
    isLoading: providerSettingsQuery.isLoading,
  }
}

export function ClaudeAgentModelAliasesSubmenu({
  models,
  selectedModelId,
  aliases,
  loading,
  onChange,
  loadingModels,
  occludeNativeBrowserSurface,
}: {
  models: ModelDescriptor[]
  selectedModelId: string | null
  aliases: ClaudeAgentModelAliases
  loading?: boolean
  loadingModels?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
  occludeNativeBrowserSurface?: boolean
}) {
  const isCustom = hasClaudeAgentModelAliases(aliases)
  const selectedModel = models.find(m => m.id === selectedModelId) ?? null
  const mainModelLabel = selectedModel?.label
    ?? selectedModelId
    ?? (loadingModels ? 'Loading...' : 'default')

  return (
    <MenuSub>
      <MenuSubTrigger
        data-testid="claude-agent-model-aliases-trigger"
        data-selected-model-id={selectedModelId ?? ''}
        className={cn(isCustom && 'text-primary font-medium')}
      >
        <SettingsIcon className="size-3.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">Model aliases</span>
          <span className="max-w-52 truncate text-[11px] font-normal text-muted-foreground/60">
            Main model:
            {' '}
            {mainModelLabel}
          </span>
        </div>
        {isCustom && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
      </MenuSubTrigger>
      <MenuSubPopup
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
        className="w-[34rem] p-0"
      >
        <div className="min-w-0 p-2">
          <div className="flex min-w-0 items-center justify-between gap-3 px-2 pb-2">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground/70">
                Model aliases
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Main model:
                {' '}
                {mainModelLabel}
              </div>
            </div>
            {loading || loadingModels
              ? <span className="shrink-0 text-[11px] text-muted-foreground/60">Loading...</span>
              : null}
          </div>
          <ClaudeModelMatrixEditor
            aliases={aliases}
            models={models}
            mainModelId={selectedModelId}
            loading={loading || loadingModels}
            onChange={onChange}
          />
        </div>
      </MenuSubPopup>
    </MenuSub>
  )
}
