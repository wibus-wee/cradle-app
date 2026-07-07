import {
  CheckCircleLine as CheckCircle2Icon,
  CylinderLine as DatabaseIcon,
  DownloadLine as DownloadIcon,
  LaptopLine as LaptopIcon,
  Refresh1Line as RefreshCwIcon,
  ServerLine as ServerIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VList } from 'virtua'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { getServerUrl, isElectron, nativeIpc } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

type SourceApp = 'claude' | 'codex' | 'cursor' | 'windsurf' | 'gemini' | 'unknown'
type SourceScope = 'server' | 'electron-upload'
type SourceKind = 'settings' | 'project' | 'session' | 'instruction' | 'mcp' | 'command' | 'hook' | 'skill' | 'plugin' | 'subagent'

interface ExternalWorkImportItem {
  id: string
  sourceApp: SourceApp
  sourceScope: SourceScope
  sourceKind: SourceKind
  title: string
  summary: string | null
  sourcePath: string | null
  externalId: string
  fingerprint: string
  workspacePath: string | null
  createdAt: number | null
  updatedAt: number | null
  duplicate: boolean
  duplicateImportId: string | null
  importable: boolean
  reason: string | null
  payloadJson: string
}

interface PreviewResponse {
  items: ExternalWorkImportItem[]
  warnings: string[]
}

interface ImportResponse {
  imported: number
  duplicates: number
  skipped: number
  errors: number
}

type ImportStatus = 'idle' | 'scanning' | 'importing' | 'ready' | 'error'

interface SelectionState {
  fingerprints: Set<string>
  count: number
}

const IMPORT_ROW_SIZE = 92

interface ImportSelectionState extends SelectionState {
  replace: (fingerprints: string[]) => void
  clear: () => void
  toggle: (fingerprint: string, checked: boolean) => void
}

type ImportSelectionStore = StoreApi<ImportSelectionState>

function createImportSelectionStore(): ImportSelectionStore {
  return createStore<ImportSelectionState>(set => ({
    fingerprints: new Set(),
    count: 0,
    replace: fingerprints => set({
      fingerprints: new Set(fingerprints),
      count: fingerprints.length,
    }),
    clear: () => set({
      fingerprints: new Set(),
      count: 0,
    }),
    toggle: (fingerprint, checked) => set((current) => {
      const alreadySelected = current.fingerprints.has(fingerprint)
      if (alreadySelected === checked) {
        return current
      }
      const next = new Set(current.fingerprints)
      if (checked) {
        next.add(fingerprint)
      }
      else {
        next.delete(fingerprint)
      }
      return {
        fingerprints: next,
        count: current.count + (checked ? 1 : -1),
      }
    }),
  }))
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, getServerUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as T
}

function mergePreviewItems(responses: PreviewResponse[]): ExternalWorkImportItem[] {
  const byFingerprint = new Map<string, ExternalWorkImportItem>()
  for (const response of responses) {
    for (const item of response.items.filter(item => item.sourceKind === 'session')) {
      const existing = byFingerprint.get(item.fingerprint)
      if (!existing) {
        byFingerprint.set(item.fingerprint, item)
        continue
      }
      if (existing.sourceScope === 'electron-upload' && item.sourceScope === 'server') {
        byFingerprint.set(item.fingerprint, item)
      }
    }
  }
  return Array.from(byFingerprint.values()).sort((left, right) => {
    if (left.importable !== right.importable) {
      return left.importable ? -1 : 1
    }
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  })
}

function formatItemMeta(item: ExternalWorkImportItem): string {
  return [
    item.sourceApp,
    item.sourceKind,
    item.sourceScope === 'server' ? 'server' : 'device',
    item.workspacePath,
  ]
    .filter(Boolean)
    .join(' / ')
}

interface ExternalWorkImportRowProps {
  item: ExternalWorkImportItem
  busy: boolean
  duplicateLabel: string
  selectionStore: ImportSelectionStore
}

