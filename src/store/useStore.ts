import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import {
  CachedExcalidrawScene,
  ExcalidrawFile,
  FileTreeNode,
  LoadDirectoryResult,
  OpenTab,
  Preferences,
  WorkspaceAccessMode,
} from '../types'
import { convertPreferencesFromRust, convertPreferencesToRust } from '../lib/preferences'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { applyDocumentTheme, getEffectiveTheme, getNextExplicitTheme } from '../lib/theme'
import { getWorkspaceAccessMode, normalizeWorkspaceKey } from '../lib/workspaceAccess'

type UnsavedChangesDecision = 'save' | 'discard' | 'cancel'
type FileLoadSource = 'cache' | 'disk' | null

interface FileContentResult {
  content: string
  content_hash: string
}

function parseSceneFromContent(content: string): CachedExcalidrawScene {
  const data = JSON.parse(content)

  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files: data.files || {},
  }
}

function toOpenTab(
  file: ExcalidrawFile,
  content: string,
  contentHash: string,
  sceneVersion = 0
): OpenTab {
  return {
    ...file,
    cachedContent: content,
    contentHash,
    cachedScene: parseSceneFromContent(content),
    sceneVersion,
  }
}

function toExcalidrawFile(tab: OpenTab): ExcalidrawFile {
  return {
    name: tab.name,
    path: tab.path,
    modified: tab.modified,
  }
}

async function readOpenTabFromDisk(file: ExcalidrawFile, sceneVersion = 0): Promise<OpenTab> {
  const { content, content_hash: contentHash } = await invoke<FileContentResult>(
    'read_file_with_hash',
    { filePath: file.path }
  )

  return toOpenTab({ ...file, modified: false }, content, contentHash, sceneVersion)
}

async function confirmUnsavedChanges(
  fileName: string,
  actionDescription: string
): Promise<UnsavedChangesDecision> {
  const shouldSave = await ask(
    `Do you want to save changes to "${fileName}" before ${actionDescription}?`,
    {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Save',
      cancelLabel: "Don't Save",
    }
  )

  if (shouldSave) {
    return 'save'
  }

  const shouldDiscard = await ask(
    `Discard unsaved changes to "${fileName}"?`,
    {
      title: 'Discard Unsaved Changes',
      kind: 'warning',
      okLabel: "Don't Save",
      cancelLabel: 'Cancel',
    }
  )

  return shouldDiscard ? 'discard' : 'cancel'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`)
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`
  }

  return path
}

async function persistPreferences(preferences: Preferences): Promise<void> {
  const prefsToSave = convertPreferencesToRust(preferences)
  await invoke('save_preferences', { preferences: prefsToSave })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let preferenceMutationQueue: Promise<void> = Promise.resolve()

function enqueuePreferenceMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const queuedMutation = preferenceMutationQueue
    .catch(() => undefined)
    .then(mutation)

  preferenceMutationQueue = queuedMutation.then(
    () => undefined,
    () => undefined
  )

  return queuedMutation
}

interface AppStore {
  // State
  currentDirectory: string | null
  currentWorkspaceKey: string | null
  workspaceAccessMode: WorkspaceAccessMode
  files: ExcalidrawFile[]
  fileTree: FileTreeNode[]
  activeFile: ExcalidrawFile | null
  fileContent: string | null
  activeFileLoadSource: FileLoadSource
  preferences: Preferences
  sidebarVisible: boolean
  isDirty: boolean
  presentationMode: boolean
  openTabs: OpenTab[]

  // Actions
  setCurrentDirectory: (dir: string | null) => void
  setFiles: (files: ExcalidrawFile[]) => void
  setFileTree: (tree: FileTreeNode[]) => void
  setActiveFile: (file: ExcalidrawFile | null) => void
  setFileContent: (content: string | null) => void
  completeSaveAs: (newPath: string, content: string, contentHash: string) => void
  updateTabScene: (filePath: string, scene: CachedExcalidrawScene) => void
  setPreferences: (prefs: Preferences) => void
  setSidebarVisible: (visible: boolean) => void
  setIsDirty: (dirty: boolean) => void
  markFileAsModified: (filePath: string, modified: boolean) => void
  markTreeNodeAsModified: (filePath: string, modified: boolean) => void
  togglePresentationMode: () => void
  closeTab: (filePath: string) => Promise<void>
  toggleDecorations: () => void
  toggleTheme: () => Promise<void>
  setWorkspaceAccessMode: (mode: WorkspaceAccessMode) => Promise<void>
  requireEditableWorkspace: (action: string) => Promise<boolean>

