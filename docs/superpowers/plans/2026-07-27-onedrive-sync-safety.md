# OneDrive Sync Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OneDrive-backed workspaces read-only by default and prevent stale machines from overwriting newer `.excalidraw` content.

**Architecture:** Rust owns validated, hash-checked persistence and a long-lived recursive watcher. Zustand owns workspace access policy, save outcomes, tab/cache consistency, and external-change transitions. React components, native menus, and keyboard shortcuts delegate to those store actions rather than implementing independent policies.

**Tech Stack:** Tauri 2, Rust 2024, notify 8, BLAKE3, React 19, TypeScript, Zustand, Vitest, Testing Library.

---

### Task 1: Add hash-checked and create-only Rust persistence

**Files:**
- Create: `src-tauri/src/file_io.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `src-tauri/src/file_io.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests for:

```rust
#[test]
fn saves_when_expected_hash_matches()

#[test]
fn rejects_stale_hash_without_changing_disk_content()

#[test]
fn rejects_invalid_excalidraw_content_before_write()

#[test]
fn create_new_rejects_existing_target()
```

Use a unique directory below `std::env::temp_dir()`, write valid Excalidraw JSON, and remove the directory after each test.

- [ ] **Step 2: Run the focused Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml file_io::tests -- --nocapture`

Expected: FAIL because the module and functions do not exist.

- [ ] **Step 3: Implement serializable outcomes**

Create:

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SaveFileError {
    Conflict { message: String, current_hash: String },
    AlreadyExists { message: String },
    Validation { message: String },
    Io { message: String },
}

#[derive(Debug, Serialize)]
pub struct SavedFile {
    pub path: String,
    pub content_hash: String,
}
```

Implement `save_if_unchanged(path, content, expected_hash)` and `create_new(path, content)` using existing security helpers. `create_new` must use `OpenOptions::create_new(true)`.

- [ ] **Step 4: Route `save_file` and `save_file_as` through the helpers**

Change `save_file` to accept `expected_hash` and return `SavedFile`. Validate Save As parent, extension, and content before create-only write. Do not parse error strings in TypeScript.

- [ ] **Step 5: Run focused Rust tests and check**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml file_io::tests -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/file_io.rs src-tauri/src/lib.rs
git commit -m "feat: prevent stale file overwrites" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Persist workspace access and normalize workspace keys

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/security.rs`
- Modify: `src/types/index.ts`
- Modify: `src/lib/preferences.ts`
- Create: `src/lib/preferences.test.ts`

- [ ] **Step 1: Write failing preference conversion tests**

Verify a missing Rust `workspace_access` becomes `{}`, existing fields remain unchanged, and TypeScript serializes the map as `workspace_access`.

- [ ] **Step 2: Run the focused test**

Run: `npm run test:run -- src/lib/preferences.test.ts`

Expected: FAIL because `Preferences` has no workspace-access map.

- [ ] **Step 3: Extend Rust preferences safely**

Add:

```rust
#[serde(default)]
pub workspace_access: HashMap<String, String>,
```

Initialize it in `Default`. Add `workspace_key(directory)` that canonicalizes the directory and lowercases the resulting key only on Windows. Register a `get_workspace_key` Tauri command.

- [ ] **Step 4: Extend TypeScript preferences**

Add:

```ts
export type WorkspaceAccessMode = 'read-only' | 'editable'
workspaceAccess: Record<string, WorkspaceAccessMode>
```

Update both preference conversion helpers with `{}` fallback.

- [ ] **Step 5: Run tests and checks**

Run:

```powershell
npm run test:run -- src/lib/preferences.test.ts
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/lib.rs src-tauri/src/security.rs src/types/index.ts src/lib/preferences.ts src/lib/preferences.test.ts
git commit -m "feat: persist per-workspace access mode" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Keep the Rust watcher alive and emit structured events

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `src-tauri/src/watcher.rs`

- [ ] **Step 1: Write failing event-mapping and ownership tests**

Test mapping notify create, modify, and remove kinds to:

