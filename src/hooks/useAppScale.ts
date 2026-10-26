import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadAppScale, saveAppScale } from '../lib/db'

function validScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 60 && value <= 125 && value % 5 === 0
}

export function useAppScale() {
  const [scale, setScaleState] = useState(100)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState<string>()
  const mounted = useRef(false)
  const revision = useRef(0)
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    mounted.current = true
    const initialRevision = revision.current
    void loadAppScale().then((stored) => {
      if (active && revision.current === initialRevision && validScale(stored)) setScaleState(stored)
    }).catch(() => {
      if (active && revision.current === initialRevision) setSaveError('Your saved display preference could not be loaded. You can still change the scale below.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false; mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const original = ['zoom', '--app-scale'].map((name) => ({ name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) }))
    const ratio = String(scale / 100)
    root.style.setProperty('zoom', ratio)
    root.style.setProperty('--app-scale', ratio)
    return () => {
      for (const { name, value, priority } of original) {
        if (value) root.style.setProperty(name, value, priority)
        else root.style.removeProperty(name)
      }
    }
  }, [scale])

  const setScale = useCallback((next: number) => {
    if (!validScale(next)) return
    const selectedRevision = ++revision.current
    setScaleState(next)
    setLoading(false)
    setSaveError(undefined)
    // Serialize IndexedDB writes so a slower earlier selection cannot win.
    // Finishing these writes after unmount is intentional; only React updates stop.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await saveAppScale(next)
        if (mounted.current && revision.current === selectedRevision) setSaveError(undefined)
      } catch {
        if (mounted.current && revision.current === selectedRevision) setSaveError('The scale changed, but this browser could not remember it. Try choosing a scale again; your planner data is unchanged.')
      }
    })
  }, [])

  return { scale, setScale, loading, saveError }
}
