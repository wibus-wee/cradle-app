import { ArrowRightUpLine as InheritIcon } from '@mingcute/react'

import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { ClaudeAgentAliasKey, ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  CLAUDE_AGENT_ALIAS_KEYS,
  DEFAULT_CLAUDE_AGENT_ALIASES,
} from '~/features/agent-runtime/claude-agent-config'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { SettingsDivider } from '../settings/settings-row'

const CURRENT_MODEL_VALUE = '__cradle_current_model__'

const TIERS: Array<{ key: ClaudeAgentAliasKey, label: string }> = [
  { key: 'haiku', label: 'Haiku' },
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'opus', label: 'Opus' },
]

function modelLabel(model: ModelDescriptor): string {
  return model.label || model.id
}

function dedupeModelOptions(input: Array<{ id: string, label: string }>): Array<{ id: string, label: string }> {
  const seen = new Set<string>()
  return input.filter((model) => {
    if (seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function buildModelOptions(input: {
  models: ModelDescriptor[]
  aliases: ClaudeAgentModelAliases
  mainModelId: string | null
}): Array<{ id: string, label: string }> {
  const aliasModels = CLAUDE_AGENT_ALIAS_KEYS
    .map(key => input.aliases[key].trim())
    .filter(Boolean)
    .map(id => ({ id, label: id }))

  const mainModel = input.mainModelId
    ? [{ id: input.mainModelId, label: input.mainModelId }]
    : []

  return dedupeModelOptions([
    ...mainModel,
    ...input.models.map(model => ({ id: model.id, label: modelLabel(model) })),
    ...aliasModels,
  ])
}

export function ClaudeModelMatrixEditor({
  aliases,
  models,
  mainModelId,
  loading = false,
  onChange,
}: {
  aliases: ClaudeAgentModelAliases
  models: ModelDescriptor[]
  mainModelId: string | null
  loading?: boolean
  onChange: (next: ClaudeAgentModelAliases) => void
}) {
  const modelOptions = buildModelOptions({ models, aliases, mainModelId })
  const setAlias = (key: ClaudeAgentAliasKey, value: string) => {
    onChange({
      ...aliases,
      [key]: value === CURRENT_MODEL_VALUE ? '' : value,
    })
  }

  return (
    <div className="flex flex-col gap-0 -mt-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {loading && <Spinner className="size-3 text-muted-foreground" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_CLAUDE_AGENT_ALIASES)}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Reset
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Clear alias overrides
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="overflow-hidden rounded-md ring-1 ring-foreground/8">
        {TIERS.map((tier, index) => {
          const currentValue = aliases[tier.key] || CURRENT_MODEL_VALUE
          const isPassthrough = currentValue === CURRENT_MODEL_VALUE

          return (
            <div key={tier.key}>
              {index > 0 && <SettingsDivider />}
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-[3.5rem] shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tier.label}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  <TierChip
                    active={isPassthrough}
                    onClick={() => setAlias(tier.key, CURRENT_MODEL_VALUE)}
                    title="Inherit the main model"
                  >
                    <InheritIcon className="size-2.5" aria-hidden="true" />
                    <span>inherit</span>
                  </TierChip>

                  {modelOptions.map((model) => {
                    const active = model.id === currentValue
                    return (
                      <TierChip
                        key={model.id}
                        active={active}
                        onClick={() => setAlias(tier.key, model.id)}
                        title={model.id}
                      >
                        <span className="truncate">{model.label}</span>
                      </TierChip>
                    )
                  })}

                  {modelOptions.length === 0 && (
                    <span className="px-1.5 text-[10.5px] text-muted-foreground/60">
                      No models discovered yet.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TierChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      title={title}
      className={cn(
        'inline-flex h-6 shrink-0 max-w-[10rem] items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/25'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