  // Async actions
  loadDirectory: (dir: string) => Promise<LoadDirectoryResult>
  loadFileTree: (dir: string) => Promise<void>
  loadFile: (file: ExcalidrawFile) => Promise<void>
  loadFileFromTree: (node: FileTreeNode) => Promise<void>
  saveCurrentFile: (content?: string) => Promise<boolean>
  createNewFile: (fileName?: string, directory?: string) => Promise<void>
  createNewFolder: (folderName?: string, directory?: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
  deleteFolder: (folderPath: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  savePreferences: () => Promise<void>
  clearRecentDirectories: () => Promise<void>
  toggleSidebar: () => void
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentDirectory: null,
  currentWorkspaceKey: null,
  workspaceAccessMode: 'read-only',
  files: [],
  fileTree: [],
  activeFile: null,
  fileContent: null,
  activeFileLoadSource: null,
  preferences: {
    lastDirectory: null,
    recentDirectories: [],
    theme: 'system',
    sidebarVisible: true,
    showDecorations: true,
    workspaceAccess: {},
  },
  sidebarVisible: true,
  isDirty: false,
  presentationMode: false,
  openTabs: [],

  // Basic setters
  setCurrentDirectory: (dir) => set({ currentDirectory: dir }),
  setFiles: (files) => set({ files }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setActiveFile: (file) => set({ activeFile: file }),
  setFileContent: (content) => set((state) => ({
    fileContent: content,
    openTabs:
      content && state.activeFile
        ? state.openTabs.map((tab) =>
            tab.path === state.activeFile?.path
              ? { ...tab, cachedContent: content }
              : tab
          )
        : state.openTabs,
  })),
  completeSaveAs: (newPath, content, contentHash) => set((state) => {
    const oldPath = state.activeFile?.path
    if (!oldPath) {
      return state
    }

    const name = fileNameFromPath(newPath)
    const activeFile = { name, path: newPath, modified: false }
    const existingTab = state.openTabs.find((tab) => tab.path === oldPath)
    const updatedTab = existingTab
      ? {
          ...existingTab,
          name,
          path: newPath,
          modified: false,
          cachedContent: content,
          contentHash,
        }
      : toOpenTab(activeFile, content, contentHash)

    return {
      activeFile,
      fileContent: content,
      activeFileLoadSource: 'disk',
      isDirty: false,
      openTabs: existingTab
        ? state.openTabs.map((tab) => (tab.path === oldPath ? updatedTab : tab))
        : [...state.openTabs, updatedTab],
    }
  }),
  updateTabScene: (filePath, scene) => set((state) => ({
    openTabs: state.openTabs.map((tab) =>
      tab.path === filePath ? { ...tab, cachedScene: scene } : tab
    ),
  })),
  setPreferences: (prefs) => set({ preferences: prefs }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  
  markFileAsModified: (filePath, modified) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
      openTabs: state.openTabs.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
    }))
  },

  markTreeNodeAsModified: (filePath, modified) => {
    const updateNode = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map(node => {
        if (node.path === filePath) {
          return { ...node, modified }
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }
    
    set((state) => ({
      fileTree: updateNode(state.fileTree)
    }))
  },

  // Load directory and list files
  loadDirectory: async (dir) => {
    try {
      const state = get()
      const [files, fileTree] = await Promise.all([
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir })
      ])

      // Start watching before committing the loaded directory to state/preferences.
      await invoke('watch_directory', { directory: dir })
      const workspaceKey = normalizeWorkspaceKey(dir)
      const workspaceAccessMode = getWorkspaceAccessMode(
        get().preferences.workspaceAccess,
        workspaceKey
      )

      if (state.presentationMode && state.preferences.showDecorations) {
        await invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu before loading directory:', error)
        })
      }

