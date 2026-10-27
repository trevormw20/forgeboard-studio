// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
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

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
  }
}

beforeEach(() => { vi.stubGlobal('PointerEvent', TestPointerEvent) })
afterEach(() => { cleanup(); cached = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })

type FocusProps = { autoFocus?: boolean; focusItemId?: string }

function Harness({ failAdd = false, beginDragOnMount = false, ...focus }: { failAdd?: boolean; beginDragOnMount?: boolean } & FocusProps) {
  const forge = useForgeboard()
  useLayoutEffect(() => {
    if (!forge.ready || !beginDragOnMount) return
    // A pointer may reach a newly mounted checklist before passive effects run.
    // Child layout effects have completed, but its passive mount reset has not.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move Coffee' }), { clientX: 70, clientY: 200, pointerId: 1, button: 0 })
  }, [forge.ready, beginDragOnMount])
  if (!forge.ready) return <p>Loading</p>
  const checklistForge = failAdd ? { ...forge, actions: { ...forge.actions, addNoteChecklistItem: () => { throw new Error('Could not add this item.') } } } : forge
  return <><input aria-label="Capture draft" /><NoteChecklist forge={checklistForge} note={forge.workspace.personalNotes![0]} {...focus} /><output aria-label="Saved checklist">{JSON.stringify(forge.workspace.personalNotes![0].checklist ?? [])}</output></>
}

