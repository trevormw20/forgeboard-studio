// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useForgeboard } from '../hooks/useForgeboard'
import { ProjectProgressPanel } from './ProjectProgressPanel'
import { ExperimentPanel } from './ExperimentPanel'

vi.mock('../lib/db', () => ({
  loadCachedWorkspace: async () => undefined, loadConnection: async () => undefined,
  countMutations: async () => 0, enqueueMutation: async () => {}, saveCachedWorkspace: async () => {},
}))
afterEach(cleanup)
function Harness({ panel }: { panel: 'progress' | 'experiment' }) {
  const forge = useForgeboard()
  if (!forge.ready) return <p>Loading</p>
  return panel === 'progress' ? <ProjectProgressPanel forge={forge} /> : <ExperimentPanel forge={forge} />
}
describe('manager extensions', () => {
  it('tracks and edits a desktop chat without claiming a live connection', async () => {
    render(<Harness panel="progress" />)
    await screen.findByRole('button', { name: 'Track a chat' })
    fireEvent.click(screen.getByRole('button', { name: 'Track a chat' }))
    fireEvent.change(screen.getByLabelText('Chat name or role'), { target: { value: 'Story planning' } })
    fireEvent.change(screen.getByLabelText('Chat status'), { target: { value: 'waiting-on-me' } })
    fireEvent.change(screen.getByLabelText('What is happening?'), { target: { value: 'Read the first letter before approving.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save chat status' }))
    expect(screen.getByText('Story planning')).toBeTruthy()
    expect(screen.getByText(/Claude desktop\/chat · Reported/)).toBeTruthy()
    expect(screen.getAllByText(/not a live connection/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Update status' }))
    fireEvent.change(screen.getByLabelText('Chat status'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save chat status' }))
    expect(screen.getByText('Part done')).toBeTruthy()
    const project = screen.getByLabelText('Status for Calculator Quest') as HTMLSelectElement
    expect(project.value).toBe('')
    fireEvent.change(project, { target: { value: 'paused' } })
    expect(project.value).toBe('paused')
    fireEvent.click(screen.getByRole('button', { name: 'Paste chat update' }))
    fireEvent.change(screen.getByLabelText('JSON update from your chat'), { target: { value: '{broken json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import update' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBeTruthy())
    expect(screen.getByText('Story planning')).toBeTruthy()
  })
  it('records an evidence checkpoint and a reasoned decision', async () => {
    render(<Harness panel="experiment" />)
    await screen.findByRole('button', { name: 'Plan an experiment' })
    fireEvent.click(screen.getByRole('button', { name: 'Plan an experiment' }))
    fireEvent.change(screen.getByLabelText('What are you testing?'), { target: { value: 'Readers request a sample' } })
    fireEvent.change(screen.getByLabelText('What action will produce useful evidence?'), { target: { value: 'Ask relevant readers about the offer' } })
    fireEvent.change(screen.getByLabelText('Your action goal'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Review on'), { target: { value: '2030-01-15' } })
    fireEvent.change(screen.getByLabelText('How will you decide to continue, adjust, or stop?'), { target: { value: 'Adjust if readers misunderstand the offer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }))
    expect(screen.getByText(/0\/10 planned actions recorded/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record progress or a decision' }))
    fireEvent.change(screen.getByLabelText('Actions completed since your last entry'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('What happened? Include responses, leads, sales, or what you learned'), { target: { value: 'Two conversations. One reader requested a sample.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save evidence' }))
    expect(screen.getByText(/2\/10 planned actions recorded/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Adjust' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Your review decision and reason'), { target: { value: 'Clarify pricing before the next test.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }))
    expect(screen.getByText(/Clarify pricing before the next test/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Business experiment checkpoints' })).getByText('adjust')).toBeTruthy()
  })
})