      set({
        currentDirectory: dir,
        currentWorkspaceKey: workspaceKey,
        workspaceAccessMode,
        files,
        fileTree,
        activeFile: null,
        fileContent: null,
        activeFileLoadSource: null,
        isDirty: false,
        presentationMode: false,
        openTabs: [],
      })

      try {
        await enqueuePreferenceMutation(async () => {
          const prefs = get().preferences
          const currentRecentDirs = prefs.recentDirectories || []
          const recentDirs = currentRecentDirs.filter((d) => d !== dir)
          recentDirs.unshift(dir)
          if (recentDirs.length > 10) {
            recentDirs.pop()
          }

          const nextPreferences = {
            ...prefs,
            lastDirectory: dir,
            recentDirectories: recentDirs,
          }

          set((currentState) => ({
            preferences: {
              ...currentState.preferences,
              lastDirectory: nextPreferences.lastDirectory,
              recentDirectories: nextPreferences.recentDirectories,
            },
          }))

          await persistPreferences(nextPreferences)
        })

        return { status: 'loaded' }
      } catch (error) {
        console.error('Failed to save recent directory preferences:', error)
        return { status: 'loaded_with_preference_error' }
      }
    } catch (error) {
      console.error('Failed to load directory:', error)
      // Show user-friendly error message
      alert(`Failed to load directory: ${error}`)
      return { status: 'failed' }
    }
  },

  // Load file tree only
  loadFileTree: async (dir) => {
    try {
      const fileTree = await invoke<FileTreeNode[]>('get_file_tree', {
        directory: dir,
      })
      
      set({ fileTree })
    } catch (error) {
      console.error('Failed to load file tree:', error)
    }
  },

  // Load file content
  loadFile: async (file) => {
    const state = get()
    
    // If clicking the same file that's already active, do nothing
    if (state.activeFile?.path === file.path) {
      return
    }
    
    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'switching files')
      
      if (decision === 'save') {
        if (!(await state.saveCurrentFile())) {
          return
        }
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }
    
    try {
      const latestState = get()
      const existingTab = latestState.openTabs.find(t => t.path === file.path)

      if (existingTab) {
        const diskHash = await invoke<string>('hash_file_content', {
          filePath: file.path,
        })

        if (diskHash === existingTab.contentHash) {
          set({
            activeFile: toExcalidrawFile(existingTab),
            fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: existingTab.modified,
          })
          return
        }
      }

      const updatedTab = await readOpenTabFromDisk(
        file,
        existingTab ? existingTab.sceneVersion + 1 : 0
      )
      const updatedFile = toExcalidrawFile(updatedTab)
      const openTabs = existingTab
        ? get().openTabs.map((tab) => (tab.path === file.path ? updatedTab : tab))
        : [...get().openTabs, updatedTab]

      set({
        activeFile: updatedFile,
        fileContent: updatedTab.cachedContent,
        activeFileLoadSource: 'disk',
        isDirty: false,
        openTabs,
      })

      state.markFileAsModified(file.path, false)
      state.markTreeNodeAsModified(file.path, false)
    } catch (error) {
      console.error('Failed to load file:', error)
      
      // If file doesn't exist, refresh the tree and show error
      if (String(error).includes('No such file') || String(error).includes('not found')) {
        alert(`File not found: ${file.name}\n\nThe file may have been deleted or moved. Refreshing file list...`)
        
        // Clear active file if it's the one that failed
        if (state.activeFile?.path === file.path) {
          set({
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          })
        }
        
        // Refresh the file tree
        if (state.currentDirectory) {
          await state.loadFileTree(state.currentDirectory)
        }
      } else {
        // Other errors
        alert(`Failed to load file: ${error}`)
      }
    }
  },

  // Load file from tree node
  loadFileFromTree: async (node) => {
    if (node.is_directory) return

    await get().loadFile({
      name: node.name,
      path: node.path,
      modified: node.modified,
    })
  },

  // Save current file
  saveCurrentFile: async (content) => {
    const state = get()
    if (!(await state.requireEditableWorkspace('save files'))) {
      return false
    }
    const { activeFile, fileContent, isDirty } = state
    
    if (!activeFile) {
      return true
    }
    
    // Only save if file is dirty
    if (!isDirty && !content) {
      return true
    }
    
    const contentToSave = content || fileContent
    if (!contentToSave) {
      return false
    }
    
    // Validate JSON before saving
    try {
      const parsed = JSON.parse(contentToSave)
      if (!parsed || typeof parsed !== 'object') {
        console.error('[saveCurrentFile] Invalid JSON structure')
        return false
      }
      
    } catch (jsonError) {
      console.error('[saveCurrentFile] Invalid JSON, not saving:', jsonError)
      return false
    }
    
    try {
      const contentHash = await invoke<string>('save_file', {
        filePath: activeFile.path,
        content: contentToSave,
        expectedHash: state.openTabs.find((tab) => tab.path === activeFile.path)?.contentHash || '',
      })
      
      state.markFileAsModified(activeFile.path, false)
      state.markTreeNodeAsModified(activeFile.path, false)
      set((currentState) => ({
        isDirty: false,
        activeFile: { ...activeFile, modified: false },
        openTabs: currentState.openTabs.map((tab) =>
          tab.path === activeFile.path
            ? {
                ...tab,
                cachedContent: contentToSave,
                contentHash,
                modified: false,
              }
            : tab
        ),
      }))
      return true
    } catch (error) {
      console.error('[saveCurrentFile] Failed to save file:', error)
      const errorMessage = String(error)
      if (errorMessage.includes('FILE_CONFLICT:')) {
        alert(
          'This file changed on disk after it was opened. Your local changes were not overwritten. ' +
          'Reload the file or save a copy before continuing.'
        )
      } else {
        alert(`Failed to save file: ${error}`)
      }
      return false
    }
  },

  // Create new file
  createNewFile: async (fileName, directory) => {
    const state = get()
    let { currentDirectory } = state
    
    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'creating a new file')
      
      if (decision === 'save') {
        if (!(await state.saveCurrentFile())) {
          return
        }
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }
    
    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }

        // Load the selected directory
        const result = await state.loadDirectory(dir)
        if (result.status === 'failed') {
          return
        }
        currentDirectory = dir
      } catch (error) {
        console.error('Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }

    }

    if (!(await get().requireEditableWorkspace('create files'))) {
      return
    }
    
    // Generate default filename if not provided
    const finalFileName = fileName || `Untitled-${Date.now()}.excalidraw`
    const requestedFileName = finalFileName.endsWith('.excalidraw')
      ? finalFileName
      : `${finalFileName}.excalidraw`
    const targetDirectory = directory || currentDirectory
    
    try {
      // Create the new file
      const filePath = await invoke<string>('create_new_file', {
        directory: targetDirectory,
        fileName: requestedFileName,
      })
      
      // Reload the file tree to show the new file
      await state.loadFileTree(currentDirectory)
      
      // Create an ExcalidrawFile object for the new file
      const file: ExcalidrawFile = {
        name: fileNameFromPath(filePath),
        path: filePath,
        modified: false,
      }
      
      // Load the new file immediately
      await state.loadFile(file)
    } catch (error) {
      console.error('Failed to create new file:', error)
      alert(`Failed to create file: ${error}`)
    }
  },

  // Create new folder
  createNewFolder: async (folderName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }

        // Load the selected directory
        const result = await state.loadDirectory(dir)
        if (result.status === 'failed') {
          return
        }
        currentDirectory = dir
      } catch (error) {
        console.error('[createNewFolder] Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }

    }

    if (!(await get().requireEditableWorkspace('create folders'))) {
      return
    }

    // Generate default folder name if not provided
    const finalFolderName = folderName || `New Folder-${Date.now()}`
    const targetDirectory = directory || currentDirectory

    try {
      await invoke<string>('create_new_folder', {
        directory: targetDirectory,
        folderName: finalFolderName,
      })

      // Reload the file tree to show the new folder
      await state.loadFileTree(currentDirectory)
    } catch (error) {
      console.error('[createNewFolder] Failed to create folder:', error)
      alert(`Failed to create folder: ${error}`)
    }
  },

  // Rename file
  renameFile: async (oldPath, newName) => {
    if (!(await get().requireEditableWorkspace('rename files'))) {
      return
    }
    try {
      // Ensure the new name has .excalidraw extension
      const finalName = newName.endsWith('.excalidraw') 
        ? newName 
        : `${newName}.excalidraw`
      
      const newPath = await invoke<string>('rename_file', {
        oldPath,
        newName: finalName,
      })
      
      const state = get()
      const renamedFile = {
        name: finalName,
        path: newPath,
        modified: state.activeFile?.path === oldPath ? state.isDirty : false,
      }

      set({
        activeFile: state.activeFile?.path === oldPath ? renamedFile : state.activeFile,
        openTabs: state.openTabs.map((tab) =>
          tab.path === oldPath ? { ...tab, name: finalName, path: newPath } : tab
        ),
      })

      // Reload the file tree
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename file:', error)
      alert(`Failed to rename file: ${error}`)
    }
  },

  // Rename folder
  renameFolder: async (oldPath, newName) => {
    if (!(await get().requireEditableWorkspace('rename folders'))) {
      return
    }
    try {
      const newPath = await invoke<string>('rename_folder', {
        oldPath,
        newName,
      })

      const state = get()
      const updatedTabs = state.openTabs.map((tab) => {
        if (!isPathInsideDirectory(tab.path, oldPath)) {
          return tab
        }

        const nextPath = replacePathPrefix(tab.path, oldPath, newPath)
        return {
          ...tab,
          path: nextPath,
          name: fileNameFromPath(nextPath),
        }
      })

      const activeFile = state.activeFile && isPathInsideDirectory(state.activeFile.path, oldPath)
        ? {
            ...state.activeFile,
            path: replacePathPrefix(state.activeFile.path, oldPath, newPath),
            name: fileNameFromPath(replacePathPrefix(state.activeFile.path, oldPath, newPath)),
          }
        : state.activeFile

      set({
        activeFile,
        openTabs: updatedTabs,
      })

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename folder:', error)
      alert(`Failed to rename folder: ${error}`)
    }
  },
  
  // Delete file
  // NOTE: Confirmation should be handled by the caller
  deleteFile: async (filePath) => {
    if (!(await get().requireEditableWorkspace('delete files'))) {
      return false
    }
    try {
      await invoke('delete_file', { filePath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => tab.path !== filePath)
      
      if (state.activeFile?.path === filePath) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      } else {
        set({ openTabs })
      }
      
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
      
      return true
    } catch (error) {
      console.error('[deleteFile] Failed to delete file:', error)
      throw error
    }
  },

  // Delete folder
  // NOTE: Confirmation should be handled by the caller
  deleteFolder: async (folderPath) => {
    if (!(await get().requireEditableWorkspace('delete folders'))) {
      return false
    }
    try {
      await invoke('delete_folder', { folderPath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => !isPathInsideDirectory(tab.path, folderPath))

      if (state.activeFile && isPathInsideDirectory(state.activeFile.path, folderPath)) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      } else {
        set({ openTabs })
      }

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }

      return true
    } catch (error) {
      console.error('[deleteFolder] Failed to delete folder:', error)
      throw error
    }
  },

  // Load preferences
  loadPreferences: async () => {
    try {
      // The Rust backend returns snake_case fields
      const prefs = await invoke<any>('get_preferences')
      
      // Convert snake_case from Rust to camelCase for TypeScript
      const loadedPrefs = convertPreferencesFromRust(prefs)
      let safePrefs = loadedPrefs

      await enqueuePreferenceMutation(async () => {
        const initialPrefs = loadedPrefs.showDecorations === false
          ? {
              ...loadedPrefs,
              showDecorations: true,
            }
          : loadedPrefs

        safePrefs = initialPrefs
        set({
          preferences: initialPrefs,
          sidebarVisible: initialPrefs.sidebarVisible,
        })

        if (loadedPrefs.showDecorations === false) {
          try {
            await invoke('set_decorations', { visible: false })
            safePrefs = {
              ...get().preferences,
              showDecorations: false,
            }
            set({
              preferences: safePrefs,
            })
          } catch (error) {
            console.error('Failed to apply window decorations preference:', error)
            alert(`Failed to apply window decorations preference: ${error}`)
          }
        }
      })

      applyDocumentTheme(
        getEffectiveTheme(
          safePrefs.theme,
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )
      )
      
      // Auto-load last directory if it exists
      if (safePrefs.lastDirectory) {
        const lastDirectoryLoadResult = await get().loadDirectory(safePrefs.lastDirectory)

        if (lastDirectoryLoadResult.status === 'failed') {
          // Clear the invalid lastDirectory from preferences
          const newPrefs = { ...get().preferences, lastDirectory: null }
          set({ preferences: newPrefs })
          await get().savePreferences()
        }
      }
    } catch (error) {
      console.error('Failed to load preferences:', error)
      // Set default preferences if loading fails
      const defaultPrefs: Preferences = {
        lastDirectory: null,
        recentDirectories: [],
        theme: 'system',
        sidebarVisible: true,
        showDecorations: true,
        workspaceAccess: {},
      }
      set({
        preferences: defaultPrefs,
        sidebarVisible: true,
      })
      applyDocumentTheme(
        getEffectiveTheme(
          defaultPrefs.theme,
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )
      )
    }
  },

  // Save preferences
  savePreferences: async () => {
    try {
      await enqueuePreferenceMutation(async () => {
        await persistPreferences(get().preferences)
      })
    } catch (error) {
      console.error('Failed to save preferences:', error)
    }
  },

  clearRecentDirectories: async () => {
    try {
      await enqueuePreferenceMutation(async () => {
        await persistPreferences({
          ...get().preferences,
          recentDirectories: [],
        })

        set((currentState) => ({
          preferences: {
            ...currentState.preferences,
            recentDirectories: [],
          },
        }))
      })
    } catch (error) {
      console.error('Failed to clear recent directories:', error)
    }
  },

  // Toggle sidebar
  toggleSidebar: () => {
    const state = get()
    const newVisible = !state.sidebarVisible
    set({ sidebarVisible: newVisible })

    // Update preferences
    const newPrefs = { ...state.preferences, sidebarVisible: newVisible }
    set({ preferences: newPrefs })
    state.savePreferences()
  },

  // Toggle presentation mode
  togglePresentationMode: () => {
    const state = get()
    const entering = !state.presentationMode
    set({ presentationMode: entering })

    if (entering) {
      invoke('set_menu_visible', { visible: false }).catch((error) => {
        console.error('Failed to hide menu for presentation mode:', error)
        set({ presentationMode: false })
      })
    } else {
      if (state.preferences.showDecorations) {
        invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu after presentation mode:', error)
        })
      }
    }
  },

  // Toggle decorations
  toggleDecorations: () => {
    if (get().presentationMode) {
      return
    }

    enqueuePreferenceMutation(async () => {
      if (get().presentationMode) {
        return
      }

      const previousVisible = get().preferences.showDecorations
      const newVisible = !previousVisible
      await invoke('set_decorations', { visible: newVisible })
      set((currentState) => ({
        preferences: {
          ...currentState.preferences,
          showDecorations: newVisible,
        },
      }))

      try {
        await persistPreferences(get().preferences)
      } catch (error) {
        if (get().presentationMode) {
          throw error
        }

        try {
          await invoke('set_decorations', { visible: previousVisible })
          set((currentState) => ({
            preferences: {
              ...currentState.preferences,
              showDecorations: previousVisible,
            },
          }))
        } catch (rollbackError) {
          console.error(
            'Failed to restore window decorations after preference save failure:',
            rollbackError
          )
          throw new Error(
            `Failed to save decoration preference: ${describeError(error)}. ` +
            `Failed to restore window decorations: ${describeError(rollbackError)}`
          )
        }

        throw error
      }
    })
      .catch((error) => {
        console.error('Failed to toggle window decorations:', error)
        alert(`Failed to toggle window decorations: ${error}`)
      })
  },

  toggleTheme: async () => {
    try {
      await enqueuePreferenceMutation(async () => {
        const state = get()
        const nextTheme = getNextExplicitTheme(
          state.preferences.theme,
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )

        await persistPreferences({
          ...state.preferences,
          theme: nextTheme,
        })

        set((currentState) => ({
          preferences: {
            ...currentState.preferences,
            theme: nextTheme,
          },
        }))
        applyDocumentTheme(nextTheme)
      })
    } catch (error) {
      console.error('Failed to toggle theme:', error)
      await message(`Failed to update theme: ${error}`, {
        title: 'Error',
        kind: 'error',
      })
    }
  },

  requireEditableWorkspace: async (action) => {
    if (!get().currentDirectory || get().workspaceAccessMode === 'editable') {
      return true
    }

    await message(`This workspace is read-only. Enable editing before you ${action}.`, {
      title: 'Read Only Workspace',
      kind: 'info',
    })
    return false
  },

  setWorkspaceAccessMode: async (mode) => {
    const state = get()
    const workspaceKey = state.currentWorkspaceKey
    if (!workspaceKey || mode === state.workspaceAccessMode) {
      return
    }

    if (mode === 'editable') {
      const confirmed = await ask(
        'Enable editing for this workspace on this machine?\n\nFor OneDrive-backed folders, normally edit from only one machine at a time.',
        {
          title: 'Enable Workspace Editing',
          kind: 'warning',
          okLabel: 'Enable Editing',
          cancelLabel: 'Keep Read Only',
        }
      )
      if (!confirmed) {
        return
      }
    } else if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(
        state.activeFile.name,
        'switching this workspace to read-only'
      )
      if (decision === 'cancel') {
        return
      }
      if (decision === 'save') {
        if (!(await state.saveCurrentFile())) {
          return
        }
        if (get().isDirty) {
          return
        }
      } else {
        try {
          const currentTab = state.openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (currentTab?.sceneVersion || 0) + 1
          )
          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
        } catch (error) {
          await message(`Failed to discard changes: ${error}`, {
            title: 'Error',
            kind: 'error',
          })
          return
        }
      }
    }

    try {
      await enqueuePreferenceMutation(async () => {
        const latest = get()
        const nextPreferences: Preferences = {
          ...latest.preferences,
          workspaceAccess: {
            ...latest.preferences.workspaceAccess,
            [workspaceKey]: mode,
          },
        }
        await persistPreferences(nextPreferences)
        set({
          preferences: nextPreferences,
          workspaceAccessMode: mode,
        })
      })
    } catch (error) {
      await message(`Failed to update workspace access: ${error}`, {
        title: 'Error',
        kind: 'error',
      })
    }
  },

  // Close tab
  closeTab: async (filePath) => {
    const state = get()
    const tabIndex = state.openTabs.findIndex(t => t.path === filePath)
    if (tabIndex === -1) return

    const tab = state.openTabs[tabIndex]

    // Check for unsaved changes if this is the active file
    if (state.activeFile?.path === filePath && state.isDirty) {
      const decision = await confirmUnsavedChanges(tab.name, 'closing')

      if (decision === 'save') {
        if (!(await state.saveCurrentFile())) {
          return
        }
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }

    const newTabs = state.openTabs.filter(t => t.path !== filePath)

    if (state.activeFile?.path === filePath) {
      // Switch to adjacent tab
      if (newTabs.length > 0) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        set({ openTabs: newTabs })
        await get().loadFile(newActiveTab)
      } else {
        set({
          openTabs: newTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      }
    } else {
      set({ openTabs: newTabs })
    }
  },

}))
