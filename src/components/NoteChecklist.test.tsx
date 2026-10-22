// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useForgeboard } from '../hooks/useForgeboard'
import { createSeedWorkspace } from '../seed'
import type { NoteChecklistItem, Workspace } from '../types'
import { NoteChecklist } from './NoteChecklist'

let cached: Workspace | undefined
vi.mock('../lib/db', () => ({
  loadCachedWorkspace: async () => cached,
  loadConnection: async () => undefined,
  countMutations: async () => 0,
  enqueueMutation: async () => {},
  saveCachedWorkspace: async () => {},
}))

beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { cleanup(); cached = undefined; vi.unstubAllGlobals() })

function Harness({ failAdd = false }: { failAdd?: boolean }) {
  const forge = useForgeboard()
  if (!forge.ready) return <p>Loading</p>
  const checklistForge = failAdd ? { ...forge, actions: { ...forge.actions, addNoteChecklistItem: () => { throw new Error('Could not add this item.') } } } : forge
  return <><NoteChecklist forge={checklistForge} note={forge.workspace.personalNotes![0]} /><output aria-label="Saved checklist">{JSON.stringify(forge.workspace.personalNotes![0].checklist ?? [])}</output></>
}

async function start(items: NoteChecklistItem[] = [], failAdd = false) {
  cached = createSeedWorkspace()
  cached.personalNotes = [{ id: 'note', title: 'Daily notes', body: 'Keep the original writing.', checklist: items, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' }]
  render(<Harness failAdd={failAdd} />)
  await screen.findByLabelText('New checklist item')
}

function saved(): NoteChecklistItem[] { return JSON.parse(screen.getByLabelText('Saved checklist').textContent ?? '[]') }
function addText(text: string) {
  fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add checklist item' }))
}
function options(text: string) { fireEvent.click(screen.getByRole('button', { name: `Options for ${text}` })) }

describe('Note checklist', () => {
  it('adds sub-items and sub-sub-items with independent checkboxes and immediate saves', async () => {
    await start()
    addText('Tuesday')
    options('Tuesday')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Tuesday' }))
    const child = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(child)
    fireEvent.change(child, { target: { value: 'Wed' } })
    options('Wed')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Wed' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Orange chicken' } })
    expect(screen.getByRole('listitem', { name: 'Checklist item: Tuesday' }).getAttribute('aria-level')).toBe('1')
    expect(screen.getByRole('listitem', { name: 'Checklist item: Wed' }).getAttribute('aria-level')).toBe('2')
    expect(screen.getByRole('listitem', { name: 'Checklist item: Orange chicken' }).getAttribute('aria-level')).toBe('3')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    expect((screen.getByRole('checkbox', { name: 'Tuesday' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Wed' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Orange chicken' }))
    expect(screen.getByText('2 of 3 done')).toBeTruthy()
    expect(saved().map((item) => item.text)).toEqual(['Tuesday', 'Wed', 'Orange chicken'])
    const [parent, nested, deep] = saved()
    expect(nested.parentId).toBe(parent.id)
    expect(deep.parentId).toBe(nested.id)
    expect(parent.completedAt).toBeTruthy()
    expect(nested.completedAt).toBeUndefined()
    expect(deep.completedAt).toBeTruthy()
  })

  it('supports Enter, Tab, Shift+Tab, stable text focus, and grip arrow-key ordering', async () => {
    await start()
    addText('Tuesday')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Tuesday' }), { key: 'Enter' })
    const next = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(next)
    fireEvent.change(next, { target: { value: 'Wed' } })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'Tab' })
    expect(saved()[1].parentId).toBe(saved()[0].id)
    fireEvent.keyDown(next, { key: 'Enter' })
    const deep = screen.getByRole('textbox', { name: 'Edit New item' })
    fireEvent.change(deep, { target: { value: 'Orange chicken' } })
    fireEvent.keyDown(deep, { key: 'Tab' })
    expect(saved()[2].parentId).toBe(saved()[1].id)
    fireEvent.keyDown(deep, { key: 'Tab', shiftKey: true })
    expect(saved()[2].parentId).toBe(saved()[0].id)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Orange chicken' }), { key: 'ArrowUp' })
    const list = screen.getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))
    expect(list).toEqual(['Checklist item: Tuesday', 'Checklist item: Orange chicken', 'Checklist item: Wed'])
  })

  it('slides a handle right to indent and left to outdent while ignoring vertical drags', async () => {
    await start()
    addText('Tuesday')
    addText('Wed')
    const grip = screen.getByRole('button', { name: 'Move Wed' })
    fireEvent.pointerDown(grip, { clientX: 70, clientY: 50, pointerId: 1, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 115, clientY: 52, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 115, clientY: 52, pointerId: 1 })
    expect(saved()[1].parentId).toBe(saved()[0].id)
    fireEvent.pointerDown(grip, { clientX: 110, clientY: 50, pointerId: 2, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 60, clientY: 51, pointerId: 2 })
    fireEvent.pointerUp(grip, { clientX: 60, clientY: 51, pointerId: 2 })
    expect(saved()[1].parentId).toBeUndefined()
    fireEvent.pointerDown(grip, { clientX: 70, clientY: 50, pointerId: 3, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 110, clientY: 120, pointerId: 3 })
    fireEvent.pointerUp(grip, { clientX: 110, clientY: 120, pointerId: 3 })
    expect(saved()[1].parentId).toBeUndefined()
  })

  it('provides explicit indent/outdent buttons and skips invalid nesting', async () => {
    await start()
    addText('Tuesday')
    addText('Wed')
    options('Tuesday')
    expect((screen.getByRole('button', { name: 'Indent Tuesday' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Outdent Tuesday' }) as HTMLButtonElement).disabled).toBe(true)
    options('Wed')
    fireEvent.click(screen.getByRole('button', { name: 'Indent Wed' }))
    expect(saved()[1].parentId).toBe(saved()[0].id)
    fireEvent.click(screen.getByRole('button', { name: 'Outdent Wed' }))
    expect(saved()[1].parentId).toBeUndefined()
    const before = saved()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Wed' }), { key: 'Tab', ctrlKey: true })
    expect(saved()).toEqual(before)
  })

  it('soft-deletes a group, offers undo, and keeps deleted checklist groups recoverable', async () => {
    await start()
    addText('Tuesday')
    options('Tuesday')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Tuesday' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Wed' } })
    options('Tuesday')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tuesday and its sub-items' }))
    expect(screen.queryByRole('checkbox', { name: 'Tuesday' })).toBeNull()
    expect(saved().every((item) => item.deletedAt)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('checkbox', { name: 'Wed' })).toBeTruthy()
    options('Tuesday')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tuesday and its sub-items' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss checklist delete notice' }))
    fireEvent.click(screen.getByText('Deleted checklist items · 2'))
    fireEvent.click(screen.getByRole('button', { name: 'Restore checklist item: Tuesday' }))
    expect(screen.getByRole('checkbox', { name: 'Wed' })).toBeTruthy()
    await waitFor(() => expect(saved().every((item) => !item.deletedAt)).toBe(true))
  })

  it('keeps the draft when adding fails, with a useful error instead of dropping text', async () => {
    await start([], true)
    addText('Important thought not to lose')
    expect((screen.getByLabelText('New checklist item') as HTMLInputElement).value).toBe('Important thought not to lose')
    expect(screen.getByRole('alert').textContent).toBe('Could not add this item.')
    expect(saved()).toEqual([])
  })

  it('lists every disconnected cyclic deleted group so none become hidden', async () => {
    const timestamp = '2026-10-21T12:00:00Z'
    const item = (id: string, parentId: string, text: string): NoteChecklistItem => ({ id, parentId, text, order: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp })
    await start([item('a', 'b', 'First group'), item('b', 'a', 'First child'), item('c', 'd', 'Second group'), item('d', 'c', 'Second child')])
    fireEvent.click(screen.getByText('Deleted checklist items · 4'))
    expect(screen.getByRole('button', { name: 'Restore checklist item: First group' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore checklist item: Second group' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore checklist item: First group' }))
    expect(screen.getByRole('checkbox', { name: 'First child' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore checklist item: Second group' })).toBeTruthy()
    expect(saved().find((entry) => entry.id === 'c')?.deletedAt).toBe(timestamp)
  })
})
