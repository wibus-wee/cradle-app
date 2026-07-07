import {
  CloseLine as XIcon,
  LinkLine as LinkIcon,
  PlusLine as PlusIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '~/components/ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Skeleton } from '~/components/ui/skeleton'
import type { KanbanIssue } from '~/features/kanban/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { formatIssueId } from '../shared/format-issue-id'
import {
  useAddRelation,
  useDeleteRelation,
  useIssues,
  useRelations,
  useSearchIssues,
} from '../use-kanban'

interface RelationManagerProps {
  issueId: string
  workspaceId: string
  readOnly?: boolean
}

type RelationType = 'blocks' | 'duplicates' | 'relates_to'

type RelationAction = {
  key: string
  type: RelationType
  label: string
  direction: 'current-source' | 'current-target'
}

const relationSections: RelationAction[] = [
  {
    key: 'blocks',
    type: 'blocks',
    label: 'Blocks',
    direction: 'current-source',
  },
  {
    key: 'blocked-by',
    type: 'blocks',
    label: 'Blocked by',
    direction: 'current-target',
  },
  {
    key: 'duplicates',
    type: 'duplicates',
    label: 'Duplicates',
    direction: 'current-source',
  },
  {
    key: 'duplicated-by',
    type: 'duplicates',
    label: 'Duplicated by',
    direction: 'current-target',
  },
  {
    key: 'relates-to',
    type: 'relates_to',
    label: 'Related to',
    direction: 'current-source',
  },
]

export function RelationManager({ issueId, workspaceId, readOnly = false }: RelationManagerProps) {
  const { data: relations = [] } = useRelations(issueId, !readOnly)
  const { data: workspaceIssues = [], isLoading: isLoadingWorkspaceIssues } = useIssues({
    workspaceId,
  })
  const { workspaces } = useWorkspaces()
  const [addOpenSection, setAddOpenSection] = useState<string | null>(null)
  const [candidateOpenSection, setCandidateOpenSection] = useState<string | null>(null)
  const [targetIssueId, setTargetIssueId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim()
  const searchIssues = useSearchIssues(trimmedQuery, 8, !!addOpenSection && trimmedQuery.length > 0)
  const addRelation = useAddRelation()
  const deleteRelation = useDeleteRelation()

  const issueById = new Map(workspaceIssues.map(issue => [issue.id, issue]))

  const candidateIssues = (() => {
    const byId = new Map<string, KanbanIssue>()
    const needle = trimmedQuery.toLowerCase()
    const append = (issue: KanbanIssue) => {
      if (issue.id !== issueId) {
        byId.set(issue.id, issue)
      }
    }

    for (const issue of searchIssues.data ?? []) {
      append(issue)
    }

    for (const issue of workspaceIssues) {
      if (!needle) {
        append(issue)
        continue
      }

      const readableId = formatIssueId(issue, workspaces).toLowerCase()
      const searchableText = [issue.id, readableId, String(issue.number), issue.title]
        .join(' ')
        .toLowerCase()

      if (searchableText.includes(needle)) {
        append(issue)
      }
    }

    return Array.from(byId.values()).slice(0, 8)
  })()

  const typedIssue = (() => {
    const needle = trimmedQuery.toLowerCase()
    if (!needle) {
      return null
    }
    return (
      candidateIssues.find((issue) => {
        const readableId = formatIssueId(issue, workspaces).toLowerCase()
        return (
          issue.id.toLowerCase() === needle
          || readableId === needle
          || String(issue.number) === needle
        )
      }) ?? null
    )
  })()

  const selectedIssue = targetIssueId
    ? (issueById.get(targetIssueId) ?? candidateIssues.find(issue => issue.id === targetIssueId))
    : typedIssue
  const resolvedTargetId
    = targetIssueId ?? typedIssue?.id ?? (trimmedQuery.length > 0 ? trimmedQuery : null)
  const resolvedTargetLabel = selectedIssue
    ? `${formatIssueId(selectedIssue, workspaces)} ${selectedIssue.title}`
    : resolvedTargetId
  const canSubmit = !!resolvedTargetId && resolvedTargetId !== issueId

  const closeAddPopover = () => {
    setAddOpenSection(null)
    setCandidateOpenSection(null)
    setTargetIssueId(null)
    setQuery('')
  }

  const handleAddOpenChange = (sectionKey: string, open: boolean) => {
    if (readOnly) {
      return
    }
    if (open) {
      if (sectionKey !== addOpenSection) {
        setTargetIssueId(null)
        setQuery('')
      }
      setAddOpenSection(sectionKey)
      setCandidateOpenSection(sectionKey)
      return
    }
    closeAddPopover()
  }

  const submitRelation = (action: RelationAction) => {
    if (readOnly) {
      return
    }
    if (!canSubmit || !resolvedTargetId) {
      return
    }

    const sourceIssueId = action.direction === 'current-source' ? issueId : resolvedTargetId
    const targetIssueIdForRelation
      = action.direction === 'current-source' ? resolvedTargetId : issueId

    addRelation.mutate(
      {
        sourceIssueId,
        targetIssueId: targetIssueIdForRelation,
        type: action.type,
      },
      {
        onSuccess: closeAddPopover,
      },
    )
  }

  return (
    <div className="space-y-3">
      {relationSections.map((section) => {
        const sectionRelations = relations.filter((relation) => {
          if (section.type !== relation.type) {
            return false
          }
          if (section.type === 'relates_to') {
            return relation.sourceIssueId === issueId || relation.targetIssueId === issueId
          }
          return section.direction === 'current-source'
            ? relation.sourceIssueId === issueId
            : relation.targetIssueId === issueId
        })

        return (
          <section
            key={section.key}
            className="space-y-1.5"
            aria-labelledby={`issue-${section.key}-heading`}
          >
            <div className="flex items-center justify-between">
              <h3
                id={`issue-${section.key}-heading`}
                className="text-[12px] font-medium text-muted-foreground"
              >
                {section.label}
              </h3>
              {!readOnly && (
                <Popover
                  open={addOpenSection === section.key}
                  onOpenChange={open => handleAddOpenChange(section.key, open)}
                >
                  <PopoverTrigger
                    className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`Add ${section.label} relation`}
                  >
                    <PlusIcon className="size-3" aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-2">
                    <div className="space-y-2">
                      <Combobox
                        open={candidateOpenSection === section.key}
                        value={targetIssueId}
                        inputValue={query}
                        onOpenChange={open => setCandidateOpenSection(open ? section.key : null)}
                        onInputValueChange={(value) => {
                          setQuery(value)
                          setTargetIssueId(null)
                          setCandidateOpenSection(section.key)
                        }}
                        onValueChange={(value) => {
                          setTargetIssueId(value)
                          const issue = candidateIssues.find(candidate => candidate.id === value)
                          setQuery(issue ? formatIssueId(issue, workspaces) : (value ?? ''))
                          setCandidateOpenSection(null)
                        }}
                        modal={false}
                        autoHighlight
                      >
                        <ComboboxInput
                          autoFocus
                          aria-label={`Target issue for ${section.label}`}
                          placeholder="Search or paste issue ID"
                          showClear
                          showTrigger
                          size="sm"
                          startAddon={(
                            <SearchIcon
                              className="size-3 !text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          className="w-full"
                        />
                        <ComboboxContent align="start" sideOffset={6} className="w-72 p-1.5">
                          <ComboboxList className="max-h-56 p-0.5">
                            {(isLoadingWorkspaceIssues || searchIssues.isFetching) && (
                              <Skeleton className="h-10 w-full" />
                            )}
                            {!isLoadingWorkspaceIssues
                              && !searchIssues.isFetching
                              && candidateIssues.length === 0 && (
                                <div className="px-2 py-5 text-center text-xs text-muted-foreground">
                                  Type an issue ID to link directly
                                </div>
                              )}
                            {!isLoadingWorkspaceIssues
                              && candidateIssues.map(issue => (
                                <IssueRelationComboboxItem
                                  key={issue.id}
                                  issue={issue}
                                  readableId={formatIssueId(issue, workspaces)}
                                />
                              ))}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>

                      <div className="rounded-lg bg-fill/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                        {resolvedTargetLabel
                          ? `Target: ${resolvedTargetLabel}`
                          : 'Choose a target issue first'}
                      </div>

                      <button
                        type="button"
                        onClick={() => submitRelation(section)}
                        disabled={!canSubmit || addRelation.isPending}
                        className="flex h-7 w-full items-center justify-center rounded-md bg-primary px-2 text-[12px] font-medium text-primary-foreground transition-[background-color,opacity] hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                      >
                        Add to
{' '}
{section.label}
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {sectionRelations.length > 0
? (
              <div className="flex flex-col gap-1">
                {sectionRelations.map(relation => (
                  <RelationRow
                    key={relation.id}
                    issueId={issueId}
                    relation={relation}
                    label={section.label}
                    issueById={issueById}
                    workspaces={workspaces}
                    readOnly={readOnly}
                    onDelete={id => deleteRelation.mutate({ id, issueId })}
                  />
                ))}
              </div>
            )
: (
              <p className="text-[12px] text-muted-foreground/50">None</p>
            )}
          </section>
        )
      })}
    </div>
  )
}

function RelationRow({
  issueId,
  relation,
  label,
  issueById,
  workspaces,
  readOnly,
  onDelete,
}: {
  issueId: string
  relation: { id: string, sourceIssueId: string, targetIssueId: string }
  label: string
  issueById: Map<string, KanbanIssue>
  workspaces: Parameters<typeof formatIssueId>[1]
  readOnly: boolean
  onDelete: (id: string) => void
}) {
  const targetId
    = relation.sourceIssueId === issueId ? relation.targetIssueId : relation.sourceIssueId
  const targetIssue = issueById.get(targetId)
  const targetLabel = targetIssue ? formatIssueId(targetIssue, workspaces) : targetId.slice(0, 8)
  const targetTitle = targetIssue?.title

  return (
    <div className="group flex items-center gap-2 py-1">
      <LinkIcon className="size-3 !text-muted-foreground/60" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12px] text-foreground">
        <span className="shrink-0 font-mono tabular-nums">{targetLabel}</span>
        {targetTitle && <span className="truncate text-muted-foreground">{targetTitle}</span>}
      </span>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onDelete(relation.id)}
          className="flex size-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Remove ${label} relation ${targetLabel}`}
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function IssueRelationComboboxItem({
  issue,
  readableId,
}: {
  issue: KanbanIssue
  readableId: string
}) {
  return (
    <ComboboxItem value={issue.id} className="min-h-11 items-start gap-2 rounded-lg p-2 pr-7">
      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {readableId}
      </span>
      <span className="min-w-0 flex-1 whitespace-normal break-words text-xs font-medium leading-4 text-foreground">
        {issue.title}
      </span>
    </ComboboxItem>
  )
}
