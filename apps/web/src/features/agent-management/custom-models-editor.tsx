import {
  DeleteLine as Trash2Icon,
  PlusLine as PlusIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import { useEffect, useReducer, useRef } from 'react'
import { z } from 'zod'

import { postProvidersModelLookup, postProvidersModelSearch } from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import type { ModelCapabilities } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

interface SearchResult {
  id: string
  label: string
  capabilities: ModelCapabilities
}

interface CustomModelsEditorState {
  newId: string
  enrichingId: string | null
  searchQuery: string
  searchResults: SearchResult[]
  highlightIdx: number
  lookupPending: boolean
  searchPending: boolean
}

type CustomModelsEditorAction
  = | { type: 'new-id/set', value: string }
    | { type: 'lookup/start' }
    | { type: 'lookup/end' }
    | { type: 'enrich/start', modelId: string }
    | { type: 'enrich/cancel' }
    | { type: 'enrich/apply' }
    | { type: 'search-query/set', value: string }
    | { type: 'search/start' }
    | { type: 'search/success', results: SearchResult[] }
    | { type: 'search/clear' }
    | { type: 'highlight/set', index: number }

const initialCustomModelsEditorState: CustomModelsEditorState = {
  newId: '',
  enrichingId: null,
  searchQuery: '',
  searchResults: [],
  highlightIdx: 0,
  lookupPending: false,
  searchPending: false,
}

const ModelCapabilitiesSchema = z.object({}).passthrough()

const CustomModelEntrySchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().optional(),
    capabilities: ModelCapabilitiesSchema.default({}),
  })
  .transform(model => ({
    id: model.id,
    label: model.label || model.id,
    capabilities: model.capabilities,
  }))

const SearchResultsSchema = z.array(CustomModelEntrySchema)

function occurrenceKey(id: string, counts: Map<string, number>): string {
  const count = counts.get(id) ?? 0
  counts.set(id, count + 1)
  return `${id}:${count}`
}

function customModelsEditorReducer(
  state: CustomModelsEditorState,
  action: CustomModelsEditorAction,
): CustomModelsEditorState {
  switch (action.type) {
    case 'new-id/set':
      return { ...state, newId: action.value }
    case 'lookup/start':
      return { ...state, lookupPending: true }
    case 'lookup/end':
      return { ...state, lookupPending: false, newId: '' }
    case 'enrich/start':
      return {
        ...state,
        enrichingId: action.modelId,
        searchQuery: action.modelId,
        searchResults: [],
        highlightIdx: 0,
        searchPending: false,
      }
    case 'enrich/cancel':
    case 'enrich/apply':
      return {
        ...state,
        enrichingId: null,
        searchQuery: '',
        searchResults: [],
        highlightIdx: 0,
        searchPending: false,
      }
    case 'search-query/set':
      return { ...state, searchQuery: action.value }
    case 'search/start':
      return { ...state, searchPending: true }
    case 'search/success':
      return { ...state, searchResults: action.results, highlightIdx: 0, searchPending: false }
    case 'search/clear':
      if (state.searchResults.length === 0 && !state.searchPending && state.highlightIdx === 0) {
        return state
      }
      return { ...state, searchResults: [], highlightIdx: 0, searchPending: false }
    case 'highlight/set':
      return { ...state, highlightIdx: action.index }
    default:
      return state
  }
}

async function lookupModel(modelId: string): Promise<CustomModelEntry | null> {
  const { data } = await postProvidersModelLookup({
    body: { modelId },
    throwOnError: true,
  })
  return CustomModelEntrySchema.parse(data)
}

async function searchProviderModels(query: string): Promise<SearchResult[]> {
  const { data } = await postProvidersModelSearch({
    body: { query },
    throwOnError: true,
  })
  return SearchResultsSchema.parse(data)
}

