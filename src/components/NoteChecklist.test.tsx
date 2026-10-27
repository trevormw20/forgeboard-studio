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
  saveWorkspaceChanges: async () => {},
}))

beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { cleanup(); cached = undefined; vi.unstubAllGlobals() })

type FocusProps = { autoFocus?: boolean; focusItemId?: string }

function Harness({ failAdd = false, ...focus }: { failAdd?: boolean } & FocusProps) {
  const forge = useForgeboard()
  if (!forge.ready) return <p>Loading</p>
  const checklistForge = failAdd ? { ...forge, actions: { ...forge.actions, addNoteChecklistItem: () => { throw new Error('Could not add this item.') } } } : forge
  return <><input aria-label="Capture draft" /><NoteChecklist forge={checklistForge} note={forge.workspace.personalNotes![0]} {...focus} /><output aria-label="Saved checklist">{JSON.stringify(forge.workspace.personalNotes![0].checklist ?? [])}</output></>
}

async function start(items: NoteChecklistItem[] = [], failAdd = false, focus: FocusProps = {}) {
  cached = createSeedWorkspace()
  cached.personalNotes = [{ id: 'note', title: 'Daily notes', body: 'Keep the original writing.', checklist: items, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' }]
  const view = render(<Harness failAdd={failAdd} {...focus} />)
  await screen.findByRole('button', { name: 'Add item' })
  return view
}

function checklistItem(id: string, text: string, parentId?: string, order = 0): NoteChecklistItem {
  return { id, text, parentId, order, createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:00:00Z' }
}

function saved(): NoteChecklistItem[] { return JSON.parse(screen.getByLabelText('Saved checklist').textContent ?? '[]') }
function addText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
  const input = screen.getByRole('textbox', { name: 'Edit New item' })
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: text } })
}
function options(text: string) { fireEvent.click(screen.getByRole('button', { name: `Options for ${text}` })) }
function rowNames() { return screen.getAllByRole('listitem').map((row) => row.getAttribute('aria-label')?.replace('Checklist item: ', '')) }

