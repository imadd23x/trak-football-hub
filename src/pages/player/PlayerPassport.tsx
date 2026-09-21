import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Share2, Download } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { scoreToBand } from '@/lib/rating-engine'
import { toast } from 'sonner'
import { captureElementToPng, shareOrSaveImage } from '@/lib/card-export'

type BandKey = 'exceptional' | 'standout' | 'good' | 'steady' | 'mixed' | 'developing' | 'difficult'

type SeasonSummary = {
  label: string   // e.g. "2025–26"
  club: string
  ageGroup: string
  matches: number
  goals: number
  assists: number
}

type CareerStats = {
  totalMatches: number
  totalGoals: number
  totalAssists: number
}

type Award = {
  id: string
  award_type: string
  awarded_for: string | null
  created_at: string
}

const AWARD_LABELS: Record<string, string> = {
  player_of_week:   'Player of the Week',
  player_of_month:  'Player of the Month',
  most_improved:    'Most Improved',
  top_scorer:       'Top Scorer',
  player_of_season: 'Player of the Season',
}

function seasonLabel(date: Date) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  return `${start}–${String(start + 1).slice(2)}`
}

// ── Card geometry (all px, no calc or %) ──────────────────────────────────
const CARD_W   = 390
const CARD_PAD = 28
const SHELL_W   = 430  // MobileShell max-width
const SHELL_PAD = 20   // MobileShell px-5
const CONTENT  = CARD_W - CARD_PAD * 2   // 334
const COL3_GAP = 8
const COL3_W   = Math.floor((CONTENT - COL3_GAP * 2) / 3)  // 106

const MONO: React.CSSProperties = { fontFamily: "'DM Mono', monospace" }
const SANS: React.CSSProperties = { fontFamily: "'DM Sans', sans-serif" }

