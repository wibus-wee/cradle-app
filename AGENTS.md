# AGENTS

This file provides guidance to Agent when working with code in this repository.

## Principles

Please be clear: When designing features for Cradle, always consider ownership and namespace. Each feature should have a clear owner responsible for its semantics, configuration, lifecycle, compatibility, and migration. This ownership should be reflected in the namespace where the feature resides. The fundamental question to ask is: "Who owns this feature, who is it for, and with whom will it evolve?"

By adhering to this principle, we can ensure that features are well-organized, maintainable, and evolve in a way that serves their intended users effectively. This approach promotes clarity, accountability, and a better developer experience across the codebase.

We should keep the compatibility with other products, we can read data from others namespace,but we should never write data to others namespace, this is the basic principle of namespace ownership.

For example, if we want to use skills in agent, we can read skills data from (\~/.)/.agents/skills namespace, but we should never write skills data to skills namespace, we should write skills data to our Cradle namespace, and let agent own the lifecycle of skills data in agent context.

- 破坏性重构，不要做兼容性代码！务必要从大局的架构上思考问题，而不是局限于某个文件、某个模块、某个功能点的实现细节！如果你发现了一个问题，并且你认为这个问题的解决方案需要对现有代码进行破坏性的重构，那么请大胆地进行重构！不要担心兼容性问题，因为我们现在还没有发布任何版本，我们可以随时进行破坏性的重构！我们要追求的是一个干净、简洁、易于维护的代码库，而不是一个充斥着兼容性代码的代码库！所以，请务必从大局的架构上思考问题，勇敢地进行破坏性的重构！
- 如果能选择架构升级，就直接架构升级，不要犹豫！不要担心兼容性问题！我们现在还没有发布任何版本，我们可以随时进行架构升级！我们要追求的是一个干净、简洁、易于维护的代码库，而不是一个充斥着兼容性代码的代码库！所以，请务必从大局的架构上思考问题，勇敢地进行架构升级！
- 麻烦写前端的时候，不要给组件写 Test... 不要花无用的时间在这些无意义的事情上！不要莫名其妙就拿 Browser 来测，有很多东西只有我让你测了才需要测！不要为了测试而测试！我们要追求的是一个干净、简洁、易于维护的代码库，而不是一个充斥着无意义测试代码的代码库！所以，请务必从大局的架构上思考问题，勇敢地进行开发，不要被无意义的测试所束缚！
- 最高警告：请不要随意发明一个新的类型，新的投影。一切的一切，请从现有的可能能用到的库的 API 当中寻找，而不是考虑自创
- 请不要动不动就使用启发式方案，如果你觉得你想要使用启发式方案的话，立即停止下来跟我交流为什么你想这样使用
- 请你信任内部 TS 类型，不要动不动就对值做 unknown，直接注解为期望类型，而不是 unknown 后使用大量内联辅助函数解决类型安全问题
  - 同时，如果你发现改这里不行，必须要一直往上改才可以做到不内联的情况，请你立即反馈报告给我
- 请你不要动不动就改 DB Schema，也不要动不动就想着 DB Migration，即使 Migration 也请你谨慎。。不是什么都要扯到 DB 去的😅、
- 把这些全部都补齐，依照最佳实践，必要的时候允许重构以及分离文件，不要把所有东西锁在一个文件里面，默认项目里的代码质量参差不齐，你才是拥有最好代码组织能力的人

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