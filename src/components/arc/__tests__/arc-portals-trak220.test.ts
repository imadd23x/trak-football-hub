import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// TRAK-220 (20 Oct live run): Arc's tokens are scoped to `.arc` (TRAK-163), and
// Radix portals menus, lists and dialogs to <body>, outside every `.arc`. A
// portalled panel without the class has no --surface-raised, so its background
// is transparent: the card's Edit/Unpublish menu and its expanded view were
// see-through on the light theme.
const ARC = join(process.cwd(), 'src/components/arc')
const source = (file: string) => readFileSync(join(ARC, file), 'utf8')

describe('TRAK-220: every Arc panel opened into <body> carries the arc class', () => {
  it.each([
    ['split-button/split-button.tsx', /<DropdownPrimitive\.Content className=\{`arc \$\{styles\.menu\}`\}/],
    ['dropdown-menu/dropdown-menu.tsx', /<DropdownPrimitive\.Content className=\{`arc \$\{styles\.menu\}`\}/],
    ['select/select.tsx', /<SelectPrimitive\.Content className=\{`arc \$\{styles\.content\}`\}/],
    ['notification-center/notification-center.tsx', /<PopoverPrimitive\.Content className=\{`arc \$\{styles\.panel\}`\}/],
    ['card/card.tsx', /className=\{\["arc", className, styles\.panel\]/],
    // TRAK-272: Arc's Button group's More menu.
    ['button-group/button-group.tsx', /<DropdownPrimitive\.Content className=\{`arc \$\{styles\.menu\}`\}/],
    // TRAK-328: Arc's tooltip (the lock on "How strong are they?").
    ['tooltip/tooltip.tsx', /<TooltipPrimitive\.Content className=\{`arc \$\{styles\.tooltip\}`\}/],
  ])('%s', (file, pattern) => {
    expect(source(file)).toMatch(pattern)
  })

  it('no other Arc component portals a panel unchecked', () => {
    const portalling = readdirSync(ARC, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .flatMap(dir => readdirSync(join(ARC, dir.name)).filter(f => f.endsWith('.tsx')).map(f => `${dir.name}/${f}`))
      .filter(file => /\.Portal\b/.test(source(file)))
    // The bottom sheet takes its class from callers; they pass "arc" (EventSheet).
    expect(portalling.sort()).toEqual(['bottom-sheet/bottom-sheet.tsx', 'button-group/button-group.tsx', 'card/card.tsx', 'dropdown-menu/dropdown-menu.tsx',
      'notification-center/notification-center.tsx', 'select/select.tsx', 'split-button/split-button.tsx', 'tooltip/tooltip.tsx'])
  })

  it('every bottom sheet in the app passes className="arc"', () => {
    const files = (readdirSync(join(process.cwd(), 'src'), { recursive: true }) as string[])
      .filter(file => file.endsWith('.tsx') && !file.includes('__tests__') && !file.startsWith('components/arc/'))
      .map(file => `src/${file}`)
      .filter(file => readFileSync(join(process.cwd(), file), 'utf8').includes('<BottomSheet'))
    // TRAK-263: the coach's player profile editor (foot, nationality, traits). Imad, 23 Oct: Home's Take register and View log.
    // TRAK-294: New drill. TRAK-285: a player's line-up sheet on a phone. TRAK-339: Use a past plan, and the register
    // TRAK-340: the planner's Add a part, See more drills, Write your own and Leave. TRAK-298: a training's Who's here and log.
    // TRAK-353: a player's position, roles and Can also play. TRAK-354: a player's objectives. TRAK-357: New formation and Rename.
    expect(files.sort()).toEqual(['src/components/coach/CoachWeekStrip.tsx', 'src/components/coach/games/LineUpAndJobs.tsx',
      'src/components/coach/season-plan/PlayerObjectivesSheet.tsx',
      'src/components/coach/squad/PlayerFactsEditor.tsx', 'src/components/coach/squad/PositionAndRolesSheet.tsx',
      'src/components/coach/squad/formations/NameSheet.tsx', 'src/components/coach/training/DrillSheet.tsx',
      'src/components/coach/training/PastPlanSheet.tsx', 'src/components/coach/training/PlannerSheets.tsx', 'src/components/coach/training/RegisterSheet.tsx', 'src/components/trak/EventSheet.tsx'])
    for (const file of files) {
      const sheets = readFileSync(join(process.cwd(), file), 'utf8').match(/<BottomSheet\b[^>]*>/gs) ?? []
      expect(sheets.length, file).toBeGreaterThan(0)
      for (const sheet of sheets) expect(sheet, file).toContain('className="arc"')
    }
  })
})
