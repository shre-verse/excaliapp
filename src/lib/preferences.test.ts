import { describe, expect, it } from 'vitest'
import { convertPreferencesFromRust, convertPreferencesToRust } from './preferences'

describe('preference conversion', () => {
  it('defaults legacy preferences to an empty workspace access map', () => {
    expect(convertPreferencesFromRust({ theme: 'dark' }).workspaceAccess).toEqual({})
  })

  it('converts workspace access across the Tauri boundary', () => {
    const preferences = convertPreferencesFromRust({
      workspace_access: {
        'c:/drawings': 'editable',
      },
    })

    expect(preferences.workspaceAccess).toEqual({
      'c:/drawings': 'editable',
    })
    expect(convertPreferencesToRust(preferences).workspace_access).toEqual({
      'c:/drawings': 'editable',
    })
  })
})
