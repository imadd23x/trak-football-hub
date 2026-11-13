/* TRAK-460: a coach's profile picture. The database only lets a coach store one object, named by their own user id, in the
   private `avatars` bucket (20261113150000); this is the check the screen makes first so a wrong file gets a clear message
   before anything is sent. The bucket enforces the same list and size, so this is a courtesy, not the guard. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** What is wrong with a chosen file, or null when it can be uploaded. */
export function photoProblem(file: Pick<File, 'type' | 'size'>): 'type' | 'size' | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > PHOTO_MAX_BYTES) return 'size'
  return null
}
