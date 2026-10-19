import { useEffect, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getSettingsAccount } from '@/lib/settings-account'

interface OwnAvatarProps {
  reference?: string | null
  fallback: ReactNode
}

export function OwnAvatar({ reference, fallback }: OwnAvatarProps) {
  const { user } = useAuth()
  // A reference is a version marker, never an arbitrary image URL to fetch.
  // Existing public URLs still identify an uploaded photo at the user's root key.
  return user && reference
    ? <PrivateImage key={`${user.id}:${reference}`} userId={user.id} fallback={fallback} />
    : <>{fallback}</>
}

function PrivateImage({ userId, fallback }: { userId: string; fallback: ReactNode }) {
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let objectUrl: string | null = null
    setImage(null)
    setFailed(false)
    // Bound the whole read, including Auth verification and response-body
    // consumption. Abandon this attempt before aborting so late results cannot
    // replace a retry or publish a blob after the error is visible.
    const deadline = setTimeout(() => {
      if (!active) return
      active = false
      clearTimeout(deadline)
      controller.abort()
      setFailed(true)
    }, 20_000)
    void (async () => {
      const { client } = await getSettingsAccount(userId, () => active, controller.signal)
      const { data, error } = await client.storage.from('avatars').download(userId, {}, {
        signal: controller.signal, cache: 'no-store',
      })
      if (!active) return
      if (error) throw error
      if (!data || !data.size || data.size > 5 * 1024 * 1024
        || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(data.type)) {
        throw new Error('Invalid profile photo')
      }
      objectUrl = URL.createObjectURL(data)
      setImage(objectUrl)
    })().catch(() => { if (active) setFailed(true) }).finally(() => {
      active = false
      clearTimeout(deadline)
    })
    return () => {
      active = false
      clearTimeout(deadline)
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [userId, attempt])
  return <div className="relative w-full h-full flex items-center justify-center">
    {image && !failed ? <img src={image} alt="Profile" className="w-full h-full object-cover" onError={() => setFailed(true)} /> : fallback}
    {failed ? <button type="button" aria-label="Retry profile photo" title="Photo unavailable. Retry"
      onClick={() => setAttempt(value => value + 1)}
      className="absolute inset-0 flex items-end justify-center pb-1 rounded-lg bg-background/60 text-foreground focus-visible:ring-2 focus-visible:ring-primary">
      <RefreshCw size={18} aria-hidden="true" />
      <span className="sr-only">Photo unavailable</span>
    </button> : !image && <span role="status" className="sr-only">Loading profile photo</span>}
  </div>
}
