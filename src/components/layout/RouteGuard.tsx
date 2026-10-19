import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

const DEV_MODE = import.meta.env.DEV

/** Shown when a user is authenticated but has no profile row —
 *  usually a provisioning failure during signup. Fail closed:
 *  never render role-gated pages without a verified role. */
function ProfileMissingScreen() {
  const { refreshProfile, signOut, profileError } = useAuth()
  const [retrying, setRetrying] = useState(false)

  const retry = async () => {
    setRetrying(true)
    await refreshProfile()
    setRetrying(false)
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center px-8 text-center">
      <h1 className="text-[20px] font-semibold text-white/90 mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {profileError ? 'Could not load account access' : 'Finishing account setup'}
      </h1>
      <p role={profileError ? 'alert' : undefined} className="text-[13px] text-white/45 mb-8 max-w-[300px]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {profileError ?? "Your account isn't fully set up yet. This can happen if something interrupted sign-up. Tap retry to finish setting up your account."}
      </p>
      <button
        onClick={retry}
        disabled={retrying}
        className="w-full max-w-[280px] py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-50"
      >
        {retrying ? 'Retrying…' : 'Retry setup'}
      </button>
      <button
        onClick={() => signOut()}
        className="mt-4 text-[12px] text-white/30 hover:text-white/60"
      >
        Sign out
      </button>
    </div>
  )
}

export function RouteGuard({ allowedRole, children }: { allowedRole: string; children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  const [params] = useSearchParams()

  // Dev bypass: add ?dev=player or ?dev=coach or ?dev=parent to skip auth
  const devRole = params.get('dev')
  if (DEV_MODE && devRole && devRole === allowedRole) {
    return <>{children}</>
  }

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center px-6"><p role="status" aria-label="Account access" className="text-sm text-muted-foreground">Checking your account…</p></div>

  if (!user) return <Navigate to="/" replace />

  // Fail closed: authenticated but no profile → setup screen, never the page
  if (!profile) return <ProfileMissingScreen />

  if (profile.role !== allowedRole) {
    const homeMap: Record<string, string> = {
      player: '/player/home',
      coach: '/coach/home',
      parent: '/parent/home',
      club: '/club/home',
    }
    return <Navigate to={homeMap[profile.role] ?? '/'} replace />
  }

  return <>{children}</>
}
