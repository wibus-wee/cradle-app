import type { BeforeMount } from '@monaco-editor/react'
import Editor from '@monaco-editor/react'
import { useId } from 'react'

import type { JsonSchemaNode } from './codex-config-schema'

/**
 * Monaco editor for a single structured setting's JSON fragment. The fragment
 * is validated and autocompleted against the property's own subschema
 * (root `definitions` included, so internal `$ref`s resolve).
 */
export function CodexConfigFieldEditor({
  fieldKey,
  fragmentSchema,
  value,
  theme,
  disabled,
  onChange,
}: {
  fieldKey: string
  fragmentSchema: JsonSchemaNode
  value: string
  theme: 'vs' | 'vs-dark'
  disabled: boolean
  onChange: (value: string) => void
}) {
  const modelId = useId()
  const beforeMount: BeforeMount = (monaco) => {
    const defaults = monaco.languages.json.jsonDefaults
    const uri = `cradle://schemas/codex-field/${fieldKey}`
    defaults.setDiagnosticsOptions({
      ...defaults.diagnosticsOptions,
      validate: true,
      enableSchemaRequest: false,
      schemas: [
        ...(defaults.diagnosticsOptions.schemas ?? []).filter(schema => schema.uri !== uri),
        { uri, fileMatch: [`*codex-field-${fieldKey}.json`], schema: fragmentSchema },
      ],
    })
  }
  const lineCount = value.split('\n').length
  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg bg-card ring-1 ring-foreground/6"
      style={{ height: Math.min(360, Math.max(120, (lineCount + 2) * 19)) }}
    >
      <Editor
        height="100%"
        language="json"
        path={`inmemory://cradle/field/${encodeURIComponent(modelId)}/codex-field-${fieldKey}.json`}
        value={value}
        theme={theme}
        beforeMount={beforeMount}
        onChange={next => onChange(next ?? '')}
        options={{
          readOnly: disabled,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: 2,
          formatOnPaste: true,
          stickyScroll: { enabled: false },
        }}
      />
    </div>
  )
}
