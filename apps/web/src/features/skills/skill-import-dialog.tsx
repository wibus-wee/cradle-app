import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  LinkLine as LinkIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { HalftoneArt } from '~/components/ui/canvas-art'
import {
  Dialog,
  DialogContent,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { TruncatedText } from '~/components/ui/truncated-text'
import type { DiscoveredSkill, SkillScope } from '~/features/skills/types'
import { cn } from '~/lib/cn'

import { useSkillSourceImport } from './use-skills'

type DialogStep = 'input' | 'fetching' | 'select' | 'installing' | 'done'

interface FetchResult {
  sessionId: string
  sourceLabel: string
  sourceType: string
  skills: DiscoveredSkill[]
}

interface ImportResult {
  imported: number
  errors: Array<{ dir: string, error: string }>
}

interface SkillImportDialogState {
  step: DialogStep
  sourceInput: string
  fetchResult: FetchResult | null
  selected: Set<string>
  importResult: ImportResult | null
  fetchError: string | null
}

type SkillImportDialogAction
  = { type: 'reset' }
    | { type: 'fetch-start', source: string }
    | { type: 'fetch-success', source: string, result: FetchResult }
    | { type: 'fetch-error', error: string }
    | { type: 'toggle-skill', skillDir: string }
    | { type: 'toggle-all', skillDirs: string[] }
    | { type: 'install-start' }
    | { type: 'install-success', result: ImportResult }
    | { type: 'install-error', error: string }

const initialSkillImportDialogState: SkillImportDialogState = {
  step: 'input',
  sourceInput: '',
  fetchResult: null,
  selected: new Set<string>(),
  importResult: null,
  fetchError: null,
}

function skillImportDialogReducer(state: SkillImportDialogState, action: SkillImportDialogAction): SkillImportDialogState {
  switch (action.type) {
    case 'reset':
      return initialSkillImportDialogState
    case 'fetch-start':
      return {
        ...state,
        sourceInput: action.source,
        fetchError: null,
        step: 'fetching',
      }
    case 'fetch-success':
      return {
        ...state,
        sourceInput: action.source,
        fetchResult: action.result,
        selected: new Set(action.result.skills.map(skill => skill.skillDir)),
        step: 'select',
      }
    case 'fetch-error':
      return {
        ...state,
        fetchError: action.error,
        step: 'input',
      }
    case 'toggle-skill': {
      const next = new Set(state.selected)
      if (next.has(action.skillDir)) {
        next.delete(action.skillDir)
      }
      else {
        next.add(action.skillDir)
      }
      return {
        ...state,
        selected: next,
      }
    }
    case 'toggle-all': {
      const shouldClear = state.selected.size === action.skillDirs.length
      return {
        ...state,
        selected: shouldClear ? new Set() : new Set(action.skillDirs),
      }
    }
    case 'install-start':
      return {
        ...state,
        step: 'installing',
      }
    case 'install-success':
      return {
        ...state,
        importResult: action.result,
        step: 'done',
      }
    case 'install-error':
      return {
        ...state,
        fetchError: action.error,
        step: 'select',
      }
    default:
      return state
  }
}

const DOT_STEPS: DialogStep[] = ['input', 'fetching', 'select', 'done']

function StepDots({ current }: { current: DialogStep }) {
  const idx = DOT_STEPS.indexOf(current === 'installing' ? 'select' : current)

  return (
    <div className="flex items-center gap-1.5">
      {DOT_STEPS.map((step, i) => (
        <div
          key={step}
          className={cn(
            'h-1 rounded-full transition-colors duration-150',
            i < idx
              ? 'w-2 bg-foreground/30'
              : i === idx
                ? 'w-5 bg-foreground/60'
                : 'w-2 bg-foreground/10',
          )}
        />
      ))}
    </div>
  )
}

function RightPanelInput() {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col justify-end px-7 pb-8">
      <p className="text-[13px] leading-relaxed text-muted-foreground" style={{ textWrap: 'pretty' }}>
        {t('import.description')}
      </p>
    </div>
  )
}

