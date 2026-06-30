# Anti-Patterns

What NOT to do in Cradle's design system. Each pattern includes: wrong code → right code → why it matters.

---

## Color Anti-Patterns

### 1. Using Tailwind built-in neutrals instead of `neutral-1..10`

**Wrong:**
```tsx
// ❌ Tailwind's built-in scale — not the same as Cradle's semantic tiers
<p className="text-neutral-500">Secondary info</p>
<div className="bg-neutral-100">Card surface</div>
<div className="border-neutral-200">Divider</div>
```

**Right:**
```tsx
// ✅ Cradle semantic tiers — meaningful and dark-mode aware
<p className="text-[var(--color-neutral-6)]">Secondary info</p>
<div className="bg-[var(--color-neutral-2)]">Card surface</div>
<div className="border-black/8">Divider</div>
```

**Why it matters**: Tailwind's `neutral-500` is not `#737373`. Using built-in neutrals creates visual drift that accumulates across components. More importantly, they don't invert in dark mode the way Cradle's tokens do.

---

### 2. Raw hex in component styles instead of CSS vars

**Wrong:**
```tsx
// ❌ Hardcoded hex breaks dark mode and token synchronization
<div style={{ backgroundColor: '#f5f5f5', color: '#262626' }}>
  Content
</div>
```

**Right:**
```tsx
// ✅ Token vars adapt to light/dark and stay in sync with tokens.css
<div style={{
  backgroundColor: 'var(--color-neutral-2)',
  color: 'var(--color-neutral-9)'
}}>
  Content
</div>
```

**Why it matters**: Raw hex bypasses the token system entirely. A single token update in `tokens.css` now requires searching the entire codebase for matching hex values — and you'll always miss some.

---

### 3. Opacity modifiers on top of text tokens

**Wrong:**
```tsx
// ❌ Double opacity — creates inconsistent, unpredictable contrast
<p className="text-[var(--color-neutral-9)]/70">Body copy</p>
<span className="text-neutral-9 opacity-60">Label</span>
```

**Right:**
```tsx
// ✅ Use the pre-resolved tier that matches the contrast you need
<p className="text-[var(--color-neutral-9)]">Primary body copy</p>
<span className="text-[var(--color-neutral-6)]">Secondary label</span>
```

**Why it matters**: The 4 text tiers (neutral-6, 7, 8, 9) are designed with pre-calculated WCAG contrast ratios. Adding `/70` creates a fifth ad-hoc tier with an unverified contrast ratio. In dark mode, the result is doubly unpredictable.

---

### 4. Using accent colors decoratively

**Wrong:**
```tsx
// ❌ Accent as decoration — no semantic meaning
<div className="border-blue-500 rounded-lg">
  Non-workspace content with blue border "for style"
</div>
<h2 className="text-[var(--color-accent)]">Generic heading</h2>
```

**Right:**
```tsx
// ✅ Accent only when the content maps to the semantic category
<div className="bg-blue-500/10 text-blue-600 rounded-full px-2 py-0.5 text-xs">
  Workspace
</div>
<h2 className="text-[var(--color-neutral-9)]">Generic heading</h2>
```

**Why it matters**: Cradle's accent system is semantic — each color means something specific (workspace, agent, session, etc.). Decorative accent usage dilutes these meanings, making it harder to scan content at a glance.

---

### 5. Using `bg-neutral-50` / `bg-white` / `bg-gray-*` instead of neutral-1..10

**Wrong:**
```tsx
// ❌ Tailwind utility classes that bypass the semantic tier system
<div className="bg-white">Page background</div>
<div className="bg-gray-50">Chrome surface</div>
<p className="text-gray-600">Secondary text</p>
```

**Right:**
```tsx
// ✅ Semantic tiers
<div className="bg-[var(--color-neutral-1)]">Page background</div>
<div className="bg-[var(--color-neutral-2)]">Chrome surface</div>
<p className="text-[var(--color-neutral-6)]">Secondary text</p>
```

**Why it matters**: `bg-white` doesn't adapt to dark mode. `bg-gray-50` maps to `#f9fafb`, which is lighter than Cradle's neutral-2 (`#f5f5f5`) — a subtle but real drift from the intended color system.

---

## Typography Anti-Patterns

### 6. Hardcoding font-family

**Wrong:**
```tsx
// ❌ Hardcoded font-family bypasses the token system
<p style={{ fontFamily: "'Geist Variable', sans-serif" }}>Text</p>
<code style={{ fontFamily: "'Geist Mono', monospace" }}>Code</code>
```

**Right:**
```tsx
// ✅ Use the font token — class-based or CSS var
<p className="font-sans">Text</p>
<code className="font-mono">Code</code>

// Or in inline styles when needed:
<p style={{ fontFamily: 'var(--font-sans)' }}>Text</p>
```

