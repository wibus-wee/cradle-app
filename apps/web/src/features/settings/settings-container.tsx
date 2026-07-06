// Unified settings layout primitives — a Linear-style single-column page shell
// (`SettingsPage`) and grouped card container (`SettingsGroup`) that every
// settings section composes for a consistent visual language.
import { cn } from '~/lib/cn'

interface SettingsPageProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Large page title shown at the top of the section. */
  title: string
  /** Optional supporting copy rendered beneath the title. */
  description?: string
  /** Optional trailing accessory aligned to the title (badge, status, etc.). */
  action?: React.ReactNode
  /** Max-width of the page shell. Defaults to '2xl' (672px). */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'
  children: React.ReactNode
}

/**
 * Centered, width-constrained page shell. Provides the section's large title
 * and stacks `SettingsGroup` cards with consistent vertical rhythm. Extra
 * props (e.g. `data-testid`, readiness flags) are forwarded to the root.
 */
const maxWidthClasses = {
  'sm': 'max-w-sm',
  'md': 'max-w-md',
  'lg': 'max-w-lg',
  'xl': 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
}

export function SettingsPage({ title, description, action, maxWidth = '2xl', children, className, ...rest }: SettingsPageProps) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-7 pb-4', maxWidthClasses[maxWidth], className)} {...rest}>
      <SettingsHeader title={title} description={description} action={action} />
      {children}
    </div>
  )
}

interface SettingsHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

/**
 * Shared section header — the large title + muted description treatment that
 * both `SettingsPage` (narrow) and `SettingsMasterDetail` (wide) render so every
 * settings section opens with the same visual language.
 */
export function SettingsHeader({ title, description, action }: SettingsHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground text-balance">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </header>
  )
}

interface SettingsMasterDetailProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Large page title, aligned with `SettingsPage`. */
  title: string
  /** Optional supporting copy beneath the title. */
  description?: string
  /** Optional trailing accessory aligned to the title (count badge, actions). */
  action?: React.ReactNode
  /**
   * Optional full-width content rendered between the header and the
   * master-detail card (e.g. an account row card or a batch-selection bar).
   */
  toolbar?: React.ReactNode
  /** Left list pane content (search + list + footer). */
  list: React.ReactNode
  /** Right detail pane content. */
  detail: React.ReactNode
  /** Fixed width of the list pane in px. Defaults to 300. */
  listWidth?: number
  /** Out-of-flow content (dialogs, portals) rendered after the card. */
  children?: React.ReactNode
}

/**
 * Full-height, width-filling master-detail shell for settings sections whose
 * editor is too large to collapse into the centered `SettingsPage` column
 * (Providers, Agents). Shares the section header with `SettingsPage` and wraps
 * the list/detail split in a single `bg-card` surface so it speaks the same
 * card language as the rest of Settings. The list pane owns its own scroll
 * region; the detail pane scrolls independently.
 *
 * Sections using this must be height-constrained by the content host (added to
 * the fixed-height set) so the card fills the viewport rather than the page.
 */
export function SettingsMasterDetail({
  title,
  description,
  action,
  toolbar,
  list,
  detail,
  listWidth = 300,
  className,
  children,
  ...rest
}: SettingsMasterDetailProps) {
  return (
    <div className={cn('flex h-full min-h-0 w-full min-w-0 flex-col gap-5', className)} {...rest}>
      <SettingsHeader title={title} description={description} action={action} />
      {toolbar}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <aside
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/60"
          style={{ flex: `0 0 ${listWidth}px`, maxWidth: '42%' }}
        >
          {list}
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {detail}
        </section>
      </div>
      {children}
    </div>
  )
}

interface SettingsGroupProps {
  /** Optional group label rendered above the card (e.g. "General"). */
  label?: string
  /** Optional supporting copy for the group label. */
  description?: string
  /** Optional trailing accessory aligned to the group label. */
  action?: React.ReactNode
  /**
   * When set, renders the card without the default row padding/divider styling
   * so callers can lay out custom content (lists, forms) inside the container.
   */
  bare?: boolean
  sectionClassName?: string
  className?: string
  children: React.ReactNode
}

/**
 * Linear-style grouped card. Direct children are treated as rows: they receive
 * inset horizontal padding and hairline dividers between them. Pass `bare` to
 * opt out and control the inner layout directly.
 */
export function SettingsGroup({ label, description, action, bare = false, sectionClassName, className, children }: SettingsGroupProps) {
  const hasHeader = Boolean(label || description || action)

  return (
    <section className={cn('flex flex-col gap-2.5', sectionClassName)}>
      {hasHeader && (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {label && <h2 className="text-[13px] font-medium text-foreground">{label}</h2>}
            {description && <p className="mt-0.5 text-[12px] text-muted-foreground text-pretty">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          'rounded-xl border border-border bg-card',
          bare ? undefined : 'px-4 [&>*+*]:border-t [&>*+*]:border-border/60',
          className,
        )}
      >
        {children}
      </div>
    </section>
  )
}
