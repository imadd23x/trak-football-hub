import { useEffect, useState } from 'react'
import { BLANK_KIT, copyKitSet, snapshotKit, type EventKitSnapshot, type TeamKitSet } from '@/lib/kit-templates'
import { loadTeamKits, saveTeamKits } from '@/lib/team-kits'
import { KitPicker } from './KitPicker'
import { KitAnnouncement } from './KitAnnouncement'
import { TeamKitEditor } from './TeamKitEditor'
import { Button } from '@/components/arc/button/button'
import { EditIcon } from '@/components/trak/IconAction'

/** Key by coach + event squad at the caller, so changing scope discards stale reads. */
export function EventKitField({ coachId, squad, value, onChange }: {
  coachId: string; squad: string | null; value: EventKitSnapshot | null; onChange: (value: EventKitSnapshot | null) => void
}) {
  const [kits, setKits] = useState<TeamKitSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState<TeamKitSet | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)
    loadTeamKits(coachId, squad).then(result => { if (active) setKits(result) }, () => { if (active) setLoadError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [coachId, squad, attempt])

  async function save() {
    if (!draft || saving) return
    setSaving(true)
    setSaveError(false)
    try {
      const result = await saveTeamKits(coachId, squad, draft)
      setKits(result)
      setDraft(null)
      setSaved(true)
    } catch { setSaveError(true) } finally { setSaving(false) }
  }

  return <section aria-label="Event kit" className="space-y-3 arc">
    <div><h3 className="text-sm font-medium">Team kits · {squad || 'Whole roster'}</h3>
      <p className="text-xs text-muted-foreground mt-1">Choose what players should wear. Home, away and alternate are independent of the match venue.</p></div>
    {value && <>
      <KitAnnouncement kit={value.design} slot={value.slot} animated={false} />
      <p className="text-xs text-muted-foreground">This is the kit saved with this event. Choose a kit below to replace it.</p>
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange(null)}>Use text instructions instead</Button>
    </>}
    {loading ? <p role="status" className="text-sm">Loading team kits…</p> : loadError ? <div role="alert" className="space-y-2 text-sm">
      <p>Couldn't load team kits. Your event selection is still here.</p>
      <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt(n => n + 1)}>Retry team kits</Button>
    </div> : draft ? <div className="space-y-3">
      <TeamKitEditor value={draft} onChange={setDraft} disabled={saving} />
      <p className="text-xs text-muted-foreground">Save your team colors here, then choose a kit for this event. Existing events keep their selected kit.</p>
      {saveError && <p role="alert" className="text-sm text-destructive">Couldn't save team kits. Your colors are still here. Try again.</p>}
      <div className="flex gap-2">
        <Button type="button" size="md" onClick={save} disabled={saving}>{saving ? 'Saving kits…' : 'Save team kits'}</Button>
        <Button type="button" size="md" variant="secondary" disabled={saving} onClick={() => { setDraft(null); setSaveError(false) }}>Cancel kit changes</Button>
      </div>
    </div> : <>
      {kits ? <KitPicker kits={kits} value={value && JSON.stringify(value.design) === JSON.stringify(kits[value.slot]) ? value.slot : null}
        onChange={slot => onChange(snapshotKit(kits, slot))} /> : <p className="text-sm text-muted-foreground">Set up home, away and alternate kits for this squad.</p>}
      {/* TRAK-455: editing the kits is a pencil; setting them up the first time keeps its words. */}
      {kits ? <EditIcon label="Edit team kits" onClick={() => { setSaved(false); setDraft(copyKitSet(kits)) }} />
        : <Button type="button" variant="secondary" size="md" onClick={() => {
          setSaved(false)
          setDraft(copyKitSet({ version: 1, home: BLANK_KIT, away: BLANK_KIT, alternate: BLANK_KIT }))
        }}>Set up team kits</Button>}
      {saved && <p role="status" className="text-xs text-muted-foreground">Team kits saved. Choose one above to use it for this event.</p>}
    </>}
  </section>
}
