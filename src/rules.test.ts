import { describe, expect, it } from 'vitest'
import { HORIZONTAL_LIMIT, LEVEL_CONFIGS, levelForElapsed, obstacleMotion, overlapsObstacle, pitchToBoatHeight, swipeToWorldDelta } from './rules'

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

  it('progresses through three increasingly fast and crowded levels', () => {
    expect(levelForElapsed(0).level).toBe(1)
    expect(levelForElapsed(20).level).toBe(2)
    expect(levelForElapsed(40).level).toBe(3)
    expect(LEVEL_CONFIGS.map((level) => level.speed)).toEqual([8.6, 11.8, 15.2])
    expect(LEVEL_CONFIGS.map((level) => level.obstacleCount)).toEqual([8, 13, 18])
    expect(LEVEL_CONFIGS.map((level) => level.lateralSwing)).toEqual([0.58, 0.96, 1.34])
  })

  it('moves obstacles sideways and vertically with level-specific amplitude', () => {
    const first = LEVEL_CONFIGS[0]
    const offset = obstacleMotion(0, first, Math.PI / 2)
    expect(offset.x).toBeCloseTo(first.lateralSwing)
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(first.verticalSwing)
  })
})
