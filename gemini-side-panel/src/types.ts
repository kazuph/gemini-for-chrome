// Per-tool-call log entry attached to an assistant message so the UI can show
// a collapsible "Tool calls" panel with arguments / results / durations.
export interface ToolCallLog {
  name: string
  args: Record<string, unknown>
  success: boolean
  resultSummary: string
  timestamp: number
  durationMs: number
}

// Message types for chat
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: ToolCallLog[]
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
  selector?: string
}

export interface PressKeyCombinationAction {
  action: 'PRESS_KEY_COMBINATION'
  keys: string[]
}

export interface WaitForElementAction {
  action: 'WAIT_FOR_ELEMENT'
  selector: string
  timeoutMs?: number
}

export interface ScrollByAction {
  action: 'SCROLL_BY'
  dx: number
  dy: number
}

export interface ScrollToBottomAction {
  action: 'SCROLL_TO_BOTTOM'
  behavior?: 'auto' | 'smooth'
}

export interface ScrollToTopAction {
  action: 'SCROLL_TO_TOP'
  behavior?: 'auto' | 'smooth'
}

export interface GetScrollPositionAction {
  action: 'GET_SCROLL_POSITION'
}

export interface ReadPageAction {
  action: 'READ_PAGE'
}

export interface GetTextAction {
  action: 'GET_TEXT'
  selector: string
}

export interface GetAttributeAction {
  action: 'GET_ATTRIBUTE'
  selector: string
  name: string
}

export interface FindElementsAction {
  action: 'FIND_ELEMENTS'
  selector: string
  limit?: number
}

export interface GetAllLinksAction {
  action: 'GET_ALL_LINKS'
  filterSelector?: string
}

export interface WaitAction {
  action: 'WAIT'
  ms: number
}

export interface NavigateToUrlAction {
  action: 'NAVIGATE_TO_URL'
  url: string
  sameOriginOnly?: boolean
  waitForLoad?: boolean
}

export interface FetchUrlAction {
  action: 'FETCH_URL'
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface RunJsAction {
  action: 'RUN_JS'
  code: string
  timeout_ms?: number
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
  | WaitForElementAction
  | ScrollByAction
  | ScrollToBottomAction
  | ScrollToTopAction
  | GetScrollPositionAction
  | ReadPageAction
  | GetTextAction
  | GetAttributeAction
  | FindElementsAction
  | GetAllLinksAction
  | WaitAction
  | NavigateToUrlAction
  | FetchUrlAction
  | RunJsAction

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

export interface WaitForElementResult {
  success: boolean
  message?: string
  error?: string
  elapsedMs?: number
}

export interface ScrollPositionResult {
  success: boolean
  message?: string
  error?: string
  x?: number
  y?: number
  maxX?: number
  maxY?: number
}

export interface ScrollToBottomResult {
  success: boolean
  message?: string
  error?: string
  x?: number
  y?: number
  maxX?: number
  maxY?: number
  scrollHeight?: number
  iterations?: number
}

export interface ReadPageResult {
  success: boolean
  error?: string
  title?: string
  url?: string
  content?: string
  excerpt?: string
}

export interface GetTextResult {
  success: boolean
  error?: string
  text?: string
}

export interface GetAttributeResult {
  success: boolean
  error?: string
  name?: string
  value?: string | null
}

export interface FoundElementInfo {
  index: number
  text: string
  visible: boolean
  rect: { x: number; y: number; width: number; height: number }
  tagName: string
  href?: string
  ariaLabel?: string
}

export interface FindElementsResult {
  success: boolean
  error?: string
  count?: number
  elements?: FoundElementInfo[]
}

export interface LinkInfo {
  text: string
  href: string
  title?: string
  ariaLabel?: string
}

export interface GetAllLinksResult {
  success: boolean
  error?: string
  count?: number
  links?: LinkInfo[]
}

export interface NavigateToUrlResult {
  success: boolean
  error?: string
  url?: string
  title?: string
  content?: string
  excerpt?: string
}

export interface FetchUrlResult {
  success: boolean
  error?: string
  status?: number
  statusText?: string
  ok?: boolean
  url?: string
  headers?: Record<string, string>
  contentType?: string
  body?: string
  bodyJson?: unknown
  truncated?: boolean
  byteLength?: number
}

// run_js: arbitrary JS evaluation in the active tab via CDP Runtime.evaluate.
// value is the JSON-serialized return value (parsed back into an object when
// serializable). valuePreview is JSON.stringify(value).slice(0, 200).
export interface RunJsResult {
  success: boolean
  value?: unknown
  valuePreview?: string
  valueByteSize?: number
  type?: string
  truncated?: boolean
  error?: string
  durationMs?: number
}

export type BrowserActionResult =
  | ClickElementResult
  | FillElementResult
  | GetHtmlResult
  | GenericActionResult
  | WaitForElementResult
  | ScrollPositionResult
  | ScrollToBottomResult
  | ReadPageResult
  | GetTextResult
  | GetAttributeResult
  | FindElementsResult
  | GetAllLinksResult
  | NavigateToUrlResult
  | FetchUrlResult
  | RunJsResult

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
  | WaitForElementAction
  | ScrollByAction
  | ScrollToBottomAction
  | ScrollToTopAction
  | GetScrollPositionAction
  | ReadPageAction
  | GetTextAction
  | GetAttributeAction
  | FindElementsAction
  | GetAllLinksAction
  | WaitAction
  | NavigateToUrlAction
  | FetchUrlAction
  | RunJsAction
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
