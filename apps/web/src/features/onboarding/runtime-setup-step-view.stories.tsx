import { ArrowRightLine as ArrowRightIcon } from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import type { DownloadTask } from '~/features/download-center/types'
import type { ManagedResource } from '~/features/managed-resources/projection'
import { managedResourceKey } from '~/features/managed-resources/projection'
import { cn } from '~/lib/cn'

import type { OnboardingRuntimeItem } from './runtime-setup-step-view'
import { OnboardingRuntimesStepView } from './runtime-setup-step-view'

const MB = 1024 * 1024

const CLAUDE_KEY = { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' }
const CODEX_KEY = { namespace: 'codex', resourceType: 'runtime', resourceId: 'app-server' }
const OPENCODE_KEY = { namespace: 'opencode', resourceType: 'runtime', resourceId: 'cli' }
const OCR_KEY = { namespace: 'image-ocr', resourceType: 'model', resourceId: 'ppocrv6-small' }

type FixtureState = 'not-installed' | 'installing' | 'installed' | 'error'

function actionsFor(state: FixtureState): ManagedResource['actions'] {
  const enabled = { available: true, reasonCode: null }
  const disabled = { available: false, reasonCode: 'managed_resource_unavailable' }
  return {
    install: state === 'not-installed' || state === 'error' ? enabled : disabled,
    update: disabled,
    uninstall: state === 'installed' ? enabled : disabled,
  }
}

function resourceFixture(input: {
  key: ManagedResource['key']
  displayName: string
  description: string
  required: boolean
  kind: string
  state: FixtureState
  version: string
  downloadBytes: number
  installedBytes: number
}): ManagedResource {
  const installed = input.state === 'installed'
  return {
    key: input.key,
    displayName: input.displayName,
    description: input.description,
    kind: input.kind,
    required: input.required,
    state: input.state,
    installationSource: installed ? 'managed' : null,
    installedVersion: installed ? input.version : null,
    availableVersion: input.version,
    installedSizeBytes: installed ? input.installedBytes : null,
    downloadSizeBytes: input.downloadBytes,
    actions: actionsFor(input.state),
  }
}

function taskFixture(input: {
  resource: ManagedResource
  status: DownloadTask['status']
  transferredBytes: number
  error?: { code: string, message: string }
}): DownloadTask {
  const now = new Date().toISOString()
  return {
    taskId: `task-${input.resource.key.namespace}-${input.resource.key.resourceId}`,
    scope: 'server',
    owner: {
      namespace: input.resource.key.namespace,
      resourceType: input.resource.key.resourceType,
      resourceId: input.resource.key.resourceId,
      displayName: input.resource.displayName,
    },
    fileName: `${input.resource.key.resourceId}.tar.gz`,
    sourceId: 'registry',
    status: input.status,
    transferredBytes: input.transferredBytes,
    totalBytes: input.resource.downloadSizeBytes,
    attempts: 1,
    maxAttempts: 3,
    error: input.error
      ? { code: input.error.code, message: input.error.message, retryable: true }
      : null,
    result: null,
    createdAt: now,
    updatedAt: now,
    startedAt: input.status === 'queued' ? null : now,
    finishedAt: null,
  }
}

interface SceneSpec {
  codex: FixtureState
  codexProgress?: number
  codexFailed?: boolean
  claude?: FixtureState
  claudeProgress?: number
  opencode?: FixtureState
  ocr?: FixtureState
}

function buildItems(spec: SceneSpec): OnboardingRuntimeItem[] {
  const codex = resourceFixture({
    key: CODEX_KEY,
    displayName: 'Codex app server',
    description: 'Runs OpenAI Codex sessions — the default agent runtime.',
    required: true,
    kind: 'runtime',
    state: spec.codex,
    version: 'rust-v0.58.0',
    downloadBytes: 92 * MB,
    installedBytes: 226 * MB,
  })
  const claude = resourceFixture({
    key: CLAUDE_KEY,
    displayName: 'Claude Code runtime',
    description: 'Runs Claude sessions, quick questions, and title generation.',
    required: false,
    kind: 'runtime',
    state: spec.claude ?? 'not-installed',
    version: '2.0.61',
    downloadBytes: 152 * MB,
    installedBytes: 317 * MB,
  })
  const opencode = resourceFixture({
    key: OPENCODE_KEY,
    displayName: 'OpenCode CLI',
    description: 'Runs OpenCode sessions.',
    required: false,
    kind: 'runtime',
    state: spec.opencode ?? 'not-installed',
    version: '1.18.21',
    downloadBytes: 46 * MB,
    installedBytes: 118 * MB,
  })
  const ocr = resourceFixture({
    key: OCR_KEY,
    displayName: 'Light OCR model',
    description: 'Reads text out of image attachments, on-device.',
    required: false,
    kind: 'model',
    state: spec.ocr ?? 'not-installed',
    version: '0.3.4',
    downloadBytes: 35 * MB,
    installedBytes: 71 * MB,
  })

  return [
    {
      resource: codex,
      icon: { key: 'codex' },
      tasks: spec.codex === 'installing' && spec.codexProgress !== undefined
        ? [taskFixture({
            resource: codex,
            status: 'downloading',
            transferredBytes: Math.round(codex.downloadSizeBytes! * spec.codexProgress),
          })]
        : spec.codexFailed
          ? [taskFixture({
              resource: codex,
              status: 'failed',
              transferredBytes: Math.round(codex.downloadSizeBytes! * 0.34),
              error: { code: 'network_error', message: 'Connection reset by peer' },
            })]
          : [],
    },
    {
      resource: claude,
      icon: { key: 'claude-cli' },
      tasks: spec.claude === 'installing' && spec.claudeProgress !== undefined
        ? [taskFixture({
            resource: claude,
            status: 'downloading',
            transferredBytes: Math.round(claude.downloadSizeBytes! * spec.claudeProgress),
          })]
        : [],
    },
    { resource: opencode, icon: { key: 'opencode' }, tasks: [] },
    { resource: ocr, tasks: [] },
  ]
}

/** Dialog chrome replica matching CredentialSetupDialog's step shell. */
function RuntimesStepScene({ spec, live }: { spec: SceneSpec, live?: boolean }) {
  const { t } = useTranslation('onboarding')
  const [items, setItems] = useState<OnboardingRuntimeItem[]>(() => buildItems(spec))

  const startDownload = useCallback((key: ManagedResource['key']) => {
    setItems(current => current.map((item) => {
      if (managedResourceKey(item.resource) !== JSON.stringify([key.namespace, key.resourceType, key.resourceId])) {
        return item
      }
      if (item.resource.state === 'installed' || item.tasks.length > 0) {
        return item
      }
      return {
        ...item,
        resource: { ...item.resource, state: 'installing', actions: actionsFor('installing') },
        tasks: [taskFixture({ resource: item.resource, status: 'downloading', transferredBytes: Math.round((item.resource.downloadSizeBytes ?? 0) * 0.02) })],
      }
    }))
  }, [])

  // Simulated transfer engine for the Live story: advances each active task,
  // passes through verifying, then flips the resource to installed.
  useEffect(() => {
    if (!live) {
      return
    }
    const interval = window.setInterval(() => {
      setItems(current => current.map((item) => {
        const active = item.tasks.find(task => task.status === 'downloading' || task.status === 'verifying')
        if (!active) {
          return item
        }
        const total = active.totalBytes ?? item.resource.downloadSizeBytes ?? 0
        if (active.status === 'downloading') {
          const next = active.transferredBytes + Math.round(total * (0.018 + Math.random() * 0.02))
          if (next >= total) {
            return { ...item, tasks: [{ ...active, status: 'verifying', transferredBytes: total }] }
          }
          return { ...item, tasks: [{ ...active, transferredBytes: next }] }
        }
        return {
          ...item,
          resource: { ...item.resource, state: 'installed', installationSource: 'managed', installedVersion: item.resource.availableVersion, installedSizeBytes: item.resource.downloadSizeBytes ? Math.round(item.resource.downloadSizeBytes * 2) : null, actions: actionsFor('installed') },
          tasks: [{ ...active, status: 'completed', transferredBytes: total }],
        }
      }))
    }, 120)
    return () => window.clearInterval(interval)
  }, [live])

  // Live story: auto-start the required runtime shortly after the step appears.
  useEffect(() => {
    if (!live) {
      return
    }
    const timeout = window.setTimeout(startDownload, 900, CODEX_KEY)
    return () => window.clearTimeout(timeout)
  }, [live, startDownload])

  const requiredReady = useMemo(
    () => items.filter(item => item.resource.required).every(item => item.resource.state === 'installed'),
    [items],
  )

  const stepIndex = 0
  const totalSteps = 4

  return (
    <Dialog open>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-[520px]"
        showCloseButton={false}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="mb-3 flex items-center gap-1.5">
            {Array.from({ length: totalSteps }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-150',
                  index <= stepIndex ? 'bg-foreground' : 'bg-muted',
                )}
              />
            ))}
          </div>
          <DialogTitle className="font-heading text-base font-semibold tracking-tight text-balance">
            {t('setup.runtimes.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-pretty">
            {t('setup.runtimes.description')}
          </DialogDescription>
        </div>

        <div className="max-h-[min(60vh,480px)] overflow-y-auto px-5 pb-4">
          <OnboardingRuntimesStepView
            items={items}
            onInstall={resource => startDownload(resource.key)}
          />
        </div>

        <DialogFooter variant="bare" className="justify-between border-t border-border px-4 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
            {t('setup.skip')}
          </Button>
          <Button
            size="sm"
            variant={requiredReady ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs active:scale-[0.96]"
          >
            {t('setup.continue')}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const meta = {
  title: 'App/Onboarding/Runtime Setup Step',
  component: RuntimesStepScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    spec: { codex: 'not-installed' } satisfies SceneSpec,
  },
} satisfies Meta<typeof RuntimesStepScene>

export default meta

type Story = StoryObj<typeof meta>

/** The moment the step appears — before the required download auto-starts. */
export const Fresh: Story = {}

/** Required runtime mid-download; optionals untouched. */
export const Downloading: Story = {
  args: {
    spec: { codex: 'installing', codexProgress: 0.42 },
  },
}

/** User added Claude too — both transferring at once. */
export const DownloadingWithOptional: Story = {
  args: {
    spec: { codex: 'installing', codexProgress: 0.68, claude: 'installing', claudeProgress: 0.21 },
  },
}

/** Required runtime failed mid-transfer; owner retry path is one click. */
export const Failed: Story = {
  args: {
    spec: { codex: 'error', codexFailed: true },
  },
}

/** Required done; optionals still available for one-click adds. */
export const RequiredReady: Story = {
  args: {
    spec: { codex: 'installed' },
  },
}

/** Everything installed. */
export const AllSet: Story = {
  args: {
    spec: { codex: 'installed', claude: 'installed', opencode: 'installed', ocr: 'installed' },
  },
}

/**
 * Interactive: the required runtime auto-starts ~1s in and finishes; clicking
 * Add on an optional row starts its simulated transfer too.
 */
export const Live: Story = {
  args: {
    spec: { codex: 'not-installed' },
    live: true,
  },
}
