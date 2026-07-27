# ExcaliApp Copilot Instructions

## Commands

- Install JavaScript dependencies with `npm ci`. CI and release workflows use Node.js 24; native commands require the latest stable Rust toolchain.
- Run the web frontend only with `npm run dev`; Vite serves on fixed port `1420`.
- Run the desktop app in development with `npm run tauri dev`.
- Type-check with `npm run typecheck`.
- Build the frontend with `npm run build` (`tsc && vite build`).
- Build the native desktop application with `npm run tauri build`.
- Run the Vitest suite once with `npm run test:run`; use `npm test` for watch mode.
- Run one test file with `npm run test:run -- src/lib/utils.test.ts`.
- Run one named test with `npm run test:run -- src/lib/utils.test.ts -t "should combine class names"`.
- Validate the Rust backend independently with `cargo check --manifest-path src-tauri/Cargo.toml`.
- No lint or formatter script is configured. Use `npm run typecheck`, tests, and builds; the README's `type-check` and `format` command names are stale. `test:coverage` is also unavailable until a Vitest coverage provider is added.

Release packaging is specialized: tags matching `v*` run `.github/workflows/release.yml` to test and build the macOS DMG and Linux AppImage, while the Mac App Store workflow is manually dispatched. Keep version changes synchronized across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.

## Architecture

ExcaliApp is a local-first Tauri 2 desktop application. The React 19 frontend renders the file browser, tabs, presentation UI, and embedded Excalidraw editor; the Rust backend owns filesystem access, native menus, preferences persistence, file watching, and security validation. Frontend filesystem operations must cross the Tauri IPC boundary through commands registered in `src-tauri/src/lib.rs`.

`src/store/useStore.ts` is the application coordinator. Its Zustand store owns the selected directory, recursive file tree, active file, open tabs, cached Excalidraw scenes/content hashes, dirty state, presentation mode, and preferences. Components and hooks should call store actions rather than duplicating file lifecycle logic.

Workspace access is persisted locally per normalized directory. Unknown workspaces default to read-only; the store gates filesystem mutations and `ExcalidrawEditor` enables canvas view mode until editing is explicitly enabled. Saves include the loaded content hash, and Rust rejects stale writes when the disk hash changed.

Each open tab keeps cached JSON, parsed scene data, a disk content hash, and a `sceneVersion`. `ExcalidrawEditor` keeps one editor pane mounted per tab and hides inactive panes so canvas state survives tab switches. When a tab is revisited, the store compares the backend's BLAKE3 hash with the cached hash: unchanged files load from cache, externally changed files reload from disk.

The Rust backend is split by responsibility:

- `src-tauri/src/lib.rs` implements Tauri commands, file watching, preferences storage, close interception, and command registration.
- `src-tauri/src/security.rs` provides path canonicalization, `.excalidraw` extension checks, joined-name sanitization, and Excalidraw JSON validation helpers used by filesystem commands.
- `src-tauri/src/menu.rs` builds native menus and emits `menu-command` events consumed by `src/hooks/useMenuHandler.ts`.

Rust emits `file-system-change` when the watcher reports a changed `.excalidraw` path, and `App.tsx` requests a tree refresh. Store actions explicitly update open-file state after app-initiated deletes and refresh the tree after folder operations. Window close is also event-driven: Rust emits `check-unsaved-before-close`, React prompts for save/discard, and only then invokes `force_close_app`.

## Repository Conventions

- Preserve the IPC contract exactly. Rust command parameters use snake_case internally, while Tauri invoke objects use the generated camelCase keys such as `filePath`, `oldPath`, and `folderName`.
- Preferences are camelCase in TypeScript and snake_case in Rust. Always use `convertPreferencesFromRust` and `convertPreferencesToRust` at this boundary. `FileTreeNode.is_directory` intentionally mirrors the Rust payload and is not converted.
- Treat paths as absolute and cross-platform. Existing TypeScript path helpers accept both `/` and `\`; do not introduce separator-specific string logic.
- Keep file mutation and unsaved-change behavior centralized in the Zustand store. Switching files, creating files, closing tabs, renaming folders, and deleting paths all need to preserve `openTabs`, `activeFile`, cached content, tree state, and dirty markers together.
- Treat `workspaceAccessMode` as a defense-in-depth policy: UI controls, keyboard/menu entry points, store mutations, and Excalidraw canvas changes must remain consistent with it.
- Excalidraw saves must remain valid JSON with `type: "excalidraw"`, numeric `version`, an `elements` array, selected serializable `appState` fields, and embedded `files`. The normal `save_file` command validates paths, extensions, and content. `save_file_as` currently writes directly, so changes to that flow must not assume it receives the same validation.
- Programmatic editor setup and centering must not mark a file dirty. `ExcalidrawEditor` delays change tracking until initial content is centered; preserve that guard when changing load behavior.
- Native menu commands and global keyboard shortcuts are parallel entry points. When adding or changing an app command, check both `src-tauri/src/menu.rs`, `src/hooks/useMenuHandler.ts`, and `src/hooks/useKeyboardShortcuts.ts`. Clipboard/select-all shortcuts deliberately remain owned by Excalidraw.
- Tests use Vitest with `jsdom` and `src/test/setup.ts`; colocate frontend tests as `*.test.ts` or `*.test.tsx`.
- Use current source, `package.json`, and workflows as the authority. `CLAUDE.md` contains useful original design intent, but its implementation-status and dependency notes predate the current application.
