import {
  AnticlockwiseLine as RotateCcwIcon,
  ClipboardLine as ClipboardIcon,
  FolderOpenLine as FolderOpenIcon,
  LifebuoyLine as LifeBuoyIcon,
  Share2Line as Share2Icon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getObservabilityExport, postObservabilityFlush } from '~/api-gen/sdk.gen'
import type { GetObservabilityExportResponses } from '~/api-gen/types.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { useOnboardingStore } from '~/features/onboarding/onboarding-store'
import { getServerUrl, isElectron, nativeIpc } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

type SupportStatus = 'idle' | 'working' | 'ready' | 'error'
type ObservabilityExportBundle = GetObservabilityExportResponses[200]
interface SupportTemplateCopy {
  title: string
  version: string
  runtime: string
  server: string
  whatHappened: string
  expected: string
  reproduction: string
  diagnostics: string
  diagnosticsNote: string
}

const ObservabilityEventSchema = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  source: z.string(),
  code: z.string(),
  severity: z.string(),
  category: z.string(),
  message: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  messageId: z.string().optional(),
  traceId: z.string().optional(),
  dedupeKey: z.string().optional(),
  parentEventId: z.string().optional(),
  occurredAt: z.number(),
  recordedAt: z.number(),
})

const ObservabilityIncidentSchema = z.object({
  id: z.string(),
  dedupeKey: z.string(),
  code: z.string(),
  severity: z.string(),
  status: z.enum(['open', 'resolved']),
  source: z.string(),
  message: z.string(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  messageId: z.string().optional(),
  firstOccurredAt: z.number(),
  lastOccurredAt: z.number(),
  lastRecordedAt: z.number(),
  count: z.number(),
  lastEventId: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

const ObservabilityErrorPatternSchema = z.object({
  patternId: z.string(),
  source: z.string(),
  code: z.string(),
  category: z.string(),
  severity: z.string(),
  runtimeKind: z.string().optional(),
  providerTargetId: z.string().optional(),
  modelId: z.string().optional(),
  messageFingerprint: z.string(),
  messagePreview: z.string(),
  count: z.number(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  sampleRunIds: z.array(z.string()),
  sampleTraceIds: z.array(z.string()),
  sampleMessages: z.array(z.string()),
})

const ObservabilityExportBundleSchema = z.object({
  schema: z.string(),
  exportedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  redaction: z.record(z.string(), z.unknown()),
  events: z.array(ObservabilityEventSchema),
  incidents: z.array(ObservabilityIncidentSchema),
  errorPatterns: z.array(ObservabilityErrorPatternSchema),
  timeline: z.array(z.record(z.string(), z.unknown())),
  logs: z.record(z.string(), z.unknown()),
})

function createSupportTemplate(copy: SupportTemplateCopy): string {
  return [
    copy.title,
    '',
    copy.version,
    copy.runtime,
    copy.server,
    '',
    copy.whatHappened,
    '',
    '',
    copy.expected,
    '',
    '',
    copy.reproduction,
    '',
    '1. ',
    '',
    copy.diagnostics,
    '',
    copy.diagnosticsNote,
  ].join('\n')
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function formatTimestampForFilename(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-')
}

export function SupportSettings() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<SupportStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [dataPath, setDataPath] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'default' | 'custom' | null>(null)
  const [pendingTarget, setPendingTarget] = useState<string | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)

  const template = createSupportTemplate({
    title: t('support.template.title'),
    version: t('support.template.version', { version: import.meta.env.PACKAGE_VERSION ?? '0.0.1' }),
    runtime: t('support.template.runtime', { runtime: isElectron ? t('support.template.runtime.electron') : t('support.template.runtime.web') }),
    server: t('support.template.server', { server: getServerUrl() }),
    whatHappened: t('support.template.whatHappened'),
    expected: t('support.template.expected'),
    reproduction: t('support.template.reproduction'),
    diagnostics: t('support.template.diagnostics'),
    diagnosticsNote: t('support.template.diagnosticsNote'),
  })
  const handoff = [
    t('support.privateHandoff.title'),
    '',
    t('support.privateHandoff.step1'),
    t('support.privateHandoff.step2'),
    t('support.privateHandoff.step3'),
    '',
    template,
  ].join('\n')
  const canOpenDataPath = isElectron && !!nativeIpc
  const settingsSupportReady = template.length > 0

  useEffect(() => {
    if (!nativeIpc) { return }
    void nativeIpc.native.getCradleDataPaths().then((paths) => {
      setDataPath(paths.serverDataPath)
      setDataSource(paths.serverDataSource)
      if (paths.migration.phase === 'failed' && paths.migration.errorMessage) {
        setMessage(paths.migration.errorMessage)
      }
    }).catch(() => {})
  }, [])

  const exportDiagnostics = async () => {
    setStatus('working')
    setMessage(null)
    try {
      await postObservabilityFlush()
      const { data } = await getObservabilityExport()
      if (!data) {
        throw new Error(t('support.error.noDiagnosticsBundle'))
      }
      const bundle = ObservabilityExportBundleSchema.parse(data) satisfies ObservabilityExportBundle
      const exportedAt = bundle.exportedAt
      const payload = {
        schema: 'cradle.private-preview.diagnostics.v2',
        exportedAt,
        source: 'settings.support',
        note: t('support.diagnostics.note'),
        bundle,
      }
      downloadTextFile(
        `cradle-diagnostics-${formatTimestampForFilename(exportedAt)}.json`,
        JSON.stringify(payload, null, 2),
      )
      setStatus('ready')
      setMessage(t('support.status.exported', { eventCount: bundle.events.length, incidentCount: bundle.incidents.length }))
    }
    catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const copyFeedbackTemplate = async () => {
    setStatus('working')
    setMessage(null)
    try {
      await navigator.clipboard.writeText(template)
      setStatus('ready')
      setMessage(t('support.status.templateCopied'))
    }
    catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const copyPrivateHandoff = async () => {
    setStatus('working')
    setMessage(null)
    try {
      await navigator.clipboard.writeText(handoff)
      setStatus('ready')
      setMessage(t('support.status.handoffCopied'))
    }
    catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const openDataDirectory = async () => {
    if (!nativeIpc) {
      return
    }
    const paths = await nativeIpc.native.getCradleDataPaths()
    setDataPath(paths.serverDataPath)
    setDataSource(paths.serverDataSource)
    await nativeIpc.native.showItemInFolder(paths.serverDataPath)
  }

  const chooseDataDirectory = async () => {
    if (!nativeIpc) { return }
    setMigrationBusy(true)
    setMessage(null)
    try {
      const result = await nativeIpc.native.chooseCradleDataDirectory()
      if (!result.canceled && result.filePath) { setPendingTarget(result.filePath) }
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
    finally {
      setMigrationBusy(false)
    }
  }

  const confirmDataDirectoryChange = async () => {
    if (!nativeIpc || !pendingTarget) { return }
    setMigrationBusy(true)
    try {
      await nativeIpc.native.scheduleCradleDataDirectoryMigration(pendingTarget)
      setPendingTarget(null)
      setMessage(t('support.dataDirectory.restart'))
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setMigrationBusy(false)
    }
  }

  return (
    <SettingsPage
      title={t('support.page.title')}
      description={t('support.page.description')}
      action={<Badge variant="outline">{t('support.badge.manual')}</Badge>}
      data-testid="support-settings"
      data-settings-support-ready={settingsSupportReady ? 'true' : 'false'}
    >
      <Alert>
        <LifeBuoyIcon className="size-4" aria-hidden="true" />
        <AlertTitle>{t('support.alert.title')}</AlertTitle>
        <AlertDescription>
          {t('support.alert.description')}
        </AlertDescription>
      </Alert>

      <SettingsGroup>
        <SettingsRow
          label={t('support.diagnostics.label')}
          description={t('support.diagnostics.description')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void exportDiagnostics()}
            disabled={status === 'working'}
          >
            {status === 'working' ? <Spinner className="size-3.5" /> : <Share2Icon className="size-3.5" aria-hidden="true" />}
            {t('support.action.export')}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t('support.feedbackTemplate.label')}
          description={t('support.feedbackTemplate.description')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyFeedbackTemplate()}
            disabled={status === 'working'}
          >
            <ClipboardIcon className="size-3.5" aria-hidden="true" />
            {t('support.action.copy')}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t('support.feedbackChannel.label')}
          description={t('support.feedbackChannel.description')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyPrivateHandoff()}
            disabled={status === 'working'}
          >
            <ClipboardIcon className="size-3.5" aria-hidden="true" />
            {t('support.action.copy')}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t('support.dataDirectory.label')}
          description={dataPath ? `${dataPath}${dataSource ? ` (${dataSource})` : ''}` : t('support.dataDirectory.description')}
        >
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void openDataDirectory()} disabled={!canOpenDataPath || migrationBusy}>
              <FolderOpenIcon className="size-3.5" aria-hidden="true" />
              {t('support.action.reveal')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void chooseDataDirectory()} disabled={!canOpenDataPath || migrationBusy}>
              {t('support.dataDirectory.change')}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('support.onboarding.label')}
          description={t('support.onboarding.description')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => useOnboardingStore.getState().reset()}
          >
            <RotateCcwIcon className="size-3.5" aria-hidden="true" />
            {t('support.action.showOnboarding')}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t('support.uninstall.label')}
          description={t('support.uninstall.description')}
        >
          <Badge variant="outline">{t('support.badge.documented')}</Badge>
        </SettingsRow>
      </SettingsGroup>

      {message && (
        <p className="text-[12px] text-muted-foreground" data-testid="support-settings-status">
          {message}
        </p>
      )}

      <AlertDialog open={pendingTarget !== null} onOpenChange={open => !open && setPendingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('support.dataDirectory.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('support.dataDirectory.confirmDescription', { path: pendingTarget ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('support.dataDirectory.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDataDirectoryChange()} disabled={migrationBusy}>
              {t('support.dataDirectory.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
