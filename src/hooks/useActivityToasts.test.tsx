// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityNotification } from '../lib/notifications'
import { useActivityToasts } from './useActivityToasts'

const item = (id: string, groupId = id): ActivityNotification => ({ id, groupId, kind: 'chat', title: id, body: 'Reported work', at: '2026-10-26T16:00:00Z' })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('incoming activity popups', () => {
  it('does not popup historical startup reports or duplicate updates on re-render', () => {
    const { result, rerender } = renderHook(useActivityToasts, { initialProps: { items: [item('old')], ready: false, workspaceId: 'one' } })
    expect(result.current.toasts).toHaveLength(0)
    rerender({ items: [item('old')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts).toHaveLength(0)
    rerender({ items: [item('new'), item('old')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts.map((entry) => entry.id)).toEqual(['new'])
    act(() => result.current.dismissToast('new'))
    rerender({ items: [item('new'), item('old')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('replaces a file popup when its Haiku result arrives, limits the stack, and quietly expires it', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(useActivityToasts, { initialProps: { items: [] as ActivityNotification[], ready: true, workspaceId: 'one' } })
    rerender({ items: [item('file-received', 'file')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts[0].id).toBe('file-received')
    rerender({ items: [item('file-summary', 'file')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts.map((entry) => entry.id)).toEqual(['file-summary'])
    rerender({ items: [item('four'), item('three'), item('two'), item('file-summary', 'file')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts.map((entry) => entry.id)).toEqual(['four', 'three', 'two'])
    act(() => vi.advanceTimersByTime(12_000))
    expect(result.current.toasts).toHaveLength(0)
  })

  it('resets its baseline when the workspace changes instead of leaking other workspace popups', () => {
    const { result, rerender } = renderHook(useActivityToasts, { initialProps: { items: [] as ActivityNotification[], ready: true, workspaceId: 'one' } })
    rerender({ items: [item('new')], ready: true, workspaceId: 'one' })
    expect(result.current.toasts).toHaveLength(1)
    rerender({ items: [item('other')], ready: true, workspaceId: 'two' })
    expect(result.current.toasts).toHaveLength(0)
  })
})
