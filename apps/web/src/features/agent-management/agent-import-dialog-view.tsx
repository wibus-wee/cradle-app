import { DownloadLine as DownloadIcon } from '@mingcute/react'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import type { PreviewLocalConfigImportResult } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'

interface AgentImportDialogViewProps {
  open: boolean
  preview: PreviewLocalConfigImportResult | null
  selectedIds: Set<string>
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onToggleCandidate: (candidateId: string, checked: boolean) => void
  onImport: () => void
}

export function AgentImportDialogView({
  open,
  preview,
  selectedIds,
  busy,
  error,
  onOpenChange,
  onToggleCandidate,
  onImport,
}: AgentImportDialogViewProps) {
  const importableSelectedCount
    = preview?.candidates.filter(candidate => candidate.importable && selectedIds.has(candidate.id))
      .length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Agents</DialogTitle>
          <DialogDescription>
            Review detected Claude, Codex, Gemini, Pi, Kimi, and CC Switch mappings before creating
            Agents.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}

          {!preview && (
            <div className="rounded-md border border-foreground/8 px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              Scanning local config
            </div>
          )}

          {preview && preview.candidates.length === 0 && (
            <div className="rounded-md border border-foreground/8 px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No Claude, Codex, Gemini, Pi, Kimi, or CC Switch mappings found
            </div>
          )}

          {preview && preview.candidates.length > 0 && (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-foreground/8">
              {preview.candidates.map(candidate => (
                <label
                  key={candidate.id}
                  className={cn(
                    'flex gap-3 border-b border-foreground/6 px-3 py-3 last:border-b-0',
                    candidate.importable
                      ? 'cursor-pointer hover:bg-foreground/[0.025]'
                      : 'opacity-60',
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(candidate.id)}
                    disabled={!candidate.importable || busy}
                    onCheckedChange={value => onToggleCandidate(candidate.id, Boolean(value))}
                  />
                  {(candidate.avatarUrl || candidate.iconSlug) && (
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-foreground/8 bg-background">
                      {candidate.avatarUrl
                        ? <img src={candidate.avatarUrl} alt="" className="size-5 object-contain" />
                        : (
                            <ProviderIcon
                              iconSlug={candidate.iconSlug}
                              presetId={candidate.app}
                              className="size-5"
                            />
                          )}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {candidate.agentName}
                      </span>
                      <Badge
                        variant={candidate.sourceKind === 'cc-switch' ? 'secondary' : 'outline'}
                        className="font-normal"
                      >
                        {candidate.sourceLabel}
                      </Badge>
                      {candidate.alreadyConfigured && (
                        <Badge variant="outline" className="font-normal">Existing</Badge>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                      <span>{candidate.app}</span>
                      <span className="truncate">{candidate.resolvedProviderName}</span>
                      {candidate.modelId && <span className="truncate">{candidate.modelId}</span>}
                      {candidate.endpoint && <span className="truncate font-mono">{candidate.endpoint}</span>}
                      {candidate.executable && <span className="truncate font-mono">{candidate.executable}</span>}
                    </div>
                    {candidate.notes.map(note => (
                      <p key={note} className="text-[11.5px] leading-relaxed text-muted-foreground">{note}</p>
                    ))}
                    {candidate.reason && (
                      <p className="text-[11.5px] leading-relaxed text-destructive">{candidate.reason}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter variant="bare">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onImport} disabled={busy || importableSelectedCount === 0}>
            <DownloadIcon />
            {busy ? 'Importing' : 'Import selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
