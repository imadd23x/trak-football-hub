import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

interface Props {
  matchLabel?: string
  sessionId?: string
}

export function PostMatchPrompt({
  matchLabel = 'vs Olympiakos U19',
  sessionId = 'latest',
}: Props) {
  const dismissKey = `trak.postmatch.dismissed.${sessionId}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(dismissKey) === '1'
    } catch {
      return false
    }
  })
  const navigate = useNavigate()

  if (dismissed) return null

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissKey, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <div
      className="flex items-center gap-3 mb-4"
      style={{
        background: 'rgba(200,242,90,0.06)',
        borderTop: '1px solid rgba(200,242,90,0.18)',
        borderRight: '1px solid rgba(200,242,90,0.18)',
        borderBottom: '1px solid rgba(200,242,90,0.18)',
        borderLeft: '3px solid #C8F25A',
        borderTopLeftRadius: 0,
        borderBottomLeftRadius: 0,
        borderTopRightRadius: 14,
        borderBottomRightRadius: 14,
        padding: '14px 16px',
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 8,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: '#C8F25A',
          }}
        >
          Post-match
        </div>
        <p
          className="mt-1"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.88)',
          }}
        >
          You have an unassessed match — {matchLabel}
        </p>
      </div>

      <button
        onClick={() => navigate('/coach/assess')}
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: '#C8F25A',
          whiteSpace: 'nowrap',
        }}
      >
        Assess now →
      </button>

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          color: 'rgba(255,255,255,0.35)',
          background: 'transparent',
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
