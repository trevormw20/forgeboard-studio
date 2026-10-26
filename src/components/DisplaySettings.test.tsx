// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DisplaySettings, type DisplaySettingsProps } from './DisplaySettings'

afterEach(cleanup)

function props(overrides: Partial<DisplaySettingsProps> = {}): DisplaySettingsProps {
  return { scale: 100, onScaleChange: vi.fn(), onOpenConnection: vi.fn(), onOpenShortcuts: vi.fn(), ...overrides }
}

it('offers a labeled keyboard-accessible scale slider with immediate controlled updates', () => {
  const settings = props()
  const { rerender } = render(<DisplaySettings {...settings} />)
  const slider = screen.getByRole('slider', { name: 'App scale' })
  expect(slider.getAttribute('min')).toBe('60')
  expect(slider.getAttribute('max')).toBe('125')
  expect(slider.getAttribute('step')).toBe('5')
  expect(slider.getAttribute('aria-valuetext')).toBe('100 percent')
  fireEvent.change(slider, { target: { value: '80' } })
  expect(settings.onScaleChange).toHaveBeenCalledExactlyOnceWith(80)
  rerender(<DisplaySettings {...settings} scale={80} />)
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('80 percent')
  expect(screen.getByText('80%')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Save/i })).toBeNull()
})

it('offers compact presets, indicates the active one, and resets to the default', () => {
  const settings = props({ scale: 85 })
  render(<DisplaySettings {...settings} />)
  expect(screen.getByRole('button', { name: '85% Comfortable' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '75% Compact' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '75% Compact' }))
  fireEvent.click(screen.getByRole('button', { name: '85% Comfortable' }))
  fireEvent.click(screen.getByRole('button', { name: '100% Default' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset to 100%' }))
  expect(settings.onScaleChange).toHaveBeenNthCalledWith(1, 75)
  expect(settings.onScaleChange).toHaveBeenNthCalledWith(2, 85)
  expect(settings.onScaleChange).toHaveBeenNthCalledWith(3, 100)
  expect(settings.onScaleChange).toHaveBeenNthCalledWith(4, 100)
})

it('keeps connection and shortcut controls behind their callbacks without collecting credentials', () => {
  const settings = props()
  render(<DisplaySettings {...settings} />)
  fireEvent.click(screen.getByRole('button', { name: /Data connection/ }))
  fireEvent.click(screen.getByRole('button', { name: /Keyboard shortcuts/ }))
  expect(settings.onOpenConnection).toHaveBeenCalledExactlyOnceWith()
  expect(settings.onOpenShortcuts).toHaveBeenCalledExactlyOnceWith()
  expect(settings.onScaleChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText(/remembered in this browser only/)).toBeTruthy()
  expect(screen.getByText(/Windows display scale and planner data stay the same/)).toBeTruthy()
})

it('disables scale changes while loading and exposes preference errors accessibly', () => {
  const settings = props({ loading: true, saveError: 'This display preference could not be saved.' })
  render(<DisplaySettings {...settings} />)
  const slider = screen.getByRole('slider') as HTMLInputElement
  expect(slider.closest('fieldset')?.disabled).toBe(true)
  expect(screen.getByText('Loading your display preference…').getAttribute('role')).toBe('status')
  expect(screen.getByRole('alert').textContent).toBe('This display preference could not be saved.')
  fireEvent.click(screen.getByRole('button', { name: /Keyboard shortcuts/ }))
  expect(settings.onOpenShortcuts).toHaveBeenCalledOnce()
})
