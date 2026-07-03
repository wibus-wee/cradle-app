import {
  AttachmentLine as PaperclipIcon,
  BoxLine as BoxIcon,
  BrainLine as BrainIcon,
  Chat1Line as MessageCircleIcon,
  CommandLine as CommandIcon,
  Cursor2Line as MousePointer2Icon,
  Dashboard2Line as GaugeIcon,
  DotCircleLine as CircleDotIcon,
  GitCompareLine as DiffIcon,
  GroupLine as UsersIcon,
  HammerLine as HammerIcon,
  HeartbeatLine as ActivityIcon,
  ListCheckLine as ListChecksIcon,
  PackageLine as PackageIcon,
  Plugin2Line,
  QuestionLine as CircleHelpIcon,
  QuestionLine as MessageCircleQuestionIcon,
  SafeShieldLine as ShieldCheckIcon,
  Scan2Line as ScanEyeIcon,
  SearchLine as SearchIcon,
  Settings2Line as SettingsIcon,
  SparklesLine as SparklesIcon,
  TargetLine as TargetIcon,
  TerminalBoxLine as SquareTerminalIcon,
  TreeLine as FolderTreeIcon,
  WarningLine as AlertTriangleIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { clampPercentValue } from '~/lib/number-format'

import type { ChatComposerSlashCommand, ChatSlashCommandStateVisual } from './chat-slash-commands'
import { getSlashCommandSourceLabel, hasDuplicateSlashCommandName } from './chat-slash-commands'
import { getSlashCommandPanelItems, isSlashCommandAvailable } from './slash-command-input'

interface SlashCommandPanelProps {
  commands: ChatComposerSlashCommand[]
  query: string
  listboxId?: string
  onActiveOptionIdChange?: (optionId: string | undefined) => void
  onSelect: (command: ChatComposerSlashCommand) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 24
const UNSAFE_OPTION_ID_CHAR_RE = /[^\w-]/g

function formatCommandSubtitle(
  commands: ChatComposerSlashCommand[],
  command: ChatComposerSlashCommand,
): string {
  const aliases = command.aliases?.length
    ? `Aliases: ${command.aliases.map(alias => `/${alias}`).join(', ')}`
    : ''
  return [
    command.description,
    command.availability?.enabled === false ? command.availability.reason : '',
    aliases,
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatSlashCommandOptionId(command: ChatComposerSlashCommand, index: number): string {
  return `chat-slash-command-${formatCommandKey(command, index).replace(UNSAFE_OPTION_ID_CHAR_RE, '-')}`
}

function formatCommandKey(command: ChatComposerSlashCommand, index: number): string {
  return command.id || `${command.source}:${command.name}:${index}`
}

function getCommandBadge(
  commands: ChatComposerSlashCommand[],
  command: ChatComposerSlashCommand,
): string {
  return hasDuplicateSlashCommandName(commands, command) ? getSlashCommandSourceLabel(command) : ''
}

function getCommandBadgeClassName(command: ChatComposerSlashCommand): string {
  return command.source === 'runtime'
    ? 'border-primary/20 bg-primary/10 text-primary'
    : 'border-border bg-muted text-muted-foreground'
}

function getCommandStateClassName(command: ChatComposerSlashCommand): string {
  switch (command.stateTone) {
    case 'success':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'danger':
      return 'border-destructive/25 bg-destructive/10 text-destructive'
    case 'neutral':
    default:
      return 'border-border/70 bg-muted/70 text-muted-foreground'
  }
}

function formatCommandRowSubtitle(
  commands: ChatComposerSlashCommand[],
  command: ChatComposerSlashCommand,
): string {
  if (command.stateVisual?.kind === 'compactUsage' && command.stateLabel) {
    return `${command.description} (${command.stateLabel.toLowerCase()})`
  }
  return formatCommandSubtitle(commands, command)
}

function readCommandTitle(command: ChatComposerSlashCommand): string {
  return command.label ?? `/${command.name}`
}

function readCompactRingClassName(status: ChatSlashCommandStateVisual['status']): string {
  switch (status) {
    case 'compacted':
      return 'text-emerald-500'
    case 'overLimit':
      return 'text-destructive'
    case 'nearLimit':
      return 'text-amber-500'
    case 'running':
      return 'text-primary'
    case 'idle':
    default:
      return 'text-primary/80'
  }
}

function renderCommandIcon(command: ChatComposerSlashCommand): ReactNode {
  const className = 'mt-0.5 size-3.5 shrink-0 text-muted-foreground/80'
  switch (command.iconKey ?? (command.presentation === 'slot' ? 'tool-activity' : undefined)) {
    case 'alert':
      return <AlertTriangleIcon className={className} aria-hidden="true" />
    case 'appshot':
      return <SparklesIcon className={className} aria-hidden="true" />
    case 'approvals':
      return <ShieldCheckIcon className={className} aria-hidden="true" />
    case 'code-review':
      return <ScanEyeIcon className={className} aria-hidden="true" />
    case 'compact':
      return <GaugeIcon className={className} aria-hidden="true" />
    case 'config':
      return <SettingsIcon className={className} aria-hidden="true" />
    case 'crew':
      return <UsersIcon className={className} aria-hidden="true" />
    case 'diff':
      return <DiffIcon className={className} aria-hidden="true" />
    case 'feedback':
      return <MessageCircleIcon className={className} aria-hidden="true" />
    case 'filesystem':
      return <FolderTreeIcon className={className} aria-hidden="true" />
    case 'goal':
      return <TargetIcon className={className} aria-hidden="true" />
    case 'ide-context':
      return <MousePointer2Icon className={className} aria-hidden="true" />
    case 'mcp':
      return <PaperclipIcon className={className} aria-hidden="true" />
    case 'model':
      return <BoxIcon className={className} aria-hidden="true" />
    case 'personality':
    case 'plan':
    case 'side-chat':
      return <CircleDotIcon className={className} aria-hidden="true" />
    case 'progress':
      return <ListChecksIcon className={className} aria-hidden="true" />
    case 'quick-question':
      return <MessageCircleQuestionIcon className={className} aria-hidden="true" />
    case 'user-input':
      return <CircleHelpIcon className={className} aria-hidden="true" />
    case 'plugin':
      return <Plugin2Line className={className} aria-hidden="true" />
    case 'reasoning':
      return <BrainIcon className={className} aria-hidden="true" />
    case 'search':
      return <SearchIcon className={className} aria-hidden="true" />
    case 'skills':
      return <PackageIcon className={className} aria-hidden="true" />
    case 'status':
      return <ActivityIcon className={className} aria-hidden="true" />
    case 'terminal':
      return <SquareTerminalIcon className={className} aria-hidden="true" />
    case 'tool-activity':
      return <HammerIcon className={className} aria-hidden="true" />
    case 'usage':
      return <GaugeIcon className={className} aria-hidden="true" />
    default:
      return <CommandIcon className={className} aria-hidden="true" />
  }
}

function SlashCommandIcon({
  command,
  className,
}: {
  command: ChatComposerSlashCommand
  className?: string
}) {
  const visual = command.stateVisual
  if (visual?.kind === 'compactUsage') {
    return <CompactUsageIcon state={visual} className={className} />
  }
  return <span className={cn('shrink-0', className)}>{renderCommandIcon(command)}</span>
}

function CompactUsageIcon({
  state,
  className,
}: {
  state: ChatSlashCommandStateVisual
  className?: string
}) {
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const percent = state.percent === null ? 0 : clampPercentValue(state.percent)
  const strokeDashoffset = circumference - (circumference * percent) / 100

  return (
    <span
      className={cn(
        'relative mt-px grid size-4 shrink-0 place-items-center',
        readCompactRingClassName(state.status),
        state.status === 'running' && 'animate-pulse',
        className,
      )}
      aria-hidden="true"
      data-testid="slash-command-compact-state-ring"
    >
      <svg className="absolute inset-0 size-4 -rotate-90" viewBox="0 0 18 18">
        <circle
          cx="9"
          cy="9"
          r={radius}
          className="stroke-muted-foreground/20"
          fill="none"
          strokeWidth="2"
        />
        {state.percent !== null && (
          <circle
            cx="9"
            cy="9"
            r={radius}
            className="stroke-current"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            strokeWidth="2"
          />
        )}
      </svg>
    </span>
  )
}

export function SlashCommandPanel({
  commands,
  listboxId,
  onActiveOptionIdChange,
  query,
  onSelect,
  onClose,
  visible,
}: SlashCommandPanelProps) {
  const [selection, setSelection] = useState({ activeIndex: 0, query })
  const listRef = useRef<HTMLMenuElement>(null)

  const results = useMemo(
    () =>
      getSlashCommandPanelItems(commands, query)
        .slice(0, MAX_RESULTS)
        .map(item => ({ item })),
    [commands, query],
  )

  const effectiveActiveIndex
    = results.length === 0
      ? 0
      : Math.min(selection.query === query ? selection.activeIndex : 0, results.length - 1)

  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[effectiveActiveIndex] as HTMLElement | undefined
    if (typeof active?.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' })
    }
  }, [effectiveActiveIndex])

  const handleDocumentKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!visible) {
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelection({
        activeIndex: (effectiveActiveIndex + 1) % Math.max(results.length, 1),
        query,
      })
    }
 else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelection({
        activeIndex: (effectiveActiveIndex - 1 + results.length) % Math.max(results.length, 1),
        query,
      })
    }
 else if (
      (e.key === 'Enter' || e.key === 'Tab')
      && results[effectiveActiveIndex]
      && isSlashCommandAvailable(results[effectiveActiveIndex].item)
    ) {
      e.preventDefault()
      onSelect(results[effectiveActiveIndex].item)
    }
 else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true)
  }, [])

  const handleOptionClick = useCallback(
    (command: ChatComposerSlashCommand) => {
      if (!isSlashCommandAvailable(command)) {
        return
      }
      onSelect(command)
    },
    [onSelect],
  )

  const activeCommand = results[effectiveActiveIndex]?.item
  const activeOptionId = activeCommand
    ? formatSlashCommandOptionId(activeCommand, effectiveActiveIndex)
    : undefined

  useEffect(() => {
    onActiveOptionIdChange?.(visible ? activeOptionId : undefined)
  }, [activeOptionId, onActiveOptionIdChange, visible])

  if (!visible || results.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl backdrop-blur-md">
      <menu ref={listRef} className="m-0 max-h-72 list-none overflow-y-auto p-1" id={listboxId}>
        {results.map(({ item }, idx) => {
          const subtitle = formatCommandRowSubtitle(commands, item)
          const badge = getCommandBadge(commands, item)
          const isAvailable = isSlashCommandAvailable(item)
          return (
            <li key={formatCommandKey(item, idx)}>
              <Button
                type="button"
                id={formatSlashCommandOptionId(item, idx)}
                aria-label={`${readCommandTitle(item)} ${getSlashCommandSourceLabel(item)}`}
                data-active={formatSlashCommandOptionId(item, idx) === activeOptionId}
                disabled={!isAvailable}
                variant="ghost"
                className={cn(
                  'h-auto w-full items-start justify-start gap-2.5 rounded-lg px-2.5 py-1 text-left whitespace-normal',
                  isAvailable
                    ? idx === effectiveActiveIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground/80 hover:bg-accent/40'
                    : 'cursor-not-allowed text-muted-foreground/45 opacity-75',
                )}
                onMouseEnter={() => setSelection({ activeIndex: idx, query })}
                onFocus={() => setSelection({ activeIndex: idx, query })}
                onClick={() => handleOptionClick(item)}
              >
                <SlashCommandIcon command={item} />
                <span className="flex min-w-0 flex-1 flex-row items-center gap-1.5">
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="shrink-0 whitespace-nowrap text-xs font-medium">
                      {readCommandTitle(item)}
                    </span>
                    {item.argumentHint && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {item.argumentHint}
                      </span>
                    )}
                    {badge && (
                      <span
                        className={cn(
                          'rounded border px-1 py-px text-[9px] font-medium leading-none',
                          getCommandBadgeClassName(item),
                        )}
                      >
                        {badge}
                      </span>
                    )}
                    {item.stateLabel && item.stateVisual?.kind !== 'compactUsage' && (
                      <span
                        className={cn(
                          'max-w-28 truncate rounded border px-1 py-px text-[9px] font-medium leading-none tabular-nums',
                          getCommandStateClassName(item),
                        )}
                      >
                        {item.stateLabel}
                      </span>
                    )}
                  </span>
                  {subtitle && (
                    <span className="mt-0.5 block min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {subtitle}
                    </span>
                  )}
                </span>
              </Button>
            </li>
          )
        })}
      </menu>
    </div>
  )
}
