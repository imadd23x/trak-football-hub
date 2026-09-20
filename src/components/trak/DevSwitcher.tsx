import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { X, ArrowLeftRight } from 'lucide-react'
import { requireDevPassword } from '@/lib/dev-credentials'

const DEV_ACCOUNTS = [
  { role: 'coach',  label: 'Coach',  email: 'coach@trak.dev',  color: 'hsl(40,78%,60%)' },
  { role: 'player', label: 'Player', email: 'player@trak.dev', color: '#C8F25A' },
  { role: 'parent', label: 'Parent', email: 'parent@trak.dev', color: 'hsl(214,60%,57%)' },
  { role: 'club',   label: 'Admin',  email: 'club@trak.dev',   color: 'rgba(255,255,255,0.7)' },
] as const

export function DevSwitcher() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const navigate = useNavigate()

  const switchTo = async (account: typeof DEV_ACCOUNTS[number]) => {
    setBusy(account.role)
    setOpen(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: requireDevPassword(),
    })
    if (error) {
      alert(`Switch failed: ${error.message}`)
      setBusy(null)
      return
    }
    setBusy(null)
    navigate(`/${account.role}/home`, { replace: true })
  }

  return (
    // Portal-like fixed overlay — rendered directly in App, always on top
    <div className="fixed z-[9999]" style={{ bottom: '80px', right: '12px' }}>
      {open && (
        <div className="mb-2 rounded-[12px] overflow-hidden shadow-2xl"
          style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.12)', minWidth: 220 }}>
          {DEV_ACCOUNTS.map(acc => (
            <button
              key={acc.role}
              onClick={() => switchTo(acc)}
              disabled={busy !== null}
              className="w-full px-4 py-3 text-left text-[13px] font-medium flex items-center gap-2.5 hover:bg-white/[0.06] transition-colors disabled:opacity-50 border-b border-white/[0.06] last:border-0"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: acc.color }} />
              <span style={{ color: acc.color }}>
                {busy === acc.role ? 'Switching...' : acc.label}
              </span>
              <span className="text-[10px] text-white/30 ml-auto" style={{ fontFamily: "'DM Mono', monospace" }}>
                {acc.email.replace('@trak.dev', '')}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[10px] font-bold tracking-wider transition-all"
          style={{
            background: open ? 'rgba(200,242,90,0.18)' : 'rgba(10,10,11,0.85)',
            border: `1px solid ${open ? 'rgba(200,242,90,0.45)' : 'rgba(255,255,255,0.14)'}`,
            color: open ? '#C8F25A' : 'rgba(255,255,255,0.35)',
            backdropFilter: 'blur(10px)',
          }}>
          {open ? <><X size={10} /> close</> : <><ArrowLeftRight size={10} /> DEV</>}
        </button>
      </div>
    </div>
  )
}
