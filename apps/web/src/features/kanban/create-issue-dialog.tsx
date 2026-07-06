import {
  AttachmentLine as PaperclipIcon,
  CalendarLine as CalendarIcon,
  CloseLine as XIcon,
  FullscreenLine as MaximizeIcon,
  RightSmallLine as ChevronRightIcon,
  SearchLine as SearchIcon,
  TagLine as TagsIcon,
  UserXLine as UserRoundXIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Calendar } from '~/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import type { KanbanIssue, KanbanStatus } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { AssigneeAvatar } from './shared/assignee-avatar'
import { priorityOptions } from './shared/issue-metadata'
import { LabelChip } from './shared/label-chip'
import { collectWorkspaceLabelOptions, filterWorkspaceLabelOptions } from './shared/label-metadata'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { IssuePriority } from './use-kanban'
import { useCreateIssue, useStatuses } from './use-kanban'

const priorityLabelKeys: Record<IssuePriority, 'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

const CURRENT_USER_ASSIGNEE_ID = '__self__'
const LABEL_SUGGESTION_LIMIT = 8

function normalizeLabelForCompare(label: string): string {
  return label.trim().toLowerCase()
}

function toDateInputValue(ts: number | null | undefined): string {
  return ts ? formatIssueDate(new Date(ts * 1000)) : ''
}

function toCalendarDate(ts: number | null | undefined): Date | undefined {
  return ts ? new Date(ts * 1000) : undefined
}

function fromCalendarDate(value: Date | undefined): number | null {
  return value ? Math.floor(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 1000) : null
}

function formatIssueDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(value)
}

interface CreateIssueDialogProps {
  workspaceId: string
  issues: KanbanIssue[]
  defaultStatusId?: string
  open: boolean
  onClose: () => void
}

