import { Command as CommandPrimitive } from 'cmdk'
import { CheckLine as CheckIcon, SearchLine as SearchIcon } from '@mingcute/react'
import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run.',
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          'top-[18vh] max-h-[min(720px,calc(100vh-4rem))] translate-y-0 overflow-hidden rounded-xl p-0 shadow-[0_20px_80px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.08)] sm:max-w-xl dark:shadow-[0_20px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.1)]',
          className,
        )}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-12 items-center gap-2 border-b border-border/70 px-3"
    >
      <SearchIcon className="size-4 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'no-scrollbar max-h-[min(26rem,calc(100vh-12rem))] scroll-py-2 overflow-x-hidden overflow-y-auto p-1.5 outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        'py-10 text-center text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('mx-2 my-1 h-px bg-border/70', className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  checked = false,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  checked?: boolean
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      data-checked={checked ? 'true' : undefined}
      className={cn(
        'group/command-item relative flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition-[background-color,color] duration-100 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-muted data-[selected=true]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    >
      {children}
      {checked && (
        <CheckIcon className="ml-auto size-3.5 shrink-0 !text-primary" aria-hidden="true" />
      )}
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums group-data-[selected=true]/command-item:text-foreground/70',
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
}
