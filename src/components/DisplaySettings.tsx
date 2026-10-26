import { useId } from 'react'
import { ChevronRight, Database, Keyboard, Monitor, RotateCcw } from 'lucide-react'
import './display-settings.css'

export interface DisplaySettingsProps {
  scale: number
  onScaleChange: (scale: number) => void
  onOpenConnection: () => void
  onOpenShortcuts: () => void
  loading?: boolean
  saveError?: string
}

const presets = [
  { value: 75, label: 'Compact' },
  { value: 85, label: 'Comfortable' },
  { value: 100, label: 'Default' },
]

export function DisplaySettings({ scale, onScaleChange, onOpenConnection, onOpenShortcuts, loading = false, saveError }: DisplaySettingsProps) {
  const id = useId()
  const helpId = `${id}-help`
  return <div className="display-settings">
    <section className="display-settings-section" aria-labelledby={`${id}-heading`}>
      <div className="display-settings-heading"><Monitor size={19} aria-hidden="true" /><div><h2 id={`${id}-heading`}>Display</h2><p>Make Forgeboard fit your monitor.</p></div></div>
      <fieldset className="display-scale-controls" disabled={loading}>
        <legend className="sr-only">App scale</legend>
        <div className="display-scale-label"><label htmlFor={`${id}-scale`}>App scale</label><output htmlFor={`${id}-scale`} aria-live="polite">{scale}%</output></div>
        <input id={`${id}-scale`} className="display-scale-range" type="range" min={60} max={125} step={5} value={scale} aria-describedby={helpId} aria-valuetext={`${scale} percent`} onChange={(event) => onScaleChange(Number(event.target.value))} />
        <div className="display-scale-limits" aria-hidden="true"><span>60% · Smaller</span><span>125% · Larger</span></div>
        <div className="display-scale-presets" aria-label="Scale presets">{presets.map((preset) => <button key={preset.value} type="button" aria-label={`${preset.value}% ${preset.label}`} aria-pressed={scale === preset.value} onClick={() => onScaleChange(preset.value)}><strong>{preset.value}%</strong><span>{preset.label}</span></button>)}</div>
        <button className="display-scale-reset" type="button" onClick={() => onScaleChange(100)}><RotateCcw size={14} aria-hidden="true" />Reset to 100%</button>
      </fieldset>
      <p className="display-settings-help" id={helpId}>Changes apply immediately and are remembered in this browser only. Your Windows display scale and planner data stay the same.</p>
      {loading && <p className="display-settings-feedback" role="status">Loading your display preference…</p>}
      {saveError && <p className="display-settings-error" role="alert">{saveError}</p>}
    </section>
    <section className="display-settings-section display-settings-tools" aria-labelledby={`${id}-tools`}>
      <h2 id={`${id}-tools`}>Connection & shortcuts</h2>
      <button type="button" className="display-settings-link" onClick={() => onOpenConnection()}><Database size={18} aria-hidden="true" /><span><strong>Data connection</strong><small>Manage your private GitHub vault and sync.</small></span><ChevronRight size={17} aria-hidden="true" /></button>
      <button type="button" className="display-settings-link" onClick={() => onOpenShortcuts()}><Keyboard size={18} aria-hidden="true" /><span><strong>Keyboard shortcuts</strong><small>Quick ways to capture and navigate.</small></span><ChevronRight size={17} aria-hidden="true" /></button>
    </section>
  </div>
}
