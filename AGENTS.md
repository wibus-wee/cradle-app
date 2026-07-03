# AGENTS

This file provides guidance to Agent when working with code in this repository.

## Principles

### Ownership & Namespace

Every feature must have a clear owner responsible for its semantics, configuration, lifecycle, and evolution. Ownership is reflected in namespace boundaries.

**Read across, write within.** You may read data from other namespaces (e.g., `~/.agents/skills`), but never write to them. Write only to your own namespace (e.g., Cradle's). Each namespace owner controls the full lifecycle of its data.

### Architecture First

- **Prefer breaking refactors over compatibility shims.** Some versions are published yet, but clean, well-structured code matters more than backward compatibility. If a fix requires a breaking change, make it.
- **Upgrade architecture without hesitation.** If a better approach exists, adopt it. Don't accumulate technical debt for the sake of incremental compatibility.

### Code Quality

- **Trust TypeScript types.** Annotate values with their expected types directly. Avoid `unknown` + inline type guards. If proper typing requires changes up the call chain, report it rather than working around it.
- **Don't invent new types or projections.** Exhaust existing library APIs and patterns before introducing new abstractions.
- **Don't casually modify DB schema.** Not every problem needs a database change. Schema migrations require careful consideration.
- **Separate concerns.** Don't lock everything in one file. Refactor and split when it improves clarity — assume existing code quality is uneven, and you are responsible for bringing it up to standard.
- **Discuss before using heuristics.** If you're considering a heuristic approach, stop and explain why before proceeding.

### Testing

Don't write component tests for the sake of coverage. Only test when explicitly requested or when the test exercises a critical path that can't be verified otherwise. Avoid browser-based testing unless specifically asked.

## Stacks

- **Frontend**: React, TypeScript, Tailwind CSS
- **State Management**: Zustand
- **Routing**: TanStack Router
- **Desktop App**: Electron
- **Documentation**: JSDoc, Markdown
- **Code Quality**: ESLint

## CRITICAL RULES

### 0. UI - Follow Design System Conventions

**All UI components MUST follow the design system conventions:** design-system

### 1. Styling - NO Dynamic Tailwind Classes

**All Tailwind classes MUST be statically defined. Never construct class names dynamically:**

```tsx
// ❌ WRONG - Dynamic class construction
// Won't work!

// ✅ CORRECT - Static classes with conditional logic
import { cn } from '@/lib/utils'  const size = 'large'
const className = `text-${size}`  // Won't work with Tailwind purging!

const color = 'blue'
const className = `bg-${color}-500`

const className = cn({
  'text-base': size === 'small',
  'text-lg': size === 'medium',
  'text-xl': size === 'large',
})

// ✅ CORRECT - Predefined class mappings
const sizeClasses = {
  small: 'text-base',
  medium: 'text-lg',
  large: 'text-xl',
}
const className = sizeClasses[size]
```

**Always use the** `cn()` **utility from** `@/lib/utils` **for combining classes:**

```tsx
import { cn } from '@/lib/utils'

function Button({ className, variant = 'primary', ...props }) {
  return (
    <button
      className={cn(
        // Base styles
        'px-4 py-2 rounded-md font-medium transition-colors',
        // Variant styles
        {
          'bg-primary text-white hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground': variant === 'secondary',
        },
        // External className override
        className
      )}
      {...props}
    />
  )
}
```

### 2. Frontend Component Organization - Domain-Based Structure

**Components are organized by reusability and domain:**

- `components/ui/` - Universal base UI components

  - Reusable primitives (buttons, inputs, modals)
  - Can be used in any React application
  - Pure UI components without business logic
  - Examples: `Button`, `Input`, `Select`, `Tooltip`

- `components/common/` - App-specific shared components

  - Used across multiple features but specific to this app
  - Contains app-specific logic
  - Examples: `ErrorElement`, `Footer`, `AppHeader`

- `features/{domain}/` - Feature-specific components

  - Components specific to a business domain/feature
  - Contains domain-specific logic or data handling
  - Examples: `features/feed/`, `features/auth/`, `features/user/`

**Placement rule**: If a component is specific to a business domain/feature, place it in the corresponding module directory.

### Creating a Styled Component with Variants

```tsx
import { cn } from '@/lib/utils'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        // Base styles
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'disabled:pointer-events-none disabled:opacity-50',

        // Size variants
        {
          'h-8 px-3 text-sm': size === 'sm',
          'h-10 px-4': size === 'md',
          'h-12 px-6 text-lg': size === 'lg',
        },

        // Color variants
        {
          'bg-primary text-white hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
          'border border-border bg-background hover:bg-fill': variant === 'outline',
        },

        className
      )}
      {...props}
    />
  )
}
```

### Enforcement

- **Always use Drizzle**: For database interactions, use Drizzle ORM to ensure type safety and consistency. Avoid raw SQL queries or other database libraries. Use drizzle-kit for schema management and migrations.
- **During code review**: Check for missing or outdated documentation