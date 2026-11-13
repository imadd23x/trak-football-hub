import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixtureImport } from '../FixtureImport'
import { FIXTURE_TEMPLATE_CSV, fixtureKey, type Fixture } from '@/lib/fixtures-csv'

// TRAK-129 (J8.6): the coach drops the league's CSV, checks every row, fixes
// what can't be read, then confirms. Nothing is saved before Confirm.

const HEADER = 'Date,Kickoff,Meet time,Opponent,Home or away,Venue,Kit'
const csv = (...lines: string[]) => new File([[HEADER, ...lines].join('\n')], 'fixtures.csv', { type: 'text/csv' })
const user = () => userEvent.setup({ applyAccept: false })

function setup(props: Partial<React.ComponentProps<typeof FixtureImport>> = {}) {
  const onConfirm = vi.fn<(fixtures: Fixture[]) => Promise<void>>().mockResolvedValue(undefined)
  render(<FixtureImport onConfirm={onConfirm} {...props} />)
  return { onConfirm }
}

const fileInput = () => screen.getByLabelText(/choose a csv file/i)
const addButton = () => screen.getByRole('button', { name: /^add \d+ fixtures?$/i })

describe('FixtureImport', () => {
  it('offers the template as a CSV download', () => {
    setup()
    const link = screen.getByRole('link', { name: /download the template/i })
    expect(link).toHaveAttribute('download', 'trak-fixtures-template.csv')
    const href = link.getAttribute('href')!
    expect(href.startsWith('data:text/csv;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(href.slice('data:text/csv;charset=utf-8,'.length))).toBe(FIXTURE_TEMPLATE_CSV)
  })

  it('previews every row and saves nothing until Confirm', async () => {
    const { onConfirm } = setup()
    await user().upload(fileInput(), csv('2026-11-14,10:00,09:15,Rivals FC,Away,Rivals Park,White', '2026-11-17,17:30,,,,Main pitch,'))

    expect(await screen.findByText(/Sat 14 Nov/)).toBeInTheDocument()
    expect(screen.getByText(/Match vs Rivals FC \(away\)/)).toBeInTheDocument()
    expect(screen.getByText(/Tue 17 Nov/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    await user().click(addButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const saved = onConfirm.mock.calls[0][0]
    expect(saved.map(f => [f.line, f.kind, f.date, f.kickoff])).toEqual([[2, 'match', '2026-11-14', '10:00'], [3, 'training', '2026-11-17', '17:30']])
    expect(await screen.findByText('Added 2 fixtures.')).toBeInTheDocument()
  })

  it('blocks Confirm while a row needs fixing, and accepts it once the coach corrects it', async () => {
    const { onConfirm } = setup()
    await user().upload(fileInput(), csv('2026-11-14,10:00,,Rivals FC,,,', '2026-02-31,18:00,,Other FC,,,'))

    const bad = await screen.findByRole('listitem', { name: 'Line 3' })
    expect(within(bad).getByText(/not a real date/i)).toBeInTheDocument()
    expect(screen.getByText(/1 needs fixing/i)).toBeInTheDocument()
    expect(addButton()).toBeDisabled()

    await user().click(within(bad).getByRole('button', { name: /edit line 3/i }))
    const date = within(bad).getByLabelText('Date')
    await user().clear(date)
    await user().type(date, '2026-02-28')

    expect(within(bad).queryByText(/not a real date/i)).not.toBeInTheDocument()
    expect(addButton()).toBeEnabled()
    expect(addButton()).toHaveAccessibleName('Add 2 fixtures')
    await user().click(addButton())
    expect(onConfirm.mock.calls[0][0].map(f => f.date)).toEqual(['2026-11-14', '2026-02-28'])
  })

  it('lets the coach remove a row instead of fixing it', async () => {
    const { onConfirm } = setup()
    await user().upload(fileInput(), csv('2026-11-14,10:00,,Rivals FC,,,', 'next week,18:00,,Other FC,,,'))
    const bad = await screen.findByRole('listitem', { name: 'Line 3' })
    await user().click(within(bad).getByRole('button', { name: /remove line 3/i }))

    expect(screen.queryByRole('listitem', { name: 'Line 3' })).not.toBeInTheDocument()
    expect(addButton()).toHaveAccessibleName('Add 1 fixture')
    await user().click(addButton())
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1)
  })

  it('skips fixtures already on the schedule, so importing the same file again adds nothing', async () => {
    const existing = new Set([fixtureKey({ date: '2026-11-14', kickoff: '10:00', opponent: 'Rivals FC' })])
    const { onConfirm } = setup({ existingKeys: existing })
    await user().upload(fileInput(), csv('2026-11-14,10:00,,Rivals FC,,,', '2026-11-21,10:00,,Other FC,,,'))

    const known = await screen.findByRole('listitem', { name: 'Line 2' })
    expect(within(known).getByText(/already in your events/i)).toBeInTheDocument()
    await user().click(addButton())
    expect(onConfirm.mock.calls[0][0].map(f => f.opponent)).toEqual(['Other FC'])
  })

  it('says so, and offers nothing to add, when every fixture is already on the schedule', async () => {
    const existing = new Set([fixtureKey({ date: '2026-11-14', kickoff: '10:00', opponent: 'Rivals FC' })])
    const { onConfirm } = setup({ existingKeys: existing })
    await user().upload(fileInput(), csv('2026-11-14,10:00,,Rivals FC,,,'))
    expect(await screen.findByText(/nothing new to add/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^add \d+ fixtures?$/i })).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('refuses a PDF and points to the template', async () => {
    const { onConfirm } = setup()
    await user().upload(fileInput(), new File(['%PDF-1.4'], 'league.pdf', { type: 'application/pdf' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a csv file.*template/i)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows what is wrong with a file it cannot use', async () => {
    setup()
    await user().upload(fileInput(), new File(['Kickoff,Opponent\n18:00,Rivals FC\n'], 'x.csv', { type: 'text/csv' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no date column/i)
  })

  it('keeps every row when saving fails, and lets the coach try again', async () => {
    const onConfirm = vi.fn<(fixtures: Fixture[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)
    render(<FixtureImport onConfirm={onConfirm} />)
    await user().upload(fileInput(), csv('2026-11-14,10:00,,Rivals FC,,,'))
    await user().click(await screen.findByRole('button', { name: 'Add 1 fixture' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i)
    expect(screen.getByRole('listitem', { name: 'Line 2' })).toBeInTheDocument()
    await user().click(addButton())
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Added 1 fixture.')).toBeInTheDocument()
  })

  it('keeps refusing US-style dates in a month-first file after an edit, so 11/03 never becomes 11 March', async () => {
    setup()
    await user().upload(fileInput(), csv('11/13/2026,18:00,,Rivals FC,,,'))
    const row = await screen.findByRole('listitem', { name: 'Line 2' })
    expect(within(row).getByText(/month first/i)).toBeInTheDocument()
    await user().click(within(row).getByRole('button', { name: /edit line 2/i }))
    const date = within(row).getByLabelText('Date')
    await user().clear(date)
    await user().type(date, '11/03/2026')
    expect(within(row).getByText(/month first/i)).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('takes a dropped file, for a coach on a laptop', async () => {
    setup()
    const zone = screen.getByTestId('fixture-drop-zone')
    fireEvent.drop(zone, { dataTransfer: { files: [csv('2026-11-14,10:00,,Rivals FC,,,')] } })
    expect(await screen.findByRole('listitem', { name: 'Line 2' })).toBeInTheDocument()
  })
})
