import type { ChannelId } from '../types'

export interface GridPoint {
  channelId: ChannelId
  row: number
}

export interface GridSelection {
  anchor: GridPoint
  focus: GridPoint
}

export function cellKey(channelId: ChannelId, row: number): string {
  return `${channelId}:${row}`
}

export function rectangularSelection(
  selection: GridSelection,
  channelIds: ChannelId[],
  rowCount: number,
): GridPoint[] {
  const anchorIndex = channelIds.indexOf(selection.anchor.channelId)
  const focusIndex = channelIds.indexOf(selection.focus.channelId)
  if (anchorIndex < 0 || focusIndex < 0 || rowCount <= 0) return []

  const firstChannel = Math.min(anchorIndex, focusIndex)
  const lastChannel = Math.max(anchorIndex, focusIndex)
  const firstRow = Math.max(0, Math.min(selection.anchor.row, selection.focus.row))
  const lastRow = Math.min(rowCount - 1, Math.max(selection.anchor.row, selection.focus.row))
  const points: GridPoint[] = []

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let channel = firstChannel; channel <= lastChannel; channel += 1) {
      points.push({ channelId: channelIds[channel], row })
    }
  }
  return points
}

export function selectionBounds(points: GridPoint[]): { firstRow: number; lastRow: number } | null {
  if (!points.length) return null
  return points.reduce((bounds, point) => ({
    firstRow: Math.min(bounds.firstRow, point.row),
    lastRow: Math.max(bounds.lastRow, point.row),
  }), { firstRow: points[0].row, lastRow: points[0].row })
}
