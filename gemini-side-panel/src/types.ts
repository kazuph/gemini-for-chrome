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

export interface HoverElementAction {
  action: 'HOVER_ELEMENT'
  selector: string
}

export interface FocusElementAction {
  action: 'FOCUS_ELEMENT'
  selector: string
}

export interface BlurElementAction {
  action: 'BLUR_ELEMENT'
  selector?: string
}

export interface ScrollIntoViewAction {
  action: 'SCROLL_INTO_VIEW'
  selector: string
  behavior?: 'auto' | 'smooth'
  block?: 'start' | 'center' | 'end' | 'nearest'
}

export interface RightClickElementAction {
  action: 'RIGHT_CLICK_ELEMENT'
  selector: string
}

export interface DoubleClickElementAction {
  action: 'DOUBLE_CLICK_ELEMENT'
  selector: string
}

export interface SelectTextAction {
  action: 'SELECT_TEXT'
  selector: string
  start?: number
  end?: number
}

export interface PressKeyAction {
  action: 'PRESS_KEY'
  key: string
}

export interface PressKeyCombinationAction {
  action: 'PRESS_KEY_COMBINATION'
  keys: string[]
}

export type BrowserAction =
  | ClickElementAction
  | FillElementAction
  | GetHtmlAction
  | HoverElementAction
  | FocusElementAction
  | BlurElementAction
  | ScrollIntoViewAction
  | RightClickElementAction
  | DoubleClickElementAction
  | SelectTextAction
  | PressKeyAction
  | PressKeyCombinationAction

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

export interface GenericActionResult {
  success: boolean
  message: string
}

export type BrowserActionResult =
  | ClickElementResult
  | FillElementResult
  | GetHtmlResult
  | GenericActionResult

// Mermaid overlay action
export interface ShowMermaidOverlayAction {
  action: 'SHOW_MERMAID_OVERLAY'
  svgContent: string
}

// Message actions for Chrome messaging
export type MessageAction =
  | { action: 'GET_PAGE_CONTENT' }
  | { action: 'PING' }
  | ClickElementAction
  | FillElementAction
  | GetHtmlAction
  | HoverElementAction
  | FocusElementAction
  | BlurElementAction
  | ScrollIntoViewAction
  | RightClickElementAction
  | DoubleClickElementAction
  | SelectTextAction
  | PressKeyAction
  | PressKeyCombinationAction
  | ShowMermaidOverlayAction

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
