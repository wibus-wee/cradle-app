// "What's New" dialog shown after a desktop update (i18n-aware).
import { StaticRender } from '@cradle/streamdown'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

function resolveTitle(title: Record<string, string> | string | undefined): string {
  if (!title) { return 'What\'s New' }
  if (typeof title === 'string') { return title }
  const lang = document.documentElement.lang || navigator.language || 'zh'
  const short = lang.split('-')[0].toLowerCase()
  return title[short] || title.zh || title.en || Object.values(title)[0] || 'What\'s New'
}

interface WhatsNewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  date?: string
  title?: Record<string, string> | string
  markdown: string
}

export function WhatsNewDialog({
  open,
  onOpenChange,
  version,
  date,
  title,
  markdown,
}: WhatsNewDialogProps) {
  // Strip the leading frontmatter if present (should already be stripped by fetch)
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {resolveTitle(title)}
          </DialogTitle>
          <DialogDescription>
            {version}
            {date && ` · ${date}`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto text-sm [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-medium [&_h3]:text-foreground [&_p]:my-1.5 [&_p]:text-muted-foreground [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li]:text-muted-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:font-mono">
          <StaticRender content={body} />
        </div>

        <DialogFooter variant="bare">
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Got it!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
