import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { useStore } from '../store/useStore'

describe('Sidebar controls', () => {
  beforeEach(() => {
    useStore.setState({
      currentDirectory: 'C:\\Drawings',
      currentWorkspaceKey: 'c:/drawings',
      workspaceAccessMode: 'read-only',
      fileTree: [],
      activeFile: null,
      preferences: {
        lastDirectory: 'C:\\Drawings',
        recentDirectories: [],
        theme: 'light',
        sidebarVisible: true,
        showDecorations: true,
        workspaceAccess: {},
      },
    } as never)
  })

  it('shows the read-only workspace state and edit action', () => {
    render(<Sidebar />)

    expect(screen.getByText('Read Only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Editing' })).toBeInTheDocument()
  })

  it('shows and invokes the global theme action', () => {
    const toggleTheme = vi.fn()
    useStore.setState({ toggleTheme } as never)
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))

    expect(toggleTheme).toHaveBeenCalledOnce()
  })
})