```rust
#[derive(Clone, Serialize)]
pub struct FileSystemChange {
    pub path: String,
    pub kind: FileSystemChangeKind,
}
```

Ignore paths without the `.excalidraw` extension.

Implement a small generic `WatcherSlot<T>` used by `AppState`. With a `DropSpy` test value, verify the installed value remains owned after `install` returns and replacing it drops the previous value exactly once.

- [ ] **Step 2: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml watcher::tests -- --nocapture`

Expected: FAIL because `watcher.rs` does not exist.

- [ ] **Step 3: Implement owned watcher state**

Add `watcher: WatcherSlot<notify::RecommendedWatcher>` to `AppState`. Build the watcher with a callback that emits structured events, install it in state, and replace the previous watcher on directory changes. Remove the detached channel thread whose watcher is dropped at command return.

- [ ] **Step 4: Add a safe snapshot command**

Register `get_file_snapshot(file_path) -> Result<Option<FileContent>, String>`. Return `Ok(None)` when the path no longer exists; otherwise reuse validated Excalidraw read/hash logic.

- [ ] **Step 5: Run Rust verification**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml watcher::tests -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs
git commit -m "fix: retain the active file watcher" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Return explicit save outcomes and gate lifecycle actions

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useMenuHandler.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Create: `src/store/useStore.saveOutcomes.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover file switch, close tab, create file, directory switch, and app close. For each action, mock `saveCurrentFile` returning `conflict`, `cancelled`, or `failed` and assert the pending action does not continue. Add Save As tests that verify native menu and `Ctrl/Cmd+Shift+S` callers use a central store action and that the returned path/hash update `activeFile`, `openTabs`, cached content, and dirty state together.

- [ ] **Step 2: Run the focused test**

Run: `npm run test:run -- src/store/useStore.saveOutcomes.test.ts`

Expected: FAIL because `saveCurrentFile` returns `void`.

- [ ] **Step 3: Define discriminated outcomes**

```ts
export type SaveOutcome =
  | { status: 'saved'; contentHash: string }
  | { status: 'unchanged' }
  | { status: 'conflict'; currentHash: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
```

Send `expectedHash` from the active tab and map structured Tauri errors without parsing messages. Add `saveCurrentFileAs` as the only frontend Save As entry point and adapt it to the create-only `SavedFile` response.

- [ ] **Step 4: Refactor repeated unsaved-change handling**

Create one store helper/action that resolves save/discard/cancel and returns whether the caller may continue. Replace the duplicated branches in load, create, close, directory switching, and app-close handling. Workspace-mode switching will use the same helper in Task 5.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm run test:run -- src/store/useStore.saveOutcomes.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/types/index.ts src/store/useStore.ts src/App.tsx src/hooks/useMenuHandler.ts src/hooks/useKeyboardShortcuts.ts src/store/useStore.saveOutcomes.test.ts
git commit -m "fix: abort lifecycle actions after failed saves" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Add workspace access policy to the store

**Files:**
- Create: `src/lib/workspaceAccess.ts`
- Create: `src/lib/workspaceAccess.test.ts`
- Modify: `src/store/useStore.ts`
- Create: `src/store/useStore.workspaceAccess.test.ts`

- [ ] **Step 1: Write failing policy tests**

Cover:

- absent workspace key defaults to `read-only`
- persisted `editable` restores editing
- switching to read-only while clean succeeds
- switching while dirty requires save/discard/cancel
- failed, conflicted, or cancelled save leaves the workspace editable
- save, Save As, create, rename, and delete are blocked before Tauri invocation

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```powershell
npm run test:run -- src/lib/workspaceAccess.test.ts src/store/useStore.workspaceAccess.test.ts
```

Expected: FAIL because access policy state/actions do not exist.

- [ ] **Step 3: Implement pure access helpers**

Provide `getWorkspaceAccess(preferences, workspaceKey)` and `isWorkspaceEditable(...)`.

- [ ] **Step 4: Extend Zustand state**