export function CustomModelsEditor({
  models,
  onChange,
}: {
  models: CustomModelEntry[]
  onChange: (next: CustomModelEntry[]) => void
}) {
  const [state, dispatch] = useReducer(customModelsEditorReducer, initialCustomModelsEditorState)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchListRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search trigger
  useEffect(() => {
    const query = state.searchQuery.trim()
    if (!query) {
      dispatch({ type: 'search/clear' })
      return
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      dispatch({ type: 'search/start' })
      void searchProviderModels(query).then(
        results => dispatch({ type: 'search/success', results }),
        () => dispatch({ type: 'search/success', results: [] }),
      )
    }, 250)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [state.searchQuery])

  useEffect(() => {
    if (!state.enrichingId) {
      return
    }
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [state.enrichingId])

  const addModel = async () => {
    const id = state.newId.trim()
    if (!id || models.some(m => m.id === id)) {
      return
    }

    dispatch({ type: 'lookup/start' })
    try {
      const entry = (await lookupModel(id)) ?? { id, label: id, capabilities: {} }
      onChange([...models, entry])
    }
 catch {
      onChange([...models, { id, label: id, capabilities: {} }])
    }
    dispatch({ type: 'lookup/end' })
    inputRef.current?.focus()
  }

  const removeModel = (id: string) => {
      onChange(models.filter(m => m.id !== id))
    }

  const applyEnrichResult = (targetModelId: string, result: SearchResult) => {
      onChange(
        models.map(m =>
          m.id === targetModelId
            ? {
                ...m,
                label: result.label.trim() || targetModelId,
                capabilities: result.capabilities,
              }
            : m),
      )
      dispatch({ type: 'enrich/apply' })
    }

  const startEnrich = (modelId: string) => {
    dispatch({ type: 'enrich/start', modelId })
  }

  const cancelEnrich = () => {
    dispatch({ type: 'enrich/cancel' })
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelEnrich()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = Math.min(state.highlightIdx + 1, state.searchResults.length - 1)
        searchListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        dispatch({ type: 'highlight/set', index: next })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(state.highlightIdx - 1, 0)
        searchListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        dispatch({ type: 'highlight/set', index: next })
        return
      }
      if (e.key === 'Enter' && state.enrichingId && state.searchResults.length > 0) {
        e.preventDefault()
        applyEnrichResult(state.enrichingId, state.searchResults[state.highlightIdx])
      }
    }

  const modelKeyCounts = new Map<string, number>()
  const searchResultKeyCounts = new Map<string, number>()

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[12.5px] font-medium text-foreground">Custom models</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Add model IDs manually when the /models endpoint is unavailable or incomplete.
        </p>
      </div>

      {/* Add input */}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={state.newId}
          onChange={e => dispatch({ type: 'new-id/set', value: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && void addModel()}
          placeholder="e.g. claude-sonnet-4-20250514"
          className="h-8 flex-1 font-mono text-[12px]"
        />
        <Button
          size="xs"
          variant="secondary"
          onClick={() => void addModel()}
          disabled={!state.newId.trim() || state.lookupPending}
          className="gap-1"
        >
          {state.lookupPending ? <Spinner className="size-3" /> : <PlusIcon className="size-3" />}
          Add
        </Button>
      </div>

      {/* List */}
      {models.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
          <ul className="divide-y divide-foreground/4">
            {models.map(m => (
              <li key={occurrenceKey(m.id, modelKeyCounts)} className="relative">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-foreground">
                      {m.label !== m.id ? m.label : m.id}
                    </div>
                    {m.label !== m.id && (
                      <div className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                        {m.id}
                      </div>
                    )}
                  </div>
                  {m.capabilities.contextWindow != null && m.capabilities.contextWindow > 0 && (
                    <Badge
                      variant="secondary"
                      className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground"
                    >
                      {Math.round(m.capabilities.contextWindow / 1000)}
k
                    </Badge>
                  )}
                  {m.capabilities.reasoning && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal text-muted-foreground"
                    >
                      reasoning
                    </Badge>
                  )}
                  {m.capabilities.inputModalities && m.capabilities.inputModalities.length > 1 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal text-muted-foreground"
                    >
                      multimodal
                    </Badge>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => startEnrich(m.id)}
                    aria-label={`Match ${m.id} from models.dev`}
                    className="text-muted-foreground/50 hover:text-foreground"
                    title="Match from models.dev"
                  >
                    <SparklesIcon className="size-3" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => removeModel(m.id)}
                    aria-label={`Remove ${m.id}`}
                    className="text-muted-foreground/50 hover:text-destructive"
                  >
                    <Trash2Icon className="size-3" aria-hidden="true" />
                  </Button>
                </div>

                {/* Inline search autocomplete */}
                {state.enrichingId === m.id && (
                  <div className="border-t border-foreground/4 bg-muted/30 px-3 py-2">
                    <div className="relative">
                      <Input
                        ref={searchInputRef}
                        value={state.searchQuery}
                        onChange={e =>
                          dispatch({ type: 'search-query/set', value: e.target.value })}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search models.dev..."
                        className="h-7 font-mono text-[11px]"
                      />
                      {state.searchPending && (
                        <Spinner className="absolute right-2 top-1/2 size-3 -translate-y-1/2" />
                      )}
                    </div>
                    {state.searchResults.length > 0 && (
                      <ul
                        ref={searchListRef}
                        className="mt-1.5 max-h-40 overflow-y-auto rounded-lg ring-1 ring-foreground/6"
                      >
                        {state.searchResults.map((r, idx) => (
                          <li key={occurrenceKey(r.id, searchResultKeyCounts)}>
                            <button
                              type="button"
                              onClick={() => applyEnrichResult(m.id, r)}
                              onMouseEnter={() => dispatch({ type: 'highlight/set', index: idx })}
                              className={cn(
                                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
                                idx === state.highlightIdx && 'bg-accent',
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-medium text-foreground">
                                  {r.label}
                                </div>
                                <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                                  {r.id}
                                </div>
                              </div>
                              {r.capabilities.contextWindow != null
                                && r.capabilities.contextWindow > 0 && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                    {Math.round(r.capabilities.contextWindow / 1000)}
k
                                  </span>
                                )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {state.searchQuery.trim()
                      && !state.searchPending
                      && state.searchResults.length === 0 && (
                        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                          No matches found
                        </p>
                      )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
