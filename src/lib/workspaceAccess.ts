import type { WorkspaceAccessMode } from '../types'

export function normalizeWorkspaceKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function getWorkspaceAccessMode(
  workspaceAccess: Record<string, WorkspaceAccessMode>,
  workspaceKey: string
): WorkspaceAccessMode {
  return workspaceAccess[workspaceKey] ?? 'read-only'
}
