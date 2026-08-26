export function createId(prefix: string): string {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${value}`
}

export function isoNow(): string {
  return new Date().toISOString()
}

export function toLocalInputValue(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

export function fromLocalInputValue(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}
