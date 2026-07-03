import type { FormEvent } from 'react'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Textarea } from '~/components/ui/textarea'

export function ChatGoalEditorDialog({
  open,
  objectiveDraft,
  busy,
  onObjectiveDraftChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  objectiveDraft: string
  busy: boolean
  onObjectiveDraftChange: (value: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit goal</DialogTitle>
            <DialogDescription>
              Update the active goal without sending a chat message.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={objectiveDraft}
            onChange={event => onObjectiveDraftChange(event.target.value)}
            disabled={busy}
            autoFocus
            rows={4}
            className="max-h-48 resize-none"
            aria-label="Goal objective"
          />
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || objectiveDraft.trim().length === 0}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
