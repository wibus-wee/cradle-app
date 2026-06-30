# Components Reference

Available UI components in Cradle. All components are in `apps/web/src/components/ui/`.

---

## UI Primitives

### Button

**Source**: `apps/web/src/components/ui/button.tsx`

```tsx
import { Button } from '@/components/ui/button'

<Button variant="default" size="default">Save</Button>
```

**Variants:**
| Variant | Class | Use |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | Primary CTA — one per screen |
| `outline` | `border-border bg-background hover:bg-muted` | Secondary actions |
| `secondary` | `bg-secondary` | Tertiary, non-critical actions |
| `ghost` | `hover:bg-muted` | Toolbar buttons, icon buttons |
| `destructive` | `bg-destructive/10 text-destructive` | Delete, remove, irreversible actions |
| `link` | — | In-text links, navigation actions |

**Sizes:**
| Size | Height | Use |
|---|---|---|
| `xs` | h-6 | Dense toolbars, inline controls |
| `sm` | h-7 | Compact lists, side panels |
| `default` | h-8 | Standard button size |
| `lg` | h-9 | Prominent CTAs, modal footers |
| `icon` | h-8 w-8 | Icon-only buttons |

---

### Input

**Source**: `apps/web/src/components/ui/input.tsx`

```tsx
import { Input } from '@/components/ui/input'

<Input placeholder="Search..." />
```

Height: `h-8`. Rounded: `rounded-lg`. Border: `border-input`. Padding: `px-2.5 py-1`.

Use for single-line text input. For multi-line, use `Textarea`.

---

### Textarea

**Source**: `apps/web/src/components/ui/textarea.tsx`

```tsx
import { Textarea } from '@/components/ui/textarea'

<Textarea placeholder="Write your message..." rows={4} />
```

Use for multi-line content. Auto-resize via `resize-none` when inside a flex container that manages height.

---

### Select

**Source**: `apps/web/src/components/ui/select.tsx`

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

<Select>
  <SelectTrigger>
    <SelectValue placeholder="Choose..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
  </SelectContent>
</Select>
```

---

### DropdownMenu

**Source**: `apps/web/src/components/ui/dropdown-menu.tsx`

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem>Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### ContextMenu

**Source**: `apps/web/src/components/ui/context-menu.tsx`

```tsx
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

<ContextMenu>
  <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem>Copy</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

Use for right-click menus on content elements.

---

### Checkbox

**Source**: `apps/web/src/components/ui/checkbox.tsx`

```tsx
import { Checkbox } from '@/components/ui/checkbox'

<Checkbox id="agree" />
<label htmlFor="agree">I agree</label>
```

---

### Toggle

**Source**: `apps/web/src/components/ui/toggle.tsx`

```tsx
import { Toggle } from '@/components/ui/toggle'

<Toggle>Bold</Toggle>
```

Use for binary state switches in toolbars and formatting controls.

---

### Separator

**Source**: `apps/web/src/components/ui/separator.tsx`

```tsx
import { Separator } from '@/components/ui/separator'

<Separator />
<Separator orientation="vertical" />
```

**When to use**: Only when spatial layout cannot convey separation. Prefer `gap-*` over separators in most cases.

---

### Table

**Source**: `apps/web/src/components/ui/table.tsx`

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
```

---

### Skeleton

**Source**: `apps/web/src/components/ui/skeleton.tsx`

```tsx
import { Skeleton } from '@/components/ui/skeleton'

<Skeleton className="h-4 w-48" />
```

Use for loading states where the final content shape is known.

---

### Spinner

**Source**: `apps/web/src/components/ui/spinner.tsx`

```tsx
import { Spinner } from '@/components/ui/spinner'

<Spinner />
```

Use for indeterminate loading states where content shape is unknown.

---

### Toast

**Source**: `apps/web/src/components/ui/toast.tsx`

System notifications. Use `useToast()` hook to trigger toasts.

```tsx
const { toast } = useToast()
toast({ title: 'Saved', description: 'Changes have been saved.' })
```

---

### Form / Fieldset

**Source**: `apps/web/src/components/ui/form.tsx`, `apps/web/src/components/ui/fieldset.tsx`

```tsx
import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form'
import { Fieldset } from '@/components/ui/fieldset'
```

Use `Fieldset` for grouping related form fields. Use `Form` + `FormField` for react-hook-form integration.

---

### Autocomplete

**Source**: `apps/web/src/components/ui/autocomplete.tsx`

Combobox-style input with suggestion dropdown.

---

### Carousel

**Source**: `apps/web/src/components/ui/carousel.tsx`

Horizontal scroll container with prev/next controls. Use for media galleries and multi-step flows.

---

### Collapsible

**Source**: `apps/web/src/components/ui/collapsible.tsx`

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
```

Animated expand/collapse. Uses spring physics internally.

---

### IconPicker

**Source**: `apps/web/src/components/ui/icon-picker.tsx`

Searchable icon selector popover.

---

### Frame

**Source**: `apps/web/src/components/ui/frame.tsx`

Sandboxed iframe wrapper. Use for embedded content previews.

---

## Selection Rules

### Modal vs Sheet vs Dialog

| Pattern | When to use |
|---|---|
| **Sheet** | Persistent side panel — settings, detail views, secondary contexts that coexist with main content |
| **Dialog / Modal** | Confirmations, alerts, focused single-task flows that require full attention |
| **Popover** | Lightweight contextual controls — filters, quick edits, color pickers |
| **DropdownMenu** | Action menus triggered by buttons |
| **ContextMenu** | Right-click action menus on content |

**Rule**: prefer Sheet for anything that might need to stay open while the user interacts with main content. Use Dialog only for blocking interactions (confirm delete, authentication, critical settings).

### Button variant selection

| Situation | Variant |
|---|---|
| One primary action per screen/panel | `default` |
| Second-level action alongside `default` | `outline` |
| Toolbar icon buttons | `ghost` + `size="icon"` |
| Destructive (delete, remove) | `destructive` |
| Inline text action | `link` |
| Non-critical grouped actions | `secondary` |

---

## Adding New Components

All new components must:

1. Accept `className` prop and merge with `cn()` from `@/lib/utils`
2. Use static Tailwind classes only — no dynamic class construction
3. Consume design tokens via Tailwind token classes, not raw hex
4. Be placed in `apps/web/src/components/ui/` if universally reusable, or `apps/web/src/features/{domain}/` if domain-specific
5. Export from the appropriate barrel file

```tsx
import { cn } from '@/lib/utils'

interface MyComponentProps {
  className?: string
}

export function MyComponent({ className }: MyComponentProps) {
  return (
    <div className={cn('text-sm text-[var(--color-neutral-9)]', className)}>
      Content
    </div>
  )
}
```
