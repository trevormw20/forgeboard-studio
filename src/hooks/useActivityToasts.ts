import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityNotification } from '../lib/notifications'

interface Options { items: readonly ActivityNotification[]; ready: boolean; workspaceId: string }

/** Initial loading is a baseline, not a flood of historical "just finished"
 * popups. Once ready, new synchronized reports appear without opening a panel.
 * Closing a popup is deliberately not the same as reading its notification.
 */
export function useActivityToasts({ items, ready, workspaceId }: Options) {
  const [toasts, setToasts] = useState<ActivityNotification[]>([])
  const seen = useRef<Set<string>>(new Set())
  const baseline = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!ready) return
    if (baseline.current !== workspaceId) {
      baseline.current = workspaceId
      seen.current = new Set(items.map((item) => item.id))
      setToasts([])
      return
    }
    const arrived = items.filter((item) => !seen.current.has(item.id))
    for (const item of items) seen.current.add(item.id)
    if (!arrived.length) return
    setToasts((previous) => {
      const freshGroups = new Set(arrived.map((item) => item.groupId))
      return [...arrived, ...previous.filter((item) => !freshGroups.has(item.groupId))].slice(0, 3)
    })
  }, [items, ready, workspaceId])

  useEffect(() => {
    if (!toasts.length) return
    const timer = window.setTimeout(() => setToasts([]), 12_000)
    return () => window.clearTimeout(timer)
  }, [toasts])

  const dismissToast = useCallback((id: string) => setToasts((previous) => previous.filter((item) => item.id !== id)), [])
  const dismissAllToasts = useCallback(() => setToasts([]), [])
  return { toasts, dismissToast, dismissAllToasts }
}
