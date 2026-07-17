import { ChipLine as CpuIcon, DownSmallLine as ChevronDownIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { AcpDraftModel } from '~/features/agent-runtimes/use-acp-draft-session'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

interface AcpModelSelectorProps {
  models: AcpDraftModel[]
  selectedModelId: string | null
  loading: boolean
  onSelectModel: (id: string) => void
  occludeNativeBrowserSurface?: boolean
}

export function AcpModelSelector({
  models,
  selectedModelId,
  loading,
  onSelectModel,
  occludeNativeBrowserSurface = false,
}: AcpModelSelectorProps) {
  const { t } = useTranslation('common')
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button
            variant="ghost"
            size="xs"
            data-testid="acp-model-selector"
            data-selected-model-id={selectedModelId ?? ''}
            disabled={loading || models.length === 0}
            className="min-w-0 max-w-full shrink"
          />
        )}
      >
        <CpuIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 max-w-40 truncate">
          {loading ? t('status.loading') : selectedModel?.label ?? t('model.emptySelection')}
        </span>
        <ChevronDownIcon className="size-2.5 shrink-0 !text-muted-foreground/50" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        sideOffset={4}
        className="w-64"
        {...(occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {})}
      >
        {models.map(model => (
          <MenuItem
            key={model.id}
            onClick={() => onSelectModel(model.id)}
            className={cn(selectedModelId === model.id && 'font-medium')}
          >
            <CpuIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{model.label}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}
