import {
  GlobeLine as GlobeIcon,
  LayoutTopLine as PanelIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Spinner } from '~/components/ui/spinner'

export interface BrowserPanelCreateSurfaceViewProps {
  canCreateTui: boolean
  browserPending: boolean
  onCreateBrowser: () => void
  onCreateTui: () => void
}

export function BrowserPanelCreateSurfaceView({
  canCreateTui,
  browserPending,
  onCreateBrowser,
  onCreateTui,
}: BrowserPanelCreateSurfaceViewProps) {
  return (
    <Empty className="absolute inset-0 rounded-none border-0 bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PanelIcon className="size-4" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>New Tab</EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="grid max-w-xs grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col gap-2 whitespace-normal px-3 py-3 text-xs"
          onClick={onCreateBrowser}
          disabled={browserPending}
          aria-label="Create browser tab"
        >
          {browserPending
            ? <Spinner className="size-4" />
            : <GlobeIcon className="size-4" />}
          <span>Browser</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col gap-2 whitespace-normal px-3 py-3 text-xs"
          onClick={onCreateTui}
          disabled={!canCreateTui}
          aria-label="Create terminal tab"
          title={
            canCreateTui
              ? 'Terminal'
              : 'Open a workspace to create a terminal.'
          }
        >
          <TerminalIcon className="size-4" />
          <span>Terminal</span>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
