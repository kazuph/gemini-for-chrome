import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { UISettings, ThemeMode } from '../types'
import { DEFAULT_UI_SETTINGS } from '../types'

/**
 * Utility function to merge Tailwind classes
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Format timestamp to readable string
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Load UI settings from Chrome storage
 */
export async function loadUISettings(): Promise<UISettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['uiSettings'], (result) => {
      if (result.uiSettings) {
        resolve({ ...DEFAULT_UI_SETTINGS, ...result.uiSettings })
      } else {
        resolve(DEFAULT_UI_SETTINGS)
      }
    })
  })
}

/**
 * Save UI settings to Chrome storage
 */
export async function saveUISettings(settings: UISettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ uiSettings: settings }, resolve)
  })
}

/**
 * Get effective theme based on mode and system preference
 */
export function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}