const ExternalWorkImportRow = ({
  item,
  busy,
  duplicateLabel,
  selectionStore,
}: ExternalWorkImportRowProps) => {
  const checked = useStore(
    selectionStore,
    state => state.fingerprints.has(item.fingerprint),
  )
  const toggle = useStore(selectionStore, state => state.toggle)
  const handleToggle = (value: boolean | 'indeterminate') => {
    toggle(item.fingerprint, value === true)
  }

  return (
    <div
      className={cn(
        'border-t border-foreground/5 py-3',
        item.importable ? 'opacity-100' : 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {item.sourceScope === 'server'
              ? <ServerIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
              : <LaptopIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />}
            <span className="truncate text-[13px] font-medium text-foreground">{item.title}</span>
            {item.duplicate && (
              <Badge variant="outline">{duplicateLabel}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">{formatItemMeta(item)}</p>
          {item.summary && (
            <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{item.summary}</p>
          )}
          {item.reason && (
            <p className="mt-1 text-[12px] text-muted-foreground">{item.reason}</p>
          )}
        </div>
        <Checkbox
          checked={checked}
          onCheckedChange={handleToggle}
          disabled={busy || !item.importable}
          aria-label={item.title}
        />
      </div>
    </div>
  )
}

ExternalWorkImportRow.displayName = 'ExternalWorkImportRow'

interface ImportActionButtonsProps {
  status: ImportStatus
  selectionStore: ImportSelectionStore
  onScan: () => void
  onImport: () => void
}

const ImportActionButtons = ({
  status,
  selectionStore,
  onScan,
  onImport,
}: ImportActionButtonsProps) => {
  const { t } = useTranslation('settings')
  const selectedCount = useStore(selectionStore, state => state.count)
  const busy = status === 'scanning' || status === 'importing'

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onScan}
        disabled={busy}
      >
        {status === 'scanning' ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
        {t('import.action.scan')}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onImport}
        disabled={busy || selectedCount === 0}
      >
        {status === 'importing' ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" aria-hidden="true" />}
        {t('import.action.import')}
      </Button>
    </div>
  )
}

ImportActionButtons.displayName = 'ImportActionButtons'

interface ImportSelectionControlProps {
  busy: boolean
  importableCount: number
  importableFingerprints: string[]
  selectionStore: ImportSelectionStore
}

const ImportSelectionControl = ({
  busy,
  importableCount,
  importableFingerprints,
  selectionStore,
}: ImportSelectionControlProps) => {
  const { t } = useTranslation('settings')
  const selectedCount = useStore(selectionStore, state => state.count)
  const checked = importableCount > 0 && selectedCount === importableCount
  const handleCheckedChange = (value: boolean | 'indeterminate') => {
    if (value === true) {
      selectionStore.getState().replace(importableFingerprints)
      return
    }
    selectionStore.getState().clear()
  }

  return (
    <SettingsRow
      label={t('import.selection.label')}
      description={t('import.selection.description', { selected: selectedCount, count: importableCount })}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={busy || importableCount === 0}
        aria-label={t('import.selection.toggleAll')}
      />
    </SettingsRow>
  )
}

ImportSelectionControl.displayName = 'ImportSelectionControl'

export function ExternalWorkImportSettings() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [items, setItems] = useState<ExternalWorkImportItem[]>([])
  const [selectionStore] = useState(createImportSelectionStore)
  const [message, setMessage] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const itemByFingerprint = new Map<string, ExternalWorkImportItem>()
  const importableFingerprints: string[] = []
  for (const item of items) {
    itemByFingerprint.set(item.fingerprint, item)
    if (item.importable) {
      importableFingerprints.push(item.fingerprint)
    }
  }
  const importableCount = importableFingerprints.length

  const scan = async () => {
    setStatus('scanning')
    setMessage(null)
    setWarnings([])
    try {
      const serverPreview = await postJson<PreviewResponse>('/external-work-import/preview', {
        includeHome: true,
        limitPerSource: 500,
      })
      const responses = [serverPreview]
      const nextWarnings = [...serverPreview.warnings]

      if (isElectron && nativeIpc) {
        const localFiles = await nativeIpc.native.scanExternalWorkImportFiles({
          limitPerSource: 500,
        })
        nextWarnings.push(...localFiles.warnings)
        if (localFiles.files.length > 0) {
          responses.push(await postJson<PreviewResponse>('/external-work-import/upload-preview', {
            files: localFiles.files,
          }))
        }
      }

      const merged = mergePreviewItems(responses)
      const nextFingerprints: string[] = []
      for (const item of merged) {
        if (item.importable) {
          nextFingerprints.push(item.fingerprint)
        }
      }
      setItems(merged)
      selectionStore.getState().replace(nextFingerprints)
      setWarnings(nextWarnings)
      setStatus('ready')
      setMessage(t('import.status.scanned', { count: merged.length }))
    }
    catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const importSelected = async () => {
    setStatus('importing')
    setMessage(null)
    try {
      const selectedItems: ExternalWorkImportItem[] = []
      for (const fingerprint of selectionStore.getState().fingerprints) {
        const item = itemByFingerprint.get(fingerprint)
        if (item?.importable && item.sourceKind === 'session') {
          selectedItems.push(item)
        }
      }
      const result = await postJson<ImportResponse>('/external-work-import/import', {
        items: selectedItems,
      })
      const importMessage = t('import.status.imported', {
        imported: result.imported,
        duplicates: result.duplicates,
        skipped: result.skipped,
        errors: result.errors,
      })
      await scan()
      setStatus('ready')
      setMessage(importMessage)
    }
    catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const busy = status === 'scanning' || status === 'importing'

  return (
    <SettingsPage
      title={t('import.page.title')}
      description={t('import.page.description')}
      action={<Badge variant="outline">{isElectron ? t('import.badge.device') : t('import.badge.server')}</Badge>}
      className="h-full min-h-0 pb-0"
      data-testid="external-work-import-settings"
    >

      <Alert>
        <DatabaseIcon className="size-4" aria-hidden="true" />
        <AlertTitle>{t('import.alert.title')}</AlertTitle>
        <AlertDescription>{t('import.alert.description')}</AlertDescription>
      </Alert>

      <SettingsGroup>
        <SettingsRow
          label={t('import.scan.label')}
          description={isElectron ? t('import.scan.descriptionElectron') : t('import.scan.descriptionServer')}
        >
          <ImportActionButtons
            status={status}
            selectionStore={selectionStore}
            onScan={() => void scan()}
            onImport={() => void importSelected()}
          />
        </SettingsRow>

        <ImportSelectionControl
          busy={busy}
          importableCount={importableCount}
          importableFingerprints={importableFingerprints}
          selectionStore={selectionStore}
        />
      </SettingsGroup>

      {warnings.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon className="size-4" aria-hidden="true" />
          <AlertTitle>{t('import.warning.title')}</AlertTitle>
          <AlertDescription>{warnings.join(' ')}</AlertDescription>
        </Alert>
      )}

      {items.length > 0 && (
        <SettingsGroup bare sectionClassName="min-h-0 flex-1" className="h-full min-h-0 overflow-hidden">
          <VList
            className="h-full min-h-0 pr-1"
            data={items}
            itemSize={IMPORT_ROW_SIZE}
          >
            {item => (
              <ExternalWorkImportRow
                key={item.fingerprint}
                item={item}
                busy={busy}
                duplicateLabel={t('import.badge.duplicate')}
                selectionStore={selectionStore}
              />
            )}
          </VList>
        </SettingsGroup>
      )}

      {message && (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground" data-testid="external-work-import-status">
          {status === 'error'
            ? <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
            : <CheckCircle2Icon className="size-3.5" aria-hidden="true" />}
          {message}
        </p>
      )}
    </SettingsPage>
  )
}
