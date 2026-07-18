import { describe, expect, it } from 'vitest'
import { cellKey, rectangularSelection, selectionBounds } from './selection'
import type { ChannelId } from '../types'

const ids: ChannelId[] = ['pulse1', 'pulse2', 'triangle', 'noise']

describe('tracker grid selection', () => {
  it('returns every cell in a forward rectangular drag', () => {
    const points = rectangularSelection({
      anchor: { channelId: 'pulse1', row: 3 },
      focus: { channelId: 'pulse2', row: 5 },
    }, ids, 64)

    expect(points.map((point) => cellKey(point.channelId, point.row))).toEqual([
      'pulse1:3', 'pulse2:3',
      'pulse1:4', 'pulse2:4',
      'pulse1:5', 'pulse2:5',
    ])
    expect(selectionBounds(points)).toEqual({ firstRow: 3, lastRow: 5 })
  })

  it('normalizes reverse drags and clamps rows', () => {
    const points = rectangularSelection({
      anchor: { channelId: 'triangle', row: 8 },
      focus: { channelId: 'pulse2', row: -2 },
    }, ids, 4)

    expect(points).toHaveLength(8)
    expect(points[0]).toEqual({ channelId: 'pulse2', row: 0 })
    expect(points.at(-1)).toEqual({ channelId: 'triangle', row: 3 })
  })
})
