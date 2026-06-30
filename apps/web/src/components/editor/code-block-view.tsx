import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { useState } from 'react'
import type { IconType } from 'react-icons'
import { FaCode, FaFileCode } from 'react-icons/fa'
import {
  SiC,
  SiCplusplus,
  SiCss,
  SiDocker,
  SiGnubash,
  SiGo,
  SiGraphql,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiLua,
  SiMarkdown,
  SiOpenjdk,
  SiPhp,
  SiPostgresql,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSass,
  SiSwift,
  SiToml,
  SiTypescript,
  SiYaml,
  SiZig,
} from 'react-icons/si'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '~/components/ui/combobox'
import { cn } from '~/lib/cn'

import { loadLanguage } from './shiki-highlighter'

interface LanguageOption {
  value: string
  label: string
  Icon: IconType
  colorClassName: string
}

const AUTO_LANGUAGE: LanguageOption = {
  value: '',
  label: 'Auto',
  Icon: FaCode,
  colorClassName: 'text-muted-foreground',
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'bash', label: 'Bash', Icon: SiGnubash, colorClassName: 'text-emerald-500' },
  { value: 'c', label: 'C', Icon: SiC, colorClassName: 'text-sky-500' },
  { value: 'cpp', label: 'C++', Icon: SiCplusplus, colorClassName: 'text-blue-500' },
  { value: 'css', label: 'CSS', Icon: SiCss, colorClassName: 'text-cyan-500' },
  { value: 'dockerfile', label: 'Dockerfile', Icon: SiDocker, colorClassName: 'text-sky-500' },
  { value: 'go', label: 'Go', Icon: SiGo, colorClassName: 'text-cyan-500' },
  { value: 'graphql', label: 'GraphQL', Icon: SiGraphql, colorClassName: 'text-pink-500' },
  { value: 'html', label: 'HTML', Icon: SiHtml5, colorClassName: 'text-orange-500' },
  { value: 'java', label: 'Java', Icon: SiOpenjdk, colorClassName: 'text-red-500' },
  { value: 'javascript', label: 'JavaScript', Icon: SiJavascript, colorClassName: 'text-yellow-500' },
  { value: 'json', label: 'JSON', Icon: SiJson, colorClassName: 'text-lime-500' },
  { value: 'jsx', label: 'JSX', Icon: SiReact, colorClassName: 'text-sky-500' },
  { value: 'kotlin', label: 'Kotlin', Icon: SiKotlin, colorClassName: 'text-violet-500' },
  { value: 'lua', label: 'Lua', Icon: SiLua, colorClassName: 'text-indigo-500' },
  { value: 'markdown', label: 'Markdown', Icon: SiMarkdown, colorClassName: 'text-zinc-500' },
  { value: 'php', label: 'PHP', Icon: SiPhp, colorClassName: 'text-indigo-500' },
  { value: 'plaintext', label: 'Plain text', Icon: FaFileCode, colorClassName: 'text-muted-foreground' },
  { value: 'python', label: 'Python', Icon: SiPython, colorClassName: 'text-blue-500' },
  { value: 'ruby', label: 'Ruby', Icon: SiRuby, colorClassName: 'text-red-500' },
  { value: 'rust', label: 'Rust', Icon: SiRust, colorClassName: 'text-orange-500' },
  { value: 'scss', label: 'SCSS', Icon: SiSass, colorClassName: 'text-pink-500' },
  { value: 'shell', label: 'Shell', Icon: SiGnubash, colorClassName: 'text-emerald-500' },
  { value: 'sql', label: 'SQL', Icon: SiPostgresql, colorClassName: 'text-blue-500' },
  { value: 'swift', label: 'Swift', Icon: SiSwift, colorClassName: 'text-orange-500' },
  { value: 'toml', label: 'TOML', Icon: SiToml, colorClassName: 'text-stone-500' },
  { value: 'tsx', label: 'TSX', Icon: SiReact, colorClassName: 'text-sky-500' },
  { value: 'typescript', label: 'TypeScript', Icon: SiTypescript, colorClassName: 'text-blue-500' },
  { value: 'yaml', label: 'YAML', Icon: SiYaml, colorClassName: 'text-rose-500' },
  { value: 'zig', label: 'Zig', Icon: SiZig, colorClassName: 'text-amber-500' },
]
const ALL_LANGUAGE_OPTIONS = [AUTO_LANGUAGE, ...LANGUAGE_OPTIONS]

