import {
  CloseLine as XIcon,
  LeftSmallLine as ChevronLeftIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

interface ImageLightboxProps {
  images: Array<{ url: string, alt: string }>
  initialIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImageLightbox({ images, initialIndex, open, onOpenChange }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  useEffect(() => {
    setCurrentIndex(initialIndex)
  }, [initialIndex, open])

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : images.length - 1))
  }, [images.length])

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => (prev < images.length - 1 ? prev + 1 : 0))
  }, [images.length])

  useEffect(() => {
    if (!open) { return }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handlePrevious()
      }
 else if (e.key === 'ArrowRight') {
        handleNext()
      }
 else if (e.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handlePrevious, handleNext, onOpenChange])

  if (images.length === 0) { return null }

  const currentImage = images[currentIndex]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/95 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onPointerDownOutside={() => onOpenChange(false)}
        >
          <div className="relative flex h-full w-full items-center justify-center p-8">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="absolute top-4 right-4 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white"
              aria-label="Close"
            >
              <XIcon className="size-5" />
            </Button>

            {images.length > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevious}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white"
                  aria-label="Previous image"
                >
                  <ChevronLeftIcon className="size-6" />
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white"
                  aria-label="Next image"
                >
                  <ChevronRightIcon className="size-6" />
                </Button>
              </>
            )}

            <div className="flex max-h-full max-w-full flex-col items-center gap-4">
              <img
                src={currentImage.url}
                alt={currentImage.alt}
                className="max-h-[85vh] max-w-full rounded-lg object-contain"
              />

              {images.length > 1 && (
                <div className="flex items-center gap-1.5 bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm">
                  {images.map((image, index) => (
                    <Button
                      key={`${image.url}:${image.alt}`}
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setCurrentIndex(index)}
                      className={cn(
                        'size-2 rounded-full transition-colors',
                        index === currentIndex ? 'bg-white' : 'bg-white/40 hover:bg-white/60',
                      )}
                      aria-label={`Go to image ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
