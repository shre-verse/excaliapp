import { describe, expect, it } from 'vitest'
import { getWorkspaceAccessMode, normalizeWorkspaceKey } from './workspaceAccess'

describe('workspace access helpers', () => {
  it('defaults unknown workspaces to read-only', () => {
    expect(getWorkspaceAccessMode({}, 'c:/drawings')).toBe('read-only')
  })

  it('restores an explicitly editable workspace', () => {
    expect(getWorkspaceAccessMode({ 'c:/drawings': 'editable' }, 'c:/drawings')).toBe('editable')
  })

  it('normalizes Windows paths for stable preference keys', () => {
    expect(normalizeWorkspaceKey('C:\\Users\\Example\\Drawings\\')).toBe('c:/users/example/drawings')
  })
})
