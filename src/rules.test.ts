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
    expect(LEVEL_CONFIGS.map((level) => level.speed)).toEqual([9.6, 13.8, 18.4])
    expect(LEVEL_CONFIGS.map((level) => level.obstacleCount)).toEqual([10, 15, 18])
    expect(LEVEL_CONFIGS.map((level) => level.lateralSwing)).toEqual([1.05, 1.72, 2.45])
  })

  it('moves obstacles sideways and vertically with level-specific amplitude', () => {
    const first = LEVEL_CONFIGS[0]
    const offset = obstacleMotion(0, first, Math.PI / 2)
    expect(offset.x).toBeCloseTo(first.lateralSwing)
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(first.verticalSwing)
    const complexOffset = obstacleMotion(1.3, LEVEL_CONFIGS[2], 0.7, 2)
    expect(Math.abs(complexOffset.x)).toBeLessThanOrEqual(LEVEL_CONFIGS[2].lateralSwing)
    expect(Math.abs(complexOffset.y)).toBeLessThanOrEqual(LEVEL_CONFIGS[2].verticalSwing)
  })

  it('supports wider collision zones for rotating gate obstacles', () => {
    expect(overlapsObstacle(0, 1.3, 1.8, 1.3)).toBe(false)
    expect(overlapsObstacle(0, 1.3, 1.8, 1.3, 2.15, 0.85)).toBe(true)
  })
})
