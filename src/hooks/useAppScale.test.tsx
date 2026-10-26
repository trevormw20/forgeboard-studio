// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loadAppScale, saveAppScale } from '../lib/db'
import { useAppScale } from './useAppScale'

vi.mock('../lib/db', () => ({ loadAppScale: vi.fn(), saveAppScale: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(loadAppScale).mockReset().mockResolvedValue(undefined)
  vi.mocked(saveAppScale).mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('style')
})

it('starts at 100% while loading and safely uses the default for a new browser', async () => {
  const stored = deferred<unknown>()
  vi.mocked(loadAppScale).mockReturnValue(stored.promise)
  const { result } = renderHook(useAppScale)
  expect(result.current.scale).toBe(100)
  expect(result.current.loading).toBe(true)
  expect(document.documentElement.style.getPropertyValue('zoom')).toBe('1')
  expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('1')
  await act(async () => { stored.resolve(undefined) })
  expect(result.current.loading).toBe(false)
  expect(result.current.saveError).toBeUndefined()
  expect(saveAppScale).not.toHaveBeenCalled()
})

it.each([60, 85, 125])('restores valid stored scale %s without writing planner data', async (stored) => {
  vi.mocked(loadAppScale).mockResolvedValue(stored)
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.scale).toBe(stored)
  expect(document.documentElement.style.getPropertyValue('zoom')).toBe(String(stored / 100))
  expect(saveAppScale).not.toHaveBeenCalled()
})

it.each([null, '85', 0, 59, 126, 82, NaN, Infinity, {}, 100.5])('ignores malformed stored preference %s', async (stored) => {
  vi.mocked(loadAppScale).mockResolvedValue(stored)
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.scale).toBe(100)
  expect(saveAppScale).not.toHaveBeenCalled()
})

it('applies immediately, saves the browser preference, and restores it on reopening', async () => {
  let stored: unknown
  vi.mocked(loadAppScale).mockImplementation(async () => stored)
  vi.mocked(saveAppScale).mockImplementation(async (scale) => { stored = scale })
  const first = renderHook(useAppScale)
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  act(() => first.result.current.setScale(85))
  expect(first.result.current.scale).toBe(85)
  expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('0.85')
  await waitFor(() => expect(saveAppScale).toHaveBeenCalledExactlyOnceWith(85))
  first.unmount()
  const second = renderHook(useAppScale)
  await waitFor(() => expect(second.result.current.loading).toBe(false))
  expect(second.result.current.scale).toBe(85)
})

it('does not let a slow initial read replace a newer user selection', async () => {
  const stored = deferred<unknown>()
  vi.mocked(loadAppScale).mockReturnValue(stored.promise)
  const { result } = renderHook(useAppScale)
  act(() => result.current.setScale(75))
  await act(async () => { stored.resolve(125) })
  expect(result.current.scale).toBe(75)
  expect(result.current.loading).toBe(false)
  expect(result.current.saveError).toBeUndefined()
})

it('serializes rapid choices so the latest selection is the last durable value', async () => {
  const firstSave = deferred<void>()
  vi.mocked(saveAppScale).mockImplementationOnce(() => firstSave.promise)
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.setScale(75); result.current.setScale(85); result.current.setScale(100) })
  expect(result.current.scale).toBe(100)
  await waitFor(() => expect(saveAppScale).toHaveBeenCalledTimes(1))
  expect(saveAppScale).toHaveBeenNthCalledWith(1, 75)
  await act(async () => { firstSave.resolve() })
  expect(saveAppScale).toHaveBeenCalledTimes(3)
  expect(saveAppScale).toHaveBeenNthCalledWith(2, 85)
  expect(saveAppScale).toHaveBeenNthCalledWith(3, 100)
})

it('keeps the UI usable after a read error and clears feedback after a successful choice', async () => {
  vi.mocked(loadAppScale).mockRejectedValue(new Error('Storage unavailable'))
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.scale).toBe(100)
  expect(result.current.saveError).toMatch(/could not be loaded/)
  await act(async () => result.current.setScale(80))
  expect(result.current.scale).toBe(80)
  expect(result.current.saveError).toBeUndefined()
})

it('reports failed saves without undoing the visible scale and allows retry', async () => {
  vi.mocked(saveAppScale).mockRejectedValueOnce(new Error('Storage full'))
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => result.current.setScale(85))
  expect(result.current.scale).toBe(85)
  expect(result.current.saveError).toMatch(/could not remember/)
  await act(async () => result.current.setScale(85))
  expect(result.current.saveError).toBeUndefined()
  expect(saveAppScale).toHaveBeenCalledTimes(2)
})

it('ignores a stale load failure after the user has chosen a scale', async () => {
  const stored = deferred<unknown>()
  vi.mocked(loadAppScale).mockReturnValue(stored.promise)
  const { result } = renderHook(useAppScale)
  await act(async () => result.current.setScale(85))
  await act(async () => { stored.reject(new Error('Old load error')) })
  expect(result.current.scale).toBe(85)
  expect(result.current.saveError).toBeUndefined()
})

it('ignores older failed saves when a newer choice is queued and still saves that newer choice', async () => {
  const firstSave = deferred<void>()
  vi.mocked(saveAppScale).mockImplementationOnce(() => firstSave.promise)
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.setScale(75); result.current.setScale(85) })
  await waitFor(() => expect(saveAppScale).toHaveBeenCalledTimes(1))
  await act(async () => { firstSave.reject(new Error('Earlier save failed')) })
  expect(result.current.scale).toBe(85)
  expect(result.current.saveError).toBeUndefined()
  expect(saveAppScale).toHaveBeenNthCalledWith(2, 85)
})

it('restores original root styles and ignores a late load after unmount', async () => {
  const stored = deferred<unknown>()
  document.documentElement.style.setProperty('zoom', '0.9', 'important')
  document.documentElement.style.setProperty('--app-scale', '0.9')
  vi.mocked(loadAppScale).mockReturnValue(stored.promise)
  const { unmount } = renderHook(useAppScale)
  unmount()
  await act(async () => { stored.resolve(75) })
  expect(document.documentElement.style.getPropertyValue('zoom')).toBe('0.9')
  expect(document.documentElement.style.getPropertyPriority('zoom')).toBe('important')
  expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('0.9')
})

it('finishes already-queued saves after unmount without restoring app styles', async () => {
  const firstSave = deferred<void>()
  vi.mocked(saveAppScale).mockImplementationOnce(() => firstSave.promise)
  const { result, unmount } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.setScale(75); result.current.setScale(85) })
  await waitFor(() => expect(saveAppScale).toHaveBeenCalledTimes(1))
  unmount()
  await act(async () => { firstSave.resolve() })
  expect(saveAppScale).toHaveBeenNthCalledWith(2, 85)
  expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('')
})

it('rejects invalid scale updates instead of applying or persisting them', async () => {
  const { result } = renderHook(useAppScale)
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.setScale(20); result.current.setScale(82); result.current.setScale(NaN); result.current.setScale(150) })
  expect(result.current.scale).toBe(100)
  expect(saveAppScale).not.toHaveBeenCalled()
})