export default function PlayerPassport() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const cardRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef<HTMLDivElement>(null)

  const [details,   setDetails]   = useState<any>(null)
  const [seasons,   setSeasons]   = useState<SeasonSummary[]>([])
  const [career,    setCareer]    = useState<CareerStats | null>(null)
  const [awards,    setAwards]    = useState<Award[]>([])
  const [loading,   setLoading]   = useState(true)
  const [exporting, setExporting] = useState(false)

  // The card is a fixed CARD_W px so the exported PNG is identical on every
  // device. On viewports narrower than CARD_W + shell padding that overflows,
  // so shrink it visually only — the card keeps its real px geometry, and
  // captureCard() removes this transform before html2canvas runs.
  const [cardScale, setCardScale] = useState(1)
  const [cardH, setCardH]         = useState(0)

  useEffect(() => {
    const fit = () => {
      // documentElement.clientWidth, not window.innerWidth: innerWidth grows
      // with any horizontal overflow, which would feed back into the scale.
      const vw = document.documentElement.clientWidth || window.innerWidth
      const avail = Math.min(vw, SHELL_W) - SHELL_PAD * 2
      setCardScale(Math.min(1, avail / CARD_W))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight))
    ro.observe(el)
    setCardH(el.offsetHeight)
    return () => ro.disconnect()
  }, [loading, seasons, awards, career])

  useEffect(() => { if (user) loadData() }, [user])

  const loadData = async () => {
    const [{ data: det }, { data: rawMatches }] = await Promise.all([
      supabase.from('player_details').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('matches')
        .select('created_at, goals, assists')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true }),
    ])
    setDetails(det)

    const { data: squadRows } = await supabase
      .from('squad_players').select('id').eq('linked_player_id', user!.id)
    const squadIds = (squadRows ?? []).map(r => r.id)

    const awardsRes = squadIds.length > 0
      ? await supabase.from('recognition_awards')
          .select('id, award_type, awarded_for, created_at')
          .in('squad_player_id', squadIds)
          .order('created_at', { ascending: false })
      : { data: null }
    setAwards((awardsRes.data ?? []) as Award[])

    // Group by academic season
    const seasonMap: Record<string, typeof rawMatches> = {}
    for (const m of rawMatches ?? []) {
      const lbl = seasonLabel(new Date(m.created_at ?? ''))
      if (!seasonMap[lbl]) seasonMap[lbl] = []
      seasonMap[lbl]!.push(m)
    }

    const seasonRows: SeasonSummary[] = Object.entries(seasonMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([label, ms]) => ({
        label,
        club:     det?.current_club || 'Academy',
        ageGroup: det?.age_group    || '',
        matches:  ms!.length,
        goals:    ms!.reduce((s, m) => s + (m.goals   ?? 0), 0),
        assists:  ms!.reduce((s, m) => s + (m.assists ?? 0), 0),
      }))
    setSeasons(seasonRows)

    const allMatches = rawMatches ?? []
    if (allMatches.length > 0) {
      setCareer({
        totalMatches: allMatches.length,
        totalGoals:   allMatches.reduce((s, m) => s + (m.goals   ?? 0), 0),
        totalAssists: allMatches.reduce((s, m) => s + (m.assists ?? 0), 0),
      })
    }
    setLoading(false)
  }

  // ── capture ───────────────────────────────────────────────────────────────
  // The capture itself lives in card-export.ts, shared with the Evolution Card.
  // Render at true CARD_W geometry: the fit-to-viewport transform comes off for
  // the duration of the capture so the PNG is identical on every device.
  const captureCard = () => captureElementToPng(cardRef.current, {
    background: '#0D0D0F',
    scale: 3,
    width: CARD_W,
    unscale: scaleRef.current,
  })

  const handleShare = async () => {
    setExporting(true)
    try {
      const outcome = await shareOrSaveImage(await captureCard(), {
        filename: 'trak-passport.png',
        title: `${profile?.full_name ?? 'Player'} · TRAK Passport`,
      })
      if (outcome === 'saved') toast.success('Passport saved as image')
      if (outcome === 'failed') toast.error('Could not export passport')
    } finally { setExporting(false) }
  }

  const handleDownload = async () => {
    setExporting(true)
    try {
      const blob = await captureCard()
      if (!blob) throw new Error('failed')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'trak-passport.png'; a.click()
      URL.revokeObjectURL(url)
      toast.success('Passport downloaded')
    } catch { toast.error('Could not export passport') }
    finally { setExporting(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0B', ...SANS }}>
      <div style={{ maxWidth: 430, margin: '0 auto', padding: '20px 20px 80px' }}>

        {/* Nav */}
        <div className="relative flex items-center justify-center mb-6 h-10">
          <button onClick={() => navigate(-1)} className="absolute left-0 flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 999, background: '#101012', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.88)' }}>
            <ArrowLeft size={16} />
          </button>
          <span style={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.88)' }}>Player Passport</span>
        </div>

        {/* ═══════════ PASSPORT CARD ═══════════
            All widths explicit px. No CSS gap/grid.
            No inline-flex. Overflow protected on every text node.
        ═══════════════════════════════════════ */}
        <div style={{
          width: CARD_W * cardScale,
          height: cardH ? cardH * cardScale : undefined,
          overflow: 'hidden',
        }}>
        <div ref={scaleRef} style={{ transform: `scale(${cardScale})`, transformOrigin: 'top left' }}>
        <div
          ref={cardRef}
          style={{ width: CARD_W, background: '#0D0D0F', borderRadius: 24, overflow: 'hidden', position: 'relative', ...SANS }}
        >

          {/* Centred watermark */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            ...MONO, fontSize: 120, fontWeight: 700,
            color: 'rgba(200,242,90,0.03)',
            userSelect: 'none', pointerEvents: 'none',
            whiteSpace: 'nowrap', lineHeight: 1, zIndex: 0,
          }}>TRAK</div>

          <div style={{ position: 'relative', zIndex: 1 }}>

            {/* ── Header: name + identity ── */}
            <div style={{
              width: CARD_W, boxSizing: 'border-box',
              padding: `32px ${CARD_PAD}px 26px`,
              background: 'linear-gradient(160deg,#131418 0%,#0D0D0F 70%)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ marginBottom: 20 }}>
                <span style={{ ...MONO, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#C8F25A' }}>TRAK</span>
                <span style={{ ...MONO, fontSize: 9, textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginLeft: 8 }}>PLAYER PASSPORT</span>
              </div>

              <div style={{
                fontSize: 30, fontWeight: 300, color: '#FFFFFF', lineHeight: 1.1, marginBottom: 16,
                maxWidth: CONTENT, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {profile?.full_name || '—'}
              </div>

              {/* Pills: position, club, age group, shirt number */}
              <div style={{ fontSize: 0 }}>
                {[
                  details?.position,
                  details?.current_club,
                  details?.age_group,
                  details?.shirt_number ? `#${details.shirt_number}` : null,
                ].filter(Boolean).map((text, i) => (
                  <span key={i} style={{
                    display: 'inline-block', verticalAlign: 'middle',
                    marginRight: 8, marginBottom: 6,
                    padding: '4px 12px', borderRadius: 999,
                    fontSize: 11, color: 'rgba(255,255,255,0.55)',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    maxWidth: 160, overflow: 'hidden',
                    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                    {text}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Career totals ── */}
            {career && (
              <div style={{
                width: CARD_W, boxSizing: 'border-box',
                padding: `20px ${CARD_PAD}px`,
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ ...MONO, fontSize: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 12 }}>
                  CAREER TOTALS
                </div>
                <div style={{ width: CONTENT, fontSize: 0 }}>
                  {[
                    { label: 'MATCHES', value: career.totalMatches },
                    { label: 'GOALS',   value: career.totalGoals   },
                    { label: 'ASSISTS', value: career.totalAssists  },
                  ].map(({ label, value }, i) => (
                    <div key={label} style={{
                      display: 'inline-block', verticalAlign: 'top',
                      width: COL3_W, marginRight: i < 2 ? COL3_GAP : 0,
                      padding: '14px 0', borderRadius: 14, textAlign: 'center',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      boxSizing: 'border-box',
                    }}>
                      <div style={{ fontSize: 28, fontWeight: 300, color: '#C8F25A', lineHeight: 1 }}>{value}</div>
                      <div style={{ ...MONO, fontSize: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginTop: 6 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Season History ── */}
            {seasons.length > 0 && (
              <div style={{
                width: CARD_W, boxSizing: 'border-box',
                padding: `20px ${CARD_PAD}px`,
                borderBottom: awards.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                <div style={{ ...MONO, fontSize: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 14 }}>
                  SEASON HISTORY
                </div>

                {seasons.map((s, si) => (
                  <div key={s.label} style={{
                    width: CONTENT, boxSizing: 'border-box',
                    padding: '14px 16px', borderRadius: 14,
                    marginBottom: si < seasons.length - 1 ? 10 : 0,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    {/* Season label row */}
                    <div style={{ marginBottom: 4 }}>
                      <span style={{
                        display: 'inline-block', verticalAlign: 'middle',
                        fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.9)',
                        maxWidth: CONTENT - 32, overflow: 'hidden',
                        whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      }}>
                        {s.label}
                      </span>
                    </div>

                    {/* Club · age group */}
                    <div style={{
                      fontSize: 12, color: 'rgba(255,255,255,0.4)',
                      marginBottom: 12,
                      maxWidth: CONTENT - 32, overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    }}>
                      {s.club}{s.ageGroup ? ` · ${s.ageGroup}` : ''}
                    </div>

                    {/* 3 stats inline */}
                    <div style={{ width: CONTENT - 32, fontSize: 0 }}>
                      {[
                        { lbl: 'Matches', val: s.matches },
                        { lbl: 'Goals',   val: s.goals   },
                        { lbl: 'Assists', val: s.assists  },
                      ].map(({ lbl, val }, i) => (
                        <div key={lbl} style={{
                          display: 'inline-block', verticalAlign: 'top',
                          width: Math.floor((CONTENT - 32) / 3),
                          marginRight: i < 2 ? 0 : 0,
                          textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right',
                        }}>
                          <div style={{ fontSize: 22, fontWeight: 300, color: '#FFFFFF', lineHeight: 1 }}>{val}</div>
                          <div style={{ ...MONO, fontSize: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginTop: 4 }}>{lbl}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Recognition ── */}
            {awards.length > 0 && (
              <div style={{
                width: CARD_W, boxSizing: 'border-box',
                padding: `20px ${CARD_PAD}px`,
              }}>
                <div style={{ ...MONO, fontSize: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 14 }}>
                  RECOGNITION
                </div>

                {awards.map((a, ai) => {
                  const label = AWARD_LABELS[a.award_type] || a.award_type
                  const DATE_W = 68
                  return (
                    <div key={a.id} style={{
                      width: CONTENT, boxSizing: 'border-box',
                      padding: '10px 14px', borderRadius: 12,
                      marginBottom: ai < awards.length - 1 ? 8 : 0,
                      background: 'rgba(200,242,90,0.04)',
                      border: '1px solid rgba(200,242,90,0.1)',
                      fontSize: 0,
                    }}>
                      <div style={{
                        display: 'inline-block', verticalAlign: 'middle',
                        width: CONTENT - 28 - DATE_W,
                      }}>
                        <div style={{
                          fontSize: 12, color: 'rgba(255,255,255,0.88)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {label}
                        </div>
                        {a.awarded_for && (
                          <div style={{
                            fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {a.awarded_for}
                          </div>
                        )}
                      </div>
                      <div style={{
                        display: 'inline-block', verticalAlign: 'middle',
                        width: DATE_W, textAlign: 'right',
                        ...MONO, fontSize: 9, color: 'rgba(255,255,255,0.28)',
                      }}>
                        {new Date(a.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {!loading && seasons.length === 0 && awards.length === 0 && (
              <div style={{ padding: '48px 32px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.28)', lineHeight: 1.8, margin: 0 }}>
                  Your passport is empty for now.<br />
                  As your coach logs matches,<br />
                  your career will build up here.
                </p>
              </div>
            )}

            {/* ── Footer ── */}
            <div style={{
              width: CARD_W, boxSizing: 'border-box',
              padding: `14px ${CARD_PAD}px`,
              background: 'rgba(200,242,90,0.025)',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              fontSize: 0,
            }}>
              <span style={{ ...MONO, display: 'inline-block', verticalAlign: 'middle', fontSize: 11, textTransform: 'uppercase', color: '#C8F25A' }}>TRAK</span>
              <span style={{ ...MONO, display: 'inline-block', verticalAlign: 'middle', fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 6 }}>· Verified Career Record</span>
              <span style={{ ...MONO, display: 'inline-block', verticalAlign: 'middle', fontSize: 9, color: 'rgba(255,255,255,0.18)', float: 'right' }}>trak.football</span>
            </div>

          </div>
        </div>
        </div>
        </div>
        {/* ═══════════ END CARD ═══════════ */}

        {/* Buttons */}
        <div style={{ marginTop: 20, display: 'flex' }}>
          <button
            onClick={handleShare} disabled={exporting || loading}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '14px 0', borderRadius: 14, marginRight: 12, border: 'none', cursor: 'pointer',
              background: exporting ? 'rgba(200,242,90,0.5)' : '#C8F25A',
              color: '#000', fontSize: 14, fontWeight: 500, opacity: loading ? 0.4 : 1, ...SANS,
            }}
          >
            <Share2 size={14} style={{ marginRight: 6 }} />
            {exporting ? 'Exporting…' : 'Share'}
          </button>
          <button
            onClick={handleDownload} disabled={exporting || loading}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '14px 0', borderRadius: 14, cursor: 'pointer',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.7)', fontSize: 14, opacity: loading ? 0.4 : 1, ...SANS,
            }}
          >
            <Download size={14} style={{ marginRight: 6 }} />
            Save Image
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 14, lineHeight: 1.6 }}>
          Exports as a PNG image you can share anywhere
        </p>

      </div>
    </div>
  )
}
