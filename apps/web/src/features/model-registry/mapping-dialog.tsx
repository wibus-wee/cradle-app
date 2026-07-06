/**
 * Shared model registry mapping dialog.
 *
 * Two-step flow: search (models.dev + Cradle Registry) then optional
 * manual entry form. Used by both the agent-management models panel
 * and the settings model-registry page.
 */
import {
  SearchLine as SearchIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getModelRegistryMappingsQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putModelRegistryMappingsByModelId } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import type { ModelCapabilities } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import type { ModelsDevModel, SearchResult } from './schemas'
import { SearchResultItem } from './search-result-item'
import { useModelSearch } from './use-model-search'

// ── Manual entry draft ───────────────────────────────────────────────────────

interface ManualRegistryDraft {
  id: string
  name: string
  context: string
  output: string
  inputText: boolean
  inputImage: boolean
  outputText: boolean
  reasoning: boolean
  toolCall: boolean
  temperature: boolean
  structuredOutput: boolean
  family: string
  knowledge: string
  releaseDate: string
  costInput: string
  costOutput: string
  costCacheRead: string
  costCacheWrite: string
}

const OptionalNumberTextSchema = z
  .string()
  .trim()
  .transform(value => (value === '' ? undefined : Number(value)))
  .pipe(z.number().finite().optional())

const ManualRegistryDraftProjectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    context: OptionalNumberTextSchema,
    output: OptionalNumberTextSchema,
    inputText: z.boolean(),
    inputImage: z.boolean(),
    outputText: z.boolean(),
    reasoning: z.boolean(),
    toolCall: z.boolean(),
    temperature: z.boolean(),
    structuredOutput: z.boolean(),
    family: z
      .string()
      .trim()
      .transform(value => value || undefined),
    knowledge: z
      .string()
      .trim()
      .transform(value => value || undefined),
    releaseDate: z
      .string()
      .trim()
      .transform(value => value || undefined),
    costInput: OptionalNumberTextSchema,
    costOutput: OptionalNumberTextSchema,
    costCacheRead: OptionalNumberTextSchema,
    costCacheWrite: OptionalNumberTextSchema,
  })
  .transform(draft => ({
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    inputModalities: [...(draft.inputText ? ['text'] : []), ...(draft.inputImage ? ['image'] : [])],
    outputModalities: draft.outputText ? ['text'] : [],
    contextWindow: draft.context,
    maxOutput: draft.output,
    reasoning: draft.reasoning,
    toolCall: draft.toolCall,
    temperature: draft.temperature,
    structuredOutput: draft.structuredOutput,
    family: draft.family,
    knowledgeCutoff: draft.knowledge,
    releaseDate: draft.releaseDate,
    modelsDevCost: {
      input: draft.costInput,
      output: draft.costOutput,
      cache_read: draft.costCacheRead,
      cache_write: draft.costCacheWrite,
    },
    capabilitiesCost: {
      input: draft.costInput,
      output: draft.costOutput,
      cacheRead: draft.costCacheRead,
      cacheWrite: draft.costCacheWrite,
    },
  }))

export function createManualDraft(
  modelId: string,
  modelLabel: string,
  caps: ModelCapabilities,
  query: string,
): ManualRegistryDraft {
  const id = query.trim() || caps.registryModelId || modelId || ''
  return {
    id,
    name: modelLabel && modelLabel !== modelId ? modelLabel : id,
    context: caps.contextWindow ? String(caps.contextWindow) : '',
    output: caps.maxOutput ? String(caps.maxOutput) : '',
    inputText: true,
    inputImage: caps.inputModalities?.includes('image') ?? false,
    outputText: true,
    reasoning: caps.reasoning ?? false,
    toolCall: caps.toolCall ?? true,
    temperature: caps.temperature ?? true,
    structuredOutput: caps.structuredOutput ?? false,
    family: caps.family ?? '',
    knowledge: caps.knowledgeCutoff ?? '',
    releaseDate: caps.releaseDate ?? '',
    costInput: caps.cost?.input != null ? String(caps.cost.input) : '',
    costOutput: caps.cost?.output != null ? String(caps.cost.output) : '',
    costCacheRead: caps.cost?.cacheRead != null ? String(caps.cost.cacheRead) : '',
    costCacheWrite: caps.cost?.cacheWrite != null ? String(caps.cost.cacheWrite) : '',
  }
}

