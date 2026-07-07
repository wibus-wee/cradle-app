import { PlusLine as PlusIcon } from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getModelRegistryMappingsQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putModelRegistryMappingsByModelId } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'

import type { ModelsDevModel } from '../model-registry/schemas'
import {
  ModelRegistryMappingSchema,
  ModelsDevModelSchema,
} from '../model-registry/schemas'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface ModelRegistryAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (mappingId: string) => void
}

export function ModelRegistryAddDialog({
  open,
  onOpenChange,
  onSaved,
}: ModelRegistryAddDialogProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'alias' | 'manual'>('alias')
  const [modelId, setModelId] = useState('')
  const [registryModelId, setRegistryModelId] = useState('')
  const [manualJson, setManualJson] = useState('')

  const saveMapping = useMutation({
    mutationFn: async (input: {
      modelId: string
      registryModelId: string
      matchType: 'manual' | 'alias'
      model?: ModelsDevModel
    }) => {
      const { data } = await putModelRegistryMappingsByModelId({
        path: { modelId: input.modelId },
        body: input,
        throwOnError: true,
      })
      return ModelRegistryMappingSchema.parse(data)
    },
    onSuccess: (data) => {
      toastManager.add({ type: 'success', title: t('registry.status.saved' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getModelRegistryMappingsQueryKey() })
      onSaved(data.modelId)
      resetForm()
      onOpenChange(false)
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const resetForm = () => {
    setModelId('')
    setRegistryModelId('')
    setManualJson('')
    setTab('alias')
  }

  const addAlias = () => {
    const sourceId = modelId.trim()
    const targetId = registryModelId.trim()
    if (!sourceId || !targetId) {
      return
    }
    saveMapping.mutate({
      modelId: sourceId,
      registryModelId: targetId,
      matchType: 'alias',
    })
  }

  const addManual = () => {
    const sourceId = modelId.trim()
    if (!sourceId || !manualJson.trim()) {
      return
    }
    try {
      const model = ModelsDevModelSchema.parse(JSON.parse(manualJson))
      saveMapping.mutate({
        modelId: sourceId,
        registryModelId: model.id,
        matchType: 'manual',
        model,
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const busy = saveMapping.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm() } onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('registry.add.label' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('registry.add.description' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as 'alias' | 'manual')}>
          <TabsList variant="line">
            <TabsTrigger value="alias">{t('registry.add.tabAlias' as SettingsKey)}</TabsTrigger>
            <TabsTrigger value="manual">{t('registry.add.tabManual' as SettingsKey)}</TabsTrigger>
          </TabsList>

          <TabsContent value="alias">
            <div className="grid gap-3 pt-2">
              <div className="grid gap-1.5">
                <label className="text-[13px] font-medium text-foreground">
                  {t('registry.field.modelId' as SettingsKey)}
                </label>
                <Input
                  value={modelId}
                  onChange={e => setModelId(e.target.value)}
                  placeholder={t('registry.field.modelId.placeholder' as SettingsKey)}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-[13px] font-medium text-foreground">
                  {t('registry.field.registryModelId' as SettingsKey)}
                </label>
                <Input
                  value={registryModelId}
                  onChange={e => setRegistryModelId(e.target.value)}
                  placeholder={t('registry.field.registryModelId.placeholder' as SettingsKey)}
                  className="font-mono text-[12px]"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="manual">
            <div className="grid gap-3 pt-2">
              <div className="grid gap-1.5">
                <label className="text-[13px] font-medium text-foreground">
                  {t('registry.field.modelId' as SettingsKey)}
                </label>
                <Input
                  value={modelId}
                  onChange={e => setModelId(e.target.value)}
                  placeholder={t('registry.field.modelId.placeholder' as SettingsKey)}
                  className="font-mono text-[12px]"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-[13px] font-medium text-foreground">
                  {t('registry.field.manualJson' as SettingsKey)}
                </label>
                <Textarea
                  value={manualJson}
                  onChange={e => setManualJson(e.target.value)}
                  placeholder={t('registry.field.manualJson.placeholder' as SettingsKey)}
                  className="min-h-32 font-mono text-[12px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t('registry.manual.description' as SettingsKey)}
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {t('registry.action.cancel' as SettingsKey)}
          </Button>
          <Button
            size="sm"
            onClick={tab === 'alias' ? addAlias : addManual}
            disabled={!modelId.trim() || (tab === 'alias' ? !registryModelId.trim() : !manualJson.trim()) || busy}
          >
            {busy
              ? <Spinner className="size-3.5" />
              : <PlusIcon className="size-3.5" aria-hidden="true" />}
            {tab === 'alias' ? t('registry.action.saveAlias' as SettingsKey) : t('registry.action.saveManual' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
