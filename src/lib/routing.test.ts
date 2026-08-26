import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { routeNote } from './routing'

describe('fallback note routing', () => {
  it('recognizes a named project and bug board', () => {
    const workspace = createSeedWorkspace()
    const result = routeNote('Caseduko crashes when the grid is full', workspace.projects)
    expect(result.projectId).toBe('caseduko')
    expect(result.board).toBe('bugs')
  })
})
