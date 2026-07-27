# Cross-Platform Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Windows NSIS/MSI, unsigned Apple Silicon DMG, and Linux AppImage artifacts in GitHub Release `v0.3.2`.

**Architecture:** Extend the existing tag-triggered release workflow with a Windows job, replace the signed macOS job with direct unsigned Tauri DMG packaging, and make the release aggregation job depend on all platforms. Validate the workflow locally, push the workflow commit, create the tag, and monitor the run through release publication.

**Tech Stack:** GitHub Actions, Tauri 2, Node.js 24, stable Rust, Windows Server 2025, macOS 15, Ubuntu 24.04, GitHub CLI.

---

### Task 1: Update the release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the Windows build job**

Use `windows-2025`, Node.js 24, stable Rust with target `x86_64-pc-windows-msvc`, npm cache, and Rust cache. Run:

```powershell
npm ci
npm run test:run
npm run tauri -- build --bundles nsis,msi --target x86_64-pc-windows-msvc
```

Copy the generated NSIS and MSI files using PowerShell's `$env:GITHUB_REF_NAME` to:

```text
dist/github-release/ExcaliApp-$env:GITHUB_REF_NAME-windows-x64-setup.exe
dist/github-release/ExcaliApp-$env:GITHUB_REF_NAME-windows-x64.msi
```

Upload them as artifact `excaliapp-windows-x64-installers`.

- [ ] **Step 2: Replace signed macOS packaging with unsigned DMG packaging**

Remove Apple certificate, keychain, and notarization steps and secret references. Run:

```bash
npm ci
npm run test:run
npm run tauri -- build --bundles dmg --target aarch64-apple-darwin
```

Copy the generated DMG to:

```text
dist/github-release/ExcaliApp-${GITHUB_REF_NAME}-macos-arm64-unsigned.dmg
```

- [ ] **Step 3: Expand release aggregation**

Add `build-windows` to the `github-release.needs` list. Add an unsigned macOS warning to the GitHub Release body while retaining generated release notes.

- [ ] **Step 4: Validate workflow structure**

Run an ephemeral Prettier YAML parse without changing dependencies:

```powershell
npx --yes prettier@3.6.2 --check .github/workflows/release.yml
```

Also verify all artifact source paths and job dependencies by inspecting the final diff.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/release.yml
git commit -m "ci: build Windows and unsigned macOS releases" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Push and publish v0.3.2

**Files:**
- No source files.

- [ ] **Step 1: Push master**

```powershell
git push origin master
```

- [ ] **Step 2: Create and push the release tag**

Confirm no existing local or remote `v0.3.2` tag, then:

```powershell
git tag -a v0.3.2 -m "ExcaliApp v0.3.2"
git push origin v0.3.2
```

- [ ] **Step 3: Monitor GitHub Actions**

Use:

```powershell
gh run list --workflow release.yml --limit 5
gh run watch <run-id> --exit-status
```

If a platform fails, inspect:

```powershell
gh run view <run-id> --log-failed
```

Fix only verified workflow defects and push the fix. A rerun uses the original workflow SHA, so delete the unpublished failed tag locally/remotely, recreate it at the fixed `master`, and push it again. Do not use GitHub's rerun button for workflow-definition fixes.

- [ ] **Step 4: Verify release assets**

Run:

```powershell
gh release view v0.3.2
gh release download v0.3.2 --dir dist/releases/v0.3.2
```

Confirm the release contains:

- Windows NSIS `.exe`
- Windows `.msi`
- unsigned Apple Silicon `.dmg`
- Linux `.AppImage`
