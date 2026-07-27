# Cross-Platform Release Design

## Goal

Publish installable Windows, unsigned Apple Silicon macOS, and Linux artifacts in one GitHub Release when a `v*` tag is pushed.

## Trigger and Version

The existing `.github/workflows/release.yml` remains the single release workflow and runs on tags matching `v*`. The first release is `v0.3.2`, matching the version already synchronized in the package, Cargo, and Tauri manifests.

## Platform Jobs

### Windows

A `windows-2025` job installs Node.js 24 and stable Rust, restores npm dependencies, runs the Vitest suite, and builds:

- NSIS installer: `ExcaliApp-v0.3.2-windows-x64-setup.exe`
- MSI installer: `ExcaliApp-v0.3.2-windows-x64.msi`

The job uses the MSVC target and stages both files in `dist/github-release`.

Exact build command:

```powershell
npm run tauri -- build --bundles nsis,msi --target x86_64-pc-windows-msvc
```

Source paths:

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`

### macOS

The macOS job continues using `macos-15` and the Apple Silicon Rust target, but removes certificate and notarization requirements. It does not call the signed `release:mac` script. It builds an unsigned DMG directly through Tauri:

```bash
npm run tauri -- build --bundles dmg --target aarch64-apple-darwin
```

The job finds the generated file under `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg` and stages it as:

- `ExcaliApp-v0.3.2-macos-arm64-unsigned.dmg`

The artifact name and GitHub Release body explicitly identify the DMG as unsigned. Users may need to approve it through macOS Privacy & Security or remove quarantine for internal installation. Signed-release checksum and notarization sidecars are intentionally not produced by this internal unsigned workflow.

### Linux

The existing Ubuntu AppImage job remains unchanged except for participating in the expanded release dependency set.

## GitHub Release

The final release job depends on Windows, macOS, and Linux. It downloads all artifacts, verifies files exist, and publishes them to the tag's GitHub Release with generated release notes.

Artifact upload names remain platform-specific, while downloadable filenames include the tag and architecture.

## Validation

- YAML is syntactically valid and all referenced scripts exist.
- Windows bundle commands match the locally verified NSIS/MSI build.
- macOS uses direct unsigned Tauri DMG packaging and does not reference unavailable Apple secrets.
- The release job cannot run until all three platform jobs succeed.
- After pushing the workflow and `v0.3.2` tag, monitor GitHub Actions through completion and confirm all four installers are attached to the release.