Add `currentWorkspaceKey`, `workspaceAccessMode`, `setWorkspaceAccessMode`, and `requireEditableWorkspace`. `loadDirectory` obtains the normalized key before updating state. Use the Task 4 save-outcome helper before changing a dirty editable workspace to read-only.

- [ ] **Step 5: Run the policy tests**

Run:

```powershell
npm run test:run -- src/lib/workspaceAccess.test.ts src/store/useStore.workspaceAccess.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/workspaceAccess.ts src/lib/workspaceAccess.test.ts src/store/useStore.ts src/store/useStore.workspaceAccess.test.ts
git commit -m "feat: default workspaces to read only" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Enforce read-only mode in the editor and UI

**Files:**
- Modify: `src/components/ExcalidrawEditor.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/TreeView.tsx`
- Modify: `src/hooks/useMenuHandler.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/index.css`
- Create: `src/components/WorkspaceAccess.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Mock `@excalidraw/excalidraw` with a lightweight component that records props. Verify:

- Excalidraw receives `viewModeEnabled` when workspace is read-only or presentation mode is active.
- `handleChange` does not mark dirty in read-only mode.
- Sidebar displays **Read Only** and **Enable Editing**.
- New, rename, and delete UI controls are disabled or hidden in read-only mode.
- menu and shortcut mutation attempts delegate to guarded store actions.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm run test:run -- src/components/WorkspaceAccess.test.tsx`

Expected: FAIL because read-only UI behavior is absent.

- [ ] **Step 3: Implement editor enforcement**

Set:

```tsx
viewModeEnabled={presentationMode || workspaceAccessMode === 'read-only'}
```

Add the same access check at the start of the editor change handler so programmatic or unexpected events cannot dirty a read-only tab.

- [ ] **Step 4: Implement access controls**

Add a persistent badge and toggle action to the sidebar. Disable mutation controls with accessible titles. Keep file opening, pan, zoom, tab switching, and export available.

- [ ] **Step 5: Run UI tests and typecheck**

Run:

```powershell
npm run test:run -- src/components/WorkspaceAccess.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/ExcalidrawEditor.tsx src/components/Sidebar.tsx src/components/TreeView.tsx src/hooks/useMenuHandler.ts src/hooks/useKeyboardShortcuts.ts src/index.css src/components/WorkspaceAccess.test.tsx
git commit -m "feat: enforce workspace read only mode" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Add conflict resolution and validated conflict copies

**Files:**
- Create: `src/lib/choicePrompt.ts`
- Create: `src/lib/choicePrompt.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/file_io.rs`
- Create: `src/store/useStore.conflict.test.ts`

- [ ] **Step 1: Write failing prompt and conflict tests**

Test the three choices: reload latest, save local work as a copy, and cancel. Verify conflict copies stay in the original parent, use create-only validation, become the clean active tab, remove the conflicted original tab from the open set, and refresh the tree. Add the missing-file variant where reload is unavailable and only save-copy or cancel are offered.

- [ ] **Step 2: Run the focused tests**

Run:

```powershell
npm run test:run -- src/lib/choicePrompt.test.ts src/store/useStore.conflict.test.ts
cargo test --manifest-path src-tauri/Cargo.toml file_io::tests -- --nocapture
```

Expected: FAIL because conflict UI and copy commands are absent.

- [ ] **Step 3: Implement the accessible three-choice prompt**

Follow the cleanup, Escape, and overlay patterns in `src/lib/namePrompt.ts`. Return a typed choice and never silently select a destructive option.

- [ ] **Step 4: Add the sibling conflict-copy command**

Accept original path, requested filename, and content. Read the allowed workspace from `AppState.current_directory`; never trust a frontend-provided workspace root. Validate the original parent is within that workspace, sanitize the filename, enforce `.excalidraw`, and call the create-only helper.

- [ ] **Step 5: Implement frontend conflict transitions**

Preserve dirty state until a choice succeeds. Reload only after confirmation, transition to the returned copy path after save-copy success, and leave state untouched on cancel/failure. Reuse the same resolver for stale-save conflicts and dirty files removed externally.

- [ ] **Step 6: Run focused tests and checks**