function createManualDraftFromModel(
  model: ModelsDevModel | undefined,
  fallback: {
    modelId: string
    modelLabel?: string
    query?: string
    capabilities?: ModelCapabilities
  },
): ManualRegistryDraft {
  if (!model) {
    return createManualDraft(
      fallback.modelId,
      fallback.modelLabel ?? '',
      fallback.capabilities ?? {},
      fallback.query ?? '',
    )
  }

  const id = model.id.trim() || fallback.query?.trim() || fallback.modelId
  return {
    id,
    name: model.name?.trim() || fallback.modelLabel || id,
    context: model.limit?.context != null ? String(model.limit.context) : '',
    output: model.limit?.output != null ? String(model.limit.output) : '',
    inputText: model.modalities?.input?.includes('text') ?? true,
    inputImage: model.modalities?.input?.includes('image') ?? false,
    outputText: model.modalities?.output?.includes('text') ?? true,
    reasoning: model.reasoning ?? false,
    toolCall: model.tool_call ?? true,
    temperature: model.temperature ?? true,
    structuredOutput: model.structured_output ?? false,
    family: model.family ?? '',
    knowledge: model.knowledge ?? '',
    releaseDate: model.release_date ?? '',
    costInput: model.cost?.input != null ? String(model.cost.input) : '',
    costOutput: model.cost?.output != null ? String(model.cost.output) : '',
    costCacheRead: model.cost?.cache_read != null ? String(model.cost.cache_read) : '',
    costCacheWrite: model.cost?.cache_write != null ? String(model.cost.cache_write) : '',
  }
}

function buildManualModelsDevModel(draft: ManualRegistryDraft) {
  const projected = ManualRegistryDraftProjectionSchema.parse(draft)
  return {
    id: projected.id,
    name: projected.name,
    limit: { context: projected.contextWindow, output: projected.maxOutput },
    modalities: { input: projected.inputModalities, output: projected.outputModalities },
    reasoning: projected.reasoning,
    tool_call: projected.toolCall,
    temperature: projected.temperature,
    structured_output: projected.structuredOutput,
    cost: projected.modelsDevCost,
    family: projected.family,
    knowledge: projected.knowledgeCutoff,
    release_date: projected.releaseDate,
  }
}

function capabilitiesFromManualDraft(draft: ManualRegistryDraft): ModelCapabilities {
  const projected = ManualRegistryDraftProjectionSchema.parse(draft)
  return {
    contextWindow: projected.contextWindow,
    maxOutput: projected.maxOutput,
    inputModalities: projected.inputModalities,
    outputModalities: projected.outputModalities,
    reasoning: projected.reasoning,
    toolCall: projected.toolCall,
    temperature: projected.temperature,
    structuredOutput: projected.structuredOutput,
    cost: projected.capabilitiesCost,
    family: projected.family,
    knowledgeCutoff: projected.knowledgeCutoff,
    releaseDate: projected.releaseDate,
  }
}

// ── Translation keys (i18n namespace agnostic) ──────────────────────────────

const LABEL_KEYS: Record<string, string> = {
  id: 'models.manual.label.id',
  name: 'models.manual.label.name',
  contextWindow: 'models.manual.label.contextWindow',
  maxOutputTokens: 'models.manual.label.maxOutputTokens',
  family: 'models.manual.label.family',
  knowledgeCutoff: 'models.manual.label.knowledgeCutoff',
  releaseDate: 'models.manual.label.releaseDate',
  inputCost: 'models.manual.label.inputCost',
  outputCost: 'models.manual.label.outputCost',
  cacheReadCost: 'models.manual.label.cacheReadCost',
  cacheWriteCost: 'models.manual.label.cacheWriteCost',
}

const FIELD_KEYS: Record<string, string> = {
  id: 'models.manual.field.id',
  name: 'models.manual.field.name',
  contextWindow: 'models.manual.field.contextWindow',
  maxOutputTokens: 'models.manual.field.maxOutputTokens',
  family: 'models.manual.field.family',
  knowledgeCutoff: 'models.manual.field.knowledgeCutoff',
  releaseDate: 'models.manual.field.releaseDate',
  inputCost: 'models.manual.field.inputCost',
  outputCost: 'models.manual.field.outputCost',
  cacheReadCost: 'models.manual.field.cacheReadCost',
  cacheWriteCost: 'models.manual.field.cacheWriteCost',
}

// ── Manual entry form ────────────────────────────────────────────────────────

