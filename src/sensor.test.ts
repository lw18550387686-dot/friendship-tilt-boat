import { describe, expect, it } from 'vitest'
import { calibratedTilt, gradeFor, isCapsized, isStable, lowPass, mapToLandscape, normalizeAngle, TiltFilter } from './sensor'

describe('mobile tilt math', () => {
  it('maps both landscape orientations correctly', () => {
    expect(mapToLandscape(12, -4, 90)).toEqual({ roll: 12, pitch: 4 })
    expect(mapToLandscape(12, -4, 270)).toEqual({ roll: -12, pitch: -4 })
  })

  it('calibrates and wraps angular deltas', () => {
    expect(calibratedTilt({ roll: -178, pitch: 7 }, { roll: 178, pitch: 2 })).toEqual({ roll: 4, pitch: 5 })
    expect(normalizeAngle(361)).toBe(1)
  })

  it('filters sudden sensor noise', () => {
    expect(lowPass({ roll: 0, pitch: 0 }, { roll: 10, pitch: -10 }, 0.2)).toEqual({ roll: 2, pitch: -2 })
    const filter = new TiltFilter(0.5)
    expect(filter.push({ roll: 8, pitch: 4 })).toEqual({ roll: 4, pitch: 2 })
  })

  it('uses the tighter one-and-a-half and three degree boundaries', () => {
    expect(isStable(1.5, -1.5)).toBe(true)
    expect(isStable(1.51, 0)).toBe(false)
    expect(isCapsized(2.99)).toBe(false)
    expect(isCapsized(-3)).toBe(true)
  })

  it('calculates performance grades', () => {
    expect(gradeFor(48, 60)).toBe('S')
    expect(gradeFor(39, 60)).toBe('A')
    expect(gradeFor(27, 60)).toBe('B')
    expect(gradeFor(20, 60)).toBe('C')
  })
})
