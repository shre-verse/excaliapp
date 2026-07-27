import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useStore } from '../store/useStore'

describe('theme keyboard shortcut', () => {
  const toggleTheme = vi.fn()

  beforeEach(() => {
    toggleTheme.mockReset()
    useStore.setState({ toggleTheme } as never)
  })

  it('uses Excalidraw standard Shift+Alt+D shortcut', () => {
    renderHook(() => useKeyboardShortcuts())
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      shiftKey: true,
      code: 'KeyD',
      bubbles: true,
      cancelable: true,
    })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(toggleTheme).toHaveBeenCalledOnce()
  })
})
