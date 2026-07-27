import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke, mockMatchMedia } from '../test/setup'
import { useStore } from './useStore'

const initialState = useStore.getState()

function seedPreferences(theme: 'light' | 'dark' | 'system') {
  useStore.setState({
    preferences: {
      ...initialState.preferences,
      lastDirectory: 'D:\\work\\theme',
      recentDirectories: ['D:\\work\\recent'],
      theme,
      sidebarVisible: false,
      showDecorations: false,
    },
  })
}

function setSystemPreference(prefersDark: boolean) {
  mockMatchMedia.mockImplementation((query) => ({
    matches: prefersDark,
    media: query,
    query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

describe('useStore toggleTheme', () => {
  beforeEach(() => {
    useStore.setState(initialState, true)
    document.documentElement.classList.remove('dark')
  })

  it('switches light preferences to dark and persists snake_case preferences', async () => {
    seedPreferences('light')

    await useStore.getState().toggleTheme()

    expect(useStore.getState().preferences.theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: {
        last_directory: 'D:\\work\\theme',
        recent_directories: ['D:\\work\\recent'],
        theme: 'dark',
        sidebar_visible: false,
        show_decorations: false,
      },
    })
  })

  it('switches dark preferences to light and removes the root theme class', async () => {
    seedPreferences('dark')
    document.documentElement.classList.add('dark')

    await useStore.getState().toggleTheme()

    expect(useStore.getState().preferences.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: {
        last_directory: 'D:\\work\\theme',
        recent_directories: ['D:\\work\\recent'],
        theme: 'light',
        sidebar_visible: false,
        show_decorations: false,
      },
    })
  })

  it('switches system dark preferences to light', async () => {
    seedPreferences('system')
    setSystemPreference(true)
    document.documentElement.classList.add('dark')

    await useStore.getState().toggleTheme()

    expect(useStore.getState().preferences.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: expect.objectContaining({ theme: 'light' }),
    })
  })

  it('switches system light preferences to dark', async () => {
    seedPreferences('system')
    setSystemPreference(false)

    await useStore.getState().toggleTheme()

    expect(useStore.getState().preferences.theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: expect.objectContaining({ theme: 'dark' }),
    })
  })
})
