import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { z } from 'zod'

export interface WindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface WindowSize {
  width?: number
  height?: number
}

export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowPoint {
  x: number
  y: number
}

export interface WindowBoundsPolicy {
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
}

const POINT_ANCHOR_MAX_LEFT_OFFSET = 360
const POINT_ANCHOR_TOP_OFFSET = 40

const StoredWindowBoundsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
  }))

const StoredWindowSizeJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
  }))

const WindowBoundsSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
})

const DisplayWorkAreaSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
})

const WindowPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

const WindowBoundsPolicySchema = z.object({
  defaultWidth: z.number().finite().positive(),
  defaultHeight: z.number().finite().positive(),
  minWidth: z.number().finite().positive(),
  minHeight: z.number().finite().positive(),
})

export function readStoredWindowBounds(filePath: string): WindowBounds | null {
  if (!existsSync(filePath)) {
    return null
  }

  return StoredWindowBoundsJsonSchema.parse(readFileSync(filePath, 'utf8'))
}

export function readStoredWindowSize(filePath: string): WindowSize | null {
  if (!existsSync(filePath)) {
    return null
  }

  return StoredWindowSizeJsonSchema.parse(readFileSync(filePath, 'utf8'))
}

export function writeStoredWindowSize(filePath: string, size: Required<WindowSize>): void {
  writeFileSync(filePath, `${JSON.stringify({
    width: Math.round(size.width),
    height: Math.round(size.height),
  }, null, 2)}\n`)
}

export function resolveWindowSize(
  storedSize: WindowSize | null | undefined,
  policy: WindowBoundsPolicy,
  maxSize?: WindowSize,
): Required<WindowSize> {
  const input = z.object({
    storedSize: z.object({
      width: z.number().finite().positive().optional(),
      height: z.number().finite().positive().optional(),
    }).nullable().optional(),
    policy: WindowBoundsPolicySchema,
    maxSize: z.object({
      width: z.number().finite().positive().optional(),
      height: z.number().finite().positive().optional(),
    }).optional(),
  }).parse({ storedSize, policy, maxSize })

  const maxWidth = input.maxSize?.width ?? Number.POSITIVE_INFINITY
  const maxHeight = input.maxSize?.height ?? Number.POSITIVE_INFINITY
  const width = z.number()
    .finite()
    .positive()
    .optional()
    .default(input.policy.defaultWidth)
    .transform(Math.round)
    .transform(value => Math.min(Math.max(value, Math.min(input.policy.minWidth, maxWidth)), maxWidth))
    .parse(input.storedSize?.width)
  const height = z.number()
    .finite()
    .positive()
    .optional()
    .default(input.policy.defaultHeight)
    .transform(Math.round)
    .transform(value => Math.min(Math.max(value, Math.min(input.policy.minHeight, maxHeight)), maxHeight))
    .parse(input.storedSize?.height)

  return { width, height }
}

export function resolveWindowBoundsNearPoint(
  size: Required<WindowSize>,
  point: WindowPoint,
  workArea: DisplayWorkArea,
): Required<WindowBounds> {
  const input = z.object({
    size: z.object({
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    }),
    point: WindowPointSchema,
    workArea: DisplayWorkAreaSchema,
  }).parse({ size, point, workArea })

  const width = Math.round(input.size.width)
  const height = Math.round(input.size.height)
  const targetX = Math.round(input.point.x - Math.min(width / 2, POINT_ANCHOR_MAX_LEFT_OFFSET))
  const targetY = Math.round(input.point.y - POINT_ANCHOR_TOP_OFFSET)

  return {
    x: clampPosition(targetX, input.workArea.x, input.workArea.x + input.workArea.width - width),
    y: clampPosition(targetY, input.workArea.y, input.workArea.y + input.workArea.height - height),
    width,
    height,
  }
}

export function resolveVisibleWindowBounds(
  storedBounds: WindowBounds,
  workAreas: DisplayWorkArea[],
  policy: WindowBoundsPolicy,
  primaryWorkArea = workAreas[0],
): Required<WindowBounds> {
  const input = z.object({
    storedBounds: WindowBoundsSchema,
    workAreas: z.array(DisplayWorkAreaSchema),
    policy: WindowBoundsPolicySchema,
    primaryWorkArea: DisplayWorkAreaSchema.optional(),
  }).parse({ storedBounds, workAreas, policy, primaryWorkArea })

  const fallbackWorkArea = input.primaryWorkArea ?? input.workAreas[0]

  if (!fallbackWorkArea) {
    const width = z.number()
      .finite()
      .positive()
      .optional()
      .default(input.policy.defaultWidth)
      .transform(Math.round)
      .transform(value => Math.max(value, input.policy.minWidth))
      .parse(input.storedBounds.width)
    const height = z.number()
      .finite()
      .positive()
      .optional()
      .default(input.policy.defaultHeight)
      .transform(Math.round)
      .transform(value => Math.max(value, input.policy.minHeight))
      .parse(input.storedBounds.height)
    return {
      x: 0,
      y: 0,
      width,
      height,
    }
  }

  const storedWorkArea = pickWorkAreaForBounds(input.storedBounds, input.workAreas)
  const targetWorkArea = storedWorkArea ?? fallbackWorkArea
  const width = z.number()
    .finite()
    .positive()
    .optional()
    .default(input.policy.defaultWidth)
    .transform(Math.round)
    .transform(value => Math.min(Math.max(value, Math.min(input.policy.minWidth, targetWorkArea.width)), targetWorkArea.width))
    .parse(input.storedBounds.width)
  const height = z.number()
    .finite()
    .positive()
    .optional()
    .default(input.policy.defaultHeight)
    .transform(Math.round)
    .transform(value => Math.min(Math.max(value, Math.min(input.policy.minHeight, targetWorkArea.height)), targetWorkArea.height))
    .parse(input.storedBounds.height)
  const centeredX = targetWorkArea.x + Math.round((targetWorkArea.width - width) / 2)
  const centeredY = targetWorkArea.y + Math.round((targetWorkArea.height - height) / 2)
  const targetX = storedWorkArea && input.storedBounds.x !== undefined ? Math.round(input.storedBounds.x) : centeredX
  const targetY = storedWorkArea && input.storedBounds.y !== undefined ? Math.round(input.storedBounds.y) : centeredY

  return {
    x: clampPosition(targetX, targetWorkArea.x, targetWorkArea.x + targetWorkArea.width - width),
    y: clampPosition(targetY, targetWorkArea.y, targetWorkArea.y + targetWorkArea.height - height),
    width,
    height,
  }
}

function pickWorkAreaForBounds(bounds: WindowBounds, workAreas: DisplayWorkArea[]): DisplayWorkArea | undefined {
  if (
    bounds.x === undefined
    || bounds.y === undefined
    || bounds.width === undefined
    || bounds.height === undefined
  ) {
    return undefined
  }

  const measuredBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  let selectedWorkArea: DisplayWorkArea | undefined
  let selectedArea = 0

  for (const workArea of workAreas) {
    const visibleArea = getIntersectionArea(measuredBounds, workArea)
    if (visibleArea > selectedArea) {
      selectedArea = visibleArea
      selectedWorkArea = workArea
    }
  }

  return selectedArea > 0 ? selectedWorkArea : undefined
}

function getIntersectionArea(bounds: Required<WindowBounds>, workArea: DisplayWorkArea): number {
  const left = Math.max(bounds.x, workArea.x)
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
  const top = Math.max(bounds.y, workArea.y)
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  return width * height
}

function clampPosition(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum
  }

  return Math.min(Math.max(value, minimum), maximum)
}
