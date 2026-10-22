// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSeedWorkspace } from '../seed'
import type { useForgeboard } from '../hooks/useForgeboard'
import { NoteConflictCopies } from './NoteConflictCopies'

afterEach(cleanup)

it('recovers a saved note conflict as a separate project-safe note without mutating the original', () => {
  const workspace = createSeedWorkspace()
  workspace.conflicts = [{ id: 'copy', entityType: 'personal-note', entityId: 'note', detectedAt: '2026-10-21T18:00:00Z', local: { title: 'Plan', body: 'This wording', projectId: workspace.projects[0].id, parentId: 'gone' }, remote: { title: 'Plan', body: 'Other wording', projectId: workspace.projects[0].id }, resolution: 'Both snapshots retained' }]
  const checklist = [{ id: 'original-item', text: 'Keep this checkbox', order: 0, createdAt: '2026-10-21T18:00:00Z', updatedAt: '2026-10-21T18:00:00Z' }]
  Object.assign(workspace.conflicts[0].local as object, { checklist })
  const addPersonalNote = vi.fn(() => 'restored')
  const forge = { workspace, actions: { addPersonalNote } } as unknown as ReturnType<typeof useForgeboard>
  render(<NoteConflictCopies forge={forge} projectId={workspace.projects[0].id} />)
  fireEvent.click(screen.getByText('Saved conflict copies'))
  fireEvent.click(screen.getByRole('button', { name: 'Save this version as a note' }))
  expect(addPersonalNote).toHaveBeenCalledWith({ projectId: workspace.projects[0].id, title: 'Plan (saved copy)', body: 'This wording', checklist, color: undefined, labelIds: [] })
  expect(screen.getByText(/\[ \] Keep this checkbox/)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain(workspace.projects[0].name)
  expect(workspace.conflicts[0].local).toMatchObject({ body: 'This wording' })
  fireEvent.click(screen.getByRole('button', { name: 'Save other version as a note' }))
  expect(addPersonalNote.mock.calls).toHaveLength(2)
})

it('never mixes project conflicts and explicitly offers General recovery for an unavailable project', () => {
  const workspace = createSeedWorkspace()
  workspace.conflicts = [{ id: 'copy', entityType: 'personal-note', entityId: 'note', detectedAt: '2026-10-21T18:00:00Z', local: { title: 'Private project', body: 'Project wording', projectId: workspace.projects[1].id }, remote: { title: 'Old project', body: 'Recovered wording', projectId: 'removed-project' }, resolution: 'Both snapshots retained' }]
  const addPersonalNote = vi.fn(() => 'restored')
  const forge = { workspace, actions: { addPersonalNote } } as unknown as ReturnType<typeof useForgeboard>
  const { rerender } = render(<NoteConflictCopies forge={forge} projectId={workspace.projects[0].id} />)
  expect(screen.queryByText('Saved conflict copies')).toBeNull()
  rerender(<NoteConflictCopies forge={forge} />)
  fireEvent.click(screen.getByText('Saved conflict copies'))
  expect(screen.queryByText('Project wording')).toBeNull()
  expect(screen.getByText(/Original project is unavailable/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save other version to General' }))
  expect(addPersonalNote).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined, body: 'Recovered wording' }))
})

it('recovers a post-merge cyclic checklist snapshot without losing its items or checkmarks', () => {
  const workspace = createSeedWorkspace(), at = '2026-10-21T18:00:00Z'
  const checklist = [
    { id: 'a', text: 'A', parentId: 'b', order: 0, completedAt: at, createdAt: at, updatedAt: at },
    { id: 'b', text: 'B', parentId: 'a', order: 0, createdAt: at, updatedAt: at },
  ]
  workspace.conflicts = [{ id: 'cyclic-copy', entityType: 'personal-note', entityId: 'note', detectedAt: at, local: { title: 'Cycle', body: 'Keep both', checklist }, remote: { title: 'Cycle', body: 'Other' }, resolution: 'Both kept' }]
  const addPersonalNote = vi.fn<(input: unknown) => string>(() => 'restored')
  const forge = { workspace, actions: { addPersonalNote } } as unknown as ReturnType<typeof useForgeboard>
  render(<NoteConflictCopies forge={forge} />)
  fireEvent.click(screen.getByText('Saved conflict copies'))
  fireEvent.click(screen.getByRole('button', { name: 'Save this version as a note' }))
  const copy = addPersonalNote.mock.calls[0]?.[0] as unknown as { checklist: typeof checklist }
  expect(copy.checklist).toHaveLength(2)
  expect(copy.checklist[0]).toMatchObject({ text: 'A', completedAt: at })
  expect(copy.checklist.every((item) => !item.parentId)).toBe(true)
  expect(checklist[0].parentId).toBe('b')
})
