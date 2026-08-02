import { describe, expect, it } from 'vitest'
import { normalizeRoomCode } from './coop'

describe('co-op invitation codes', () => {
  it('normalizes room codes from invitation URLs', () => {
    expect(normalizeRoomCode(' abcd-2345!? ')).toBe('ABCD2345')
    expect(normalizeRoomCode('a1b0c9')).toBe('ABC9')
  })
})
