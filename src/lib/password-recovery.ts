import { isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'

export type RecoveryState = {
  status: 'verifying' | 'slow' | 'invalid' | 'ready' | 'saving' | 'complete'
  message: string | null
}
export type PasswordUpdateResult = { error: string | null; expired?: boolean }
const invalidLink = 'This reset link is invalid, expired, or has already been used. Request a new reset link from sign in or Settings. If another account is signed in, sign out first.'
const changedAccount = 'Your account changed while this reset link was open. Request a new reset link for the account you want to update.'

/**
 * An in-memory UX boundary for the current tab's implicit recovery callback.
 * This is not server-enforced recovery authority: Auth accepts any permitted
 * authenticated password update. Tokens are held only in memory, never logged
 * or copied into another storage key. Reloading needs a fresh recovery link.
 */
export function createPasswordRecovery(
  auth: SupabaseClient['auth'],
  callbackUrl: string,
  supabaseUrl: string,
  publicKey: string,
) {
  const url = new URL(callbackUrl)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasError = ['error', 'error_code', 'error_description'].some(key => hash.has(key) || url.searchParams.has(key))
  let expectedToken: string | null = !hasError && url.pathname === '/reset-password' && hash.get('type') === 'recovery'
    && hash.get('refresh_token') ? hash.get('access_token') : null
  let closed = !expectedToken
  let proof: Session | null = null
  let version = 0
  let disposed = false
  let requestStarted = false
  let abortUpdate: AbortController | null = null
  const accountChangeMessage = () => requestStarted ? `${changedAccount} If the update had already started, the previous account’s password may have changed.` : changedAccount
  let state: RecoveryState = { status: closed ? 'invalid' : 'verifying', message: closed ? invalidLink : null }
  const listeners = new Set<() => void>()
  let slowTimer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: RecoveryState) => {
    if (disposed) return
    state = next
    listeners.forEach(listener => listener())
  }
  const invalidate = (message = invalidLink) => {
    closed = true
    proof = null
    expectedToken = null
    version++
    clearTimeout(slowTimer)
    abortUpdate?.abort()
    requestStarted = false
    publish({ status: 'invalid', message })
  }
  const startWait = () => {
    clearTimeout(slowTimer)
    slowTimer = setTimeout(() => {
      if (!closed && state.status === 'verifying') publish({ status: 'slow', message: 'Checking this reset link is taking longer than expected. You can keep waiting or return to Trak and request a new link from sign in or Settings.' })
    }, 10000)
  }
  const current = (captured: Session, revision: number) => !disposed && !closed && version === revision && proof?.access_token === captured.access_token
  const verifySession = async () => {
    const captured = proof
    const revision = version
    if (!captured || closed) return
    try {
      const { data, error } = await auth.getSession()
      if (!current(captured, revision)) return
      if (error || data.session?.user.id !== captured.user.id || data.session.access_token !== captured.access_token) {
        invalidate(changedAccount)
        return
      }
      clearTimeout(slowTimer)
      publish({ status: 'ready', message: null })
    } catch {
      if (current(captured, revision)) invalidate()
    }
  }

  // Register before React mounts: the SDK clears the URL and emits recovery
  // during its initialisation. Never await an Auth call inside this callback;
  // its notification runs under the SDK's exclusive session lock.
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (closed || disposed) return
    if (event === 'PASSWORD_RECOVERY') {
      if (proof && session?.access_token === proof.access_token) return
      if (!session || session.access_token !== expectedToken) {
        invalidate(changedAccount)
        return
      }
      proof = session
      version++
      setTimeout(() => { void verifySession() }, 0)
      return
    }
    if (event === 'SIGNED_OUT') {
      invalidate(accountChangeMessage())
      return
    }
    if (!proof) return // ordinary sessions cannot establish recovery
    if (!session || session.user.id !== proof.user.id) {
      invalidate(accountChangeMessage())
      return
    }
    if (event === 'TOKEN_REFRESHED') {
      // Preserve an established account context, never create one on refresh.
      proof = session
      expectedToken = session.access_token
      version++
      if (state.status === 'verifying' || state.status === 'slow') setTimeout(() => { void verifySession() }, 0)
      if (state.status === 'saving') {
        invalidate('Your session changed during the update. Request a new reset link. If the update had already started, the previous account’s password may have changed.')
      }
    } else if (session.access_token !== proof.access_token) {
      invalidate(accountChangeMessage())
    }
    // INITIAL_SESSION for the same recovery session may arrive after recovery.
  })
  if (!closed) {
    startWait()
    void auth.initialize().then(({ error }) => {
      // initialize resolves before the SDK's queued recovery notification.
      setTimeout(() => { if (!closed && !proof) invalidate(); else if (error && !closed) invalidate() }, 0)
    }).catch(() => invalidate())
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    async updatePassword(password: string): Promise<boolean> {
      if (state.status !== 'ready' || !proof || closed) return false
      const captured = proof
      const revision = version
      publish({ status: 'saving', message: null })
      const controller = new AbortController()
      abortUpdate = controller
      let deadline: ReturnType<typeof setTimeout> | undefined
      const run = async (): Promise<boolean> => {
        const { data: active, error: sessionError } = await auth.getSession()
        if (!current(captured, revision)) return false
        if (sessionError || active.session?.user.id !== captured.user.id || active.session.access_token !== captured.access_token) {
          invalidate(changedAccount)
          return false
        }
        const { data, error } = await auth.getUser(captured.access_token)
        if (!current(captured, revision)) return false
        if (error && (isAuthRetryableFetchError(error) || error.status === 429)) {
          publish({ status: 'ready', message: 'Your account could not be checked right now. Check your connection and try again; no password update was sent.' })
          return false
        }
        if (error || data.user?.id !== captured.user.id) { invalidate(); return false }
        // The request is pinned to the verified recovery account, even if the
        // shared browser session changes after dispatch. A late response may
        // have updated that account, but cannot update a replacement account.
        requestStarted = true
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          method: 'PUT',
          signal: controller.signal,
          headers: { apikey: publicKey, Authorization: `Bearer ${captured.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const result: PasswordUpdateResult = { error: null }
        const body: { id?: string; msg?: string; message?: string } | null = await response.json().catch(() => null)
        if (!response.ok) {
          result.error = body?.msg || body?.message || 'Your password could not be updated. Please try again.'
          result.expired = response.status === 401 || response.status === 403
        } else if (body?.id !== captured.user.id) {
          result.error = 'The update could not be confirmed. Request a new reset link, or try signing in with your new password.'
        }
        if (!current(captured, revision)) return false
        if (result.expired) { invalidate(); return false }
        if (result.error) { publish({ status: 'ready', message: result.error }); return false }
        const { data: latest } = await auth.getSession()
        if (!current(captured, revision)) return false
        if (latest.session?.user.id !== captured.user.id || latest.session.access_token !== captured.access_token) {
          invalidate(accountChangeMessage())
          return false
        }
        closed = true
        proof = null
        expectedToken = null
        version++
        publish({ status: 'complete', message: 'Your password has been updated.' })
        return true
      }
      try {
        const timeout = new Promise<boolean>(resolve => {
          deadline = setTimeout(() => {
            if (current(captured, revision)) {
              version++ // a late SDK response must not submit or finish this attempt
              const message = requestStarted
                ? 'The update timed out and may already have completed. Try signing in with your new password, or retry the update.'
                : 'The account check timed out before the update was sent. Check your connection and try again.'
              requestStarted = false
              publish({ status: 'ready', message })
            }
            controller.abort()
            resolve(false)
          }, 15000)
        })
        return await Promise.race([run(), timeout])
      } catch {
        if (current(captured, revision)) publish({ status: 'ready', message: 'The update could not be confirmed. Check your connection and try again. If it already completed, you can sign in with your new password.' })
        return false
      } finally {
        clearTimeout(deadline)
        if (abortUpdate === controller) abortUpdate = null
        if (version === revision) requestStarted = false
      }
    },
    dispose() {
      disposed = true
      proof = null
      expectedToken = null
      clearTimeout(slowTimer)
      abortUpdate?.abort()
      subscription.unsubscribe()
      listeners.clear()
    },
  }
}
