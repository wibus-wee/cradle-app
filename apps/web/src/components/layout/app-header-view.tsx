import {
  GlobeLine as GlobeIcon,
  LayoutBottomLine as PanelBottomIcon,
  LayoutLeftbarCloseLine as PanelLeftCloseIcon,
  LayoutLeftbarOpenLine as PanelLeftOpenIcon,
  LayoutRightLine as PanelRightIcon,
} from '@mingcute/react'
import { m } from 'motion/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

interface AppHeaderToggle {
  label: string
  open: boolean
  onToggle: () => void
}

interface AppHeaderViewProps {
  isDrillIn?: boolean
  isTearoffWindow?: boolean
  sidebar: {
    inSheet: boolean
    sheetOpen: boolean
    collapsed: boolean
    toggleLabel: string
    collapsedWindowControlsOffset: number
    onToggle: () => void
  }
  windowControls: {
    leftReservedWidth: number
    rightReservedWidth: number
  }
  surface: React.ReactNode
  actions?: React.ReactNode
  browserPanel?: AppHeaderToggle | null
  bottomPanel?: AppHeaderToggle | null
  aside?: AppHeaderToggle | null
}

export function AppHeaderView({
  isDrillIn = false,
  isTearoffWindow = false,
  sidebar,
  windowControls,
  surface,
  actions,
  browserPanel,
  bottomPanel,
  aside,
}: AppHeaderViewProps) {
  const showSidebarToggle = (!isDrillIn || sidebar.inSheet) && !isTearoffWindow

  return (
    <div
      className="relative mt-1 mb-0 flex h-11 shrink-0 items-center bg-sidebar pe-1 pl-1"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {windowControls.leftReservedWidth > 0 && (
        <div
          aria-hidden="true"
          className="h-full shrink-0"
          style={{ width: windowControls.leftReservedWidth }}
        />
      )}

      {showSidebarToggle && (
        <m.div
          initial={false}
          animate={{ marginLeft: sidebar.collapsedWindowControlsOffset }}
          transition={{ duration: 0.2 }}
          className="flex items-center overflow-hidden"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              'shrink-0 text-muted-foreground',
              sidebar.inSheet && sidebar.sheetOpen && 'text-foreground',
            )}
            onClick={sidebar.onToggle}
            aria-label={sidebar.toggleLabel}
            aria-pressed={sidebar.inSheet ? sidebar.sheetOpen : !sidebar.collapsed}
            title={sidebar.toggleLabel}
            data-chrome-side-sheet-trigger={sidebar.inSheet ? 'left' : undefined}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {(sidebar.inSheet && !sidebar.sheetOpen) || (!sidebar.inSheet && sidebar.collapsed)
              ? <PanelLeftOpenIcon aria-hidden="true" />
              : <PanelLeftCloseIcon aria-hidden="true" />}
          </Button>
        </m.div>
      )}

      <div
        className="ml-0.5 mr-1 h-full min-w-0 flex-1"
        style={{ WebkitAppRegion: isTearoffWindow ? 'drag' : 'no-drag' } as React.CSSProperties}
      >
        {surface}
      </div>

      <div
        className="ml-auto flex shrink-0 items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {actions}
        {browserPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', browserPanel.open && 'text-foreground')}
            onClick={browserPanel.onToggle}
            aria-label={browserPanel.label}
            aria-pressed={browserPanel.open}
            title={browserPanel.label}
            data-testid="app-header-browser-toggle"
          >
            <GlobeIcon aria-hidden="true" />
          </Button>
        )}
        {bottomPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', bottomPanel.open && 'text-foreground')}
            onClick={bottomPanel.onToggle}
            aria-label={bottomPanel.label}
            aria-pressed={bottomPanel.open}
            title={bottomPanel.label}
            data-testid="app-header-panel-toggle"
          >
            <PanelBottomIcon aria-hidden="true" />
          </Button>
        )}
        {aside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', aside.open && 'text-foreground')}
            onClick={aside.onToggle}
            aria-label={aside.label}
            aria-pressed={aside.open}
            title={aside.label}
            data-testid="app-header-aside-toggle"
          >
            <PanelRightIcon aria-hidden="true" />
          </Button>
        )}
        {windowControls.rightReservedWidth > 0 && (
          <div
            aria-hidden="true"
            className="h-full shrink-0"
            style={{ width: windowControls.rightReservedWidth }}
          />
        )}
      </div>
    </div>
  )
}
