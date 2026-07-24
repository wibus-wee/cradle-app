import {
  Delete2Line as TrashIcon,
  InformationLine as InfoIcon,
  More2Line as MoreIcon,
  Settings2Line as SettingsIcon,
} from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from './sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

function UiOverlaysGallery() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activity, setActivity] = useState('No overlay action selected')

  return (
    <main className="min-h-[42rem] bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <section>
          <h1 className="text-xl font-semibold">Overlays and option sets</h1>
          <p className="mt-1 text-sm text-muted-foreground">Interactive surfaces using the same focus, portal, and host-suppression paths as the application.</p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Menus and selection</h2>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <MoreIcon aria-hidden="true" />
                    Session actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Session</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setActivity('Renamed session')}>
                    Rename
                    <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem defaultChecked>Pin to sidebar</DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setActivity('Archive selected')}>
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Select defaultValue="balanced">
                <SelectTrigger className="w-44" aria-label="Reasoning effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="deep">Deep reasoning</SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">Runtime details</Button>
                </PopoverTrigger>
                <PopoverContent className="w-72">
                  <div className="text-sm font-medium">Codex runtime</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">Connected locally with a 128k context window.</div>
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Settings">
                    <SettingsIcon aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Runtime settings</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-medium">Dialogs and side sheets</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rename session</DialogTitle>
                    <DialogDescription>Choose a concise title that will remain easy to scan in the sidebar.</DialogDescription>
                  </DialogHeader>
                  <Input defaultValue="Component architecture refactor" aria-label="Session title" />
                  <DialogFooter showCloseButton>
                    <Button onClick={() => {
                      setActivity('Session renamed')
                      setDialogOpen(false)
                    }}
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive"><TrashIcon aria-hidden="true" />Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia><TrashIcon aria-hidden="true" /></AlertDialogMedia>
                    <AlertDialogTitle>Delete this session?</AlertDialogTitle>
                    <AlertDialogDescription>This removes the session from local history and cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => setActivity('Session deleted')}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Sheet>
                <SheetTrigger asChild><Button variant="outline">Open details</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Runtime details</SheetTitle>
                    <SheetDescription>Inspect the active model and host capabilities.</SheetDescription>
                  </SheetHeader>
                  <div className="space-y-3 px-4 text-sm">
                    <div className="flex items-center justify-between border-b border-border py-2"><span>Runtime</span><span className="text-muted-foreground">Codex</span></div>
                    <div className="flex items-center justify-between border-b border-border py-2"><span>Model</span><span className="text-muted-foreground">GPT-5</span></div>
                    <div className="flex items-center justify-between border-b border-border py-2"><span>Status</span><span className="text-emerald-600">Connected</span></div>
                  </div>
                  <SheetFooter>
                    <SheetClose asChild><Button>Done</Button></SheetClose>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </section>

        <section className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium">Interaction status</div>
            <div className="mt-1 text-xs text-muted-foreground" role="status">{activity}</div>
          </div>
        </section>
      </div>
    </main>
  )
}

const meta = {
  title: 'Design System/Overlays',
  component: UiOverlaysGallery,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof UiOverlaysGallery>

export default meta

type Story = StoryObj<typeof meta>

export const Catalog: Story = {}
