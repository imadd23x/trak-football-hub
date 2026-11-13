import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES, photoProblem } from '../profile-photo'

describe('TRAK-460: which files a coach may use as a profile picture', () => {
  it('accepts the four image types up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) expect(photoProblem({ type, size: 1024 })).toBeNull()
    expect(photoProblem({ type: 'image/png', size: PHOTO_MAX_BYTES })).toBeNull()
  })
  it('refuses a file that is not one of them', () => {
    for (const type of ['application/pdf', 'text/html', 'image/svg+xml', 'video/mp4', '']) expect(photoProblem({ type, size: 1024 })).toBe('type')
  })
  it('refuses a picture over 5 MB, and says the type first when both are wrong', () => {
    expect(photoProblem({ type: 'image/png', size: PHOTO_MAX_BYTES + 1 })).toBe('size')
    expect(photoProblem({ type: 'application/pdf', size: PHOTO_MAX_BYTES + 1 })).toBe('type')
  })
})
