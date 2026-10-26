// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

vi.mock('./lib/db', () => ({
  loadCachedWorkspace: async () => undefined, loadConnection: async () => undefined, loadBaseWorkspace: async () => undefined,
  countMutations: async () => 0, mutationIds: async () => [], saveWorkspaceChanges: async () => {}, clearMutations: async () => {},
  saveConnection: async () => {}, saveBaseWorkspace: async () => {}, saveSha: async () => {}, clearConnection: async () => {},
}))
beforeEach(() => { vi.stubGlobal('scrollTo', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('organized workspace navigation', () => {
  it('shows one top panel at a time and keeps the deadline visible', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Next up' })
    const tabs = screen.getByRole('tablist', { name: 'Workspace sections' })
    expect(within(tabs).getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByRole('heading', { name: 'From your chats' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Project and chat progress' })).toBeNull()
    fireEvent.click(within(tabs).getByRole('tab', { name: /From chats/ }))
    expect(screen.getByRole('heading', { name: 'From your chats' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Next up' })).toBeNull()
    expect(screen.getByText('Steam Next Fest submission')).toBeTruthy()
    fireEvent.keyDown(within(tabs).getByRole('tab', { name: /From chats/ }), { key: 'Home' })
    expect(within(tabs).getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(within(tabs).getByRole('tab', { name: 'Today' }))
  })

  it('filters the full priority list without hiding project identities', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Next up' })
    fireEvent.click(screen.getByRole('tab', { name: /All tasks/ }))
    const list = screen.getByRole('heading', { name: 'Priority list' }).closest('section')!
    expect(within(list).getByText('Store page live')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'Verify puzzle' } })
    expect(within(list).queryByText('Store page live')).toBeNull()
    expect(within(list).getByText('Verify puzzle validation on a full grid')).toBeTruthy()
    expect(within(list).getByText('Caseduko', { selector: '.project-label' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter tasks by project' }), { target: { value: 'calculator-quest' } })
    expect(within(list).getByText('No matching tasks')).toBeTruthy()
  })

  it('opens the matching project notebook and keeps a newly added project inside Notes', async () => {
    render(<App />)
    const projects = screen.getByRole('navigation', { name: 'Projects' })
    fireEvent.click(within(projects).getByRole('button', { name: /Calculator Quest/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Project notes' }))
    expect(screen.getByRole('heading', { name: 'Personal notes' })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Project notebook' }) as HTMLSelectElement).value).toBe('calculator-quest')
    fireEvent.click(screen.getByRole('button', { name: 'Add project notes' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'New notebook project' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(screen.getByRole('heading', { name: 'Personal notes' })).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Project notebook' }) as HTMLSelectElement
    expect(select.selectedOptions[0].textContent).toContain('New notebook project')
    expect(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: /New notebook project/ })).toBeTruthy()
  })

  it('does not take over browser shortcuts or typing in note fields', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Next up' })
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true })
    expect(screen.queryByRole('heading', { name: 'Personal notes' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'p' })
    expect(screen.getByRole('heading', { name: 'Personal notes' })).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Search all notes' })
    fireEvent.keyDown(search, { key: 'g' })
    expect(screen.getByRole('heading', { name: 'Personal notes' })).toBeTruthy()
  })

  it('uses the currently selected notebook project when adding a task', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Next up' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Project notebook' }), { target: { value: 'quadro' } })
    fireEvent.keyDown(document.body, { key: 'n' })
    const dialog = screen.getByRole('dialog', { name: 'Add task' })
    expect((within(dialog).getByLabelText('Project') as HTMLSelectElement).value).toBe('quadro')
  })
})
