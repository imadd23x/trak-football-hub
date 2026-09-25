import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getSettingsAccount } from '@/lib/settings-account'
import { MetadataLabel } from '@/components/trak'

/* Who the player is linked to. Moved from Settings to the Profile tab
   (TRAK-71, use-case test 25 Sep). Only active coaches count: a coach who left
   keeps read access to history, not a place here. A name hidden by RLS does
   not hide the link. A failed load says so and offers a retry. */
export function PlayerConnections() {
  const { user } = useAuth()
  const userId = user?.id
  const [coaches, setCoaches] = useState<string[]>([])
  const [parents, setParents] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const controller = new AbortController()
    const current = () => !cancelled
    setState('loading')
    void (async () => {
      const { client } = await getSettingsAccount(userId, current)
      const [squad, links] = await Promise.all([
        client.from('squad_players').select('coach_user_id').eq('linked_player_id', userId).eq('status', 'active').abortSignal(controller.signal),
        client.from('player_parent_links').select('parent_user_id').eq('player_user_id', userId).abortSignal(controller.signal),
      ])
      if (squad.error) throw squad.error
      if (links.error) throw links.error
      const coachIds = [...new Set((squad.data ?? []).flatMap(row => row.coach_user_id ? [row.coach_user_id] : []))]
      const parentIds = [...new Set((links.data ?? []).map(row => row.parent_user_id))]
      const ids = [...new Set([...coachIds, ...parentIds])]
      const names = new Map<string, string>()
      if (ids.length) {
        const { data, error } = await client.from('profiles').select('user_id, full_name').in('user_id', ids).abortSignal(controller.signal)
        if (error) throw error
        for (const row of data ?? []) names.set(row.user_id, row.full_name)
      }
      if (!current()) return
      setCoaches(coachIds.map(id => names.get(id) || 'Linked coach'))
      setParents(parentIds.map(id => names.get(id) || 'Linked parent'))
      setState('ready')
    })().catch(() => { if (current()) setState('error') })
    return () => { cancelled = true; controller.abort() }
  }, [userId, attempt])

  return (
    <section aria-label="Connections" className="rounded-[18px] px-4 pt-4 pb-1 border border-white/[0.07] bg-[#101012]">
      <MetadataLabel text="CONNECTIONS" />
      {state === 'loading' && <p role="status" className="py-3 text-sm text-white/50">Loading connections…</p>}
      {state === 'error' && <div role="alert" className="py-3 text-sm text-white/50">
        Connections could not be loaded. <button onClick={() => setAttempt(value => value + 1)} className="underline">Retry connections</button>
      </div>}
      {state === 'ready' && <>
        <ConnectionRow label={coaches.length > 1 ? 'Linked coaches' : 'Linked coach'} names={coaches} />
        <ConnectionRow label={parents.length > 1 ? 'Linked parents' : 'Linked parent'} names={parents} />
      </>}
    </section>
  )
}

function ConnectionRow({ label, names }: { label: string; names: string[] }) {
  const connected = names.length > 0
  return (
    <div className="py-3 flex items-center gap-2 border-b border-white/[0.05] last:border-b-0">
      {/* Green when linked, red when not; the words say it too. */}
      <span aria-hidden="true" className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: connected ? '#C8F25A' : 'rgba(248,113,113,0.85)' }} />
      <div className="min-w-0">
        <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>{label}</div>
        <div className={`truncate text-[13px] ${connected ? 'text-white/88' : 'text-white/40'}`}>{connected ? names.join(', ') : 'Not connected'}</div>
      </div>
    </div>
  )
}
