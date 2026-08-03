import { describe, expect, it } from 'vitest'
import { HORIZONTAL_LIMIT, LEVEL_CONFIGS, TOTAL_DURATION_SECONDS, levelForElapsed, obstacleMotion, overlapsObstacle, pitchToBoatHeight, swipeToWorldDelta } from './rules'

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

  it('progresses through five increasingly fast and crowded environments', () => {
    expect(levelForElapsed(0).level).toBe(1)
    expect(levelForElapsed(15).level).toBe(2)
    expect(levelForElapsed(30).level).toBe(3)
    expect(levelForElapsed(45).level).toBe(4)
    expect(levelForElapsed(60).level).toBe(5)
    expect(TOTAL_DURATION_SECONDS).toBe(75)
    expect(LEVEL_CONFIGS.map((level) => level.speed)).toEqual([10.5, 13.6, 16.9, 20.5, 24.4])
    expect(LEVEL_CONFIGS.map((level) => level.obstacleCount)).toEqual([12, 16, 20, 24, 28])
    expect(LEVEL_CONFIGS.map((level) => level.lateralSwing)).toEqual([1.2, 1.8, 2.5, 3.1, 3.8])
  })

  it('moves obstacles sideways and vertically with level-specific amplitude', () => {
    const first = LEVEL_CONFIGS[0]
    const offset = obstacleMotion(0, first, Math.PI / 2)
    expect(offset.x).toBeCloseTo(first.lateralSwing)
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(first.verticalSwing)
    const complexOffset = obstacleMotion(1.3, LEVEL_CONFIGS[4], 0.7, 5)
    expect(Math.abs(complexOffset.x)).toBeLessThanOrEqual(LEVEL_CONFIGS[4].lateralSwing)
    expect(Math.abs(complexOffset.y)).toBeLessThanOrEqual(LEVEL_CONFIGS[4].verticalSwing)
  })

  it('supports wider collision zones for rotating gate obstacles', () => {
    expect(overlapsObstacle(0, 1.3, 1.8, 1.3)).toBe(false)
    expect(overlapsObstacle(0, 1.3, 1.8, 1.3, 2.15, 0.85)).toBe(true)
  })
})
