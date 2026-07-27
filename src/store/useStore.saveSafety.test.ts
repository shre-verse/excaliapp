import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke } from '../test/setup'
import { useStore } from './useStore'

const content = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'local-change' }],
  appState: {},
  files: {},
})

describe('save safety', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn())
    useStore.setState({
      currentDirectory: 'C:\\Drawings',
      currentWorkspaceKey: 'c:/drawings',
      workspaceAccessMode: 'editable',
      activeFile: {
        name: 'drawing.excalidraw',
        path: 'C:\\Drawings\\drawing.excalidraw',
        modified: true,
      },
      fileContent: content,
      isDirty: true,
      openTabs: [{
        name: 'drawing.excalidraw',
        path: 'C:\\Drawings\\drawing.excalidraw',
        modified: true,
        cachedContent: content,
        contentHash: 'loaded-hash',
        cachedScene: { elements: [], appState: {}, files: {} },
        sceneVersion: 0,
      }],
    } as never)
  })

  it('returns false and preserves dirty state when the disk changed', async () => {
    mockInvoke.mockRejectedValueOnce('FILE_CONFLICT:new-hash')

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(false)
    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().openTabs[0].modified).toBe(true)
  })

  it('returns true and clears dirty state after a successful save', async () => {
    mockInvoke.mockResolvedValueOnce('saved-hash')

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(true)
    expect(useStore.getState().isDirty).toBe(false)
    expect(useStore.getState().openTabs[0].contentHash).toBe('saved-hash')
  })

  it('blocks file creation while the workspace is read-only', async () => {
    useStore.setState({
      workspaceAccessMode: 'read-only',
      isDirty: false,
      activeFile: null,
    })

    await useStore.getState().createNewFile('blocked.excalidraw', 'C:\\Drawings')

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('moves Save As state to the new path and hash', () => {
    useStore.getState().completeSaveAs(
      'C:\\Drawings\\copy.excalidraw',
      content,
      'copy-hash'
    )

    expect(useStore.getState().activeFile?.path).toBe('C:\\Drawings\\copy.excalidraw')
    expect(useStore.getState().openTabs[0].path).toBe('C:\\Drawings\\copy.excalidraw')
    expect(useStore.getState().openTabs[0].contentHash).toBe('copy-hash')
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('saves a dirty drawing after its last element is deleted', async () => {
    const emptyContent = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [],
      appState: {},
      files: {},
    })
    useStore.setState({ fileContent: emptyContent })
    mockInvoke.mockResolvedValueOnce('empty-hash')

    await expect(useStore.getState().saveCurrentFile()).resolves.toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('save_file', expect.objectContaining({
      content: emptyContent,
    }))
  })
})
