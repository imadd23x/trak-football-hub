import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArrowDown, ArrowDownToLine, ArrowUpRight, Check, ChevronRight, MapPin, Shirt, X } from 'lucide-react'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { KitIllustration } from './KitIllustration'
import { KitPicker } from './KitPicker'
import { KitAnnouncement } from './KitAnnouncement'
import { KIT_COLORS, KIT_COLLECTIONS, KIT_PATTERNS, KIT_PATTERN_LABELS, KIT_SLOTS, KIT_SLOT_LABELS, copyKitSet, kitColorName, type KitColorPart, type KitSlot } from '@/lib/kit-templates'
import '@/index.css'
import './kit-preview.css'

const parts: { id: KitColorPart; label: string }[] = [
  { id: 'shirt', label: 'Shirt' }, { id: 'secondary', label: 'Pattern' }, { id: 'trim', label: 'Trim' },
  { id: 'shorts', label: 'Shorts' }, { id: 'socks', label: 'Socks' },
]

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function KitTemplatesPreview() {
  const [kits, setKits] = useState(() => copyKitSet(KIT_COLLECTIONS[0].kits))
  const [selected, setSelected] = useState<KitSlot>('home')
  const [part, setPart] = useState<KitColorPart>('shirt')
  const [collection, setCollection] = useState<string>(KIT_COLLECTIONS[0].id)
  const [role, setRole] = useState('Parent')
  const [announcement, setAnnouncement] = useState('')
  const kit = kits[selected]
  const activePart = kit.pattern === 'solid' && part === 'secondary' ? 'shirt' : part

  function changeColor(color: string) {
    setKits(current => ({ ...current, [selected]: { ...current[selected], [activePart]: color } }))
    setCollection('custom')
  }

  function exportSvg() {
    downloadFile(`trak-${selected}-kit.svg`, renderToStaticMarkup(<KitIllustration kit={kit} label={`${KIT_SLOT_LABELS[selected]} kit`} animated />), 'image/svg+xml')
    setAnnouncement(`${KIT_SLOT_LABELS[selected]} kit SVG downloaded.`)
  }

  return <div className="kit-room">
    <header className="kit-room-header">
      <a className="kit-wordmark" href="#top" aria-label="Trak kit room">trak<span>.</span></a>
      <span className="kit-header-rule" />
      <span className="kit-header-label">THE KIT ROOM</span>
      <span className="kit-preview-badge"><span />Template preview</span>
    </header>
    <main id="top">
      <section className="kit-room-intro">
        <div><p className="kit-kicker">ONE TEAM. EVERY COLOUR.</p><h1>Ready to wear.</h1><p className="kit-intro-copy">A clear kit for every fixture.<br />Select your colours. Let the whole team know.</p></div>
        <div className="kit-intro-note"><span>01 — 03</span><p>Home. Away. Alternate.<br />All part of the same team.</p><ArrowDown size={20} strokeWidth={1.5} /></div>
      </section>
      <div className="kit-workspace">
        <section className="kit-selection" aria-labelledby="team-kits-title">
          <div className="kit-section-title"><h2 id="team-kits-title">Your three kits</h2><span>Choose a kit to customise</span></div>
          <KitPicker kits={kits} value={selected} onChange={setSelected} />
          <div className="kit-selection-footer"><span><Shirt size={15} />Blank by design. Ready for your team.</span><button className="kit-text-button" onClick={exportSvg}>Download {KIT_SLOT_LABELS[selected].toLowerCase()} SVG <ArrowDownToLine size={14} /></button></div>
          <div className="kit-collections-heading"><h2>Start with your colours</h2><span>12 complete sets</span></div>
          <div className="kit-collections" aria-label="Team color collections">
            {KIT_COLLECTIONS.map(preset => <button key={preset.id} aria-pressed={collection === preset.id} onClick={() => {
              setKits(copyKitSet(preset.kits)); setCollection(preset.id)
              setAnnouncement(`${preset.name} applied to home, away, and alternate kits.`)
            }}>
              <span className="kit-collection-swatches" aria-hidden="true">{KIT_SLOTS.map(slot => <i key={slot} style={{ backgroundColor: preset.kits[slot].shirt }} />)}</span>
              <span>{preset.name}</span>{collection === preset.id && <Check size={13} aria-hidden="true" />}
            </button>)}
          </div>
          <p className="kit-collection-hint">Choosing a set replaces all three kits. Colour and pattern edits apply only to the selected kit.</p>
        </section>
        <aside className="kit-editor" aria-label={`Customize ${KIT_SLOT_LABELS[selected].toLowerCase()} kit`}>
          <div className="kit-editor-heading"><span className="kit-kicker">MAKE IT YOURS</span><h2>{KIT_SLOT_LABELS[selected]} kit<span>0{KIT_SLOTS.indexOf(selected) + 1}</span></h2></div>
          <fieldset className="kit-style-field"><legend>Shirt style</legend><div className="kit-pattern-options">
            {KIT_PATTERNS.map(pattern => <button key={pattern} aria-pressed={kit.pattern === pattern} onClick={() => {
              setKits(current => ({ ...current, [selected]: { ...current[selected], pattern } })); setCollection('custom')
            }}><span className={`kit-pattern-icon kit-pattern-${pattern}`} aria-hidden="true" />{KIT_PATTERN_LABELS[pattern]}</button>)}
          </div></fieldset>
          <fieldset className="kit-color-field"><legend>Colour each part</legend>
            <div className="kit-part-options">{parts.filter(p => p.id !== 'secondary' || kit.pattern !== 'solid').map(p => <button key={p.id} aria-pressed={activePart === p.id} onClick={() => setPart(p.id)}>{p.label}</button>)}</div>
            <div className="kit-current-color"><span>{kitColorName(kit[activePart])}</span><span>{kit[activePart].toUpperCase()}</span></div>
            <div className="kit-color-swatches">{KIT_COLORS.map(color => <button key={color.hex} title={color.name} aria-label={color.name} aria-pressed={kit[activePart].toLowerCase() === color.hex.toLowerCase()} style={{ backgroundColor: color.hex }} onClick={() => changeColor(color.hex)}>{kit[activePart].toLowerCase() === color.hex.toLowerCase() && <span aria-hidden="true" />}</button>)}</div>
            <label className="kit-custom-color"><span>Or choose a custom colour</span><input type="color" value={kit[activePart]} onChange={event => changeColor(event.target.value)} aria-label={`Custom ${activePart} color`} /></label>
          </fieldset>
          <div className="kit-editor-actions">
            <Drawer shouldScaleBackground={false}>
              <DrawerTrigger asChild><button className="kit-primary-button">Preview announcement <ArrowUpRight size={18} /></button></DrawerTrigger>
              <DrawerContent className="kit-event-sheet">
                <div className="kit-sheet-scroll">
                  <div className="kit-sheet-top"><span className="kit-kicker">EVENT PREVIEW</span><DrawerClose asChild><button className="kit-sheet-close" aria-label="Close announcement"><X size={18} aria-hidden="true" /></button></DrawerClose></div>
                  <div className="kit-role-switch" aria-label="Preview audience">{['Coach', 'Parent', 'Player'].map(audience => <button key={audience} aria-pressed={role === audience} onClick={() => setRole(audience)}>{audience}</button>)}</div>
                  <DrawerTitle className="kit-sheet-title">vs Riverside</DrawerTitle>
                  <DrawerDescription className="kit-sheet-description">Sunday, 18 October · Home · U14 friendly</DrawerDescription>
                  <div className="kit-event-times"><div><span>Kick-off</span><strong>17:00</strong></div><div className="kit-time-track"><span>60 min</span><span /></div><div><span>Finish</span><strong>18:00</strong></div></div>
                  <p className="kit-venue"><MapPin size={14} aria-hidden="true" />Main pitch<span>Meet 16:30</span></p>
                  <div className="kit-event-status"><span />{role === 'Coach' ? 'Published' : 'Confirmed'}</div>
                  <KitAnnouncement kit={kit} slot={selected} />
                  <p className="kit-family-note"><span>Coach’s note</span>Bring water and shin guards. See you at the pitch.</p>
                  <p className="kit-sheet-footnote">Sample event · {role.toLowerCase()} view · nothing is published</p>
                  <DrawerClose asChild><button className="kit-primary-button">Done <Check size={16} aria-hidden="true" /></button></DrawerClose>
                </div>
              </DrawerContent>
            </Drawer>
            <button className="kit-secondary-button" onClick={() => {
              downloadFile('trak-team-kits.json', JSON.stringify(kits, null, 2) + '\n', 'application/json')
              setAnnouncement('Home, away, and alternate kit templates downloaded as JSON.')
            }}>Export all three kits <ArrowDownToLine size={15} /></button>
            <p>Preview only. Export your set to keep your colours.</p>
          </div>
        </aside>
      </div>
      <section className="kit-family-preview" aria-labelledby="family-preview-heading">
        <div><p className="kit-kicker">ON THE SAME PAGE</p><h2 id="family-preview-heading">No more <br />“which kit?”</h2><p>The coach selects it once. Players and parents see the same complete kit, with colours written out for clarity.</p><span>Made for the event bottom sheet <ChevronRight size={14} /></span></div>
        <KitAnnouncement key={selected} kit={kit} slot={selected} />
      </section>
      <footer className="kit-room-footer"><span>trak. <span>SHOW UP READY.</span></span><span>6 styles · 24 colours · endless combinations</span></footer>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </main>
  </div>
}
