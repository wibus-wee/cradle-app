import {
  DownSmallLine as ChevronDownIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { lazy, Suspense, useEffect, useState } from 'react'

import type { GetProviderTargetsCodexConfigSchemaResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { CodexConfig, CodexField, CodexSchemaModel } from './codex-config-schema'
import { flagValue, getPathValue, isOverridden, isPathOverridden, quickFieldMeta } from './codex-config-schema'

const CodexConfigFieldEditor = lazy(() =>
  import('./codex-config-field-editor').then(module => ({ default: module.CodexConfigFieldEditor })))

interface CodexConfigSettingsViewProps {
  schema: GetProviderTargetsCodexConfigSchemaResponse
  model: CodexSchemaModel
  config: CodexConfig
  theme: 'vs' | 'vs-dark'
  /** Controls stay visible but are not interactive while saving or after a parse error. */
  readOnly: boolean
  search: string
  onSearchChange: (search: string) => void
  onSetPath: (path: string[], value: unknown) => void
  onSetFlag: (key: string, value: boolean | undefined) => void
}

export function CodexConfigSettingsView({
  schema,
  model,
  config,
  theme,
  readOnly,
  search,
  onSearchChange,
  onSetPath,
  onSetFlag,
}: CodexConfigSettingsViewProps) {
  const query = search.trim().toLowerCase()
  const searching = query.length > 0
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(
      model.groups
        .filter(group => group.fields.some(field => isOverridden(config, field.key)))
        .map(group => group.id),
    ),
  )
  const [expandedFields, setExpandedFields] = useState<ReadonlySet<string>>(() => new Set())

  const toggleGroup = (id: string) => {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      }
      else {
        next.add(id)
      }
      return next
    })
  }

  const toggleField = (key: string) => {
    setExpandedFields((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      }
      else {
        next.add(key)
      }
      return next
    })
  }

  const matches = (field: CodexField) =>
    !searching
    || field.key.toLowerCase().includes(query)
    || field.description?.toLowerCase().includes(query)

  const quickFields = model.quickFields.filter(matches)
  const visibleFlags = model.flags.filter(matches)
  const visibleGroups = model.groups
    .map(group => ({ ...group, fields: group.fields.filter(matches) }))
    .filter(group => group.fields.length > 0)
  const totalMatches = quickFields.length + visibleFlags.length + visibleGroups.reduce((sum, group) => sum + group.fields.length, 0)

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-9">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
          <Input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Search settings and feature flags"
            aria-label="Search settings and feature flags"
            className="h-8 pl-8 "
          />
        </div>

        {totalMatches === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground [text-wrap:pretty]">
            {`No settings match “${search.trim()}”.`}
          </p>
        )}

        {quickFields.length > 0 && (
          <section className="flex flex-col gap-4">
            <h4 className="px-0.5 text-sm font-medium text-foreground">General</h4>
            <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4">
              {quickFields.map(field => (
                <QuickFieldRow
                  key={field.key}
                  field={field}
                  config={config}
                  readOnly={readOnly}
                  onSetPath={onSetPath}
                />
              ))}
            </div>
          </section>
        )}

        {visibleFlags.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="px-0.5">
              <p className="text-sm font-medium text-foreground">Feature flags</p>
              <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">
                {`${model.flags.length} toggles. Each can inherit, enable, or disable.`}
              </p>
            </div>
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
              <ul className="divide-y divide-foreground/4">
                {visibleFlags.map(flag => (
                  <FlagRow
                    key={flag.key}
                    flag={flag}
                    value={flagValue(config, flag.key)}
                    readOnly={readOnly}
                    onSetFlag={onSetFlag}
                  />
                ))}
              </ul>
            </div>
          </section>
        )}

        {visibleGroups.length > 0 && (
          <section className="flex flex-col gap-3">
            <p className="px-0.5 text-sm font-medium text-foreground">All settings</p>
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
              {visibleGroups.map((group, index) => {
                const open = searching || openGroups.has(group.id)
                return (
                  <Collapsible
                    key={group.id}
                    open={open}
                    onOpenChange={() => toggleGroup(group.id)}
                    className={cn(index > 0 && 'border-t border-foreground/4')}
                  >
                    <CollapsibleTrigger
                      disabled={searching}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <ChevronDownIcon
                        className={cn(
                          'size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200',
                          open && 'rotate-180',
                        )}
                      />
                      <span className="text-sm font-medium text-foreground">{group.label}</span>
                      <span className="font-mono text-xs text-muted-foreground/70 tabular-nums">
                        {group.fields.length}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
                      <ul className="divide-y divide-foreground/4 border-t border-foreground/4">
                        {group.fields.map(field => (
                          <ExplorerRow
                            key={field.key}
                            field={field}
                            path={[field.key]}
                            config={config}
                            readOnly={readOnly}
                            theme={theme}
                            expanded={expandedFields.has(field.key)}
                            onToggleExpanded={() => toggleField(field.key)}
                            onSetPath={onSetPath}
                          />
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </section>
        )}

        <ManagedByCradle schema={schema} />
      </div>
    </TooltipProvider>
  )
}

function QuickFieldRow({
  field,
  config,
  readOnly,
  onSetPath,
}: {
  field: CodexField
  config: CodexConfig
  readOnly: boolean
  onSetPath: (path: string[], value: unknown) => void
}) {
  const meta = quickFieldMeta(field.key)
  const hint = meta?.hint ?? field.description
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {meta?.label ?? field.key}
          <OverrideDot overridden={isOverridden(config, field.key)} />
        </span>
        {hint && (
          <p className="text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
            {hint}
          </p>
        )}
      </div>
      <FieldControl
        field={field}
        value={config[field.key]}
        readOnly={readOnly}
        size="lg"
        onChange={value => onSetPath([field.key], value)}
      />
    </div>
  )
}

function FlagRow({
  flag,
  value,
  readOnly,
  onSetFlag,
}: {
  flag: CodexField
  value: boolean | undefined
  readOnly: boolean
  onSetFlag: (key: string, value: boolean | undefined) => void
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-3 py-2 transition-colors hover:bg-foreground/2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{flag.key}</span>
          <OverrideDot overridden={value !== undefined} />
        </div>
        {flag.description && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
            {flag.description}
          </p>
        )}
      </div>
      <TriStateSelect
        value={value}
        readOnly={readOnly}
        onChange={next => onSetFlag(flag.key, next)}
      />
    </li>
  )
}

function ExplorerRow({
  field,
  path,
  config,
  readOnly,
  theme,
  expanded,
  onToggleExpanded,
  onSetPath,
}: {
  field: CodexField
  path: string[]
  config: CodexConfig
  readOnly: boolean
  theme: 'vs' | 'vs-dark'
  expanded: boolean
  onToggleExpanded: () => void
  onSetPath: (path: string[], value: unknown) => void
}) {
  const value = getPathValue(config, path)
  const overridden = isPathOverridden(config, path)
  const label = (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{field.key}</span>
        <OverrideDot overridden={overridden} />
      </div>
      {field.description && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
          {field.description}
        </p>
      )}
    </div>
  )

  if (field.kind === 'object') {
    return (
      <li>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="flex w-full items-start justify-between gap-4 px-3 py-2.5 text-left transition-colors hover:bg-foreground/2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
        >
          {label}
          <ChevronDownIcon
            className={cn(
              'mt-0.5 size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        </button>
        {expanded && (
          field.children
            ? (
                <NestedFields
                  field={field}
                  path={path}
                  config={config}
                  overridden={overridden}
                  readOnly={readOnly}
                  onSetPath={onSetPath}
                />
              )
            : (
                <FragmentEditor
                  field={field}
                  value={value}
                  overridden={overridden}
                  readOnly={readOnly}
                  theme={theme}
                  onSetPath={onSetPath}
                />
              )
        )}
      </li>
    )
  }

  if (field.kind === 'stringlist') {
    return (
      <li className="flex flex-col gap-1.5 px-3 py-2.5 transition-colors hover:bg-foreground/2.5">
        {label}
        <StringListEditor
          path={path}
          value={value}
          readOnly={readOnly}
          onSetPath={onSetPath}
        />
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-4 px-3 py-2.5 transition-colors hover:bg-foreground/2.5">
      {label}
      <FieldControl
        field={field}
        value={value}
        readOnly={readOnly}
        onChange={next => onSetPath(path, next)}
      />
    </li>
  )
}

/**
 * Form rows for the declared sub-fields of a structured setting. Leaf fields
 * use the standard controls; nested objects recurse with a left rail; string
 * lists edit one entry per line. Sub-fields only appear in the saved config
 * once set — an untouched sub-field inherits.
 */
function NestedFields({
  field,
  path,
  config,
  overridden,
  readOnly,
  onSetPath,
}: {
  field: CodexField
  path: string[]
  config: CodexConfig
  overridden: boolean
  readOnly: boolean
  onSetPath: (path: string[], value: unknown) => void
}) {
  return (
    <div className="border-t border-foreground/4 px-3 pt-1 pb-2.5">
      <div className="flex flex-col gap-1 border-l border-foreground/6 pl-3.5">
        <ul className="flex flex-col">
          {field.children!.map(child => (
            <NestedRow
              key={child.key}
              field={child}
              path={[...path, child.key]}
              config={config}
              readOnly={readOnly}
              onSetPath={onSetPath}
            />
          ))}
        </ul>
        {overridden && (
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="xs"
              className="text-xs text-muted-foreground"
              disabled={readOnly}
              onClick={() => onSetPath(path, undefined)}
            >
              Remove override
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function NestedRow({
  field,
  path,
  config,
  readOnly,
  onSetPath,
}: {
  field: CodexField
  path: string[]
  config: CodexConfig
  readOnly: boolean
  onSetPath: (path: string[], value: unknown) => void
}) {
  const value = getPathValue(config, path)
  const overridden = isPathOverridden(config, path)

  if (field.kind === 'stringlist') {
    return (
      <li className="flex flex-col gap-1.5 py-2.5">
        <NestedLabel field={field} overridden={overridden} />
        <StringListEditor
          path={path}
          value={value}
          readOnly={readOnly}
          onSetPath={onSetPath}
        />
      </li>
    )
  }

  if (field.kind === 'object' && field.children) {
    return (
      <li className="flex flex-col gap-1 py-2.5">
        <NestedLabel field={field} overridden={overridden} />
        <ul className="flex flex-col border-l border-foreground/6 pl-3.5">
          {field.children.map(child => (
            <NestedRow
              key={child.key}
              field={child}
              path={[...path, child.key]}
              config={config}
              readOnly={readOnly}
              onSetPath={onSetPath}
            />
          ))}
        </ul>
      </li>
    )
  }

  if (field.kind === 'object') {
    // Map-like fragment without declared properties: edited as raw JSON at the
    // top level of its nearest structured ancestor instead of nesting editors.
    return null
  }

  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <NestedLabel field={field} overridden={overridden} />
      <FieldControl
        field={field}
        value={value}
        readOnly={readOnly}
        onChange={next => onSetPath(path, next)}
      />
    </li>
  )
}

/** String-array setting edited one entry per line; empty means inherit. */
function StringListEditor({
  path,
  value,
  readOnly,
  onSetPath,
}: {
  path: string[]
  value: unknown
  readOnly: boolean
  onSetPath: (path: string[], value: unknown) => void
}) {
  return (
    <Textarea
      rows={3}
      className="min-h-0 font-mono text-xs leading-relaxed"
      value={Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : ''}
      placeholder="One entry per line. Empty inherits."
      aria-label={path.join('.')}
      disabled={readOnly}
      onChange={(event) => {
        const entries = event.target.value.split('\n').filter(entry => entry.length > 0)
        onSetPath(path, entries.length ? entries : undefined)
      }}
    />
  )
}

function NestedLabel({ field, overridden }: { field: CodexField, overridden: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{field.key}</span>
        <OverrideDot overridden={overridden} />
      </div>
      {field.description && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
          {field.description}
        </p>
      )}
    </div>
  )
}

/** Initial fragment text for a structured setting with no override yet. */
function emptyFragment(field: CodexField): string {
  const rawType = field.fragmentSchema?.type
  const type = Array.isArray(rawType) ? rawType[0] : rawType
  return type === 'array' ? '[]' : '{}'
}

/**
 * Inline editor for one map-like setting whose schema declares no fixed
 * properties (e.g. `hooks`). The draft is committed only when it parses;
 * formatting differences from a commit never clobber the draft.
 */
function FragmentEditor({
  field,
  value,
  overridden,
  readOnly,
  theme,
  onSetPath,
}: {
  field: CodexField
  value: unknown
  overridden: boolean
  readOnly: boolean
  theme: 'vs' | 'vs-dark'
  onSetPath: (path: string[], value: unknown) => void
}) {
  const external = overridden ? JSON.stringify(value, null, 2) : emptyFragment(field)
  const [draft, setDraft] = useState(external)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(draft)) !== JSON.stringify(JSON.parse(external))) {
        setDraft(external)
        setInvalid(false)
      }
    }
    catch {
      // Keep the invalid draft; the user is mid-edit.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external])

  return (
    <div className="border-t border-foreground/4 px-3 py-3">
      <div className="flex flex-col gap-2 border-l border-foreground/6 pl-3.5">
      <Suspense
        fallback={(
          <div className="flex h-[120px] items-center justify-center">
            <Spinner />
          </div>
        )}
      >
        <CodexConfigFieldEditor
          fieldKey={field.key}
          fragmentSchema={field.fragmentSchema!}
          value={draft}
          theme={theme}
          disabled={readOnly}
          onChange={(text) => {
            setDraft(text)
            try {
              onSetPath([field.key], JSON.parse(text))
              setInvalid(false)
            }
            catch {
              setInvalid(true)
            }
          }}
        />
      </Suspense>
      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>
          {invalid
            ? 'Invalid JSON — not applied until the fragment parses.'
            : `Schema-checked and autocompleted for ${field.key}.`}
        </span>
        {overridden && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-xs text-muted-foreground"
            disabled={readOnly}
            onClick={() => onSetPath([field.key], undefined)}
          >
            Remove override
          </Button>
        )}
      </div>
      </div>
    </div>
  )
}

function OverrideDot({ overridden }: { overridden: boolean }) {
  if (!overridden) {
    return null
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className="block size-1 shrink-0 rounded-full bg-primary"
            aria-label="Overrides the Codex default"
          />
        )}
      />
      <TooltipContent>Overrides the Codex default; select Inherit to remove.</TooltipContent>
    </Tooltip>
  )
}

function TriStateSelect({
  value,
  readOnly,
  label = 'Feature flag value',
  onChange,
}: {
  value: boolean | undefined
  readOnly: boolean
  label?: string
  onChange: (value: boolean | undefined) => void
}) {
  return (
    <Select
      value={value === undefined ? 'inherit' : String(value)}
      onValueChange={(next) => {
        onChange(next === 'inherit' ? undefined : next === 'true')
      }}
      disabled={readOnly}
    >
      <SelectTrigger className="h-7 w-28 shrink-0 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">Inherit</SelectItem>
        <SelectItem value="true">Enabled</SelectItem>
        <SelectItem value="false">Disabled</SelectItem>
      </SelectContent>
    </Select>
  )
}

function FieldControl({
  field,
  value,
  readOnly,
  size = 'sm',
  onChange,
}: {
  field: CodexField
  value: unknown
  readOnly: boolean
  /** 'lg' matches the panel's full-width settings controls; 'sm' is used in list rows. */
  size?: 'sm' | 'lg'
  onChange: (value: unknown) => void
}) {
  if (field.kind === 'enum') {
    const current = typeof value === 'string' ? value : 'inherit'
    return (
      <Select
        value={current}
        onValueChange={next => onChange(next === 'inherit' ? undefined : next)}
        disabled={readOnly}
      >
        <SelectTrigger
          className={cn(
            size === 'lg' ? 'h-9 w-full ' : 'h-7 w-28 shrink-0 text-xs',
          )}
          aria-label={field.key}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit</SelectItem>
          {field.options?.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.kind === 'boolean') {
    return (
      <TriStateSelect
        value={typeof value === 'boolean' ? value : undefined}
        readOnly={readOnly}
        label={field.key}
        onChange={onChange}
      />
    )
  }
  if (field.kind === 'integer') {
    return (
      <Input
        type="number"
        className={cn(
          size === 'lg' ? 'h-9 w-full ' : 'h-7 w-28 shrink-0 text-xs',
          'tabular-nums',
        )}
        value={typeof value === 'number' ? String(value) : ''}
        placeholder={field.placeholder ?? 'Inherit'}
        aria-label={field.key}
        disabled={readOnly}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') {
            onChange(undefined)
            return
          }
          const parsed = Number.parseInt(raw, 10)
          if (!Number.isNaN(parsed)) {
            onChange(parsed)
          }
        }}
      />
    )
  }
  return (
    <Input
      className={cn(
        size === 'lg' ? 'h-9 w-full ' : 'h-7 w-44 shrink-0 text-xs',
        'font-mono',
      )}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder ?? 'Inherit'}
      aria-label={field.key}
      disabled={readOnly}
      onChange={event => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  )
}

function ManagedByCradle({ schema }: { schema: GetProviderTargetsCodexConfigSchemaResponse }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex h-7 w-fit items-center gap-1.5 px-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <ChevronDownIcon className={cn('size-3 transition-transform duration-200', open && 'rotate-180')} />
        {`Managed by Cradle · ${schema.managedKeys.length}`}
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
        <p className="mt-1.5 px-0.5 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
          These settings are owned by Cradle or change the runtime storage and auth boundary, so they
          cannot be overridden here.
        </p>
        <div className="mt-2 flex flex-wrap gap-1 px-0.5">
          {schema.managedKeys.map(key => (
            <code
              key={key}
              className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {key}
            </code>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