export function CreateIssueDialog({ workspaceId, issues, defaultStatusId, open, onClose }: CreateIssueDialogProps) {
  const { t } = useTranslation('kanban')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [statusId, setStatusId] = useState(defaultStatusId ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [dueDate, setDueDate] = useState<number | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { workspaces } = useWorkspaces()
  const createIssue = useCreateIssue()

  const workspaceName = workspaces.find(w => w.id === workspaceId)?.name ?? t('createIssue.workspaceFallback')
  const currentStatus = statuses.find((s: KanbanStatus) => s.id === statusId)

  useEffect(() => {
    if (!open) {
      return
    }
    if (defaultStatusId) {
      setStatusId(defaultStatusId)
    }
    const timer = setTimeout(() => titleInputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [open, defaultStatusId])

  const handleSubmit = () => {
    if (!title.trim()) {
      return
    }
    createIssue.mutate({
      workspaceId,
      title: title.trim(),
      description: description.trim() || null,
      priority: priority as IssuePriority,
      statusId: statusId || undefined,
      assigneeKind: assigneeId ? 'user' : null,
      assigneeId: assigneeId || null,
      dueDate,
      labels,
    }, {
      onSuccess: () => {
        setTitle('')
        setDescription('')
        setPriority('none')
        setStatusId('')
        setAssigneeId('')
        setLabels([])
        setDueDate(null)
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
 else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
          {/* Scrim — no blur, just a light dark veil */}
          <m.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-0 bg-black/20"
            onClick={onClose}
          />

          {/* Panel */}
          <m.div
            key="panel"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            onKeyDown={handleKeyDown}
            className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-[var(--shadow-lg)]"
          >
            {/* ── Header ── */}
            <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
              <span className="text-[12px] text-muted-foreground flex items-center gap-1">
                <span className="font-medium text-muted-foreground">{workspaceName}</span>
                <ChevronRightIcon className="size-3" />
                <span>{t('createIssue.breadcrumb')}</span>
              </span>
              <div className="flex-1" />
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <MaximizeIcon className="size-3" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <XIcon className="size-3" />
              </button>
            </div>

            {/* ── Body ── */}
            <div className="px-4 pt-3 pb-1">
              <input
                ref={titleInputRef}
                value={title}
                aria-label={t('createIssue.titlePlaceholder')}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('createIssue.titlePlaceholder')}
                className="w-full bg-transparent text-[15px] font-semibold text-foreground outline-none placeholder:text-muted-foreground leading-snug"
              />
            </div>

            <div className="px-4 pb-2 min-h-[60px]">
              <MarkdownEditor
                content={description}
                onSave={setDescription}
                placeholder={t('createIssue.descriptionPlaceholder')}
                className="text-[13px] text-muted-foreground"
              />
            </div>

            {/* ── Metadata badges ── */}
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
              <StatusPicker
                statuses={statuses}
                value={statusId}
                onChange={setStatusId}
                currentStatus={currentStatus}
              />
              <PriorityPicker value={priority} onChange={setPriority} />
              <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
              <DueDatePicker value={dueDate} onChange={setDueDate} />
              <LabelsPicker labels={labels} issues={issues} onChange={setLabels} />
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center gap-2 px-4 pb-3">
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <PaperclipIcon className="size-3.5" />
              </button>

              <div className="flex-1" />

              <button
                onClick={handleSubmit}
                disabled={!title.trim() || createIssue.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
                  'bg-primary text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'shadow-[var(--shadow-sm)]',
                )}
              >
                {t('createIssue.submit')}
                <kbd className="ml-0.5 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground font-sans leading-4">⌘↵</kbd>
              </button>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function StatusPicker({ statuses, value, onChange, currentStatus }: {
  statuses: KanbanStatus[]
  value: string
  onChange: (v: string) => void
  currentStatus?: KanbanStatus
}) {
  const { t } = useTranslation('kanban')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {currentStatus
            ? (
<>
                <StatusIcon category={currentStatus.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
                <span>{currentStatus.name}</span>
</>
)
            : <span>{t('property.status')}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {statuses.map((s: KanbanStatus) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <StatusIcon category={s.category as 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'} size={13} />
              {s.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AssigneePicker({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const { t } = useTranslation('kanban')
  const currentUserName = t('assignee.currentUser')
  const selectedValue = value ? `user:${value}` : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {value
            ? <AssigneeAvatar name={currentUserName} size={13} />
            : <UserRoundXIcon className="size-3.5" aria-hidden="true" />}
          <span>{value ? currentUserName : t('assignee.unassigned')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(nextValue) => {
            if (!nextValue) {
              onChange('')
              return
            }

            const [, id] = nextValue.split(':', 2)
            onChange(id ?? '')
          }}
        >
          <DropdownMenuRadioItem value="">
            <UserRoundXIcon className="size-4 !text-muted-foreground" aria-hidden="true" />
            <span>{t('assignee.unassigned')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={`user:${CURRENT_USER_ASSIGNEE_ID}`}>
            <AssigneeAvatar name={currentUserName} size={16} />
            <span>{currentUserName}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DueDatePicker({ value, onChange }: { value: number | null, onChange: (value: number | null) => void }) {
  const { t } = useTranslation('kanban')
  const selectedDate = toCalendarDate(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px]',
            value ? 'text-foreground' : 'text-muted-foreground',
            'hover:text-foreground transition-colors',
          )}
          aria-label={t('display.dueDate')}
        >
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          <span>{selectedDate ? toDateInputValue(value) : t('display.dueDate')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={date => onChange(fromCalendarDate(date))}
        />
        {selectedDate && (
          <div className="border-t border-border p-2">
            <button type="button" onClick={() => onChange(null)} className="w-full rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-fill hover:text-foreground">
              {t('filter.clear')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function LabelsPicker({ labels, issues, onChange }: { labels: string[], issues: KanbanIssue[], onChange: (labels: string[]) => void }) {
  const { t } = useTranslation('kanban')
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedLabelKeys = new Set(labels.map(normalizeLabelForCompare))
  const workspaceLabelOptions = collectWorkspaceLabelOptions(issues)
  const labelSuggestions = filterWorkspaceLabelOptions(workspaceLabelOptions, inputValue, labels).slice(0, LABEL_SUGGESTION_LIMIT)
  const trimmedInput = inputValue.trim()
  const canCreateLabel = trimmedInput.length > 0 && !selectedLabelKeys.has(normalizeLabelForCompare(trimmedInput))

  useEffect(() => {
    if (!open) {
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const addLabel = (label: string) => {
    const trimmed = label.trim()
    const key = normalizeLabelForCompare(trimmed)
    if (!trimmed || selectedLabelKeys.has(key)) {
      return
    }
    onChange([...labels, trimmed])
    setInputValue('')
  }

  const removeLabel = (label: string) => {
    const key = normalizeLabelForCompare(label)
    onChange(labels.filter(candidate => normalizeLabelForCompare(candidate) !== key))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-60 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <TagsIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {labels.length > 0
            ? (
                <span className="flex min-w-0 items-center gap-1">
                  {labels.slice(0, 2).map(label => <LabelChip key={label} label={label} className="h-4 max-w-20 truncate" />)}
                  {labels.length > 2 && (
<span className="tabular-nums">
+
{labels.length - 2}
</span>
)}
                </span>
              )
            : <span>{t('property.labels')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2">
            <SearchIcon className="size-3.5 !text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={inputValue}
              aria-label={t('property.labels')}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const exactSuggestion = labelSuggestions.find(option => normalizeLabelForCompare(option.label) === normalizeLabelForCompare(inputValue))
                  addLabel(exactSuggestion?.label ?? inputValue)
                }
              }}
              placeholder={t('issue.label.inputPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {labels.map(label => (
                <button key={label} type="button" onClick={() => removeLabel(label)} aria-label={`Remove label ${label}`}>
                  <LabelChip label={label} className="cursor-pointer hover:line-through" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {canCreateLabel && (
            <button
              type="button"
              onClick={() => addLabel(inputValue)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-fill"
            >
              <span className="truncate">{trimmedInput}</span>
              <span className="text-[11px] text-muted-foreground">{t('issue.label.create', { label: trimmedInput })}</span>
            </button>
          )}
          {labelSuggestions.map(option => (
            <button
              key={option.label}
              type="button"
              onClick={() => addLabel(option.label)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill"
            >
              <LabelChip label={option.label} tone={option.tone} className="max-w-40 truncate" />
              <span className="text-[11px] text-muted-foreground tabular-nums">{option.count}</span>
            </button>
          ))}
          {!canCreateLabel && labelSuggestions.length === 0 && (
            <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">{t('issue.label.noMatches')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PriorityPicker({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const { t } = useTranslation('kanban')
  const priority = value as IssuePriority

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <PriorityIcon priority={priority} size={13} />
          <span>{t(priorityLabelKeys[priority] ?? 'property.priority')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {priorityOptions.map(p => (
            <DropdownMenuRadioItem key={p.value} value={p.value}>
              <PriorityIcon priority={p.value} size={13} />
              {t(priorityLabelKeys[p.value])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
