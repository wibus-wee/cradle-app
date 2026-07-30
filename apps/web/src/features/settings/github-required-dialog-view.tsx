import { MeshGradient } from '@paper-design/shaders-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

import type { GithubRequiredFeature } from './github-required-dialog-store'

export interface GithubRequiredDialogViewProps {
  open: boolean
  feature: GithubRequiredFeature | null
  connectionPanel: ReactNode
  fixture: ReactNode
  onOpenChange: (open: boolean) => void
}

export function GithubRequiredDialogView({
  open,
  feature,
  connectionPanel,
  fixture,
  onOpenChange,
}: GithubRequiredDialogViewProps) {
  const { t } = useTranslation('workspace')
  const titleKey = feature === 'new-work'
    ? 'githubRequired.newWork.title'
    : 'githubRequired.pullRequests.title'
  const descriptionKey = feature === 'new-work'
    ? 'githubRequired.newWork.description'
    : 'githubRequired.pullRequests.description'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'gap-0 overflow-hidden p-0 sm:max-w-3xl',
          '[&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3',
        )}
        showCloseButton
        data-testid="github-required-dialog"
      >
        <div className="grid min-h-[min(28rem,70vh)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t('githubRequired.eyebrow')}
              </p>
              <DialogTitle className="font-heading text-lg font-semibold tracking-tight text-balance">
                {t(titleKey)}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-pretty">
                {t(descriptionKey)}
              </DialogDescription>
            </div>
            <div className="min-w-0 flex-1">
              {connectionPanel}
            </div>
            <p className="text-[12px] text-muted-foreground text-pretty">
              {t('githubRequired.connectHint')}
            </p>
          </div>

          <div className="relative hidden min-h-0 overflow-hidden border-l border-border/60 bg-muted/20 md:block">
            <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">
              <MeshGradient
                colors={['#1f2937', '#334155', '#0f172a', '#475569']}
                distortion={0.6}
                swirl={0.35}
                scale={1.15}
                speed={0.2}
                grainOverlay={0.12}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              />
              <div className="absolute inset-0 bg-gradient-to-br from-background/40 via-background/70 to-background" />
            </div>
            <div className="relative flex h-full items-center justify-center p-5">
              <div className="w-full max-w-sm scale-[0.92] opacity-90">
                {fixture}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
