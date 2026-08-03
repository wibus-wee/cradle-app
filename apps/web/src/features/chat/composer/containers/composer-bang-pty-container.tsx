import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { toastManager } from '~/components/ui/toast'
import { ShellView } from '~/features/tui/shell-view'
import { getTerminalLifetimeController } from '~/features/tui/terminal-lifetime-controller'

import type { BangCommandResult } from '../../commands/chat-response-command'
import {
  bangPtyTranscriptHasOutput,
  COMPOSER_BANG_PTY_COMMAND_LABEL,
  COMPOSER_BANG_PTY_HEIGHT_PX,
  COMPOSER_BANG_PTY_MAX_TRANSCRIPT_CHARS,
  composerBangPtyId,
} from '../bang-pty'
import { ComposerBangPtyView } from '../views/composer-bang-pty-view'

export interface ComposerBangPtyActions {
  writeBack: () => void
  discard: () => void
}

export interface ComposerBangPtyContainerProps {
  sessionId: string
  workspacePath: string
  open: boolean
  onClose: () => void
  onPersisted: (result: BangCommandResult) => void
  persistTranscript: (input: {
    sessionId: string
    transcript: string
    command: string
    durationMs: number
    exitCode: number | null
  }) => Promise<BangCommandResult>
  actionsRef?: MutableRefObject<ComposerBangPtyActions | null>
}

/** Owns ShellView + discard confirm + write-back for Composer bang PTY mode. */
export function ComposerBangPtyContainer({
  sessionId,
  workspacePath,
  open,
  onClose,
  onPersisted,
  persistTranscript,
  actionsRef,
}: ComposerBangPtyContainerProps) {
  const ptyId = composerBangPtyId(sessionId)
  const startedAtRef = useRef(Date.now())
  const transcriptRef = useRef('')
  const [busy, setBusy] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [exited, setExited] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    startedAtRef.current = Date.now()
    transcriptRef.current = ''
    setExited(false)
    setBusy(false)
    setDiscardOpen(false)
  }, [open, sessionId])

  const stopPty = useCallback(async () => {
    await getTerminalLifetimeController().stop(ptyId).catch(() => undefined)
  }, [ptyId])

  const closeMode = useCallback(async () => {
    await stopPty()
    onClose()
  }, [onClose, stopPty])

  const handleDiscardRequest = useCallback(() => {
    if (busy) {
      return
    }
    if (bangPtyTranscriptHasOutput(transcriptRef.current)) {
      setDiscardOpen(true)
      return
    }
    void closeMode()
  }, [busy, closeMode])

  const handleSubmit = useCallback(async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const durationMs = Math.max(0, Date.now() - startedAtRef.current)
      const result = await persistTranscript({
        sessionId,
        transcript: transcriptRef.current,
        command: COMPOSER_BANG_PTY_COMMAND_LABEL,
        durationMs,
        exitCode: exited ? null : 0,
      })
      await stopPty()
      onPersisted(result)
      onClose()
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Failed to write shell transcript',
        description: error instanceof Error ? error.message : String(error),
      })
      setBusy(false)
    }
  }, [busy, exited, onClose, onPersisted, persistTranscript, sessionId, stopPty])

  useEffect(() => {
    if (!actionsRef) {
      return
    }
    actionsRef.current = {
      writeBack: () => {
        void handleSubmit()
      },
      discard: handleDiscardRequest,
    }
    return () => {
      actionsRef.current = null
    }
  }, [actionsRef, handleDiscardRequest, handleSubmit])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (discardOpen) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      handleDiscardRequest()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [discardOpen, handleDiscardRequest, open])

  if (!open) {
    return null
  }

  return (
    <>
      <ComposerBangPtyView
        busy={busy}
        onDiscard={handleDiscardRequest}
        onSubmit={() => {
          void handleSubmit()
        }}
        className="h-full"
        terminal={(
          <div style={{ height: COMPOSER_BANG_PTY_HEIGHT_PX }} className="min-h-0">
            <ShellView
              ptyId={ptyId}
              cwd={workspacePath}
              visible
              className="bg-zinc-950"
              maxTranscriptChars={COMPOSER_BANG_PTY_MAX_TRANSCRIPT_CHARS}
              onTranscriptChange={(transcript) => {
                transcriptRef.current = transcript
              }}
              onExited={() => {
                setExited(true)
              }}
            />
          </div>
        )}
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent data-testid="composer-bang-pty-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this shell session?</AlertDialogTitle>
            <AlertDialogDescription>
              Terminal output will not be written back to the chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                setDiscardOpen(false)
                void closeMode()
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
