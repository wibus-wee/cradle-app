import { mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Plugin } from '@tiptap/pm/state'

import {
  readAssetDisplaySizeFromUrl,
  readAssetIdFromUrl,
  toAssetContentUrl,
  toAssetMarkdownUrl,
} from '~/features/assets/asset-url'

interface AssetImageAttributes {
  src: string | null
  alt: string | null
  title: string | null
  width: number | null
  height: number | null
}

export const AssetImage = Image.extend({
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cradle-asset-src') ?? element.getAttribute('src'),
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const src = readCanonicalSrcFromElement(element)
          return readImageDimension(element.getAttribute('width'))
            ?? (src ? readAssetDisplaySizeFromUrl(src)?.width : null)
            ?? null
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const src = readCanonicalSrcFromElement(element)
          return readImageDimension(element.getAttribute('height'))
            ?? (src ? readAssetDisplaySizeFromUrl(src)?.height : null)
            ?? null
        },
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const canonicalSrc = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : null
    const assetId = canonicalSrc ? readAssetIdFromUrl(canonicalSrc) : null
    const displaySize = canonicalSrc ? readAssetDisplaySizeFromUrl(canonicalSrc) : null
    const width = readImageDimension(HTMLAttributes.width) ?? displaySize?.width ?? null
    const height = readImageDimension(HTMLAttributes.height) ?? displaySize?.height ?? null
    const sizeAttributes = {
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }

    if (!assetId || !canonicalSrc) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, sizeAttributes)]
    }

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'src': toAssetContentUrl(assetId),
        'data-cradle-asset-src': canonicalSrc,
        ...sizeAttributes,
      }),
    ]
  },

  addNodeView() {
    const baseNodeView = (this.parent as (() => any) | undefined)?.call(this)
    if (!baseNodeView) {
      return null
    }

    return (nodeViewProps) => {
      const view = baseNodeView(nodeViewProps)
      const attrs = nodeViewProps.node.attrs as AssetImageAttributes

      if (typeof attrs.src === 'string') {
        const assetId = readAssetIdFromUrl(attrs.src)
        if (assetId) {
          const contentUrl = toAssetContentUrl(assetId)
          const img = (view as { dom?: HTMLElement }).dom
          if (img instanceof HTMLImageElement) {
            img.src = contentUrl
          }
 else if (img) {
            const inner = img.querySelector('img')
            if (inner) {
              inner.src = contentUrl
            }
          }
        }
      }

      return view
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(transaction => transaction.docChanged)) {
            return null
          }

          const tr = newState.tr
          let changed = false

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return
            }

            const attrs = node.attrs as AssetImageAttributes
            if (!attrs.src) {
              return
            }

            const assetId = readAssetIdFromUrl(attrs.src)
            if (!assetId) {
              return
            }

            const displaySize = readAssetDisplaySizeFromUrl(attrs.src)
            const width = readImageDimension(attrs.width) ?? displaySize?.width ?? null
            const height = readImageDimension(attrs.height) ?? displaySize?.height ?? null
            const nextSrc = toAssetMarkdownUrl(assetId, { width, height })

            if (attrs.src === nextSrc && attrs.width === width && attrs.height === height) {
              return
            }

            tr.setNodeMarkup(pos, undefined, {
              ...attrs,
              src: nextSrc,
              width,
              height,
            })
            changed = true
          })

          return changed ? tr : null
        },
      }),
    ]
  },
})

function readCanonicalSrcFromElement(element: HTMLElement): string | null {
  return element.getAttribute('data-cradle-asset-src') ?? element.getAttribute('src')
}

function readImageDimension(value: string | number | null | undefined): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return Math.round(numeric)
}