**Why it matters**: If the font family changes (or a different fallback is needed on a specific platform), the token allows updating everywhere from one place. Hardcoded values require a codebase-wide search.

---

### 7. Uppercase tracking labels

**Wrong:**
```tsx
// ❌ Uppercase + letter-spacing for section headers
<h3 className="uppercase tracking-wider font-semibold text-xs text-neutral-500">
  Section Title
</h3>
```

**Right:**
```tsx
// ✅ Sentence case, no letter-spacing manipulation
<h3 className="text-sm font-medium text-[var(--color-neutral-7)]">
  Section title
</h3>
```

**Why it matters**: Uppercase tracking labels are a dated design pattern that reads as "trying too hard." Cradle's aesthetic follows Linear/Vercel — minimal, confident typography that doesn't need decoration.

---

### 8. Letter-spacing on body text

**Wrong:**
```tsx
// ❌ Artificial letter-spacing on readable text
<p className="tracking-wide leading-relaxed">
  Body copy that's artificially spaced out.
</p>
```

**Right:**
```tsx
// ✅ Default letter-spacing, appropriate line-height
<p className="leading-relaxed">Body copy that reads naturally.</p>
```

**Why it matters**: Geist Variable is optically tuned for its default letter-spacing. Artificial tracking disrupts its intended rhythm.

---

## Layout Anti-Patterns

### 9. Using `shadow-md` / `shadow-lg` for depth

**Wrong:**
```tsx
// ❌ Elevation shadow — makes components look like they're floating
<div className="rounded-xl shadow-lg bg-white p-4">
  A card that levitates
</div>
```

**Right:**
```tsx
// ✅ Surface texture via inset-shadow — physical, not elevated
<div
  className="rounded-xl bg-[var(--color-neutral-1)] p-4"
  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 0 0 1px rgba(0,0,0,0.06)' }}
>
  A card with texture
</div>
```

**Why it matters**: Elevation shadows signal "this is floating above the surface." Cradle is a desktop app, not a web page. Components should feel embedded in the UI, not floating over it.

---

### 10. Gradient backgrounds

**Wrong:**
```tsx
// ❌ Gradient background — banned in Cradle
<div className="bg-gradient-to-r from-blue-500 to-purple-600">
  Hero section
</div>
<div className="bg-gradient-to-b from-neutral-1 to-neutral-3">
  Subtle fade
</div>
```

**Right:**
```tsx
// ✅ Flat surface, definition via inset-shadow or border
<div className="bg-[var(--color-neutral-9)] text-[var(--color-neutral-1)]">
  Hero section
</div>
```

**Why it matters**: Gradients are decorative and age quickly. Cradle's design ages like a tool, not like a trend. The two-tone chrome architecture provides sufficient visual hierarchy without gradients.

---

## Animation Anti-Patterns

### 11. CSS transitions instead of spring physics for interactive elements

**Wrong:**
```tsx
// ❌ Linear or ease-in-out transition — mechanical feel
<div className="transition-all ease-in-out duration-300">
  Panel that slides open
</div>
<div className="transition-opacity duration-200">
  Fading element
</div>
```

**Right:**
```tsx
// ✅ Spring physics — natural, physical feel
import { motion } from 'framer-motion'

const spring = { type: 'spring', stiffness: 600, damping: 40 }

<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={spring}
>
  Panel that enters naturally
</motion.div>
```

**Why it matters**: Linear and ease-in-out transitions feel like CSS animations — they reveal the seams. Spring physics approximates physical motion — the user's brain reads it as "real" rather than "animated."

---

## Process Anti-Patterns

### 12. Skipping CHEATSHEET.md before building

**Wrong:**
```
(start building a new component immediately)
- Pick colors from memory
- Use whatever box-shadow looks good
- Add some letter-spacing to make headers look "polished"
```

**Right:**
```
1. Read CHEATSHEET.md (2 minutes)
2. Identify the nearest token for each design decision
3. Build
4. Run pnpm check before shipping
```

**Why it matters**: Token drift compounds. One "close enough" hex becomes a precedent. Three components later, the visual language is fractured. CHEATSHEET.md takes 2 minutes to read and prevents hours of cleanup.

---

### 13. Adding new accent colors without semantic mapping

**Wrong:**
```tsx
// ❌ Adding a "pretty color" with no semantic meaning
const tagColors = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  teal: '#14b8a6',  // ← new addition with no category
}
```

**Right:**
```tsx
// ✅ Map to existing semantic category, or define one explicitly
// If "teal" means a new content category, document it:
// --color-accent-X: #14b8a6; → what does X mean?

// If it doesn't map to a category, use the closest existing accent
// and document why in a code comment.
```

**Why it matters**: Cradle's accent palette is a closed semantic system. Expanding it without a semantic justification creates decorative colors that behave like accent colors — breaking scanability for users who've learned what each color means.
