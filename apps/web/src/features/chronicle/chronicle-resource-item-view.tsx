import {
  DownloadLine as DownloadIcon,
  Refresh1Line as VerifyIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import { ChronicleResourceBadge } from './chronicle-resource-badge'
import { ChronicleResourceIcon } from './chronicle-resource-icon'
import {
  getChronicleResourceTone,
  hasVerifiedChronicleManifestDownload,
} from './chronicle-resource-presenter'
import type { ChronicleModelResource } from './use-chronicle'

export interface ChronicleResourceItemViewProps {
  resource: ChronicleModelResource
  busy: boolean
  downloadProgress: number | undefined
  onInstall: (
    category: ChronicleModelResource['category'],
  ) => Promise<ChronicleModelResource>
  onVerify: (
    category: ChronicleModelResource['category'],
  ) => Promise<ChronicleModelResource>
}

export function ChronicleResourceItemView({
  resource,
  busy,
  downloadProgress,
  onInstall,
  onVerify,
}: ChronicleResourceItemViewProps) {
  const { t } = useTranslation('chronicle')
  const tone = getChronicleResourceTone(resource)
  const [message, setMessage] = useState<string | null>(null)
  const canInstall = resource.category !== 'ocr'
  const canDownload = canInstall && hasVerifiedChronicleManifestDownload(resource)

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <ChronicleResourceIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {resource.label}
            </span>
            <ChronicleResourceBadge resource={resource} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
            {resource.message ?? resource.provider ?? t('resources.defaultMessage')}
          </p>
          {resource.path
            ? (
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
                  {resource.path}
                </p>
              )
            : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {resource.version
              ? (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {resource.version}
                  </span>
                )
              : null}
            {resource.sizeBytes !== null && resource.sizeBytes > 0
              ? (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {(resource.sizeBytes / 1024 / 1024).toFixed(1)}
                    {' '}
                    MB
                  </span>
                )
              : null}
          </div>
          {canInstall
            ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canDownload
                    ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => {
                            setMessage(null)
                            void onInstall(resource.category).then((updated) => {
                              setMessage(updated.message ?? t('resources.downloaded'))
                            })
                          }}
                        >
                          <DownloadIcon className="size-3" />
                          {t('common.action.download')}
                        </Button>
                      )
                    : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => {
                      setMessage(null)
                      void onVerify(resource.category).then((updated) => {
                        setMessage(updated.message ?? t('resources.verified'))
                      })
                    }}
                  >
                    <VerifyIcon className="size-3" />
                    {t('common.action.verify')}
                  </Button>
                </div>
              )
            : null}
          {message
            ? <p className="mt-1 text-[11px] text-muted-foreground">{message}</p>
            : null}
          {downloadProgress !== undefined
            ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('resources.downloadProgress', { progress: downloadProgress })}
                </p>
              )
            : null}
        </div>
      </div>
    </article>
  )
}
