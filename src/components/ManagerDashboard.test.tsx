// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ManagerDashboard } from './ManagerDashboard'
import { createSeedWorkspace } from '../seed'
import { importSubmissions } from '../lib/taskInbox'
import type { useForgeboard } from '../hooks/useForgeboard'
import type { Workspace } from '../types'

afterEach(cleanup)
const now = '2026-10-21T12:00:00Z'
function Harness() {
  const [workspace, setWorkspace] = useState(() => {
    const ws = createSeedWorkspace(); ws.tasks = []; ws.activity = []
    return importSubmissions(ws, [{ path: 'review.json', text: JSON.stringify({ format: 'forgeboard-task', version: 1, id: 'review-ten', project: 'Count on Chaos', date: '2026-10-21', summary: 'Review ten changes', subtasks: Array.from({ length: 10 }, (_, i) => ({ id: `test-${i}`, title: `Check result ${i + 1}` })) }) }], now).workspace
  })
  const mutate = (fn: (ws: Workspace) => void) => setWorkspace((current) => { const next = structuredClone(current); fn(next); return next })
  const forge = {
    workspace, connection: { owner: 'test', repo: 'private-vault' },
    actions: {
      updateManager: (input: object) => mutate((ws) => { ws.manager = { id: 'manager', updatedAt: now, energy: 'steady', dailyMinutes: 60, ...ws.manager, ...input } }),
      updateWork: (id: string, input: object) => mutate((ws) => { Object.assign(ws.tasks.find((t) => t.id === id)!, input) }),
      toggleSubtask: (id: string, stepId: string) => mutate((ws) => { const step = ws.tasks.find((t) => t.id === id)!.subtasks!.find((s) => s.id === stepId)!; step.completedAt = step.completedAt ? undefined : now }),
      blockSubtask: (id: string, stepId: string, reason: string) => mutate((ws) => { ws.tasks.find((t) => t.id === id)!.subtasks!.find((s) => s.id === stepId)!.blockedReason = reason }),
    },
  } as unknown as ReturnType<typeof useForgeboard>
  return <ManagerDashboard forge={forge} />
}

describe('review interaction', () => {
  it('checks five, saves a failed sixth test, and returns to all ten after parking the review', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Start here' }))
    let dialog = screen.getByRole('dialog', { name: 'Review work' })
    for (let i = 0; i < 5; i++) fireEvent.click(within(dialog).getAllByRole('checkbox')[i])
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Something failed' })[0])
    fireEvent.change(within(dialog).getByLabelText('What happened?'), { target: { value: 'Score freezes on test 6' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save blocker' }))
    fireEvent.change(within(dialog).getByLabelText('My results, errors, or questions'), { target: { value: 'First five pass. Fix the score before I continue.' } })
    fireEvent.change(within(dialog).getByLabelText('Where this stands'), { target: { value: 'blocked' } })
    expect(within(dialog).getByRole('button', { name: 'Finish task' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close review' }))
    fireEvent.click(screen.getByRole('button', { name: /Waiting \/ parked/ }))
    fireEvent.click(screen.getByRole('button', { name: /2026-10-21 · Review ten changes/ }))
    dialog = screen.getByRole('dialog', { name: 'Review work' })
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(10)
    expect(within(dialog).getAllByRole('checkbox').filter((input) => (input as HTMLInputElement).checked)).toHaveLength(5)
    expect(within(dialog).getByText('Blocked: Score freezes on test 6')).toBeTruthy()
    expect((within(dialog).getByLabelText('My results, errors, or questions') as HTMLTextAreaElement).value).toContain('First five pass')
    expect(within(dialog).getByText('10. Check result 10')).toBeTruthy()
  })
})
