import type { Lang } from '../i18n'
import { t } from '../i18n'

interface ComponentsProps {
  lang: Lang
}

const COMPONENTS = [
  { name: 'Button', path: 'components/ui/button.tsx', desc: 'Variants: default, outline, secondary, ghost, destructive, link. Sizes: xs, sm, default, lg, icon.' },
  { name: 'Input', path: 'components/ui/input.tsx', desc: 'Single-line text input. h-8, rounded-lg, border-input.' },
  { name: 'Textarea', path: 'components/ui/textarea.tsx', desc: 'Multi-line text input with auto-resize support.' },
  { name: 'Select', path: 'components/ui/select.tsx', desc: 'Radix-based select with trigger, content, and item primitives.' },
  { name: 'DropdownMenu', path: 'components/ui/dropdown-menu.tsx', desc: 'Button-triggered action menu.' },
  { name: 'ContextMenu', path: 'components/ui/context-menu.tsx', desc: 'Right-click action menu on content elements.' },
  { name: 'Checkbox', path: 'components/ui/checkbox.tsx', desc: 'Radix-based checkbox with accessible label pairing.' },
  { name: 'Toggle', path: 'components/ui/toggle.tsx', desc: 'Binary state switch for toolbars and formatting controls.' },
  { name: 'Separator', path: 'components/ui/separator.tsx', desc: 'Horizontal or vertical divider. Use sparingly — prefer gap.' },
  { name: 'Table', path: 'components/ui/table.tsx', desc: 'Accessible table with header, body, row, cell primitives.' },
  { name: 'Skeleton', path: 'components/ui/skeleton.tsx', desc: 'Loading placeholder when content shape is known.' },
  { name: 'Spinner', path: 'components/ui/spinner.tsx', desc: 'Indeterminate loading indicator.' },
  { name: 'Toast', path: 'components/ui/toast.tsx', desc: 'System notifications via useToast() hook.' },
  { name: 'Form / Fieldset', path: 'components/ui/form.tsx', desc: 'react-hook-form integration with FormField, FormLabel, FormControl, FormMessage.' },
  { name: 'Autocomplete', path: 'components/ui/autocomplete.tsx', desc: 'Combobox-style input with suggestion dropdown.' },
  { name: 'Carousel', path: 'components/ui/carousel.tsx', desc: 'Horizontal scroll container with prev/next controls.' },
  { name: 'Collapsible', path: 'components/ui/collapsible.tsx', desc: 'Animated expand/collapse with spring physics.' },
  { name: 'IconPicker', path: 'components/ui/icon-picker.tsx', desc: 'Searchable icon selector popover.' },
  { name: 'Frame', path: 'components/ui/frame.tsx', desc: 'Sandboxed iframe wrapper for embedded content previews.' },
]

const SELECTION_RULES = [
  { question: 'Persistent side panel', answer: 'Sheet', detail: 'Stays open while user interacts with main content' },
  { question: 'Blocking confirmation', answer: 'Dialog', detail: 'Delete, auth, critical settings — requires full attention' },
  { question: 'Lightweight contextual controls', answer: 'Popover', detail: 'Filters, quick edits, color pickers' },
  { question: 'Button-triggered actions', answer: 'DropdownMenu', detail: 'Action menus from buttons/icons' },
  { question: 'Right-click content', answer: 'ContextMenu', detail: 'Content-triggered menus' },
  { question: 'Primary CTA', answer: 'Button default', detail: 'One per screen or panel' },
  { question: 'Toolbar icon', answer: 'Button ghost + icon', detail: 'h-8 w-8, no label' },
  { question: 'Destructive action', answer: 'Button destructive', detail: 'bg-destructive/10 text-destructive' },
]

export default function Components({ lang }: ComponentsProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('compNum', lang)}</p>
        <h2 className="section-title">{t('compTitle', lang)}</h2>
        <p className="section-lede">{t('compLede', lang)}</p>
      </div>

      <p className="subhead">UI Primitives</p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 2,
        marginBottom: 40,
      }}
      >
        {COMPONENTS.map(({ name, path, desc }) => (
          <div key={name} style={{
            padding: '12px 14px',
            background: 'var(--color-neutral-2)',
            borderRadius: 8,
          }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>{name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-5)' }}>{path}</span>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>{desc}</p>
          </div>
        ))}
      </div>

      <p className="subhead">Selection rules</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {SELECTION_RULES.map(({ question, answer, detail }) => (
          <div key={question} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '10px 0',
            borderBottom: '1px solid var(--color-border)',
          }}
          >
            <p style={{ margin: 0, flex: 1, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-neutral-7)' }}>{question}</p>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-accent)', background: 'var(--color-neutral-2)', padding: '2px 6px', borderRadius: 4 }}>{answer}</code>
            <p style={{ margin: 0, width: 220, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-5)' }}>{detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
