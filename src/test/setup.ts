import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// Mock Tauri API for tests
const mockInvoke = vi.fn()
const mockListen = vi.fn()
const mockMessage = vi.fn()
const createMockMatchMedia = (query: string) => ({
  matches: false,
  media: query,
  query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
  addListener: vi.fn(),
  removeListener: vi.fn(),
})

const mockMatchMedia = vi.fn(createMockMatchMedia)

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
  emit: vi.fn(),
}))

// Mock @tauri-apps/api/window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    isFullscreen: vi.fn(() => Promise.resolve(false)),
    setFullscreen: vi.fn(),
  }),
}))

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: vi.fn(),
  message: mockMessage,
}))

// Mock @tauri-apps/plugin-opener
vi.mock('@tauri-apps/plugin-opener', () => ({}))

Object.defineProperty(window, 'matchMedia', {
configurable: true,
writable: true,
value: mockMatchMedia,
})

// Reset mocks before each test
beforeEach(() => {
mockInvoke.mockReset()
mockListen.mockReset()
mockMessage.mockReset()
mockMatchMedia.mockReset()
mockMatchMedia.mockImplementation(createMockMatchMedia)
})

// Export mocks for use in tests
export { mockInvoke, mockListen, mockMatchMedia, mockMessage }