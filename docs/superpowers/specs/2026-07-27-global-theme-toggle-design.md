# Global Theme Toggle Design

## Goal

Provide a basic, persisted light/dark theme switch that updates the ExcaliApp shell and every mounted Excalidraw canvas together.

## Current Behavior

ExcaliApp passes a controlled `theme` prop to Excalidraw based on the persisted application preference. Excalidraw disables its built-in `Shift+Alt+D` action when a host controls the theme unless the host implements the toggle. ExcaliApp currently has no theme control or shortcut action, so the documented Excalidraw shortcut does nothing.

## Behavior

- Add a global theme toggle button to the sidebar footer.
- Handle Excalidraw's standard `Shift+Alt+D` shortcut through `useKeyboardShortcuts`.
- Both entry points call one Zustand `toggleTheme` action.
- The action resolves the current effective theme, switches to the opposite explicit `light` or `dark` preference, updates the document root class, and persists preferences.
- If the current preference is `system`, the first toggle switches to the opposite of the currently effective system theme.
- `ExcalidrawEditor` continues deriving its controlled theme from the preference, so all mounted editor panes update together.
- The toggle is global application state and does not modify `.excalidraw` file content or dirty state.

## User Interface

The sidebar footer shows a compact button with a sun or moon icon and the destination action, such as **Switch to dark mode**. It remains available whenever the sidebar is visible.

The shortcut calls `preventDefault()` and does not depend on canvas focus. Existing Excalidraw drawing and clipboard shortcuts remain untouched.

## Testing

- Store tests verify light-to-dark, dark-to-light, and system-to-opposite-effective-theme transitions.
- Tests verify the root `dark` class and persisted preference update together.
- Keyboard-hook tests verify `Shift+Alt+D` invokes the store action without affecting unrelated shortcuts.
- Sidebar tests verify the label and icon reflect the destination theme.
