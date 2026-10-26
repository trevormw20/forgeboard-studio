// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ActivityNotification } from '../lib/notifications'
import { createSeedWorkspace } from '../seed'
import { ActivityToastStack, NotificationCenter } from './NotificationCenter'

afterEach(cleanup)
const notification: ActivityNotification = { id: 'one', groupId: 'file-one', kind: 'summary', title: 'Assets need your review', body: 'Check the build before approving the assets.', at: '2026-10-26T16:00:00Z', projectId: 'calculator-quest', taskId: 'review-task', ai: true, needsYou: 'Approve the updated art.', nextStep: 'Open the test build.' }

it('shows an unread real summary with project context and opens its original checklist', () => {
  const onRead = vi.fn(), onOpen = vi.fn()
  render(<NotificationCenter items={[notification]} unreadIds={new Set(['one'])} projects={createSeedWorkspace().projects} onRead={onRead} onOpen={onOpen} />)
  expect(screen.getByText('1 unread update')).toBeTruthy()
  expect(screen.getByText(/Calculator Quest/)).toBeTruthy()
  expect(screen.getByText(/Haiku summary · verify/)).toBeTruthy()
  expect(screen.getByText('Needs you')).toBeTruthy()
  expect(screen.getByText('Approve the updated art.')).toBeTruthy()
  expect(screen.getByText('Next step')).toBeTruthy()
  expect(screen.getByText('Open the test build.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Open checklist/ }))
  expect(onRead).toHaveBeenCalledWith(['one'])
  expect(onOpen).toHaveBeenCalledWith(notification)
})

it('marks the displayed unread snapshot without changing the original work', () => {
  const onRead = vi.fn()
  render(<NotificationCenter items={[notification, { ...notification, id: 'read' }]} unreadIds={new Set(['one'])} projects={[]} onRead={onRead} onOpen={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
  expect(onRead).toHaveBeenCalledWith(['one'])
})

it('closing a live popup does not mark the actual notification read', () => {
  const onDismiss = vi.fn(), onOpen = vi.fn()
  render(<ActivityToastStack items={[notification]} projects={[]} onOpen={onOpen} onDismiss={onDismiss} />)
  fireEvent.click(screen.getByRole('button', { name: /Dismiss popup/ }))
  expect(onDismiss).toHaveBeenCalledWith('one')
  expect(onOpen).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Live project updates').getAttribute('aria-live')).toBe('polite')
})