function RightPanelFetching({ source }: { source: string }) {
  return (
    <div className="flex h-full flex-col justify-end gap-3 px-7 pb-8">
      <div className="relative h-px overflow-hidden rounded-full bg-foreground/10">
        <m.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-foreground/40"
          animate={{ x: ['-100%', '300%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <p className="truncate text-[11px] text-muted-foreground/40">{source}</p>
    </div>
  )
}

function RightPanelSelect({
  skills,
  selected,
  scope,
}: {
  skills: DiscoveredSkill[]
  selected: Set<string>
  scope: SkillScope
}) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col gap-5 px-7 py-8">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[44px] font-bold leading-none tracking-tight text-foreground">
            {skills.length}
          </span>
          <span className="text-[13px] text-muted-foreground/50">{t('import.skillsFound', { count: skills.length })}</span>
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground/40">
          {t('import.selectedSummary', { count: selected.size, scope })}
        </p>
      </div>

      <div className="h-px bg-foreground/6" />

      <div className="flex flex-col gap-0.5 overflow-hidden">
        {skills.slice(0, 9).map((skill) => {
          const isSelected = selected.has(skill.skillDir)
          return (
            <div
              key={skill.skillDir}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-opacity',
                isSelected ? 'opacity-100' : 'opacity-20',
              )}
            >
              <CheckIcon
                className={cn(
                  'size-3 shrink-0',
                  isSelected ? '!text-emerald-500' : '!text-muted-foreground/20',
                )}
              />
              <span className="truncate text-[12px] text-foreground">{skill.name}</span>
            </div>
          )
        })}
        {skills.length > 9 && (
          <p className="px-2 text-[11px] text-muted-foreground/30">
            {t('import.more', { count: skills.length - 9 })}
          </p>
        )}
      </div>
    </div>
  )
}

function RightPanelDone({ count }: { count: number }) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col justify-center gap-2 px-8 py-10">
      <m.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="text-[56px] font-bold leading-none tracking-tight text-foreground"
      >
        {count}
      </m.p>
      <m.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        className="text-[14px] text-muted-foreground/50"
      >
        {t('import.installed', { count })}
      </m.p>
    </div>
  )
}

function InputForm({
  onFetch,
  isFetching,
  error,
}: {
  onFetch: (source: string) => void
  isFetching: boolean
  error: string | null
}) {
  const { t } = useTranslation('skills')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isFetching) {
      return
    }
    onFetch(trimmed)
  }

  return (
    <div className="flex h-full flex-col gap-8 p-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground text-balance">{t('import.title')}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground/60 text-pretty">
          {t('import.formDescription')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border border-foreground/8 bg-foreground/3 px-4 py-3',
            'transition-[background-color,border-color] duration-150 focus-within:border-foreground/20 focus-within:bg-foreground/4',
            error && 'border-destructive/30',
          )}
        >
          <LinkIcon className="size-4 shrink-0 !text-muted-foreground/25" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Skill source"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={t('import.sourcePlaceholder')}
            className="flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/25"
            disabled={isFetching}
            spellCheck={false}
            autoComplete="off"
            data-testid="skill-import-source-input"
          />
          {value && !isFetching && (
            <button
              type="button"
              onClick={() => setValue('')}
              className="flex size-5 items-center justify-center rounded text-muted-foreground/25 transition-colors hover:text-muted-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        {error && (
          <p className="px-1 text-[12px] leading-relaxed text-destructive">{error}</p>
        )}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || isFetching}
        className="h-10 w-full"
        data-testid="skill-import-fetch-btn"
      >
        {isFetching
          ? (
            <>
              <Spinner className="size-3.5" />
              {t('import.fetching')}
            </>
          )
          : (
            <>
              {t('import.fetchSkills')}
              <ChevronRightIcon className="size-4" />
            </>
          )}
      </Button>
    </div>
  )
}

function FetchingBody({ source }: { source: string }) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-12 text-center">
      <Spinner className="size-6 text-muted-foreground/40" />
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-medium text-foreground">{t('import.fetching')}</span>
        <span className="max-w-64 truncate text-[12px] text-muted-foreground/50">{source}</span>
      </div>
    </div>
  )
}