function ManualEntryForm({
  draft,
  onChange,
  t,
}: {
  draft: ManualRegistryDraft
  onChange: (next: ManualRegistryDraft) => void
  t: (key: string) => string
}) {
  const fields: {
    key:
      | 'id'
      | 'name'
      | 'context'
      | 'output'
      | 'family'
      | 'knowledge'
      | 'releaseDate'
      | 'costInput'
      | 'costOutput'
      | 'costCacheRead'
      | 'costCacheWrite'
    label: string
    placeholder: string
    mono?: boolean
  }[] = [
    { key: 'id', label: LABEL_KEYS.id, placeholder: FIELD_KEYS.id, mono: true },
    { key: 'name', label: LABEL_KEYS.name, placeholder: FIELD_KEYS.name },
    {
      key: 'context',
      label: LABEL_KEYS.contextWindow,
      placeholder: FIELD_KEYS.contextWindow,
      mono: true,
    },
    {
      key: 'output',
      label: LABEL_KEYS.maxOutputTokens,
      placeholder: FIELD_KEYS.maxOutputTokens,
      mono: true,
    },
    { key: 'family', label: LABEL_KEYS.family, placeholder: FIELD_KEYS.family, mono: true },
    {
      key: 'knowledge',
      label: LABEL_KEYS.knowledgeCutoff,
      placeholder: FIELD_KEYS.knowledgeCutoff,
      mono: true,
    },
    {
      key: 'releaseDate',
      label: LABEL_KEYS.releaseDate,
      placeholder: FIELD_KEYS.releaseDate,
      mono: true,
    },
    {
      key: 'costInput',
      label: LABEL_KEYS.inputCost,
      placeholder: FIELD_KEYS.inputCost,
      mono: true,
    },
    {
      key: 'costOutput',
      label: LABEL_KEYS.outputCost,
      placeholder: FIELD_KEYS.outputCost,
      mono: true,
    },
    {
      key: 'costCacheRead',
      label: LABEL_KEYS.cacheReadCost,
      placeholder: FIELD_KEYS.cacheReadCost,
      mono: true,
    },
    {
      key: 'costCacheWrite',
      label: LABEL_KEYS.cacheWriteCost,
      placeholder: FIELD_KEYS.cacheWriteCost,
      mono: true,
    },
  ]

  const capabilities: { key: keyof ManualRegistryDraft, label: string }[] = [
    { key: 'inputText', label: t('models.manual.capability.textInput') },
    { key: 'inputImage', label: t('models.manual.capability.imageInput') },
    { key: 'outputText', label: t('models.manual.capability.textOutput') },
    { key: 'reasoning', label: t('models.manual.capability.reasoning') },
    { key: 'toolCall', label: t('models.manual.capability.tools') },
    { key: 'temperature', label: t('models.manual.capability.temperature') },
    { key: 'structuredOutput', label: t('models.manual.capability.structuredOutput') },
  ]

  return (
    <div className="grid max-h-[min(70vh,34rem)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
      {fields.map(f => (
        <div key={f.key} className="grid gap-1.5">
          <Label className="text-[13px] font-medium">{t(f.label)}</Label>
          <Input
            value={draft[f.key]}
            onChange={event => onChange({ ...draft, [f.key]: event.target.value })}
            placeholder={t(f.placeholder)}
            className={cn('h-8 text-[12px]', f.mono && 'font-mono')}
          />
        </div>
      ))}

      <div className="grid gap-2 rounded-lg bg-muted/35 p-3 sm:col-span-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {capabilities.map(c => (
            <label
              key={c.key}
              className="flex items-center gap-2 text-[12px] text-muted-foreground"
            >
              <Checkbox
                checked={draft[c.key] as boolean}
                onCheckedChange={checked => onChange({ ...draft, [c.key]: !!checked })}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main dialog ──────────────────────────────────────────────────────────────

interface ModelRegistryMappingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
  modelLabel?: string
  initialSearchQuery?: string
  initialMode?: 'search' | 'manual'
  initialRegistryModel?: ModelsDevModel
  modelIdEditable?: boolean
  onSaved?: (modelId: string, result: SearchResult, matchType: 'alias' | 'manual') => void
}

export function ModelRegistryMappingDialog({
  open,
  onOpenChange,
  modelId: initialModelId,
  modelLabel,
  initialSearchQuery,
  initialMode = 'search',
  initialRegistryModel,
  modelIdEditable = false,
  onSaved,
}: ModelRegistryMappingDialogProps) {
  const t = useTranslation('agentManagement').t
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'search' | 'manual'>(initialMode)
  const [editableModelId, setEditableModelId] = useState(initialModelId)
  const modelId = modelIdEditable ? editableModelId.trim() : initialModelId
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery ?? '')
  const [manualDraft, setManualDraft] = useState<ManualRegistryDraft>(() =>
    createManualDraftFromModel(initialRegistryModel, {
      modelId: initialModelId,
      modelLabel,
      query: initialSearchQuery,
    }))
  const [saving, setSaving] = useState(false)

  const { results: searchResults, isPending: searchPending } = useModelSearch(
    open ? searchQuery : '',
  )

  const close = () => {
    onOpenChange(false)
    setStep(initialMode)
    setEditableModelId(initialModelId)
    setSearchQuery(initialSearchQuery ?? '')
    setManualDraft(
      createManualDraftFromModel(initialRegistryModel, {
        modelId: initialModelId,
        modelLabel,
        query: initialSearchQuery,
      }),
    )
    setSaving(false)
  }

  const saveMapping = async (
      result: SearchResult,
      matchType: 'alias' | 'manual',
      model?: ReturnType<typeof buildManualModelsDevModel>,
    ) => {
      if (!modelId) { return }
      setSaving(true)
      const body = model
        ? { modelId, registryModelId: result.id, model }
        : { modelId, registryModelId: result.id }
      try {
        await putModelRegistryMappingsByModelId({
          path: { modelId },
          body: { ...body, matchType },
          throwOnError: true,
        })
        void queryClient.invalidateQueries({ queryKey: getModelRegistryMappingsQueryKey() })
        onSaved?.(modelId, result, matchType)
        setSaving(false)
        close()
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: error instanceof Error ? error.message : String(error),
        })
        setSaving(false)
      }
    }

  const handleSelectResult = (result: SearchResult) => void saveMapping(result, 'alias')

  const handleSaveManual = () => {
    if (!manualDraft.id.trim()) { return }
    const manualModel = buildManualModelsDevModel(manualDraft)
    void saveMapping(
      {
        id: manualModel.id,
        label: manualModel.name,
        capabilities: capabilitiesFromManualDraft(manualDraft),
      },
      'manual',
      manualModel,
    )
  }

  const openManual = () => {
    setManualDraft(createManualDraft(modelId, modelLabel ?? '', {}, searchQuery))
    setStep('manual')
  }

  const openManualFromResult = (result: SearchResult) => {
    setManualDraft(
      createManualDraft(modelId, result.label, result.capabilities, result.id),
    )
    setStep('manual')
  }

  // ── Search step ──────────────────────────────────────────────────────────

  if (step === 'search') {
    return (
      <Dialog open={open} onOpenChange={v => !v && close()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('models.mapping.dialog.title')}</DialogTitle>
            <DialogDescription>{t('models.mapping.dialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {modelIdEditable
? (
              <div className="grid gap-1.5">
                <Label className="text-[13px] font-medium">{t('models.manual.label.id')}</Label>
                <Input
                  value={editableModelId}
                  onChange={event => setEditableModelId(event.target.value)}
                  placeholder={t('models.manual.field.id')}
                  className="h-8 font-mono text-[12px]"
                />
              </div>
            )
: modelLabel
? (
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <div className="truncate text-[12.5px] font-medium text-foreground">
                  {modelLabel}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {initialModelId}
                </div>
              </div>
            )
: null}

            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
              <Input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={t('models.mapping.search.placeholder')}
                className="h-8 pl-8 font-mono text-[12px]"
              />
              {searchPending && (
                <Spinner className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg ring-1 ring-foreground/6">
              {searchResults.length > 0
? (
                <ul className="divide-y divide-foreground/4">
                  {searchResults.map(result => (
                    <li key={`${result.source}:${result.id}`}>
                      <SearchResultItem
                        result={result}
                        source={result.source}
                        disabled={saving}
                        onMap={() => handleSelectResult(result)}
                        onCreateEntry={() => openManualFromResult(result)}
                        mapLabel={t('models.mapping.mapResult')}
                        createEntryLabel={t('models.mapping.createFromResult')}
                      />
                    </li>
                  ))}
                </ul>
              )
: (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                  {searchPending ? t('models.mapping.searching') : t('models.mapping.emptyResults')}
                </div>
              )}
            </div>
          </div>

          <DialogFooter variant="bare">
            <Button size="sm" variant="outline" onClick={close}>
              {t('models.action.cancel')}
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={openManual}>
              <SlidersHorizontalIcon className="size-3.5" />
              {t('models.mapping.createManualEntry')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Manual entry step ────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => !v && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(initialRegistryModel ? 'models.manual.editTitle' : 'models.manual.title')}
          </DialogTitle>
          <DialogDescription>{t('models.manual.description')}</DialogDescription>
        </DialogHeader>

        <ManualEntryForm
          draft={manualDraft}
          onChange={setManualDraft}
          t={t as (key: string) => string}
        />

        <DialogFooter variant="bare">
          <Button size="sm" variant="outline" onClick={() => setStep('search')}>
            {t('models.action.back')}
          </Button>
          <Button
            size="sm"
            onClick={handleSaveManual}
            disabled={!manualDraft.id.trim() || saving}
            className="gap-1.5"
          >
            {saving && <Spinner className="size-3.5" />}
            {t('models.manual.saveMapping')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
