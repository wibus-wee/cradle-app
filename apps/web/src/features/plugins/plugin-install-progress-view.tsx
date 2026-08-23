import { Spinner } from '~/components/ui/spinner'

import type { InstallStepId } from './plugin-install-step-header'
import { PluginInstallStepHeader } from './plugin-install-step-header'

interface PluginInstallProgressViewProps {
  label: string
  /** Secondary line shown under the label (e.g. what is being resolved). */
  hint?: string
  /** Which wizard step this progress state belongs to. */
  step?: Extract<InstallStepId, 'source' | 'install'>
}

export function PluginInstallProgressView({ label, hint, step = 'install' }: PluginInstallProgressViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <PluginInstallStepHeader current={step} />
      <div className="flex flex-col items-center gap-3 py-12 text-center animate-in fade-in duration-300">
        <Spinner className="size-6 text-foreground/70" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          {hint && (
            <p className="text-[12px] leading-relaxed text-muted-foreground animate-pulse">
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
