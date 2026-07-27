import { describe, expect, it, beforeEach } from 'vitest'
import { applyDocumentTheme, getEffectiveTheme, getNextExplicitTheme } from './theme'

describe('theme helpers', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('resolves system preference from the media query', () => {
    expect(getEffectiveTheme('system', true)).toBe('dark')
    expect(getEffectiveTheme('system', false)).toBe('light')
  })

  it('computes the next explicit theme from light, dark, and system preferences', () => {
    expect(getNextExplicitTheme('light', false)).toBe('dark')
    expect(getNextExplicitTheme('dark', false)).toBe('light')
    expect(getNextExplicitTheme('system', true)).toBe('light')
    expect(getNextExplicitTheme('system', false)).toBe('dark')
  })

  it('applies the document theme class', () => {
    applyDocumentTheme('dark')
    expect(document.documentElement).toHaveClass('dark')

    applyDocumentTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
