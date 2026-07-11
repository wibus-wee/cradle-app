import type { Context } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'

export const POSTHOG_AI_EXPORT_ATTRIBUTE = 'cradle.posthog.ai_export'

export function posthogAiOtlpUrl(host: string): string {
  return `${host.replace(/\/+$/, '')}/i/v0/ai/otel`
}

export function shouldExportPostHogAiSpan(span: Pick<ReadableSpan, 'attributes'>): boolean {
  return span.attributes[POSTHOG_AI_EXPORT_ATTRIBUTE] === true
}

export class PostHogAiFilteringSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    if (shouldExportPostHogAiSpan(span)) {
      this.delegate.onEnd(span)
    }
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush()
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }
}

export class ExcludePostHogAiSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    if (!shouldExportPostHogAiSpan(span)) {
      this.delegate.onStart(span, parentContext)
    }
  }

  onEnd(span: ReadableSpan): void {
    if (!shouldExportPostHogAiSpan(span)) {
      this.delegate.onEnd(span)
    }
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush()
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }
}
