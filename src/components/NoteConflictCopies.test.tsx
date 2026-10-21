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
  const addPersonalNote = vi.fn(() => 'restored')
  const forge = { workspace, actions: { addPersonalNote } } as unknown as ReturnType<typeof useForgeboard>
  render(<NoteConflictCopies forge={forge} projectId={workspace.projects[0].id} />)
  fireEvent.click(screen.getByText('Saved conflict copies'))
  fireEvent.click(screen.getByRole('button', { name: 'Save this version as a note' }))
  expect(addPersonalNote).toHaveBeenCalledWith({ projectId: workspace.projects[0].id, title: 'Plan (saved copy)', body: 'This wording', color: undefined, labelIds: [] })
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
