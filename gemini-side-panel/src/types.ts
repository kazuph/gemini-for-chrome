// Message types for chat
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// Page content extracted by Content Script
export interface PageContent {
  title: string
  url: string
  content: string // Markdown formatted content
  excerpt?: string
}

// Browser action types for Function Calling
export interface ClickElementAction {
  action: 'CLICK_ELEMENT'
  selector: string
}

export interface FillElementAction {
  action: 'FILL_ELEMENT'
  selector: string
  value: string
}

export interface GetHtmlAction {
  action: 'GET_HTML'
  selector?: string
}

export type BrowserAction = ClickElementAction | FillElementAction | GetHtmlAction

// Browser action results
export interface ClickElementResult {
  success: boolean
  message: string
}

export interface FillElementResult {
  success: boolean
  message: string
}

export interface GetHtmlResult {
  success: boolean
  html?: string
  error?: string
}

export type BrowserActionResult = ClickElementResult | FillElementResult | GetHtmlResult

// Message actions for Chrome messaging
export type MessageAction =
  | { action: 'GET_PAGE_CONTENT' }
  | { action: 'PING' }
  | ClickElementAction
  | FillElementAction
  | GetHtmlAction

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string }

// Response types
export interface GetPageContentResponse {
  success: true
  data: PageContent
}

export interface PingResponse {
  status: 'PONG'
}

// Gemini API related types
export interface GeminiConfig {
  apiKey: string
  modelName: string
}

// Chat state
export interface ChatState {
  messages: Message[]
  isLoading: boolean
  error: string | null
}

// Theme mode
export type ThemeMode = 'system' | 'light' | 'dark'

// UI Settings
export interface UISettings {
  fontSize: number // Base font size in pixels (min: 12, max: 24)
  themeMode: ThemeMode
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  fontSize: 14, // 14px as default (minimum)
  themeMode: 'system',
}
