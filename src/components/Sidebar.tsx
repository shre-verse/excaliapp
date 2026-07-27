import { ScrollArea } from '@radix-ui/react-scroll-area'
import { FolderOpen, Plus, FolderPlus, Lock, Moon, Sun, Unlock } from 'lucide-react'
import { useStore } from '../store/useStore'
import { TreeView } from './TreeView'
import { FileTreeNode } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { promptForName } from '../lib/namePrompt'
import { getEffectiveTheme } from '../lib/theme'

function countFilesInTree(nodes: FileTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (!node.is_directory) {
      count++
    }
    if (node.children) {
      count += countFilesInTree(node.children)
    }
  }
  return count
}

export function Sidebar() {
  const {
    currentDirectory,
    fileTree,
    activeFile,
    loadFileFromTree,
    createNewFile,
    createNewFolder,
    workspaceAccessMode,
    setWorkspaceAccessMode,
    preferences,
    toggleTheme,
  } = useStore()
  const readOnly = workspaceAccessMode === 'read-only'
  const mutationsDisabled = Boolean(currentDirectory) && readOnly
  const effectiveTheme = getEffectiveTheme(
    preferences.theme,
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  const handleSelectDirectory = async () => {
    const dir = await invoke<string | null>('select_directory')
    if (dir) {
      await useStore.getState().loadDirectory(dir)
    }
  }

  const handleNewFile = async () => {
    if (!currentDirectory) {
      const dir = await invoke<string | null>('select_directory')
      if (dir) {
        await useStore.getState().loadDirectory(dir)
      } else {
        return
      }
    }
    
    const fileName = await promptForName({
      title: 'File name',
      defaultValue: 'Untitled.excalidraw',
      confirmLabel: 'Create',
    })
    if (!fileName) {
      return
    }

    await createNewFile(fileName)
  }

  const handleNewFolder = async () => {
    if (!currentDirectory) {
      const dir = await invoke<string | null>('select_directory')
      if (dir) {
        await useStore.getState().loadDirectory(dir)
      } else {
        return
      }
    }

    const folderName = await promptForName({
      title: 'Folder name',
      defaultValue: 'New Folder',
      confirmLabel: 'Create',
    })
    if (!folderName) {
      return
    }

    await createNewFolder(folderName)
  }

  return (
    <div className="sidebar-panel w-[280px] h-full border-r flex flex-col">
      {/* Header */}
      <div className="sidebar-section p-4 border-b">
        <button
          onClick={handleSelectDirectory}
          className="sidebar-action w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          <span className="text-sm font-medium truncate">
            {currentDirectory ? currentDirectory.split('/').pop() : 'Select Directory'}
          </span>
        </button>
        
        <button
          onClick={handleNewFile}
          disabled={mutationsDisabled}
          className="sidebar-action w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={readOnly ? 'Enable editing to create files' : (!currentDirectory ? 'Select a directory first' : 'Create a new Excalidraw file')}
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">New File</span>
        </button>

        <button
          onClick={handleNewFolder}
          disabled={mutationsDisabled}
          className="sidebar-action w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={readOnly ? 'Enable editing to create folders' : (!currentDirectory ? 'Select a directory first' : 'Create a new folder')}
        >
          <FolderPlus className="w-4 h-4" />
          <span className="text-sm">New Folder</span>
        </button>

        {currentDirectory && (
          <div className="mt-3 rounded-md border p-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              {readOnly ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span>{readOnly ? 'Read Only' : 'Editing Enabled'}</span>
            </div>
            <button
              onClick={() => setWorkspaceAccessMode(readOnly ? 'editable' : 'read-only')}
              className="sidebar-action w-full mt-2 px-2 py-1.5 rounded-md text-xs"
              aria-label={readOnly ? 'Enable Editing' : 'Switch to Read Only'}
            >
              {readOnly ? 'Enable Editing' : 'Switch to Read Only'}
            </button>
          </div>
        )}
      </div>

      {/* File Tree */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-2">
          {fileTree.length === 0 ? (
            <div className="sidebar-muted text-sm text-center py-8">
              {currentDirectory ? 'No .excalidraw files found' : 'No directory selected'}
            </div>
          ) : (
            <TreeView
              nodes={fileTree}
              onFileClick={loadFileFromTree}
              activeFilePath={activeFile?.path}
            />
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="sidebar-section p-3 border-t flex items-center justify-between gap-2">
        <div className="sidebar-muted text-xs">
          {countFilesInTree(fileTree)} file{countFilesInTree(fileTree) !== 1 ? 's' : ''}
        </div>
        <button
          onClick={toggleTheme}
          className="sidebar-action p-2 rounded-md"
          aria-label={effectiveTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={`${effectiveTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} (Shift+Alt+D)`}
        >
          {effectiveTheme === 'dark'
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}
