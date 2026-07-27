import type { Preferences } from '../types'

export type EffectiveTheme = 'light' | 'dark'

export function getEffectiveTheme(
  preference: Preferences['theme'],
  systemPrefersDark: boolean
): EffectiveTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light'
  }

  return preference
}

export function getNextExplicitTheme(
  preference: Preferences['theme'],
  systemPrefersDark: boolean
): EffectiveTheme {
  return getEffectiveTheme(preference, systemPrefersDark) === 'dark' ? 'light' : 'dark'
}

export function applyDocumentTheme(theme: EffectiveTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
