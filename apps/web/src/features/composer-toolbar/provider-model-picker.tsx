import { ChipLine as CpuIcon } from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import type { MenuPortalProps } from '~/components/ui/menu'
import { Menu, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'

import { presetForProviderKind, providerTargetDisplayIconSlug } from '../agent-management/provider-settings-utils'
import type { ModelsByProviderTargetId, ThinkingOption } from './provider-model-menu'
import { ProviderModelMenu } from './provider-model-menu'
import type { ProviderModelOption } from './types'

interface ProviderModelPickerProps<TThinking extends string | null> {
  providerTargets: ProviderModelOption[]
  selectedProviderTargetId: string | null
  selectedModelId: string | null
  selectedModel: ModelDescriptor | null
  modelsByProviderTargetId: ModelsByProviderTargetId
  loadingProviderTargetIds: Set<string>
  thinkingValue: TThinking
  thinkingOptions: Array<ThinkingOption<TThinking>>
  isLoadingSelectedModels?: boolean
  emptyProviderTargetsLabel?: string
  loadingLabel?: string
  emptySelectionLabel?: string
  menuSide?: 'top' | 'bottom' | 'left' | 'right'
  menuAlign?: 'start' | 'center' | 'end'
  menuPortalProps?: MenuPortalProps
  triggerTestId?: string
  disabled?: boolean
  showProviderLabel?: boolean
  occludeNativeBrowserSurface?: boolean
  leadingSelection?: {
    label: string
    description?: string
    active: boolean
    onSelect: () => void
  }
  leadingContent?: ReactNode
  getThinkingOptionsForModel?: (model: ModelDescriptor | null) => Array<ThinkingOption<TThinking>>
  onRequestProviderTargetModels?: (id: string, options?: { refresh?: boolean }) => void
  onSelectProviderTarget: (id: string) => void
  onSelectModel: (id: string | null, providerTargetId: string) => void
  onSelectThinking: (value: TThinking) => void
}

export function ProviderModelPicker<TThinking extends string | null>({
  providerTargets,
  selectedProviderTargetId,
  selectedModelId,
  selectedModel,
  modelsByProviderTargetId,
  loadingProviderTargetIds,
  thinkingValue,
  thinkingOptions,
  isLoadingSelectedModels = false,
  emptyProviderTargetsLabel,
  loadingLabel,
  emptySelectionLabel,
  menuSide = 'top',
  menuAlign = 'start',
  menuPortalProps,
  triggerTestId = 'provider-model-selector',
  disabled = false,
  showProviderLabel = false,
  occludeNativeBrowserSurface = false,
  leadingSelection,
  leadingContent,
  getThinkingOptionsForModel,
  onRequestProviderTargetModels,
  onSelectProviderTarget,
  onSelectModel,
  onSelectThinking,
}: ProviderModelPickerProps<TThinking>) {
  const { t } = useTranslation('common')
  const selectedProviderTarget = providerTargets.find(target => target.id === selectedProviderTargetId) ?? null
  const effectiveLoadingProviderTargetIds = (() => {
    if (!selectedProviderTargetId || !isLoadingSelectedModels || loadingProviderTargetIds.has(selectedProviderTargetId)) {
      return loadingProviderTargetIds
    }

    const next = new Set(loadingProviderTargetIds)
    next.add(selectedProviderTargetId)
    return next
  })()

  const triggerThinkingOptions = getThinkingOptionsForModel
    ? getThinkingOptionsForModel(selectedModel)
    : thinkingOptions
  const hasAdjustableThinking = triggerThinkingOptions.some(option => option.value !== null)
  const thinkingLabel = hasAdjustableThinking
    ? triggerThinkingOptions.find(option => option.value === thinkingValue)?.label ?? null
    : null
  const providerLabel = showProviderLabel ? selectedProviderTarget?.name ?? null : null
  const modelLabel = selectedModel?.label
    ?? selectedModelId
    ?? (isLoadingSelectedModels ? loadingLabel ?? t('status.loading') : emptySelectionLabel ?? t('model.emptySelection'))
  const handleMenuOpenChange = (open: boolean) => {
    if (!open || !selectedProviderTargetId) {
      return
    }
    // Cache-first paint; live refresh only when server cache is missing/stale.
    onRequestProviderTargetModels?.(selectedProviderTargetId)
  }

  return (
    <Menu onOpenChange={handleMenuOpenChange}>
      <MenuTrigger
        render={(
          <Button
            variant="ghost"
            size="xs"
            data-testid={triggerTestId}
            data-selected-provider-target-id={selectedProviderTargetId ?? ''}
            data-selected-model-id={selectedModelId ?? ''}
            data-thinking-value={thinkingValue ?? ''}
            disabled={disabled}
            className="min-w-0 max-w-full shrink"
          />
        )}
      >
        {selectedProviderTarget
          ? (
              <ProviderIcon
                iconSlug={providerTargetDisplayIconSlug(selectedProviderTarget)}
                presetId={presetForProviderKind(selectedProviderTarget.providerKind).id}
                className="size-3.5 shrink-0"
              />
            )
          : <CpuIcon className="size-3.5 shrink-0 !text-muted-foreground/70" />}
        <span className="flex min-w-0 max-w-64 items-center gap-1">
          {providerLabel && (
            <>
              <span className="min-w-0 max-w-[7.5rem] truncate text-muted-foreground/80">{providerLabel}</span>
              <span className="shrink-0 text-muted-foreground/40">/</span>
            </>
          )}
          <span className="min-w-0 max-w-40 truncate">
            {modelLabel}
          </span>
        </span>
        {thinkingLabel && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">{thinkingLabel}</span>
          </>
        )}
      </MenuTrigger>
      <MenuPopup
        side={menuSide}
        align={menuAlign}
        portalProps={menuPortalProps}
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        <ProviderModelMenu
          providerTargets={providerTargets}
          selectedProviderTargetId={selectedProviderTargetId}
          selectedModelId={selectedModelId}
          modelsByProviderTargetId={modelsByProviderTargetId}
          loadingProviderTargetIds={effectiveLoadingProviderTargetIds}
          thinkingValue={thinkingValue}
          thinkingOptions={thinkingOptions}
          getThinkingOptionsForModel={getThinkingOptionsForModel}
          emptyProviderTargetsLabel={emptyProviderTargetsLabel}
          occludeNativeBrowserSurface={occludeNativeBrowserSurface}
          menuPortalProps={menuPortalProps}
          leadingSelection={leadingSelection}
          leadingContent={leadingContent}
          onRequestProviderTargetModels={onRequestProviderTargetModels}
          onSelectProviderTarget={onSelectProviderTarget}
          onSelectModel={onSelectModel}
          onSelectThinking={onSelectThinking}
        />
      </MenuPopup>
    </Menu>
  )
}
