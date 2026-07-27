# Global Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted global light/dark toggle in the sidebar and wire Excalidraw's standard `Shift+Alt+D` shortcut.

**Architecture:** A pure theme helper resolves effective and next themes. The Zustand store owns the toggle, applies the root CSS class, and persists preferences. Sidebar and keyboard entry points call the same store action, while every mounted Excalidraw pane continues consuming the controlled preference.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Excalidraw 0.18.1.

---

### Task 1: Add shared effective-theme logic

**Files:**
- Create: `src/lib/theme.ts`
- Create: `src/lib/theme.test.ts`
- Modify: `src/test/setup.ts`
- Modify: `src/components/ExcalidrawEditor.tsx`

- [ ] **Step 1: Add a configurable jsdom `matchMedia` mock**

Define `window.matchMedia` in `src/test/setup.ts` with `matches: false`, no-op listener methods, and a Vitest mock function that individual tests can override. This prevents system-theme code from throwing in jsdom.

- [ ] **Step 2: Write failing helper tests**

```ts
import { describe, expect, it } from 'vitest'
import { getEffectiveTheme, getNextExplicitTheme } from './theme'

describe('theme helpers', () => {
  it('resolves system theme from the media query', () => {
    expect(getEffectiveTheme('system', true)).toBe('dark')
    expect(getEffectiveTheme('system', false)).toBe('light')
  })

  it('switches to the opposite explicit theme', () => {
    expect(getNextExplicitTheme('light', false)).toBe('dark')
    expect(getNextExplicitTheme('dark', false)).toBe('light')
    expect(getNextExplicitTheme('system', true)).toBe('light')
  })
})
```

- [ ] **Step 3: Run the tests and confirm the missing-module failure**

Run: `npm run test:run -- src/lib/theme.test.ts`

Expected: FAIL because `src/lib/theme.ts` does not exist.

- [ ] **Step 4: Implement the pure helpers**

```ts
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
```

- [ ] **Step 5: Replace duplicated theme resolution in `ExcalidrawEditor`**

Use `getEffectiveTheme(preferenceTheme, window.matchMedia(...).matches)` and pass the result to every `EditorPane`.

- [ ] **Step 6: Run the helper test**

Run: `npm run test:run -- src/lib/theme.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/theme.ts src/lib/theme.test.ts src/test/setup.ts src/components/ExcalidrawEditor.tsx
git commit -m "refactor: centralize theme resolution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add the persisted Zustand theme action

**Files:**
- Modify: `src/store/useStore.ts`
- Create: `src/store/useStore.theme.test.ts`

- [ ] **Step 1: Write failing store tests**

Reset the store before each test, mock `save_preferences`, and verify:

```ts
await useStore.getState().toggleTheme()
expect(useStore.getState().preferences.theme).toBe('dark')
expect(document.documentElement).toHaveClass('dark')
expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
  preferences: expect.objectContaining({ theme: 'dark' }),
})
```

Cover light-to-dark, dark-to-light, and system-to-opposite-effective-theme transitions.

- [ ] **Step 2: Run the store test and confirm the missing-action failure**

Run: `npm run test:run -- src/store/useStore.theme.test.ts`

Expected: FAIL because `toggleTheme` is not part of `AppStore`.

- [ ] **Step 3: Add `toggleTheme` to `AppStore` and its implementation**

Use `getNextExplicitTheme`, update `preferences`, call `applyDocumentTheme`, then await `savePreferences`. Reuse `applyDocumentTheme` when loading preferences so initial load and toggles use one path.

- [ ] **Step 4: Run the store test**

Run: `npm run test:run -- src/store/useStore.theme.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/store/useStore.ts src/store/useStore.theme.test.ts
git commit -m "feat: persist global theme changes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Wire the standard shortcut

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Create: `src/hooks/useKeyboardShortcuts.test.tsx`

- [ ] **Step 1: Write the failing shortcut test**

Render a component that calls `useKeyboardShortcuts`, replace the store's `toggleTheme` action with a spy, and dispatch:

```ts
window.dispatchEvent(new KeyboardEvent('keydown', {
  altKey: true,
  shiftKey: true,
  code: 'KeyD',
  bubbles: true,
  cancelable: true,
}))
```

Assert the spy runs once, the event is default-prevented, and unrelated `Alt+Shift+X` does not invoke it.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm run test:run -- src/hooks/useKeyboardShortcuts.test.tsx`

Expected: FAIL because the hook does not handle the shortcut.

- [ ] **Step 3: Implement the host-owned shortcut**

Match upstream Excalidraw with `event.altKey && event.shiftKey && event.code === 'KeyD'`, call `preventDefault()`, and invoke the store action. Do not add Ctrl/Cmd or intercept other Excalidraw shortcuts.

- [ ] **Step 4: Run the shortcut test**

Run: `npm run test:run -- src/hooks/useKeyboardShortcuts.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/useKeyboardShortcuts.ts src/hooks/useKeyboardShortcuts.test.tsx
git commit -m "feat: restore Excalidraw theme shortcut" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add the sidebar toggle

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Create: `src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar tests**

Render `Sidebar` with light preferences and assert a button named `Switch to dark mode`. Click it and assert `toggleTheme` is called. Repeat with dark preferences and assert `Switch to light mode`. Set a system preference with both mocked media-query results and verify the destination label and icon follow the effective theme.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm run test:run -- src/components/Sidebar.test.tsx`

Expected: FAIL because the theme button is absent.

- [ ] **Step 3: Add the compact footer button**

Use `Sun` and `Moon` from `lucide-react`, the shared effective-theme helper, and the store action. Keep the existing file count and add the theme control alongside it with an accessible destination label.

- [ ] **Step 4: Run the sidebar test**

Run: `npm run test:run -- src/components/Sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run theme validation**

Run:

```powershell
npm run test:run -- src/lib/theme.test.ts src/store/useStore.theme.test.ts src/hooks/useKeyboardShortcuts.test.tsx src/components/Sidebar.test.tsx
npm run typecheck
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 6: Commit**

```powershell
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat: add global theme toggle" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Validate the Windows desktop behavior

**Files:**
- Modify only if validation finds a reproducible defect.

- [ ] **Step 1: Launch the app**

Run:

```powershell
$env:Path = "D:\packages\cargo\bin;$env:Path"
npm run tauri dev
```

- [ ] **Step 2: Exercise both entry points**

Verify the sidebar button changes the full app shell and all open canvases, `Shift+Alt+D` toggles with canvas focus, the preference survives restart, and drawing dirty state does not change.

- [ ] **Step 3: Run the full verification suite**

Run:

```powershell
npm run test:run
npm run typecheck
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit successfully.