// Lazy-loads a language when the user picks it from the code block menu.
async function lazyLoadLang(lang: string): Promise<void> {
  if (!lang) {
    return
  }
  await loadLanguage(lang)
}

function getLanguageOption(value: string): LanguageOption {
  return ALL_LANGUAGE_OPTIONS.find(option => option.value === value) ?? {
    value,
    label: value || AUTO_LANGUAGE.label,
    Icon: FaFileCode,
    colorClassName: 'text-muted-foreground',
  }
}

function LanguageIcon({ option }: { option: LanguageOption }) {
  const Icon = option.Icon

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center',
        option.colorClassName,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  )
}

export function CodeBlockView({ node, updateAttributes }: {
  node: ProseMirrorNode
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const language = (node.attrs.language as string) || ''
  const selected = getLanguageOption(language)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filteredOptions = (() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return ALL_LANGUAGE_OPTIONS
    }
    return ALL_LANGUAGE_OPTIONS.filter(option =>
      option.label.toLowerCase().includes(normalizedQuery)
      || option.value.toLowerCase().includes(normalizedQuery))
  })()

  function setPickerOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }

  function selectLanguage(value: string) {
    updateAttributes({ language: value })
    void lazyLoadLang(value)
    setOpen(false)
    setQuery('')
  }

  return (
    <NodeViewWrapper className="relative group">
      <div contentEditable={false} className="absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Combobox
          open={open}
          value={language}
          inputValue={query}
          onOpenChange={setPickerOpen}
          onInputValueChange={setQuery}
          onValueChange={value => selectLanguage(value ?? '')}
          modal={false}
          autoHighlight
        >
          <ComboboxTrigger
            aria-label="Select code language"
            className="inline-flex h-7 min-w-28 items-center gap-1.5 rounded-md bg-background/90 px-2 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border/70 backdrop-blur-xs transition-[background-color,color,scale] hover:bg-background hover:text-foreground active:scale-[0.96] data-[popup-open]:bg-background data-[popup-open]:text-foreground [&>svg]:ml-auto [&>svg]:size-3"
          >
            <LanguageIcon option={selected} />
            <span className="max-w-18 flex-1 truncate text-left">{selected.label}</span>
          </ComboboxTrigger>
          <ComboboxContent
            align="end"
            sideOffset={6}
            className="w-56 min-w-56 p-1.5"
          >
            <ComboboxInput
              autoFocus
              placeholder="Search language..."
              size="sm"
              showTrigger={false}
              startAddon={<LanguageIcon option={selected} />}
              className="mb-1 w-full"
            />
            <ComboboxList className="max-h-64 p-0.5">
              {filteredOptions.map(option => (
                <ComboboxItem
                  key={option.value || 'auto'}
                  value={option.value}
                  className={cn(
                    'h-8 cursor-default px-1.5 pr-8 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-highlighted:bg-accent data-highlighted:text-foreground',
                    option.value === language && 'bg-accent/70 text-foreground',
                  )}
                >
                  <LanguageIcon option={option} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </ComboboxItem>
              ))}
              {filteredOptions.length === 0 && (
                <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                  No languages found
                </div>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      <pre className="bg-muted! rounded-lg! border! border-border! p-4! pr-24! text-[13px]! leading-relaxed! font-mono!" style={{
          // @ts-expect-error -- Custom CSS properties for syntax highlighting colors
          '--tw-prose-pre-code': 'var(--text-text)',
        }}
      >
        <NodeViewContent as="div" className="whitespace-pre" />
      </pre>
    </NodeViewWrapper>
  )
}
