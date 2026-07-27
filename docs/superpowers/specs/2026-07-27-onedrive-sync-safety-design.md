# OneDrive Sync Safety Design

## Goal

Reduce accidental edits and stale overwrites when an ExcaliApp workspace is stored in OneDrive and opened across multiple machines.

The design assumes most machines are readers and one machine normally edits. It reduces conflict risk but does not claim to provide distributed locking or eliminate conflicts caused by delayed cloud synchronization.

## Current Gaps

- Presentation mode temporarily enables Excalidraw view mode but is not a persistent workspace access policy.
- New workspaces are editable immediately.
- `save_file` writes without checking whether the file changed after it was loaded.
- Watcher events refresh the tree but do not reload a clean open tab.
- A dirty tab has no explicit external-change conflict state.

## Workspace Access Mode

Each machine stores a local access mode for every absolute workspace directory:

- `read-only`: default for a directory first opened on that machine.
- `editable`: explicitly enabled for that directory on that machine.

The mode is stored in application preferences, not in the workspace, so OneDrive does not synchronize or race on the setting. Directory paths remain absolute and use the existing cross-platform path handling.

The Zustand store is the policy boundary. All mutations must check the active workspace mode before invoking Tauri commands:

- save and save-as
- create file or folder
- rename file or folder
- delete file or folder

Read-only mode sets `viewModeEnabled` on every mounted Excalidraw pane so users cannot add, modify, or delete canvas elements. The editor change handler also ignores mutation events while the workspace is read-only as a defense-in-depth guard. Pan, zoom, tab switching, and exporting an image remain available because they do not mutate the workspace.

Switching an editable workspace to read-only while the active file is dirty requires the existing save, discard, or cancel decision before the mode changes. The app never leaves a user editing a canvas whose changes cannot subsequently be saved.

## User Experience

The selected workspace displays a persistent **Read Only** indicator. An **Enable Editing** action warns that only one machine should normally edit a OneDrive-backed workspace.

The access choice persists per workspace on the local machine. Reopening the directory restores its last local mode. A workspace first opened on another machine starts read-only there.

Blocked mutation attempts surface a consistent message rather than silently returning. Presentation mode remains separate from workspace read-only mode.

Changing from editable to read-only is itself a guarded transition. If the active file is dirty, the mode changes only after a successful save or an explicit discard. Cancelled, conflicted, or failed saves leave the workspace editable and dirty.

## Conflict-Safe Saves

Every open tab already stores the BLAKE3 hash returned when its content was loaded. Saving sends this value to Rust as `expectedHash`.

Immediately before writing, Rust:

1. Validates the path, extension, and Excalidraw content.
2. Reads and hashes the current disk content.
3. Compares the current hash with `expectedHash`.
4. Rejects the save with a structured conflict error when they differ.
5. Writes only when the hashes match and returns the saved content hash.

Store save actions return a discriminated outcome rather than `void`: `saved`, `unchanged`, `conflict`, `cancelled`, or `failed`. Any action that saves before continuing—file switching, tab closing, file creation, directory switching, workspace-mode changes, and app close—continues only after `saved`, `unchanged`, or an explicit discard. Conflict, cancellation, and failure preserve dirty state and abort the pending action.

The frontend preserves the dirty local scene when a conflict occurs. It offers:

- **Reload latest**: discard local changes only after confirmation and load the disk version.
- **Save local work as a copy**: preserve local work under a new filename.
- **Cancel**: keep the dirty tab unchanged.

There is no direct force-overwrite action. This prevents a stale machine from casually replacing a newer OneDrive version.

Saving local work as a conflict copy creates a uniquely named sibling of the original file inside the active workspace. The user may edit the suggested conflict-copy filename, but not its destination directory. A validated backend command checks the parent against the active workspace, enforces the `.excalidraw` extension, validates content, and returns the new path and content hash. On success, the local scene becomes a clean active tab at the new path, the conflicted original tab is removed from the open-tab set without changing its disk file, and the tree is refreshed.

The ordinary Save As flow is separately brought under equivalent path, extension, and content validation. It uses create-only semantics: if the selected path already exists, the operation fails and asks the user to choose another name rather than overwriting existing content.

## External Changes

`AppState` owns the active watcher so it remains alive after `watch_directory` returns. Selecting another workspace replaces and drops the previous watcher before installing the new recursive watcher.

Watcher events include the changed path and change kind (`create`, `modify`, or `remove`). The frontend coalesces events for the same path over a 500 ms quiet period, then checks whether the path currently exists. A remove/create sequence for an atomic OneDrive replacement is therefore handled as a modification when the final path exists, and as a removal only when it remains absent.

- Before applying a create or modify event, read the disk hash and compare it with the tab hash.
- If the hashes match, treat the event as an app-originated or duplicate notification and do nothing.
- If the tab is clean and hashes differ, reload it from disk, update its hash, and increment `sceneVersion`.
- If the tab is dirty and hashes differ, retain its local content and mark it as externally changed.
- If a save for the same path is in progress, defer event handling until that save settles, then perform the hash comparison.
- If a clean open path is removed, close that tab and clear or select the next active tab using the normal tab lifecycle.
- If a dirty open path is removed, retain the in-memory tab, mark it as missing, and offer save-copy or cancel; reload is unavailable.
- External renames are handled as removal of the old path and creation of the new path because filesystem notifications do not reliably preserve rename identity.
- If the path is not open, refresh the file tree only.

Transient reads caused by OneDrive updating a file are retried at most three times with bounded backoff. Retry exhaustion, missing files, and invalid Excalidraw content produce an explicit external-update error while preserving the currently displayed scene; invalid content is never treated as a successful reload.

## IPC and Data Model

Preferences gain a map from normalized absolute directory path to workspace access mode. Workspace keys use the canonical directory returned by Rust and normalize case on Windows before lookup or persistence. The Rust field uses `#[serde(default)]`, and the TypeScript conversion defaults a missing map to `{}`, so existing preference files migrate without resetting unrelated settings. A directory absent from the map is read-only. The existing TypeScript camelCase and Rust snake_case conversion helpers remain the only preferences boundary.

The save IPC contract gains `expectedHash`. Rust returns either the new hash or a serializable error with a stable conflict kind. Frontend code must not parse human-readable error strings to identify conflicts.

Open tabs gain an external-change state only if needed to represent a dirty conflict. Cached content, cached scene, content hash, dirty markers, and `sceneVersion` continue to move together through Zustand actions.

## Testing

Rust tests cover:

- saving when the expected and disk hashes match
- rejecting a stale expected hash without changing the file
- validating content before comparison and write
- returning the new hash after a successful write
- retaining the installed watcher after command return and replacing it on workspace switches
- validating save-copy paths and content

Frontend tests cover:

- new workspaces defaulting to read-only
- per-workspace access mode persistence and conversion
- every mutation path being blocked in read-only mode
- menu and keyboard entry points using guarded actions
- clean tabs reloading after external changes
- dirty tabs retaining local content after external changes
- conflict actions for reload, save-copy, and cancel
- failed and conflicted saves aborting file switch, tab close, file creation, mode change, and app close
- app-originated watcher events being ignored after hash comparison
- removed and externally renamed open files
- legacy preferences defaulting only the workspace-access map

Windows validation covers launching the Tauri app, opening a local test directory, toggling workspace access, editing and saving, simulating an external file update, and confirming stale saves do not overwrite it.