Run:

```powershell
npm run test:run -- src/lib/choicePrompt.test.ts src/store/useStore.conflict.test.ts
cargo test --manifest-path src-tauri/Cargo.toml file_io::tests -- --nocapture
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/choicePrompt.ts src/lib/choicePrompt.test.ts src/store/useStore.ts src/store/useStore.conflict.test.ts src-tauri/src/lib.rs src-tauri/src/file_io.rs
git commit -m "feat: resolve external save conflicts safely" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 8: Reload clean tabs after external changes

**Files:**
- Create: `src/lib/fileSystemChangeCoalescer.ts`
- Create: `src/lib/fileSystemChangeCoalescer.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/store/useStore.ts`
- Create: `src/store/useStore.externalChanges.test.ts`

- [ ] **Step 1: Write failing coalescer and store tests**

Cover:

- a same-path remove/create burst becoming one final modification
- clean tab reload with new hash and incremented `sceneVersion`
- equal hash ignored as duplicate/self-save
- event deferred while the same path is saving
- dirty tab marked externally modified without content replacement
- clean removed tab closing through normal tab lifecycle
- dirty removed tab retained as missing and routed to the Task 7 save-copy/cancel resolver
- external rename represented by old-path removal plus new-path creation: clean old tabs close, dirty old tabs remain missing, and the tree exposes the new path
- invalid/transient content retried three times, then surfaced without replacing the scene

- [ ] **Step 2: Run focused tests**

Run:

```powershell
npm run test:run -- src/lib/fileSystemChangeCoalescer.test.ts src/store/useStore.externalChanges.test.ts
```

Expected: FAIL because the coalescer and transitions do not exist.

- [ ] **Step 3: Implement the 500 ms path coalescer**

Expose a small class or factory with `push(change)` and `dispose()`. Each path owns one timer; the latest burst flushes only after 500 ms of quiet.

- [ ] **Step 4: Move filesystem lifecycle handling into Zustand**

Add `handleFileSystemChange(path)` using `get_file_snapshot`. Compare hashes before reload, preserve dirty tabs, update active content atomically, and refresh the tree. Track saving paths so events wait until save completion.

- [ ] **Step 5: Simplify `App.tsx`**

The event listener pushes payloads into the coalescer and delegates flushed paths to the store. Remove stale `containsFilePath` logic.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm run test:run -- src/lib/fileSystemChangeCoalescer.test.ts src/store/useStore.externalChanges.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/fileSystemChangeCoalescer.ts src/lib/fileSystemChangeCoalescer.test.ts src/App.tsx src/store/useStore.ts src/store/useStore.externalChanges.test.ts
git commit -m "feat: refresh open tabs after external changes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Complete Windows and repository verification

**Files:**
- Modify: `.github/copilot-instructions.md`
- Modify: `README.md` only if user-facing read-only behavior needs documentation.

- [ ] **Step 1: Run all automated validation**

```powershell
npm run test:run
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit successfully.

- [ ] **Step 2: Launch the Windows app**

```powershell
$env:Path = "D:\packages\cargo\bin;$env:Path"
npm run tauri dev
```

- [ ] **Step 3: Perform the Windows smoke scenarios**

Use a disposable local directory:

1. First open is read-only and canvas tools cannot mutate.
2. Enable editing, create a file, draw, save, switch tabs, and restart.
3. Modify the file externally while its tab is clean; confirm automatic reload.
4. Modify externally while dirty; confirm local work remains and save is blocked.
5. Exercise reload, save-copy, and cancel.
6. Remove the file externally while clean and while dirty.
7. Confirm app close and directory switch abort after failed/conflicted saves.

- [ ] **Step 4: Update repository guidance**

Document stable commands and the read-only/hash-conflict architecture in `.github/copilot-instructions.md`. Update README behavior only where it describes file saving or workspace use.

- [ ] **Step 5: Review the final diff**

Run:

```powershell
git diff --check
git status --short
```

Confirm no generated `dist`, `target`, OneDrive test data, or unrelated user changes are staged.
