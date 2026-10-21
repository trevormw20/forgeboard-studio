// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSeedWorkspace } from '../seed'
import { HandoffInbox } from './HandoffInbox'
import { desktopChatPrompt } from '../lib/coordination'

afterEach(cleanup)
it('labels real Haiku vs pending summaries and opens the original checklist with live remaining counts', () => {
  const ws = createSeedWorkspace(), at = new Date().toISOString(), open = vi.fn()
  ws.tasks[0].submission = { id: 'review', date: at.slice(0, 10), sourceFile: 'review.json' }
  ws.tasks[0].subtasks = [{ id: 'one', title: 'One', createdAt: at, updatedAt: at, completedAt: at }, { id: 'two', title: 'Two', createdAt: at, updatedAt: at }]
  ws.handoffSummaries = [{ id: 'file', projectId: ws.projects[0].id, recordIds: ['review'], sourceFile: 'review.json', title: 'Report', inputHash: 'hash', receivedAt: at, updatedAt: at, state: 'ai', summary: 'Agent reports changes.', needsYou: 'Test the flow.', nextStep: 'Open the build.', attempts: 1, model: 'claude-haiku-4-5-20251001' }]
  const view = render(<HandoffInbox workspace={ws} openReview={open} />)
  expect(screen.getByText('Haiku summary')).toBeTruthy()
  expect(screen.getByText(/1\/2 review steps still unchecked/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Open original checklist/ }))
  expect(open).toHaveBeenCalledWith(ws.tasks[0].id)
  ws.handoffSummaries[0].state = 'pending'
  view.rerender(<HandoffInbox workspace={ws} openReview={open} />)
  expect(screen.getByText('Summary queued')).toBeTruthy()
  expect(screen.queryByText('Haiku summary')).toBeNull()
})
it('gives Cowork a direct folder instruction bound to the exact project and chat', () => {
  const prompt = desktopChatPrompt({ id: 'snail-planner', projectId: 'snail', name: 'Story planner', agent: 'claude', status: 'unknown', summary: '', updatedAt: '' }, 'Snail Mail')
  expect(prompt).toContain('SAVE one new')
  expect(prompt).toContain('Forgeboard Inbox')
  expect(prompt).toContain('snail-planner')
  expect(prompt).toContain('project "snail"')
  expect(prompt).toContain('never mark tests passed')
  expect(prompt).not.toContain('one copy-ready JSON array to paste')
})
