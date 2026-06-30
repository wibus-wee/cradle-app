import type { MarkdownComponents, MarkdownUrlTransform } from '@cradle/streamdown'
import {
  defaultMarkdownUrlTransform,
  MarkdownLink,
  StaticRender,
} from '@cradle/streamdown'
import type { CSSProperties } from 'react'

import { LinkCard } from '~/components/editor/link-card'
import { parseLinkCardTitle } from '~/components/editor/link-card-format'
import { cn } from '~/lib/cn'

import type { AssetDisplaySize } from './asset-url'
import {
  isCradleAssetUrl,
  readAssetDisplaySizeFromUrl,
  readAssetIdFromUrl,
  toAssetContentUrl,
  withAssetDisplaySize,
} from './asset-url'

interface AssetMarkdownProps {
  content: string
  className?: string
  as?: 'div' | 'span'
}

interface AssetMarkdownImage {
  filename: string
  markdownUrl: string
  width?: number | null
  height?: number | null
}

const assetUrlTransform: MarkdownUrlTransform = (value) => {
  if (isCradleAssetUrl(value)) {
    return value
  }
  return defaultMarkdownUrlTransform(value)
}

const components: MarkdownComponents = {
  img({ src, alt, className, node, ref, ...props }) {
    const asset = resolveAssetReference(src)
    return (
      <img
        {...props}
        src={asset?.contentUrl ?? src}
        alt={alt ?? ''}
        width={asset?.displaySize.width ?? undefined}
        height={asset?.displaySize.height ?? undefined}
        loading="lazy"
        decoding="async"
        data-cradle-asset-src={asset ? src : undefined}
        style={readAssetImageStyle(asset?.displaySize ?? null)}
        className={cn(
          'my-2 h-auto max-w-full rounded-md border border-border object-contain',
          className,
        )}
      />
    )
  },
  a({ href, title, children, node, ref, ...props }) {
    const display = parseLinkCardTitle(title)
    if (display) {
      return <LinkCard href={href ?? ''} display={display} />
    }
    const asset = resolveAssetReference(href)
    return (
      <MarkdownLink
        {...props}
        href={asset?.contentUrl ?? href}
        data-cradle-asset-href={asset ? href : undefined}
      >
        {children}
      </MarkdownLink>
    )
  },
}

function resolveAssetReference(value: string | undefined): {
  contentUrl: string
  displaySize: AssetDisplaySize
} | null {
  if (!value) {
    return null
  }
  const assetId = readAssetIdFromUrl(value)
  if (!assetId) {
    return null
  }

  return {
    contentUrl: toAssetContentUrl(assetId),
    displaySize: readAssetDisplaySizeFromUrl(value) ?? { width: null, height: null },
  }
}

function readAssetImageStyle(displaySize: AssetDisplaySize | null): CSSProperties | undefined {
  if (!displaySize?.width) {
    return undefined
  }

  return {
    width: displaySize.width,
    aspectRatio: displaySize.height ? `${displaySize.width} / ${displaySize.height}` : undefined,
  }
}

function escapeImageAlt(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\]/g, '\\]')
}

export function toAssetImageMarkdown(asset: AssetMarkdownImage): string {
  const markdownUrl = withAssetDisplaySize(asset.markdownUrl, {
    width: asset.width,
    height: asset.height,
  })
  return `![${escapeImageAlt(asset.filename)}](${markdownUrl})`
}

export function AssetMarkdown({ content, className, as }: AssetMarkdownProps) {
  return (
    <StaticRender
      content={content}
      className={className}
      components={components}
      urlTransform={assetUrlTransform}
      as={as}
    />
  )
}
