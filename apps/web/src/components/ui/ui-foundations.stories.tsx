import {
  AddLine as PlusIcon,
  CheckCircleLine as CheckIcon,
  InformationLine as InfoIcon,
  Settings2Line as SettingsIcon,
} from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Alert, AlertAction, AlertDescription, AlertTitle } from './alert'
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from './avatar'
import { Badge } from './badge'
import { Button } from './button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import { Checkbox } from './checkbox'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'
import { Input } from './input'
import { Kbd, KbdGroup } from './kbd'
import { Progress } from './progress'
import { RadioGroup, RadioGroupItem } from './radio-group'
import { Separator } from './separator'
import { Skeleton } from './skeleton'
import { Slider } from './slider'
import { StatusIcon } from './status-tag'
import { Switch } from './switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Textarea } from './textarea'
import { Toggle } from './toggle'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

function UiFoundationsGallery() {
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl space-y-10">
        <section className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Actions and status</h1>
            <p className="mt-1 text-sm text-muted-foreground">Primary commands, compact actions, labels, and progress states.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(variant => (
              <Button key={variant} variant={variant}>
                {variant === 'default' && <PlusIcon aria-hidden="true" />}
                {variant}
              </Button>
            ))}
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="Settings" />}>
                <SettingsIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['default', 'secondary', 'outline', 'ghost', 'destructive'] as const).map(variant => (
              <Badge key={variant} variant={variant}>{variant}</Badge>
            ))}
            {[
              ['triage', '#a855f7'],
              ['backlog', '#6b7280'],
              ['started', '#f59e0b'],
              ['completed', '#22c55e'],
              ['canceled', '#6b7280'],
            ].map(([value, color]) => (
              <span key={value} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusIcon value={value} color={color} animated={false} />
                {value}
              </span>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <span className="mb-1.5 block text-xs text-muted-foreground">Processing</span>
              <Progress value={64} />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
              <span className="text-xs text-muted-foreground">Command menu</span>
            </KbdGroup>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Form controls</h2>
            <p className="mt-1 text-sm text-muted-foreground">Text entry and binary, ranged, or exclusive choices.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Input placeholder="Workspace name" defaultValue="Cradle App" />
              <Textarea placeholder="Describe the task..." defaultValue="Refactor the user-visible surface into fixture-driven Views." />
            </div>
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4 text-sm">
                Enable automatic updates
                <Switch defaultChecked aria-label="Enable automatic updates" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox defaultChecked aria-label="Include uncommitted changes" />
                Include uncommitted changes
              </label>
              <Slider defaultValue={[68]} max={100} step={1} aria-label="Context usage" />
              <RadioGroup defaultValue="balanced" className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="fast" />Fast</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="balanced" />Balanced</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="deep" />Deep</label>
              </RadioGroup>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle aria-label="Toggle pinned">Pinned</Toggle>
            <ToggleGroup type="multiple" defaultValue={['code']} aria-label="View modes">
              <ToggleGroupItem value="code">Code</ToggleGroupItem>
              <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
              <ToggleGroupItem value="diff">Diff</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Feedback and navigation</h2>
            <p className="mt-1 text-sm text-muted-foreground">Inline notices, errors, tabs, and identity treatments.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Alert>
              <InfoIcon aria-hidden="true" />
              <AlertTitle>Runtime connected</AlertTitle>
              <AlertDescription>The provider catalog was refreshed successfully.</AlertDescription>
              <AlertAction><Button variant="ghost" size="xs">Details</Button></AlertAction>
            </Alert>
            <Alert variant="destructive">
              <InfoIcon aria-hidden="true" />
              <AlertTitle>Action requires attention</AlertTitle>
              <AlertDescription>The remote host is not accepting new sessions.</AlertDescription>
            </Alert>
          </div>
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="runtime">Runtime</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="pt-3 text-sm text-muted-foreground">
              Activity surface selected.
            </TabsContent>
            <TabsContent value="changes" className="pt-3 text-sm text-muted-foreground">
              Changes surface selected.
            </TabsContent>
            <TabsContent value="runtime" className="pt-3 text-sm text-muted-foreground">
              Runtime surface selected.
            </TabsContent>
          </Tabs>
          <AvatarGroup>
            {['CW', 'QA', 'UI'].map((initials, index) => (
              <Avatar key={initials}>
                <AvatarFallback>{initials}</AvatarFallback>
                {index === 0 && <AvatarBadge />}
              </Avatar>
            ))}
            <AvatarGroupCount>+4</AvatarGroupCount>
          </AvatarGroup>
        </section>

        <Separator />

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Fixture-driven surface</CardTitle>
              <CardDescription>One stable interface for application, Storybook, and screenshots.</CardDescription>
              <CardAction><Badge variant="secondary">View</Badge></CardAction>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Runtime dependencies stay in the adapter while this surface receives data and callbacks.
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button variant="ghost" size="sm">Dismiss</Button>
              <Button size="sm"><CheckIcon aria-hidden="true" />Apply</Button>
            </CardFooter>
          </Card>
          <Empty className="min-h-52 border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><PlusIcon aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>No sessions yet</EmptyTitle>
              <EmptyDescription>Start a session to see recent activity here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button size="sm">Start session</Button></EmptyContent>
          </Empty>
        </section>
      </div>
    </main>
  )
}

const meta = {
  title: 'Design System/Foundations',
  component: UiFoundationsGallery,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof UiFoundationsGallery>

export default meta

type Story = StoryObj<typeof meta>

export const Catalog: Story = {}
