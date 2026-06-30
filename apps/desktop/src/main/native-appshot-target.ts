/*
 */

import type {
  MacAppshotAnimationTarget,
  MacAppshotFrontmostContext,
} from './mac-bridge-protocol'

export interface AppshotScreenPointBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppshotScreenPointDisplay {
  id: number
  scaleFactor: number
  bounds: AppshotScreenPointBounds
  workArea: AppshotScreenPointBounds
}

export function createParityAppshotAnimationTarget(context: MacAppshotFrontmostContext): MacAppshotAnimationTarget {
  const workArea = context.animationTarget.codexDisplay.workArea
  const scaleFactor = context.animationTarget.codexDisplay.scaleFactor
  const geometryScale = context.animationTarget.coordinateSpace === 'pixels' || context.animationTarget.coordinateSpace === 'viewportPixels'
    ? scaleFactor
    : 1
  const width = 232 * geometryScale
  const height = 140 * geometryScale
  return {
    ...context.animationTarget,
    destinationBackgroundColor: '#ffffff',
    destinationCornerRadius: 0,
    destinationFrame: {
      x: workArea.x + (workArea.width - width) / 2,
      y: workArea.y + workArea.height - height - 36,
      width,
      height,
    },
    destinationPrimaryTextColor: '#111111',
    transitionSnapshotScale: scaleFactor,
  }
}

export function readScreenPointAppshotDestinationFrame(
  target: MacAppshotAnimationTarget,
  contentBounds: AppshotScreenPointBounds,
): AppshotScreenPointBounds {
  const scaleFactor = target.codexDisplay.scaleFactor
  const frame = target.destinationFrame
  return {
    x: contentBounds.x + frame.x / scaleFactor,
    y: contentBounds.y + frame.y / scaleFactor,
    width: frame.width / scaleFactor,
    height: frame.height / scaleFactor,
  }
}

export function readScreenPointAppshotAnimationTarget(
  target: MacAppshotAnimationTarget,
  contentBounds: AppshotScreenPointBounds,
  display: AppshotScreenPointDisplay,
): MacAppshotAnimationTarget {
  if (target.coordinateSpace !== 'viewportPixels') {
    return target
  }
  return {
    ...target,
    coordinateSpace: 'screenPoints',
    codexDisplay: {
      ...target.codexDisplay,
      id: display.id,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      workArea: display.workArea,
    },
    destinationFrame: readScreenPointAppshotDestinationFrame(target, contentBounds),
    transitionSnapshotScale: target.transitionSnapshotScale ?? target.codexDisplay.scaleFactor,
  }
}
