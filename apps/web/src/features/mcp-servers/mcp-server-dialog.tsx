import { Link3Line as HttpIcon, TerminalBoxLine as TerminalIcon } from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GetMcpServersResponse } from '~/api-gen/types.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import type { McpServerSaveBody, McpServerTransport } from './mcp-server-form'
import { parseArguments, parseSecretValues } from './mcp-server-form'

type McpServer = GetMcpServersResponse[number]

interface McpServerDialogProps {
  open: boolean
  server: McpServer | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (body: McpServerSaveBody) => Promise<void>
}

export function McpServerDialog({ open, server, saving, onOpenChange, onSave }: McpServerDialogProps) {
  const { t } = useTranslation('settings')
  const [transport, setTransport] = useState<McpServerTransport>(server?.transport ?? 'stdio')
  const [name, setName] = useState(server?.name ?? '')
  const [command, setCommand] = useState(server?.command ?? '')
  const [args, setArgs] = useState(server?.args?.join('\n') ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [enabled, setEnabled] = useState(server?.enabled ?? true)
  const [replaceSecrets, setReplaceSecrets] = useState(!server)
  const [secretText, setSecretText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const trimmedName = name.trim()
    if (!/^[\dA-Z][\w.-]*$/i.test(trimmedName)) {
      setError(t('mcpServers.form.error.name'))
      return
    }
    if (transport === 'stdio' && !command.trim()) {
      setError(t('mcpServers.form.error.command'))
      return
    }
    if (transport === 'streamable-http') {
      if (!URL.canParse(url)) {
        setError(t('mcpServers.form.error.url'))
        return
      }
    }

    let secretValues: Record<string, string> | undefined
    if (replaceSecrets) {
      try {
        secretValues = parseSecretValues(secretText)
      }
      catch {
        setError(t('mcpServers.form.error.secretLine'))
        return
      }
    }

    const body: McpServerSaveBody = transport === 'stdio'
      ? {
          transport,
          name: trimmedName,
          enabled,
          command: command.trim(),
          args: parseArguments(args),
          ...(secretValues === undefined ? {} : { secretValues }),
        }
      : {
          transport,
          name: trimmedName,
          enabled,
          url: url.trim(),
          ...(secretValues === undefined ? {} : { secretValues }),
        }
    await onSave(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? t('mcpServers.dialog.edit') : t('mcpServers.dialog.create')}</DialogTitle>
          <DialogDescription>{t('mcpServers.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-2">
            <Label>{t('mcpServers.form.transport')}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={transport}
              onValueChange={(value) => {
                if (value === 'stdio' || value === 'streamable-http') { setTransport(value) }
              }}
              className="w-full"
            >
              <ToggleGroupItem value="stdio" className="flex-1 gap-1.5">
                <TerminalIcon />
                {t('mcpServers.transport.stdio')}
              </ToggleGroupItem>
              <ToggleGroupItem value="streamable-http" className="flex-1 gap-1.5">
                <HttpIcon />
                {t('mcpServers.transport.http')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-server-name">{t('mcpServers.form.name')}</Label>
            <Input
              id="mcp-server-name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder={t('mcpServers.form.namePlaceholder')}
              autoComplete="off"
            />
          </div>

          {transport === 'stdio'
            ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="mcp-server-command">{t('mcpServers.form.command')}</Label>
                    <Input
                      id="mcp-server-command"
                      value={command}
                      onChange={event => setCommand(event.target.value)}
                      placeholder={t('mcpServers.form.commandPlaceholder')}
                      className="font-mono"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="mcp-server-args">{t('mcpServers.form.arguments')}</Label>
                    <Textarea
                      id="mcp-server-args"
                      value={args}
                      onChange={event => setArgs(event.target.value)}
                      placeholder={t('mcpServers.form.argumentsPlaceholder')}
                      className="min-h-20 resize-y font-mono text-xs"
                    />
                  </div>
                </>
              )
            : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="mcp-server-url">{t('mcpServers.form.url')}</Label>
                  <Input
                    id="mcp-server-url"
                    value={url}
                    onChange={event => setUrl(event.target.value)}
                    placeholder="https://mcp.example.com/mcp"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              )}

          {server && server.secretKeys.length > 0 && !replaceSecrets && (
            <div className="flex flex-wrap gap-1.5">
              {server.secretKeys.map(key => <Badge key={key} variant="outline" className="font-mono">{key}</Badge>)}
            </div>
          )}

          {server && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="mcp-server-replace-secrets">{t('mcpServers.form.replaceSecrets')}</Label>
              <Switch
                id="mcp-server-replace-secrets"
                checked={replaceSecrets}
                onCheckedChange={setReplaceSecrets}
              />
            </div>
          )}

          {replaceSecrets && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-secrets">
                {transport === 'stdio' ? t('mcpServers.form.environment') : t('mcpServers.form.headers')}
              </Label>
              <Textarea
                id="mcp-server-secrets"
                value={secretText}
                onChange={event => setSecretText(event.target.value)}
                placeholder={transport === 'stdio' ? 'TOKEN=value' : 'Authorization=Bearer value'}
                className="min-h-20 resize-y font-mono text-xs"
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="mcp-server-enabled">{t('mcpServers.form.enabled')}</Label>
            <Switch id="mcp-server-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('mcpServers.action.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t('mcpServers.action.saving') : t('mcpServers.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