describe('Note checklist', () => {
  it('moves checked roots below open roots without rewriting canonical order or replacing the focused input', async () => {
    await start([checklistItem('a', 'Apples', undefined, 0), checklistItem('b', 'Bread', undefined, 1), checklistItem('c', 'Coffee', undefined, 2)])
    const originalOrder = saved().map(({ id, order, parentId }) => ({ id, order, parentId }))
    const input = screen.getByRole('textbox', { name: 'Edit Apples' }) as HTMLInputElement
    const checkbox = screen.getByRole('checkbox', { name: 'Apples' })
    input.focus()
    input.setSelectionRange(3, 3)
    fireEvent.click(checkbox)
    expect(rowNames()).toEqual(['Bread', 'Coffee', 'Apples'])
    expect(screen.getByRole('textbox', { name: 'Edit Apples' })).toBe(input)
    expect(screen.getByRole('checkbox', { name: 'Apples' })).toBe(checkbox)
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(3)
    expect(saved().map(({ id, order, parentId }) => ({ id, order, parentId }))).toEqual(originalOrder)
    fireEvent.click(checkbox)
    expect(rowNames()).toEqual(['Apples', 'Bread', 'Coffee'])
    expect(document.activeElement).toBe(input)
    expect(saved().map(({ id, order, parentId }) => ({ id, order, parentId }))).toEqual(originalOrder)
  })

  it('moves completed parent subtrees together and sorts completed children only within their own parent', async () => {
    await start([
      checklistItem('walmart', 'Walmart', undefined, 0),
      checklistItem('fish', 'Fish', 'walmart', 0),
      checklistItem('salmon', 'Salmon', 'fish', 0),
      checklistItem('milk', 'Milk', 'walmart', 1),
      checklistItem('costco', 'Costco', undefined, 1),
      checklistItem('turkey', 'Turkey', 'costco', 0),
    ])
    const originalOrder = saved().map(({ id, order, parentId }) => ({ id, order, parentId }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Walmart' }))
    expect(rowNames()).toEqual(['Costco', 'Turkey', 'Walmart', 'Fish', 'Salmon', 'Milk'])
    for (const name of ['Fish', 'Salmon', 'Milk', 'Costco', 'Turkey']) expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fish' }))
    expect(rowNames()).toEqual(['Costco', 'Turkey', 'Walmart', 'Milk', 'Fish', 'Salmon'])
    expect((screen.getByRole('checkbox', { name: 'Salmon' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('listitem', { name: 'Checklist item: Fish' }).getAttribute('aria-level')).toBe('2')
    expect(screen.getByRole('listitem', { name: 'Checklist item: Salmon' }).getAttribute('aria-level')).toBe('3')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Walmart' }))
    expect(rowNames()).toEqual(['Walmart', 'Milk', 'Fish', 'Salmon', 'Costco', 'Turkey'])
    expect((screen.getByRole('checkbox', { name: 'Fish' }) as HTMLInputElement).checked).toBe(true)
    expect(saved().map(({ id, order, parentId }) => ({ id, order, parentId }))).toEqual(originalOrder)
  })

  it('keeps one Add item after all displayed rows and inserts its new open root above checked roots', async () => {
    await start([checklistItem('a', 'Already done', undefined, 0), checklistItem('b', 'Still open', undefined, 1)])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Already done' }))
    expect(rowNames()).toEqual(['Still open', 'Already done'])
    const add = screen.getByRole('button', { name: 'Add item' })
    fireEvent.click(add)
    const input = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'New open item' } })
    expect(rowNames()).toEqual(['Still open', 'New open item', 'Already done'])
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
    const list = screen.getByRole('list', { name: 'Checklist items' })
    expect(list.lastElementChild).toBe(screen.getByRole('listitem', { name: 'Checklist item: Already done' }))
    expect(list.nextElementSibling).toBe(add)
    expect(saved().filter((item) => ['a', 'b'].includes(item.id)).map(({ id, order }) => ({ id, order }))).toEqual([{ id: 'a', order: 0 }, { id: 'b', order: 1 }])
    expect(saved().find((item) => item.text === 'New open item')?.parentId).toBeUndefined()
  })

  it('autofocuses the first active item only once and leaves the current cursor alone on autosaves', async () => {
    const view = await start([checklistItem('first', 'Tuesday'), checklistItem('second', 'Wednesday', undefined, 1)], false, { autoFocus: true })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Edit Tuesday' }))
    const second = screen.getByRole('textbox', { name: 'Edit Wednesday' }) as HTMLInputElement
    second.focus()
    second.setSelectionRange(3, 3)
    view.rerender(<Harness autoFocus />)
    expect(document.activeElement).toBe(second)
    expect(second.selectionStart).toBe(3)
    fireEvent.change(second, { target: { value: 'Wednesday plan' } })
    expect(document.activeElement).toBe(second)
    expect(screen.getByRole('textbox', { name: 'Edit Wednesday plan' })).toBe(second)
    const capture = screen.getByRole('textbox', { name: 'Capture draft' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: 'Still writing my next thought' } })
    capture.setSelectionRange(8, 8)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    expect(document.activeElement).toBe(capture)
    expect(capture.selectionStart).toBe(8)
  })

  it('does not focus by default or turn a later autoFocus change into a focus request', async () => {
    const view = await start([checklistItem('first', 'Tuesday')])
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Edit Tuesday' }))
    const capture = screen.getByRole('textbox', { name: 'Capture draft' })
    capture.focus()
    view.rerender(<Harness autoFocus />)
    expect(document.activeElement).toBe(capture)
  })

  it('does not steal capture focus when an initially empty autofocus checklist gains an item', async () => {
    const view = await start([], false, { autoFocus: true })
    const capture = screen.getByRole('textbox', { name: 'Capture draft' })
    capture.focus()
    view.rerender(<Harness autoFocus focusItemId="not-yet-present" />)
    expect(document.activeElement).toBe(capture)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const first = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(first)
    capture.focus()
    fireEvent.change(first, { target: { value: 'Tuesday' } })
    expect(document.activeElement).toBe(capture)
  })

  it('focuses a requested item once, expands its collapsed group, and supports a changed request', async () => {
    const view = await start([checklistItem('root', 'Tuesday'), checklistItem('child', 'Groceries', 'root'), checklistItem('deep', 'Milk', 'child')])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Tuesday list' }))
    expect(screen.queryByRole('textbox', { name: 'Edit Milk' })).toBeNull()
    view.rerender(<Harness focusItemId="deep" />)
    const deep = screen.getByRole('textbox', { name: 'Edit Milk' }) as HTMLInputElement
    expect(document.activeElement).toBe(deep)
    expect(screen.getByRole('button', { name: 'Collapse Tuesday list' }).getAttribute('aria-expanded')).toBe('true')
    deep.setSelectionRange(2, 2)
    fireEvent.change(deep, { target: { value: 'Milky coffee' } })
    expect(document.activeElement).toBe(deep)
    const capture = screen.getByRole('textbox', { name: 'Capture draft' })
    capture.focus()
    view.rerender(<Harness focusItemId="deep" />)
    expect(document.activeElement).toBe(capture)
    view.rerender(<Harness focusItemId="child" />)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Edit Groceries' }))
    view.rerender(<Harness focusItemId="deep" />)
    expect(document.activeElement).toBe(deep)
  })

  it('keeps a missing requested ID pending until its row arrives in a later snapshot', async () => {
    cached = createSeedWorkspace()
    cached.personalNotes = [{ id: 'note', title: 'Daily notes', body: '', checklist: [], createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:00:00Z' }]
    function SnapshotHarness({ items }: { items: NoteChecklistItem[] }) {
      const forge = useForgeboard()
      if (!forge.ready) return <p>Loading</p>
      return <><input aria-label="Capture draft" /><NoteChecklist forge={forge} note={{ ...forge.workspace.personalNotes![0], checklist: items }} focusItemId="arriving" /></>
    }
    const view = render(<SnapshotHarness items={[]} />)
    const capture = await screen.findByRole('textbox', { name: 'Capture draft' })
    capture.focus()
    expect(document.activeElement).toBe(capture)
    view.rerender(<SnapshotHarness items={[checklistItem('arriving', 'Next blank row')]} />)
    const arriving = screen.getByRole('textbox', { name: 'Edit Next blank row' })
    expect(document.activeElement).toBe(arriving)
    capture.focus()
    view.rerender(<SnapshotHarness items={[checklistItem('arriving', 'Updated next row')]} />)
    expect(document.activeElement).toBe(capture)
  })

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

  it('reports a failed one-click add before accepting text, without creating a ghost item', async () => {
    await start([], true)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.queryByRole('textbox', { name: 'Edit New item' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Could not add this item.')
    expect(saved()).toEqual([])
  })

  it('puts exactly one Add item control after the whole checklist and appends a root after the final deep descendant', async () => {
    await start()
    addText('Walmart')
    options('Walmart')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Walmart' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Fish' } })
    options('Fish')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Fish' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Salmon' } })
    addText('Costco')
    options('Costco')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Costco' }))
    const turkeyInput = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(turkeyInput)
    fireEvent.change(turkeyInput, { target: { value: 'Turkey' } })

    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Checklist item: Walmart', 'Checklist item: Fish', 'Checklist item: Salmon', 'Checklist item: Costco', 'Checklist item: Turkey'])
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
    const list = screen.getByRole('list', { name: 'Checklist items' })
    expect(list.lastElementChild).toBe(screen.getByRole('listitem', { name: 'Checklist item: Turkey' }))
    expect(list.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.queryByRole('button', { name: /Add item to/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const newInput = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(newInput)
    fireEvent.change(newInput, { target: { value: 'Milk' } })
    const costco = saved().find((item) => item.text === 'Costco')!
    expect(saved().find((item) => item.text === 'Milk')?.parentId).toBeUndefined()
    expect(saved().find((item) => item.text === 'Turkey')?.parentId).toBe(costco.id)
    expect(list.lastElementChild).toBe(screen.getByRole('listitem', { name: 'Checklist item: Milk' }))
    expect(screen.getByRole('listitem', { name: 'Checklist item: Milk' }).previousElementSibling).toBe(screen.getByRole('listitem', { name: 'Checklist item: Turkey' }))
    expect(screen.getByRole('listitem', { name: 'Checklist item: Milk' }).getAttribute('aria-level')).toBe('1')
  })

  it('shows a single Add item when empty and appends outside the last collapsed group', async () => {
    await start()
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
    addText('Walmart')
    options('Walmart')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Walmart' }))
    expect(screen.getByRole('listitem', { name: 'Checklist item: New item' }).getAttribute('aria-level')).toBe('2')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Edit New item' }))
    fireEvent.change(document.activeElement!, { target: { value: 'Fish' } })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    expect(screen.queryByRole('textbox', { name: 'Edit Fish' })).toBeNull()
    addText('Costco')
    expect(saved().find((item) => item.text === 'Costco')?.parentId).toBeUndefined()
    expect(screen.getByRole('listitem', { name: 'Checklist item: Costco' }).getAttribute('aria-level')).toBe('1')
    expect(screen.getByRole('button', { name: 'Expand Walmart list' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('list', { name: 'Checklist items' }).nextElementSibling).toBe(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Walmart list' }))
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Checklist item: Walmart', 'Checklist item: Fish', 'Checklist item: Costco'])
  })

  it('reopens collapsed and completed groups for editing and expands when adding a child', async () => {
    await start()
    addText('Walmart')
    options('Walmart')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Walmart' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Fish' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Walmart' }))
    expect((screen.getByRole('checkbox', { name: 'Fish' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    expect(screen.queryByRole('textbox', { name: 'Edit Fish' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand Walmart list' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Expand Walmart list' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit Fish' }), { target: { value: 'Salmon' } })
    expect(saved().find((item) => item.text === 'Salmon')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    options('Walmart')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-item to Walmart' }))
    expect(screen.getByRole('textbox', { name: 'Edit Salmon' })).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Collapse Walmart list' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(input, { target: { value: 'Milk' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Walmart' }))
    expect(saved().find((item) => item.text === 'Walmart')?.completedAt).toBeUndefined()
    expect(saved().find((item) => item.text === 'Milk')?.parentId).toBe(saved().find((item) => item.text === 'Walmart')?.id)
  })

  it.each(['keyboard', 'button', 'slide'])('expands a collapsed destination when nesting by %s so the moved row stays editable', async (method) => {
    await start()
    addText('Walmart')
    addText('Costco')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    const input = screen.getByRole('textbox', { name: 'Edit Costco' })
    input.focus()
    if (method === 'keyboard') fireEvent.keyDown(input, { key: 'Tab' })
    else if (method === 'button') {
      options('Costco')
      fireEvent.click(screen.getByRole('button', { name: 'Indent Costco' }))
    } else {
      const grip = screen.getByRole('button', { name: 'Move Costco' })
      fireEvent.pointerDown(grip, { clientX: 70, clientY: 50, pointerId: 1, button: 0 })
      fireEvent.pointerMove(grip, { clientX: 115, clientY: 52, pointerId: 1 })
      fireEvent.pointerUp(grip, { clientX: 115, clientY: 52, pointerId: 1 })
    }
    expect(screen.getByRole('textbox', { name: 'Edit Costco' })).toBe(input)
    if (method === 'keyboard') expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Collapse Walmart list' }).getAttribute('aria-expanded')).toBe('true')
    expect(saved().find((item) => item.text === 'Costco')?.parentId).toBe(saved().find((item) => item.text === 'Walmart')?.id)
    fireEvent.change(input, { target: { value: 'More groceries' } })
    expect(saved().find((item) => item.text === 'More groceries')).toBeTruthy()
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
