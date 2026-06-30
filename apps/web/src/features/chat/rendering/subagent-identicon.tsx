import type { SVGProps } from 'react'

import { cn } from '~/lib/cn'

import styles from './subagent-identicon.module.css'

const SCAN_DELAY_MS = 200
const GRID_SIZE = 5
const SHAPE_COLUMNS = 3
const HASH_MODULO = 4_294_967_296
const FNV_OFFSET = 2_166_136_261
const FNV_PRIME = 131
const CELL_SIZE = 4

const IDENTICON_COLORS = [
  'var(--color-chart-4)',
  'var(--color-orange-500)',
  'var(--color-destructive)',
  'var(--color-violet-500)',
  'var(--color-sky-500)',
]

interface SubagentIdenticonCell {
  animationDelayMs: number
  column: number
  filled: boolean
  row: number
}

interface SubagentIdenticonProps extends SVGProps<SVGSVGElement> {
  active?: boolean
  seed: string
}

export function SubagentIdenticon({
  active = false,
  className,
  seed,
  ...props
}: SubagentIdenticonProps) {
  const identicon = buildSubagentIdenticon(seed)

  return (
    <svg
      {...props}
      className={cn('shrink-0', className)}
      viewBox="-2 -1 24 24"
      fill="none"
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      {identicon.cells.map(cell => (
        <rect
          key={`${cell.row}:${cell.column}`}
          className={active ? styles.filledScanCell : undefined}
          x={cell.column * CELL_SIZE}
          y={cell.row * CELL_SIZE}
          width={CELL_SIZE}
          height={CELL_SIZE}
          fill={identicon.color}
          style={active ? { animationDelay: `${cell.animationDelayMs}ms` } : undefined}
        />
      ))}
      {active && identicon.scanCells.map(cell => (
        cell.filled
          ? null
          : (
              <rect
                key={`scan:${cell.row}:${cell.column}`}
                className={styles.emptyScanCell}
                x={cell.column * CELL_SIZE}
                y={cell.row * CELL_SIZE}
                width={CELL_SIZE}
                height={CELL_SIZE}
                fill={identicon.color}
                style={{ animationDelay: `${cell.animationDelayMs}ms` }}
              />
            )
      ))}
    </svg>
  )
}

function buildSubagentIdenticon(seed: string) {
  const shapeHash = hashSeed(`${seed}:shape`)
  const colorHash = hashSeed(`${seed}:color`)
  const cells: SubagentIdenticonCell[] = []
  const filledCells = new Set<string>()

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < SHAPE_COLUMNS; column += 1) {
      if (!isHashBitEnabled(shapeHash, row * SHAPE_COLUMNS + column)) {
        continue
      }

      cells.push({
        animationDelayMs: readScanDelayMs(row),
        column,
        filled: true,
        row,
      })
      filledCells.add(readCellKey(column, row))

      const mirroredColumn = GRID_SIZE - 1 - column
      if (mirroredColumn !== column) {
        cells.push({
          animationDelayMs: readScanDelayMs(row),
          column: mirroredColumn,
          filled: true,
          row,
        })
        filledCells.add(readCellKey(mirroredColumn, row))
      }
    }
  }

  if (cells.length === 0) {
    const center = Math.floor(GRID_SIZE / 2)
    cells.push({
      animationDelayMs: readScanDelayMs(center),
      column: center,
      filled: true,
      row: center,
    })
    filledCells.add(readCellKey(center, center))
  }

  return {
    cells,
    color: readIdenticonColor(colorHash),
    scanCells: buildScanCells(filledCells),
  }
}

function hashSeed(seed: string): number {
  let hash = FNV_OFFSET
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * FNV_PRIME + seed.charCodeAt(index)) % HASH_MODULO
  }
  return hash
}

function isHashBitEnabled(hash: number, bitIndex: number): boolean {
  return Math.floor(hash / 2 ** bitIndex) % 2 === 1
}

function buildScanCells(filledCells: Set<string>): SubagentIdenticonCell[] {
  const cells: SubagentIdenticonCell[] = []

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      cells.push({
        animationDelayMs: readScanDelayMs(row),
        column,
        filled: filledCells.has(readCellKey(column, row)),
        row,
      })
    }
  }

  return cells
}

function readCellKey(column: number, row: number): string {
  return `${row}:${column}`
}

function readScanDelayMs(row: number): number {
  return row * SCAN_DELAY_MS
}

function readIdenticonColor(hash: number): string {
  return IDENTICON_COLORS[Math.floor(hash / HASH_MODULO * IDENTICON_COLORS.length)] ?? IDENTICON_COLORS[0]
}
