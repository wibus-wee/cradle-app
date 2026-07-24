import { Spinner } from '~/components/ui/spinner'

interface PluginInstallProgressViewProps {
  label: string
}

export function PluginInstallProgressView({ label }: PluginInstallProgressViewProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
      <Spinner className="size-3.5" />
      {label}
    </div>
  )
}
