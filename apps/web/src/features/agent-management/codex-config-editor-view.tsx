import type { BeforeMount } from '@monaco-editor/react'
import Editor from '@monaco-editor/react'
import { useId } from 'react'

export function CodexConfigEditorView({
  value,
  schemaJson,
  theme,
  disabled,
  onChange,
}: {
  value: string
  schemaJson: string
  theme: 'vs' | 'vs-dark'
  disabled: boolean
  onChange: (value: string) => void
}) {
  const modelId = useId()
  const beforeMount: BeforeMount = (monaco) => {
    const defaults = monaco.languages.json.jsonDefaults
    const uri = 'cradle://schemas/codex-provider-config'
    defaults.setDiagnosticsOptions({
      ...defaults.diagnosticsOptions,
      validate: true,
      enableSchemaRequest: false,
      schemas: [
        ...(defaults.diagnosticsOptions.schemas ?? []).filter(schema => schema.uri !== uri),
        { uri, fileMatch: ['*codex-provider-config.json'], schema: JSON.parse(schemaJson) },
      ],
    })
  }
  return (
    <div className="h-80 min-w-0 overflow-hidden rounded-md border border-border">
      <Editor
        height="100%"
        language="json"
        path={`inmemory://cradle/${encodeURIComponent(modelId)}/codex-provider-config.json`}
        value={value}
        theme={theme}
        beforeMount={beforeMount}
        onChange={value => onChange(value ?? '')}
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
        }}
      />
    </div>
  )
}