async function start(items: NoteChecklistItem[] = [], failAdd = false, focus: FocusProps = {}, beginDragOnMount = false) {
  cached = createSeedWorkspace()
  cached.personalNotes = [{ id: 'note', title: 'Daily notes', body: 'Keep the original writing.', checklist: items, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' }]
  const view = render(<Harness failAdd={failAdd} beginDragOnMount={beginDragOnMount} {...focus} />)
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

function mockChecklistRects() {
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const row = this.closest('.nc-item')
    if (row) {
      const index = [...document.querySelectorAll('.nc-item')].indexOf(row)
      const depth = Number(row.getAttribute('aria-level') ?? '1') - 1
      return new DOMRect(20 + depth * 30, 100 + index * 40, 600 - depth * 30, 40)
    }
    if (this.matches('.nc-list')) return new DOMRect(20, 100, 600, document.querySelectorAll('.nc-item').length * 40)
    return original.call(this)
  })
}

function pointerDrag(name: string, from: { x: number; y: number }, to: { x: number; y: number }, end: 'up' | 'cancel' | 'lost' = 'up', pointerType = 'mouse') {
  const grip = screen.getByRole('button', { name: `Move ${name}` })
  fireEvent.pointerDown(grip, { clientX: from.x, clientY: from.y, pointerId: 1, pointerType, button: 0 })
  fireEvent.pointerMove(grip, { clientX: to.x, clientY: to.y, pointerId: 1, pointerType })
  if (end === 'cancel') fireEvent.pointerCancel(grip, { clientX: to.x, clientY: to.y, pointerId: 1, pointerType })
  else if (end === 'lost') fireEvent.lostPointerCapture(grip, { pointerId: 1, pointerType })
  else fireEvent.pointerUp(grip, { clientX: to.x, clientY: to.y, pointerId: 1, pointerType })
}

describe('Note checklist', () => {
  it('puts a small plus after each nested group and adds into the correct parent', async () => {
    await start([
      checklistItem('walmart', 'Walmart'), checklistItem('fish', 'Fish', 'walmart'), checklistItem('sauce', 'Sauce', 'fish'),
      checklistItem('costco', 'Costco', undefined, 1), checklistItem('turkey', 'Turkey', 'costco'),
    ])
    const fishPlus = screen.getByRole('button', { name: 'Add checkbox to Fish' })
    const walmartPlus = screen.getByRole('button', { name: 'Add checkbox to Walmart' })
    expect(fishPlus.closest('.nc-item')?.getAttribute('aria-label')).toBe('Checklist item: Sauce')
    expect(walmartPlus.closest('.nc-item')?.getAttribute('aria-label')).toBe('Checklist item: Sauce')
    expect(screen.getByRole('button', { name: 'Add checkbox to Costco' }).closest('.nc-item')?.getAttribute('aria-label')).toBe('Checklist item: Turkey')
    fireEvent.click(walmartPlus)
    const input = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('enterkeyhint')).toBe('next')
    fireEvent.change(input, { target: { value: 'Milk' } })
    expect(saved().find((item) => item.text === 'Milk')?.parentId).toBe('walmart')
    expect(screen.getByRole('button', { name: 'Add checkbox to Walmart' }).closest('.nc-item')?.getAttribute('aria-label')).toBe('Checklist item: Milk')
    fireEvent.keyDown(input, { key: 'Enter' })
    const next = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(next)
    expect(saved().at(-1)?.parentId).toBe('walmart')
    expect(saved().every((item) => !item.completedAt)).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
  })

  it('keeps the nested plus usable when a list is folded and expands it after adding', async () => {
    await start([checklistItem('a', 'Walmart'), checklistItem('b', 'Fish', 'a')])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add checkbox to Walmart' }))
    expect(screen.getByRole('textbox', { name: 'Edit Fish' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Edit New item' }))
    expect(saved().at(-1)?.parentId).toBe('a')
  })

  it('moves checked roots below open roots without rewriting canonical order or replacing the focused input', async () => {
    await start([checklistItem('a', 'Apples', undefined, 0), checklistItem('b', 'Bread', undefined, 1), checklistItem('c', 'Coffee', undefined, 2)])
    expect(document.querySelector('.nc-checked-divider')).toBeNull()
    const originalOrder = saved().map(({ id, order, parentId }) => ({ id, order, parentId }))
    const input = screen.getByRole('textbox', { name: 'Edit Apples' }) as HTMLInputElement
    const checkbox = screen.getByRole('checkbox', { name: 'Apples' })
    input.focus()
    input.setSelectionRange(3, 3)
    fireEvent.click(checkbox)
    expect(rowNames()).toEqual(['Bread', 'Coffee', 'Apples'])
    expect(document.querySelectorAll('.nc-checked-divider')).toHaveLength(1)
    expect(document.querySelector('.nc-checked-divider')?.textContent).toContain('Checked items')
    expect(screen.getByRole('listitem', { name: 'Checklist item: Apples' }).classList.contains('is-checked-section')).toBe(true)
    expect(screen.getByRole('listitem', { name: 'Checklist item: Bread' }).classList.contains('is-checked-section')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Edit Apples' })).toBe(input)
    expect(screen.getByRole('checkbox', { name: 'Apples' })).toBe(checkbox)
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(3)
    expect(saved().map(({ id, order, parentId }) => ({ id, order, parentId }))).toEqual(originalOrder)
    fireEvent.click(checkbox)
    expect(rowNames()).toEqual(['Apples', 'Bread', 'Coffee'])
    expect(document.querySelector('.nc-checked-divider')).toBeNull()
    expect(screen.getByRole('listitem', { name: 'Checklist item: Apples' }).classList.contains('is-checked-section')).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(saved().map(({ id, order, parentId }) => ({ id, order, parentId }))).toEqual(originalOrder)
  })

  it('separates checked roots with one divider inside the first completed row without adding fake checklist rows', async () => {
    const completedAt = '2026-10-27T12:00:00Z'
    await start([
      { ...checklistItem('done-first', 'Done first', undefined, 0), completedAt },
      checklistItem('open', 'Still open', undefined, 1),
      { ...checklistItem('done-last', 'Done last', undefined, 2), completedAt },
    ])
    expect(rowNames()).toEqual(['Still open', 'Done first', 'Done last'])
    expect(document.querySelectorAll('.nc-checked-divider')).toHaveLength(1)
    const first = screen.getByRole('listitem', { name: 'Checklist item: Done first' })
    const last = screen.getByRole('listitem', { name: 'Checklist item: Done last' })
    expect(first.querySelector('.nc-checked-divider')?.textContent).toContain('Checked items')
    expect(last.querySelector('.nc-checked-divider')).toBeNull()
    expect(first.classList.contains('is-checked-section')).toBe(true)
    expect(last.classList.contains('is-checked-section')).toBe(true)
    expect(screen.getByRole('list', { name: 'Checklist items' }).children).toHaveLength(3)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done first' }))
    expect(first.querySelector('.nc-checked-divider')).toBeNull()
    expect(first.classList.contains('is-checked-section')).toBe(false)
    expect(last.querySelector('.nc-checked-divider')?.textContent).toContain('Checked items')
  })

  it('gives checked children a separate lower section within their unfinished parent without changing hierarchy', async () => {
    const completedAt = '2026-10-27T12:00:00Z'
    await start([
      checklistItem('store', 'Walmart'),
      { ...checklistItem('fish', 'Fish', 'store', 0), completedAt },
      checklistItem('salmon', 'Salmon', 'fish'),
      checklistItem('milk', 'Milk', 'store', 1),
      checklistItem('other', 'Costco', undefined, 1),
    ])
    expect(rowNames()).toEqual(['Walmart', 'Milk', 'Fish', 'Salmon', 'Costco'])
    const fish = screen.getByRole('listitem', { name: 'Checklist item: Fish' })
    const salmon = screen.getByRole('listitem', { name: 'Checklist item: Salmon' })
    expect(document.querySelectorAll('.nc-checked-divider')).toHaveLength(1)
    expect(fish.querySelector('.nc-checked-divider')?.textContent).toBe('Checked')
    expect(fish.getAttribute('aria-level')).toBe('2')
    expect(salmon.getAttribute('aria-level')).toBe('3')
    expect(fish.classList.contains('is-checked-section')).toBe(true)
    expect(salmon.classList.contains('is-checked-section')).toBe(true)
    expect(salmon.classList.contains('is-complete')).toBe(false)
    for (const name of ['Walmart', 'Milk', 'Costco']) expect(screen.getByRole('listitem', { name: `Checklist item: ${name}` }).classList.contains('is-checked-section')).toBe(false)
    expect(saved().find((item) => item.id === 'salmon')?.parentId).toBe('fish')
    expect((screen.getByRole('checkbox', { name: 'Salmon' }) as HTMLInputElement).checked).toBe(false)
  })

  it('keeps a checked parent branch in one lower section without dimming unfinished descendants as if they were checked', async () => {
    const completedAt = '2026-10-27T12:00:00Z'
    await start([
      { ...checklistItem('store', 'Walmart'), completedAt },
      checklistItem('fish', 'Fish', 'store'),
      { ...checklistItem('salmon', 'Salmon', 'fish'), completedAt },
      checklistItem('other', 'Costco', undefined, 1),
    ])
    expect(rowNames()).toEqual(['Costco', 'Walmart', 'Fish', 'Salmon'])
    expect(document.querySelectorAll('.nc-checked-divider')).toHaveLength(1)
    expect(screen.getByRole('listitem', { name: 'Checklist item: Walmart' }).querySelector('.nc-checked-divider')?.textContent).toContain('Checked items')
    for (const name of ['Walmart', 'Fish', 'Salmon']) expect(screen.getByRole('listitem', { name: `Checklist item: ${name}` }).classList.contains('is-checked-section')).toBe(true)
    const fish = screen.getByRole('listitem', { name: 'Checklist item: Fish' })
    expect(fish.classList.contains('is-complete')).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Fish' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit Fish' }), { target: { value: 'Fish fillets' } })
    expect(saved().find((item) => item.id === 'fish')).toMatchObject({ text: 'Fish fillets', parentId: 'store' })
    expect(saved().find((item) => item.id === 'fish')?.completedAt).toBeUndefined()
    expect(document.querySelectorAll('.nc-checked-divider')).toHaveLength(1)
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

  it('slides a handle horizontally to indent and outdent without needing a separate menu', async () => {
    await start([checklistItem('tue', 'Tuesday'), checklistItem('wed', 'Wed', undefined, 1)])
    mockChecklistRects()
    pointerDrag('Wed', { x: 70, y: 160 }, { x: 115, y: 162 })
    expect(saved().find((item) => item.id === 'wed')?.parentId).toBe('tue')
    pointerDrag('Wed', { x: 110, y: 160 }, { x: 60, y: 161 })
    expect(saved().find((item) => item.id === 'wed')?.parentId).toBeUndefined()
  })

  it('drags a six-dot handle to any vertical position and only saves when it is dropped', async () => {
    await start([checklistItem('a', 'Apples'), checklistItem('b', 'Bread', undefined, 1), checklistItem('c', 'Coffee', undefined, 2)])
    mockChecklistRects()
    const grip = screen.getByRole('button', { name: 'Move Coffee' })
    const input = screen.getByRole('textbox', { name: 'Edit Coffee' })
    const before = saved()
    fireEvent.pointerDown(grip, { clientX: 70, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 70, clientY: 101, pointerId: 1 })
    expect(saved()).toEqual(before)
    fireEvent.pointerUp(grip, { clientX: 70, clientY: 101, pointerId: 1 })
    expect(rowNames()).toEqual(['Coffee', 'Apples', 'Bread'])
    expect(screen.getByRole('textbox', { name: 'Edit Coffee' })).toBe(input)
    expect(saved().every((item) => !item.parentId)).toBe(true)
    pointerDrag('Coffee', { x: 70, y: 120 }, { x: 70, y: 230 }, 'up', 'touch')
    expect(rowNames()).toEqual(['Apples', 'Bread', 'Coffee'])
    expect(saved().every((item) => !item.parentId)).toBe(true)
  })

  it('keeps a dragged parent and all its descendants together during vertical ordering', async () => {
    await start([
      checklistItem('a', 'Walmart'), checklistItem('fish', 'Fish', 'a'), checklistItem('salmon', 'Salmon', 'fish'),
      checklistItem('b', 'Costco', undefined, 1), checklistItem('c', 'Market', undefined, 2),
    ])
    mockChecklistRects()
    pointerDrag('Walmart', { x: 70, y: 120 }, { x: 70, y: 315 })
    expect(rowNames()).toEqual(['Costco', 'Market', 'Walmart', 'Fish', 'Salmon'])
    expect(saved().find((item) => item.id === 'a')?.parentId).toBeUndefined()
    expect(saved().find((item) => item.id === 'fish')?.parentId).toBe('a')
    expect(saved().find((item) => item.id === 'salmon')?.parentId).toBe('fish')
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1)
  })

  it('combines vertical placement and horizontal nesting or outdenting in a single drag', async () => {
    await start([
      checklistItem('a', 'Apples'), checklistItem('b', 'Bread', undefined, 1),
      checklistItem('c', 'Coffee', undefined, 2), checklistItem('milk', 'Milk', 'c'),
    ])
    mockChecklistRects()
    const grip = screen.getByRole('button', { name: 'Move Coffee' })
    fireEvent.pointerDown(grip, { clientX: 70, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 105, clientY: 140, pointerId: 1 })
    expect(document.querySelector('.note-checklist [role="status"]')?.textContent).toBe('Last sub-item of Apples · Level 2')
    expect(document.querySelector('.is-dragging-checklist')).not.toBeNull()
    fireEvent.pointerUp(grip, { clientX: 105, clientY: 140, pointerId: 1 })
    expect(rowNames()).toEqual(['Apples', 'Coffee', 'Milk', 'Bread'])
    expect(saved().find((item) => item.id === 'c')?.parentId).toBe('a')
    expect(saved().find((item) => item.id === 'milk')?.parentId).toBe('c')
    expect(screen.getByRole('listitem', { name: 'Checklist item: Milk' }).getAttribute('aria-level')).toBe('3')
    pointerDrag('Coffee', { x: 100, y: 160 }, { x: 65, y: 260 })
    expect(rowNames()).toEqual(['Apples', 'Bread', 'Coffee', 'Milk'])
    expect(saved().find((item) => item.id === 'c')?.parentId).toBeUndefined()
    expect(screen.getByRole('listitem', { name: 'Checklist item: Milk' }).getAttribute('aria-level')).toBe('2')
  })

  it('keeps the first drag active when it starts before passive mount effects have run', async () => {
    await start([
      checklistItem('a', 'Apples'), checklistItem('b', 'Bread', undefined, 1),
      checklistItem('c', 'Coffee', undefined, 2), checklistItem('milk', 'Milk', 'c'),
    ], false, {}, true)
    mockChecklistRects()
    const grip = screen.getByRole('button', { name: 'Move Coffee' })
    fireEvent.pointerMove(grip, { clientX: 105, clientY: 140, pointerId: 1 })
    expect(document.querySelector('.note-checklist [role="status"]')?.textContent).toBe('Last sub-item of Apples · Level 2')
    fireEvent.pointerUp(grip, { clientX: 105, clientY: 140, pointerId: 1 })
    expect(rowNames()).toEqual(['Apples', 'Coffee', 'Milk', 'Bread'])
    expect(saved().find((item) => item.id === 'c')?.parentId).toBe('a')
    expect(saved().find((item) => item.id === 'milk')?.parentId).toBe('c')
  })

  it('does not commit a cancelled drag, lost capture, Escape, or ordinary click jitter', async () => {
    await start([checklistItem('a', 'Apples'), checklistItem('b', 'Bread', undefined, 1), checklistItem('c', 'Coffee', undefined, 2)])
    mockChecklistRects()
    const before = saved()
    pointerDrag('Coffee', { x: 70, y: 200 }, { x: 105, y: 140 }, 'cancel')
    expect(saved()).toEqual(before)
    pointerDrag('Coffee', { x: 70, y: 200 }, { x: 70, y: 101 }, 'lost')
    expect(saved()).toEqual(before)
    pointerDrag('Coffee', { x: 70, y: 200 }, { x: 73, y: 202 })
    expect(saved()).toEqual(before)
    const grip = screen.getByRole('button', { name: 'Move Coffee' })
    fireEvent.pointerDown(grip, { clientX: 70, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(grip, { clientX: 70, clientY: 101, pointerId: 1 })
    fireEvent.keyDown(grip, { key: 'Escape' })
    fireEvent.pointerUp(grip, { clientX: 70, clientY: 101, pointerId: 1 })
    expect(saved()).toEqual(before)
    expect(rowNames()).toEqual(['Apples', 'Bread', 'Coffee'])
  })

  it('keeps checked siblings below unfinished ones even when a drop crosses that boundary', async () => {
    await start([
      checklistItem('a', 'Apples'), { ...checklistItem('b', 'Bread', undefined, 1), completedAt: '2026-10-27T12:00:00Z' },
      checklistItem('c', 'Coffee', undefined, 2), { ...checklistItem('d', 'Dates', undefined, 3), completedAt: '2026-10-27T12:00:00Z' },
    ])
    mockChecklistRects()
    expect(rowNames()).toEqual(['Apples', 'Coffee', 'Bread', 'Dates'])
    pointerDrag('Apples', { x: 70, y: 120 }, { x: 70, y: 270 })
    expect(rowNames()).toEqual(['Coffee', 'Apples', 'Bread', 'Dates'])
    pointerDrag('Dates', { x: 70, y: 240 }, { x: 70, y: 101 })
    expect(rowNames()).toEqual(['Coffee', 'Apples', 'Dates', 'Bread'])
    expect((screen.getByRole('checkbox', { name: 'Dates' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Apples' }) as HTMLInputElement).checked).toBe(false)
  })

  it('uses only visible hit targets but preserves and reveals a collapsed destination’s existing children', async () => {
    await start([
      checklistItem('a', 'Walmart'), checklistItem('fish', 'Fish', 'a'), checklistItem('b', 'Costco', undefined, 1),
      checklistItem('turkey', 'Turkey', 'b'), checklistItem('c', 'Market', undefined, 2),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Walmart list' }))
    expect(screen.queryByRole('textbox', { name: 'Edit Fish' })).toBeNull()
    mockChecklistRects()
    pointerDrag('Market', { x: 70, y: 240 }, { x: 105, y: 140 })
    expect(saved().find((item) => item.id === 'c')?.parentId).toBe('a')
    expect(saved().find((item) => item.id === 'fish')?.parentId).toBe('a')
    expect(rowNames()).toEqual(['Walmart', 'Fish', 'Market', 'Costco', 'Turkey'])
    expect(screen.getByRole('button', { name: 'Collapse Walmart list' }).getAttribute('aria-expanded')).toBe('true')
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
