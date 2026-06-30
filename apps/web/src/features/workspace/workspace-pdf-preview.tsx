import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useEffect, useRef, useState } from 'react'

import { Spinner } from '~/components/ui/spinner'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface WorkspacePdfPreviewProps {
  url: string
  title: string
}

export function WorkspacePdfPreview({ url, title }: WorkspacePdfPreviewProps) {
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loadedPdf: PDFDocumentProxy | null = null
    setDocumentProxy(null)
    setErrorText(null)

    async function loadPdf() {
      const response = await fetch(url)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(readServerErrorMessage(text) ?? `PDF preview failed with status ${response.status}.`)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const task = getDocument({ data: bytes })
      const pdf = await task.promise
      loadedPdf = pdf
      if (!cancelled) {
        setDocumentProxy(pdf)
      }
      else {
        await pdf.destroy()
      }
    }

    loadPdf().catch((error) => {
      if (!cancelled) {
        setErrorText(error instanceof Error ? error.message : String(error))
      }
    })

    return () => {
      cancelled = true
      void loadedPdf?.destroy()
    }
  }, [url])

  if (errorText) {
    return (
      <div className="flex h-40 items-center justify-center px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{errorText}</p>
      </div>
    )
  }

  if (!documentProxy) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="size-4 !text-muted-foreground/50" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="flex min-h-full justify-center bg-fill/30 px-4 py-5">
      <div className="flex w-full max-w-5xl flex-col gap-5">
        {Array.from({ length: documentProxy.numPages }, (_, index) => (
          <PdfPageCanvas
            key={`${title}:${index + 1}`}
            documentProxy={documentProxy}
            pageNumber={index + 1}
          />
        ))}
      </div>
    </div>
  )
}

function PdfPageCanvas({ documentProxy, pageNumber }: { documentProxy: PDFDocumentProxy, pageNumber: number }) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [frameWidth, setFrameWidth] = useState(800)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setFrameWidth(entry.contentRect.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void, promise: Promise<unknown> } | null = null

    async function renderPage() {
      const page = await documentProxy.getPage(pageNumber)
      if (cancelled) {
        return
      }
      const baseViewport = page.getViewport({ scale: 1 })
      const cssScale = Math.min(Math.max((frameWidth - 16) / baseViewport.width, 0.35), 2)
      const outputScale = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: cssScale })
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) {
        return
      }

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })
      await renderTask.promise
    }

    renderPage().catch((error) => {
      if (!cancelled && error instanceof Error && error.name !== 'RenderingCancelledException') {
        // Rendering errors are visible through the missing page canvas; avoid crashing the whole preview.
        console.error(error)
      }
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [documentProxy, frameWidth, pageNumber])

  return (
    <div ref={frameRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        aria-label={`Page ${pageNumber}`}
        className="max-w-full rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_12px_32px_rgba(0,0,0,0.16)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_12px_32px_rgba(0,0,0,0.32)]"
      />
    </div>
  )
}

function readServerErrorMessage(raw: string): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : null
  }
  catch {
    return null
  }
}
