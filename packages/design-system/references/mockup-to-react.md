# Mockup to React Handoff

Translation guide for converting HTML mockups into Cradle React components.

---

## General Rules

1. **Structure first** — establish layout (flex, grid, gap) before applying design tokens
2. **No new tokens during handoff** — only use tokens declared in `src/tokens.css`
3. **Static classes only** — never construct class names dynamically
4. **Spring physics for interactions** — replace CSS transitions with Framer Motion spring
5. **Semantic HTML** — preserve the semantic elements from the mockup (button, nav, main, aside)

---

## Element Mapping Table

| HTML mockup pattern | React component | Notes |
|---|---|---|
| `<button class="btn-primary">` | `<Button variant="default">` | One per screen |
| `<button class="btn-secondary">` | `<Button variant="outline">` | Secondary CTA |
| `<button class="btn-ghost">` | `<Button variant="ghost">` | Toolbars |
| `<button class="btn-destructive">` | `<Button variant="destructive">` | Delete actions |
| `<a class="link">` | `<Button variant="link" asChild><a>` | In-text links |
| `<input type="text">` | `<Input>` | Single-line text |
| `<input type="search">` | `<Input type="search">` | — |
| `<textarea>` | `<Textarea>` | Multi-line text |
| `<select>` | `<Select>` + children | Radix-based |
| `<dialog>` | `<Dialog>` | Blocking modal |
| Side panel (right/left) | `<Sheet>` | Persistent overlay |
| Dropdown (`<ul>`) | `<DropdownMenu>` | Button-triggered |
| Right-click menu | `<ContextMenu>` | Content-triggered |
| `<label>` + `<input>` pair | `<FormField>` + `<FormLabel>` + `<FormControl>` | react-hook-form |
| Grouped form section | `<Fieldset>` | Multiple related fields |
| `<input type="checkbox">` | `<Checkbox>` | Radix checkbox |
| Loading shimmer | `<Skeleton className="h-N w-N">` | Known shape |
| Loading spinner | `<Spinner>` | Unknown shape |
| Inline toggle button | `<Toggle>` | Binary state |
| Expand/collapse section | `<Collapsible>` | Animated |
| `<hr>` | `<Separator>` | Sparingly |
| Icon + label button | `<Button size="icon">` + label or tooltip | Toolbar pattern |
| Toast/notification | `useToast()` hook | Programmatic |

---

## CSS → Tailwind Token Mapping

| Mockup CSS | Tailwind equivalent | Notes |
|---|---|---|
| `color: #262626` | `text-[var(--color-neutral-9)]` | Primary text |
| `color: #737373` | `text-[var(--color-neutral-6)]` | Secondary text |
| `color: #595959` | `text-[var(--color-neutral-7)]` | Tertiary text |
| `background: #ffffff` | `bg-[var(--color-neutral-1)]` | Content bg |
| `background: #f5f5f5` | `bg-[var(--color-neutral-2)]` | Chrome bg |
| `background: #ebebeb` | `bg-[var(--color-neutral-3)]` | Hover fill |
| `border: 1px solid rgba(0,0,0,0.08)` | `border border-black/8` | Standard border |
| `font-family: 'Geist Variable'` | `font-sans` | Via CSS var |
| `font-family: 'Geist Mono'` | `font-mono` | Via CSS var |
| `font-size: 14px` | `text-sm` | Body lg |
| `font-size: 13px` | `text-[13px]` | Body md (no Tailwind step) |
| `font-size: 12px` | `text-xs` | Body sm |
| `font-size: 11px` | `text-[11px]` | Caption / code-sm |
| `border-radius: 8px` | `rounded-lg` | Buttons, inputs |
| `border-radius: 10px` | `rounded-xl` | Cards, panels |
| `border-radius: 12px` | `rounded-2xl` | Modals, popovers |
| `gap: 4px` | `gap-1` | xs spacing |
| `gap: 8px` | `gap-2` | sm spacing |
| `gap: 16px` | `gap-4` | md spacing |
| `padding: 24px` | `p-6` | lg spacing |

---

## Handoff Steps

### Step 1: Inventory interactive elements

Scan the mockup for:
- All buttons → map to `<Button variant="X">`
- All inputs → `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`
- All overlays → `<Dialog>`, `<Sheet>`, `<Popover>`
- All menus → `<DropdownMenu>`, `<ContextMenu>`

### Step 2: Replace static colors

Scan for hardcoded colors in `style=""` or class names:
- Replace hex values with `var(--color-*)` expressions
- Replace Tailwind built-in neutrals (`neutral-100`, `neutral-500`) with `[var(--color-neutral-N)]`
- Replace `bg-white` with `bg-[var(--color-neutral-1)]`

### Step 3: Replace font declarations

- `font-family: 'Geist Variable'` → `className="font-sans"` or `style={{ fontFamily: 'var(--font-sans)' }}`
- `font-family: 'Geist Mono'` → `className="font-mono"`
- Remove letter-spacing from body text
- Remove `uppercase` + `tracking-wide` from section headers

### Step 4: Replace transitions with spring

```tsx
// Before (CSS transition)
<div className="transition-all duration-300 ease-in-out">

// After (Framer Motion spring)
import { motion } from 'framer-motion'
const spring = { type: 'spring', stiffness: 600, damping: 40 }
<motion.div transition={spring} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
```

### Step 5: Replace shadows

- Remove `shadow-md`, `shadow-lg` from cards/panels
- For surface texture: use `box-shadow: inset 0 1px 0 rgba(255,255,255,0.05)` or Tailwind `shadow-xs`
- For focus rings: use `ring-1 ring-[var(--color-accent)]/30`

### Step 6: Validate

```bash
pnpm check   # token drift + template lint
```

---

## Common Patterns

### Category badge

```tsx
// Mockup: <span class="badge workspace">Workspace</span>
// React:
<span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600">
  Workspace
</span>
```

### Sidebar item with active state

```tsx
// Mockup: <a class="nav-item active">Item</a>
// React:
<button
  className={cn(
    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
    isActive
      ? 'bg-[var(--color-neutral-3)] text-[var(--color-neutral-9)]'
      : 'text-[var(--color-neutral-7)] hover:bg-[var(--color-neutral-3)] hover:text-[var(--color-neutral-9)]',
  )}
>
  <Icon className="h-4 w-4 shrink-0" />
  <span className="truncate">{label}</span>
</button>
```

### Form row

```tsx
// Mockup: <label>Name</label><input>
// React:
<FormField control={form.control} name="name" render={({ field }) => (
  <FormItem>
    <FormLabel>Name</FormLabel>
    <FormControl>
      <Input placeholder="Enter name..." {...field} />
    </FormControl>
    <FormMessage />
  </FormItem>
)} />
```

### Panel with enter animation

```tsx
// Mockup: <div class="panel slide-in">
// React:
import { motion } from 'framer-motion'

<motion.div
  initial={{ opacity: 0, x: 20, filter: 'blur(4px)' }}
  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
  transition={{ type: 'spring', stiffness: 600, damping: 40 }}
  className="rounded-xl bg-[var(--color-neutral-1)] p-4"
>
  Panel content
</motion.div>
```