function SelectBody({
  result,
  selected,
  onToggle,
  onToggleAll,
  onInstall,
  isInstalling,
}: {
  result: FetchResult
  selected: Set<string>
  onToggle: (dir: string) => void
  onToggleAll: () => void
  onInstall: () => void
  isInstalling: boolean
}) {
  const { t } = useTranslation('skills')

  if (result.skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
        <p className="text-[13px] text-muted-foreground/50">{t('import.empty')}</p>
      </div>
    )
  }

  const allSelected = selected.size === result.skills.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-8 pb-3 pt-7">
        <h2 className="text-[16px] font-semibold text-foreground text-balance">
          {t('import.selectedHeading', { count: result.skills.length })}
        </h2>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-[12px] text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          {allSelected ? t('import.deselectAll') : t('import.selectAll')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-4">
        <div className="flex flex-col gap-1.5">
          {result.skills.map((skill) => {
            const isSelected = selected.has(skill.skillDir)
            return (
              <button
                key={skill.skillDir}
                type="button"
                onClick={() => onToggle(skill.skillDir)}
                className={cn(
                  'flex items-start gap-3.5 rounded-xl px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-150',
                  isSelected
                    ? 'bg-foreground/6 ring-1 ring-foreground/10 hover:bg-foreground/7'
                    : 'bg-foreground/2.5 ring-1 ring-transparent hover:bg-foreground/4',
                )}
              >
                <div
                  className={cn(
                    'mt-px flex size-4 shrink-0 items-center justify-center rounded transition-[background-color,box-shadow] duration-150',
                    isSelected
                      ? 'bg-foreground ring-1 ring-foreground'
                      : 'ring-1 ring-foreground/20 hover:ring-foreground/40',
                  )}
                >
                  {isSelected && <CheckIcon className="size-2.5 stroke-[2.5] !text-background" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">{skill.name}</span>
                  {skill.description && (
                    <TruncatedText maxLines={2} className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/55">
                      {skill.description}
                    </TruncatedText>
                  )}
                  {skill.relativePath !== '.' && (
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground/25">
                      {skill.relativePath}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-foreground/6 px-8 py-5">
        <Button
          onClick={onInstall}
          disabled={selected.size === 0 || isInstalling}
          className="h-10 w-full"
          data-testid="skill-import-install-btn"
        >
          {isInstalling
            ? (
              <>
                <Spinner className="size-3.5" />
                {t('import.installing')}
              </>
            )
            : (
              <>
                {t('import.install', { count: selected.size })}
              </>
            )}
        </Button>
      </div>
    </div>
  )
}

function DoneBody({
  result,
  onClose,
}: {
  result: ImportResult
  onClose: () => void
}) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-8 py-12 text-center">
      <div className="flex flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-foreground">
          {t('import.done')}
        </span>
        <span className="text-[13px] text-muted-foreground/55">
          {t('import.installed', { count: result.imported })}
        </span>
      </div>

      {result.errors.length > 0 && (
        <div className="w-full rounded-xl bg-destructive/6 px-4 py-3.5 text-left">
          <span className="mb-2 block text-[12px] font-medium text-destructive">
            {t('import.failed', { count: result.errors.length })}
          </span>
          {result.errors.map(e => (
            <div key={e.dir} className="border-t border-destructive/10 py-1.5">
              <span className="block font-mono text-[10px] text-muted-foreground/40">{e.dir}</span>
              <span className="block text-[11px] text-destructive/70">{e.error}</span>
            </div>
          ))}
        </div>
      )}

      <Button onClick={onClose} variant="outline" className="h-10 w-full" data-testid="skill-import-done-btn">
        {t('import.finish')}
      </Button>
    </div>
  )
}

export function SkillImportDialog({
  open,
  onOpenChange,
  editableScope,
  workspaceId,
  agentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editableScope: SkillScope
  workspaceId?: string | null
  agentId?: string | null
}) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('skills')
  const { fetchSource, importFromFetch, cancelFetch } = useSkillSourceImport({ workspaceId, agentId })
  const [state, dispatch] = useReducer(skillImportDialogReducer, initialSkillImportDialogState)

  const prevOpenRef = useRef(open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      dispatch({ type: 'reset' })
    }
    prevOpenRef.current = open
  }, [open])

  const handleClose = () => {
    if (state.fetchResult?.sessionId && state.step !== 'done') {
      cancelFetch.mutate(state.fetchResult.sessionId)
    }
    onOpenChange(false)
  }

  const handleFetch = async (source: string) => {
    dispatch({ type: 'fetch-start', source })
    try {
      const result = await fetchSource.mutateAsync(source)
      dispatch({
        type: 'fetch-success',
        source,
        result: {
          sessionId: result.sessionId,
          sourceLabel: result.source.label,
          sourceType: result.source.type,
          skills: result.skills,
        },
      })
    }
    catch (err) {
      dispatch({ type: 'fetch-error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleToggle = (skillDir: string) => {
    dispatch({ type: 'toggle-skill', skillDir })
  }

  const handleToggleAll = () => {
    if (!state.fetchResult) {
      return
    }
    dispatch({
      type: 'toggle-all',
      skillDirs: state.fetchResult.skills.map(skill => skill.skillDir),
    })
  }

  const handleInstall = async () => {
    if (!state.fetchResult || state.selected.size === 0) {
      return
    }
    dispatch({ type: 'install-start' })
    try {
      const result = await importFromFetch.mutateAsync({
        sessionId: state.fetchResult.sessionId,
        selectedDirs: Array.from(state.selected),
        scope: editableScope,
        overwrite: false,
      })
      dispatch({ type: 'install-success', result: { imported: result.imported.length, errors: result.errors } })
    }
    catch (err) {
      dispatch({ type: 'install-error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose()
          return
        }
        onOpenChange(true)
      }}
    >
      <DialogContent
        className="sm:max-w-240 overflow-hidden p-0"
        showCloseButton={false}
        data-testid="skill-import-dialog"
      >
        <div className="flex h-130">
          <div className="relative flex w-[58%] flex-col overflow-hidden border-r border-foreground/6">
            <div className="flex shrink-0 items-center justify-between border-b border-foreground/6 px-8 py-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-foreground">{t('import.title')}</span>
                <StepDots current={state.step} />
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label={tCommon('action.close')}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/30 transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                {state.step === 'input' && (
                  <m.div
                    key="input"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <InputForm
                      onFetch={source => void handleFetch(source)}
                      isFetching={fetchSource.isPending}
                      error={state.fetchError}
                    />
                  </m.div>
                )}

                {state.step === 'fetching' && (
                  <m.div
                    key="fetching"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <FetchingBody source={state.sourceInput} />
                  </m.div>
                )}

                {(state.step === 'select' || state.step === 'installing') && state.fetchResult && (
                  <m.div
                    key="select"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SelectBody
                      result={state.fetchResult}
                      selected={state.selected}
                      onToggle={handleToggle}
                      onToggleAll={handleToggleAll}
                      onInstall={() => void handleInstall()}
                      isInstalling={state.step === 'installing'}
                    />
                  </m.div>
                )}

                {state.step === 'done' && state.importResult && (
                  <m.div
                    key="done"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <DoneBody result={state.importResult} onClose={handleClose} />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="relative flex w-[42%] flex-col overflow-hidden bg-foreground/2" style={{ boxShadow: 'inset 1px 0 0 oklch(from var(--foreground) l c h / 0.05)' }}>
            <div
              className={cn(
                'pointer-events-none absolute inset-0 transition-opacity duration-700',
                state.step === 'input' ? 'opacity-50' : state.step === 'fetching' ? 'opacity-25' : 'opacity-0',
              )}
            >
              <HalftoneArt />
            </div>

            <div className="relative z-10 flex h-full flex-col">
              <AnimatePresence mode="wait">
                {state.step === 'input' && (
                  <m.div
                    key="right-input"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelInput />
                  </m.div>
                )}

                {state.step === 'fetching' && (
                  <m.div
                    key="right-fetching"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelFetching source={state.sourceInput} />
                  </m.div>
                )}

                {(state.step === 'select' || state.step === 'installing') && state.fetchResult && (
                  <m.div
                    key="right-select"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelSelect
                      skills={state.fetchResult.skills}
                      selected={state.selected}
                      scope={editableScope}
                    />
                  </m.div>
                )}

                {state.step === 'done' && state.importResult && (
                  <m.div
                    key="right-done"
                    className="h-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <RightPanelDone count={state.importResult.imported} />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
