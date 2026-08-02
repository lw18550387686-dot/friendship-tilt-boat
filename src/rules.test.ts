import { describe, expect, it } from 'vitest'
import { HORIZONTAL_LIMIT, overlapsObstacle, pitchToBoatHeight, swipeToWorldDelta } from './rules'

describe('touch steering and obstacle rules', () => {
  it('maps a horizontal swipe to a bounded world-space movement step', () => {
    expect(swipeToWorldDelta(100, 1000)).toBeCloseTo(HORIZONTAL_LIMIT * 0.245)
    expect(swipeToWorldDelta(-100, 1000)).toBeCloseTo(-HORIZONTAL_LIMIT * 0.245)
  })

  it('maps device pitch to the vertical boat lane and clamps extremes', () => {
    expect(pitchToBoatHeight(0)).toBe(1.3)
    expect(pitchToBoatHeight(50)).toBe(2.15)
    expect(pitchToBoatHeight(-50)).toBe(0.55)
  })

  it('requires both horizontal and vertical overlap for an obstacle hit', () => {
    expect(overlapsObstacle(0, 1.3, 0.8, 1.7)).toBe(true)
    expect(overlapsObstacle(0, 1.3, 2, 1.3)).toBe(false)
    expect(overlapsObstacle(0, 1.3, 0, 2.2)).toBe(false)
  })
})
