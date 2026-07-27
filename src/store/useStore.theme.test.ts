import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke, mockMatchMedia, mockMessage } from '../test/setup'
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks(count = 5) {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve()
  }
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

  it('keeps the existing theme when saving the new preference fails', async () => {
    seedPreferences('dark')
    document.documentElement.classList.add('dark')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValueOnce(new Error('save failed'))

    try {
      await useStore.getState().toggleTheme()

      expect(useStore.getState().preferences.theme).toBe('dark')
      expect(document.documentElement).toHaveClass('dark')
      expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
        preferences: expect.objectContaining({ theme: 'light' }),
      })
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to toggle theme:',
        expect.any(Error)
      )
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update theme:'),
        expect.objectContaining({
          title: 'Error',
          kind: 'error',
        })
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('serializes rapid toggles so a second unawaited toggle restores the original theme', async () => {
    seedPreferences('light')
    const firstSave = createDeferred<void>()
    const secondSave = createDeferred<void>()

    mockInvoke
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    const firstToggle = useStore.getState().toggleTheme()
    const secondToggle = useStore.getState().toggleTheme()

    await flushMicrotasks()
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'save_preferences', {
      preferences: expect.objectContaining({ theme: 'dark' }),
    })

    firstSave.resolve()
    await firstToggle
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'save_preferences', {
      preferences: expect.objectContaining({ theme: 'light' }),
    })

    secondSave.resolve()
    await secondToggle

    expect(useStore.getState().preferences.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('preserves unrelated preference changes made while theme persistence is in flight', async () => {
    seedPreferences('light')
    const firstSave = createDeferred<void>()
    const secondSave = createDeferred<void>()

    mockInvoke
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    const togglePromise = useStore.getState().toggleTheme()
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        sidebar_visible: false,
      }),
    })

    useStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        sidebarVisible: true,
      },
    }))
    const savePromise = useStore.getState().savePreferences()

    firstSave.resolve()
    await togglePromise
    await flushMicrotasks()

    expect(useStore.getState().preferences).toEqual(
      expect.objectContaining({
        theme: 'dark',
        sidebarVisible: true,
      })
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        sidebar_visible: true,
      }),
    })

    secondSave.resolve()
    await savePromise
  })

  it('clears recent directories without overwriting a queued theme commit', async () => {
    seedPreferences('light')
    const firstSave = createDeferred<void>()
    const secondSave = createDeferred<void>()

    mockInvoke
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    const togglePromise = useStore.getState().toggleTheme()
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        recent_directories: ['D:\\work\\recent'],
      }),
    })

    const clearRecentPromise = (useStore.getState() as any).clearRecentDirectories()

    firstSave.resolve()
    await togglePromise
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        recent_directories: [],
      }),
    })

    secondSave.resolve()
    await clearRecentPromise

    expect(useStore.getState().preferences).toEqual(
      expect.objectContaining({
        theme: 'dark',
        recentDirectories: [],
      })
    )
  })

  it('toggles decorations without overwriting a queued theme commit', async () => {
    seedPreferences('light')
    const themeSave = createDeferred<void>()
    const decorationChange = createDeferred<void>()
    const decorationSave = createDeferred<void>()

    mockInvoke.mockImplementation((command, payload) => {
      if (command === 'save_preferences') {
        const theme = (payload as any).preferences.theme
        if (theme === 'dark') {
          return themeSave.promise
        }

        return decorationSave.promise
      }

      if (command === 'set_decorations') {
        return decorationChange.promise
      }

      return Promise.resolve(undefined)
    })

    const toggleThemePromise = useStore.getState().toggleTheme()
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        show_decorations: false,
      }),
    })

    useStore.getState().toggleDecorations()

    themeSave.resolve()
    await toggleThemePromise

    expect(useStore.getState().preferences).toEqual(
      expect.objectContaining({
        theme: 'dark',
        showDecorations: false,
      })
    )

    decorationChange.resolve()
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'save_preferences', {
      preferences: expect.objectContaining({
        theme: 'dark',
        show_decorations: true,
      }),
    })

    decorationSave.resolve()
    await flushMicrotasks()

    expect(useStore.getState().preferences).toEqual(
      expect.objectContaining({
        theme: 'dark',
        showDecorations: true,
      })
    )
  })

  it('serializes rapid decorations toggles so the second toggle restores the original visibility', async () => {
    seedPreferences('light')
    mockInvoke.mockResolvedValue(undefined)

    useStore.getState().toggleDecorations()
    useStore.getState().toggleDecorations()
    await flushMicrotasks(20)

    const decorationCalls = mockInvoke.mock.calls.filter(([command]) => command === 'set_decorations')
    const saveCalls = mockInvoke.mock.calls.filter(([command]) => command === 'save_preferences')

    expect(decorationCalls).toEqual([
      ['set_decorations', { visible: true }],
      ['set_decorations', { visible: false }],
    ])
    expect(saveCalls).toEqual([
      ['save_preferences', expect.objectContaining({
        preferences: expect.objectContaining({ show_decorations: true }),
      })],
      ['save_preferences', expect.objectContaining({
        preferences: expect.objectContaining({ show_decorations: false }),
      })],
    ])
    expect(useStore.getState().preferences.showDecorations).toBe(false)
  })

  it('rolls back decorations when persistence fails and continues processing queued saves', async () => {
    seedPreferences('light')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    let saveAttempts = 0

    mockInvoke.mockImplementation((command) => {
      if (command === 'set_decorations') {
        return Promise.resolve(undefined)
      }

      if (command === 'save_preferences') {
        saveAttempts += 1

        if (saveAttempts === 1) {
          return Promise.reject(new Error('save failed'))
        }
      }

      return Promise.resolve(undefined)
    })

    try {
      useStore.getState().toggleDecorations()
      useStore.setState((state) => ({
        preferences: {
          ...state.preferences,
          sidebarVisible: true,
        },
      }))
      const savePromise = useStore.getState().savePreferences()

      await flushMicrotasks(20)
      await savePromise

      const decorationCalls = mockInvoke.mock.calls.filter(([command]) => command === 'set_decorations')
      expect(decorationCalls).toEqual([
        ['set_decorations', { visible: true }],
        ['set_decorations', { visible: false }],
      ])
      expect(useStore.getState().preferences).toEqual(
        expect.objectContaining({
          showDecorations: false,
          sidebarVisible: true,
        })
      )
      expect(mockInvoke).toHaveBeenNthCalledWith(4, 'save_preferences', {
        preferences: expect.objectContaining({
          show_decorations: false,
          sidebar_visible: true,
        }),
      })
    } finally {
      alertSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })

  it('preserves a newly opened recent directory when clear recent is already queued', async () => {
    seedPreferences('light')
    const clearSave = createDeferred<void>()
    let saveCallCount = 0

    mockInvoke.mockImplementation((command) => {
      if (command === 'save_preferences') {
        saveCallCount += 1

        if (saveCallCount === 1) {
          return clearSave.promise
        }

        return Promise.resolve(undefined)
      }

      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }

      if (command === 'watch_directory') {
        return Promise.resolve(undefined)
      }

      return Promise.resolve(undefined)
    })

    const clearRecentPromise = useStore.getState().clearRecentDirectories()
    await flushMicrotasks()

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'save_preferences', {
      preferences: expect.objectContaining({
        recent_directories: [],
      }),
    })

    const loadDirectoryPromise = useStore.getState().loadDirectory('D:\\work\\new-dir')
    clearSave.resolve()

    await clearRecentPromise
    await loadDirectoryPromise
    await flushMicrotasks(10)

    expect(useStore.getState().preferences).toEqual(
      expect.objectContaining({
        lastDirectory: 'D:\\work\\new-dir',
        recentDirectories: ['D:\\work\\new-dir'],
      })
    )
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: expect.objectContaining({
        last_directory: 'D:\\work\\new-dir',
        recent_directories: ['D:\\work\\new-dir'],
      }),
    })
  })

  it('continues loading and starts watching when saving recent-directory preferences fails', async () => {
    seedPreferences('light')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    mockInvoke.mockImplementation((command) => {
      if (command === 'list_excalidraw_files' || command === 'get_file_tree') {
        return Promise.resolve([])
      }

      if (command === 'save_preferences') {
        return Promise.reject(new Error('save failed'))
      }

      if (command === 'watch_directory') {
        return Promise.resolve(undefined)
      }

      return Promise.resolve(undefined)
    })

    try {
      await useStore.getState().loadDirectory('D:\\work\\loaded')

      expect(useStore.getState().currentDirectory).toBe('D:\\work\\loaded')
      expect(mockInvoke).toHaveBeenCalledWith('watch_directory', {
        directory: 'D:\\work\\loaded',
      })
      expect(alertSpy).not.toHaveBeenCalled()
    } finally {
      alertSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })

  it('keeps theme state unchanged on failure and continues processing queued saves', async () => {
    seedPreferences('light')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const followUpSave = createDeferred<void>()

    mockInvoke
      .mockRejectedValueOnce(new Error('save failed'))
      .mockImplementationOnce(() => followUpSave.promise)

    try {
      const togglePromise = useStore.getState().toggleTheme()

      useStore.setState((state) => ({
        preferences: {
          ...state.preferences,
          sidebarVisible: true,
        },
      }))
      const savePromise = useStore.getState().savePreferences()

      await togglePromise
      await flushMicrotasks()

      expect(useStore.getState().preferences).toEqual(
        expect.objectContaining({
          theme: 'light',
          sidebarVisible: true,
        })
      )
      expect(document.documentElement).not.toHaveClass('dark')
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke).toHaveBeenNthCalledWith(2, 'save_preferences', {
        preferences: expect.objectContaining({
          theme: 'light',
          sidebar_visible: true,
        }),
      })

      followUpSave.resolve()
      await savePromise
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
