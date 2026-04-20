import { useState, useEffect, useRef, useCallback } from 'react'
import { Settings, AlertCircle, Plus, Minus } from 'lucide-react'
import type { FunctionCall } from '@google/generative-ai'
import type { Message, PageContent, MessageResponse, UISettings, ThemeMode, BrowserActionResult, ToolCallLog } from '../types'
import { DEFAULT_UI_SETTINGS } from '../types'
import { GeminiChat, loadGeminiConfig, type FunctionCallResult, type GeminiUsage } from '../lib/gemini'
import { generateId, cn, loadUISettings, saveUISettings, getEffectiveTheme } from '../lib/utils'
import { MessageBubble, ChatInput, LoadingIndicator } from '../components'
import {
  GEMINI_MODEL_GROUPS,
  CUSTOM_MODEL_VALUE,
  isKnownModel,
  modelOptionDisplayLabel,
  getCostForModel,
} from '../lib/models'
import { computeSpendUsd, formatJpy } from '../lib/cost'

const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 26
const FONT_STEP = 2
const MAX_FUNCTION_CALL_TURNS = 20
const MAX_REPEATED_FUNCTION_CALL = 3
// Same function name repeated N times in a row (args ignored) -> hard stop.
// Catches the "Gemini probes with slightly different selectors" failure mode
// that MAX_REPEATED_FUNCTION_CALL (full-args equality) cannot detect.
const MAX_SAME_NAME_STREAK = 5

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Truncate at `max` chars with a one-line "…" suffix. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}...`
}

/**
 * Build a per-tool `resultSummary` string rich enough that the user (and the
 * model reading back through conversation) can tell *why* a call succeeded or
 * failed. Falls back to `data.message` / 'Success' when the tool-specific
 * extractor has nothing better to say.
 *
 * Only called for successful responses; error paths are handled by the caller.
 */
function summarizeToolResult(
  name: string,
  data: Record<string, unknown>,
  args: Record<string, unknown>
): string {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const fallbackMessage = str(data.message) ?? 'Success'

  switch (name) {
    case 'find_elements': {
      const count = num(data.count) ?? 0
      const selector = str(args.selector) ?? '?'
      if (count === 0) {
        return `0 elements — empty selector, try different (selector: ${selector})`
      }
      return `matched ${count} element${count === 1 ? '' : 's'} for ${selector}`
    }

    case 'get_all_links': {
      const count = num(data.count) ?? 0
      if (count === 0) {
        return '0 links — nothing matched, try different filter_selector'
      }
      return `${count} visible link${count === 1 ? '' : 's'}`
    }

    case 'read_page': {
      const title = str(data.title) ?? '(no title)'
      const content = str(data.content) ?? ''
      return truncate(`title: "${title}", ${content.length} chars`, 100)
    }

    case 'navigate_to_url': {
      const url = str(data.url) ?? str(args.url) ?? '?'
      const content = str(data.content) ?? ''
      return truncate(`navigated to ${url}, ${content.length} chars`, 100)
    }

    case 'fetch_url': {
      const status = num(data.status)
      const contentType = str(data.contentType) ?? 'unknown'
      const byteLength = num(data.byteLength) ?? str(data.body)?.length ?? 0
      const statusStr = status !== undefined ? String(status) : '?'
      return `HTTP ${statusStr} — ${contentType}, ${byteLength} chars`
    }

    case 'scroll_to_bottom':
    case 'scroll_to_top':
    case 'scroll_by':
    case 'get_scroll_position': {
      const y = num(data.y)
      const maxY = num(data.maxY) ?? num(data.scrollHeight)
      if (y === undefined) return fallbackMessage
      const heightStr = maxY !== undefined ? `, height=${maxY}` : ''
      const iterations = num(data.iterations)
      const iterStr = iterations !== undefined ? `, iterations=${iterations}` : ''
      return `scroll y=${y}${heightStr}${iterStr}`
    }

    case 'get_text': {
      const text = str(data.text) ?? ''
      return `${text.length} chars`
    }

    case 'get_attribute': {
      const value = data.value
      if (value === null || value === undefined) return 'null'
      const stringified = typeof value === 'string' ? value : JSON.stringify(value)
      return `value: "${truncate(stringified, 50)}"`
    }

    case 'wait_for_element': {
      const elapsed = num(data.elapsedMs)
      if (elapsed !== undefined) return `appeared in ${elapsed}ms`
      const err = str(data.error)
      if (err) return `timeout: ${err}`
      return fallbackMessage
    }

    case 'get_html': {
      const html = str(data.html) ?? ''
      return `${html.length} chars of HTML`
    }

    case 'wait': {
      const ms = num(args.ms) ?? 0
      return `waited ${ms}ms`
    }

    case 'run_js': {
      const type = str(data.type) ?? 'unknown'
      const preview = str(data.valuePreview) ?? ''
      const byteSize = num(data.valueByteSize) ?? 0
      const truncated = data.truncated === true
      if (truncated) {
        return truncate(`returned ${type} (${byteSize} bytes, truncated): ${preview}`, 100)
      }
      return truncate(`returned ${type}: ${preview}`, 100)
    }

    case 'click_element':
    case 'fill_element':
    case 'hover_element':
    case 'focus_element':
    case 'blur_element':
    case 'right_click_element':
    case 'double_click_element':
    case 'select_text':
    case 'press_key':
    case 'press_key_combination':
    case 'scroll_to_element':
      // These tools already return a useful `message` from the background.
      return fallbackMessage

    default:
      return fallbackMessage
  }
}

export default function SidePanel() {
  // API configuration state
  const [apiKey, setApiKey] = useState<string>('')
  const [modelName, setModelName] = useState<string>('gemini-2.0-flash')
  const [modelSelectValue, setModelSelectValue] = useState<string>('gemini-2.0-flash')
  const [hasKey, setHasKey] = useState<boolean>(false)
  const [showConfig, setShowConfig] = useState<boolean>(false)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState<string>('')
  // Currently-executing tool names (shown as a small "実行中: X" badge while
  // handleFunctionCalls is waiting on executeBrowserAction).
  const [currentToolCalls, setCurrentToolCalls] = useState<string[]>([])
  // Tool calls that have already completed during the in-flight turn.
  // Mirrors `turnToolCalls` (which is closed over inside handleSendMessage)
  // into React state so the streaming MessageBubble / LoadingIndicator can
  // render a live, collapsible "Tool calls" panel while the agent is still
  // working.
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallLog[]>([])

  // Page content state
  const [pageContent, setPageContent] = useState<PageContent | null>(null)

  // UI Settings state
  const [uiSettings, setUISettings] = useState<UISettings>(DEFAULT_UI_SETTINGS)
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark')

  // Browser action mode (off by default for safety)
  const [browserActionMode, setBrowserActionMode] = useState<boolean>(false)

  // Cost tracking (USD). lastCallSpend = most recent user turn, sessionSpend =
  // this in-memory session total, lifetimeSpend = persisted all-time total
  // stored in chrome.storage.local. All three are shown as a dimmed readout
  // below the header.
  const [lastCallSpend, setLastCallSpend] = useState<number>(0)
  const [sessionSpend, setSessionSpend] = useState<number>(0)
  const [lifetimeSpend, setLifetimeSpend] = useState<number>(0)

  // Currently-editing user message id (null when not editing).
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const geminiChatRef = useRef<GeminiChat | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  // 最新の streaming 内容を abort ハンドラで保存するため、state と並行して ref に持つ
  const streamingContentRef = useRef<string>('')

  useEffect(() => {
    streamingContentRef.current = streamingContent
  }, [streamingContent])

  // Update effective theme when settings or system preference changes
  useEffect(() => {
    const updateTheme = () => {
      setEffectiveTheme(getEffectiveTheme(uiSettings.themeMode))
    }
    updateTheme()

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', updateTheme)
    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [uiSettings.themeMode])

  // Scroll to bottom when messages change.
  // `block: 'end'` pins the sentinel to the viewport's bottom so the last
  // message is never clipped by the input bar below.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingContent, streamingToolCalls])

  /**
   * Fetch page content from the active tab
   */
  const fetchPageContent = useCallback(async () => {
    setError(null)

    try {
      const response = await new Promise<MessageResponse<PageContent>>((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_PAGE_CONTENT' }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message || 'Failed to get page content',
            })
          } else {
            resolve(res)
          }
        })
      })

      if (response.success) {
        setPageContent(response.data)
        console.log('Page content loaded:', response.data.title, response.data.url)
      } else {
        console.warn('Failed to load page content:', response.error)
        setPageContent(null)
      }
    } catch (err) {
      console.error('Error fetching page content:', err)
      setPageContent(null)
    }
  }, [])

  // Track whether the initial load from chrome.storage has finished so the
  // save effect does not wipe storage with an empty [] before hydration.
  const messagesHydratedRef = useRef<boolean>(false)

  // Storage quota protection. Earlier versions persisted the full toolCalls
  // payload per message (including run_js return values up to 100KB each),
  // which bloated chrome.storage.local to multi-MB levels and froze the UI
  // on hydrate. We now keep only the last N messages in storage and strip
  // heavy tool-call logs before saving.
  const MAX_PERSISTED_MESSAGES = 50

  // Load API config and UI settings on mount
  useEffect(() => {
    loadGeminiConfig().then((config) => {
      if (config) {
        setApiKey(config.apiKey)
        setModelName(config.modelName)
        setModelSelectValue(isKnownModel(config.modelName) ? config.modelName : CUSTOM_MODEL_VALUE)
        setHasKey(true)
        geminiChatRef.current = new GeminiChat(config)
      }
    })

    loadUISettings().then(setUISettings)

    // Rehydrate chat history, but first check storage size. Earlier builds
    // persisted heavy toolCalls payloads, which can swell storage to multi-MB
    // and freeze the UI during JSON parse. If we detect bloat (>2MB) we wipe
    // chatMessages automatically so the settings form stays responsive.
    const BLOAT_THRESHOLD_BYTES = 2_000_000
    chrome.storage.local.getBytesInUse(null, (totalBytes) => {
      const proceedHydrate = () => {
        chrome.storage.local.get(['chatMessages'], (result) => {
          const stored = result.chatMessages
          if (Array.isArray(stored)) {
            const trimmed = (stored as Message[])
              .slice(-MAX_PERSISTED_MESSAGES)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
              })) as Message[]
            console.log('[SidePanel hydrate] loaded messages:', {
              rawLength: stored.length,
              keptLength: trimmed.length,
            })
            setMessages(trimmed)
          }
          messagesHydratedRef.current = true
        })
      }

      if (typeof totalBytes === 'number' && totalBytes > BLOAT_THRESHOLD_BYTES) {
        console.warn(
          `[SidePanel hydrate] storage bloated (${totalBytes} bytes). Auto-clearing chatMessages to unfreeze UI.`
        )
        chrome.storage.local.remove(['chatMessages'], () => {
          // After purging the heavy key, the rest of the hydrate is safe.
          proceedHydrate()
        })
      } else {
        proceedHydrate()
      }
    })

    // Rehydrate lifetime cost total so the "total $X" indicator survives
    // extension / side-panel reloads.
    chrome.storage.local.get(['lifetimeSpendUsd'], (result) => {
      if (typeof result.lifetimeSpendUsd === 'number' && isFinite(result.lifetimeSpendUsd)) {
        setLifetimeSpend(result.lifetimeSpendUsd)
      }
    })
  }, [])

  // Persist messages to chrome.storage.local whenever they change. Only the
  // most recent MAX_PERSISTED_MESSAGES are saved, and toolCalls logs are
  // stripped (they can be huge — run_js return values alone can be 100KB).
  // toolCalls stay in React state for the live session; they're just not
  // persisted so hydrate doesn't have to re-parse MBs of JSON.
  useEffect(() => {
    if (!messagesHydratedRef.current) return
    const toSave = messages.slice(-MAX_PERSISTED_MESSAGES).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }))
    chrome.storage.local.set({ chatMessages: toSave }, () => {
      if (chrome.runtime.lastError) {
        console.error('[SidePanel persist] chrome.storage.local.set error:', chrome.runtime.lastError)
      }
    })
  }, [messages])

  // Fetch page content when panel opens and listen for tab changes
  useEffect(() => {
    if (hasKey && !showConfig) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPageContent()

      // Listen for tab activation changes
      const handleTabActivated = () => {
        console.log('Tab activated, refreshing page content')
        fetchPageContent()
      }

      // Listen for tab updates (URL changes, page load)
      const handleTabUpdated = (
        _tabId: number,
        changeInfo: { status?: string; url?: string },
        _tab: chrome.tabs.Tab
      ) => {
        if (changeInfo.status === 'complete' || changeInfo.url) {
          console.log('Tab updated, refreshing page content')
          fetchPageContent()
        }
      }

      chrome.tabs.onActivated.addListener(handleTabActivated)
      chrome.tabs.onUpdated.addListener(handleTabUpdated)

      return () => {
        chrome.tabs.onActivated.removeListener(handleTabActivated)
        chrome.tabs.onUpdated.removeListener(handleTabUpdated)
      }
    }
  }, [hasKey, showConfig, fetchPageContent])

  /**
   * Save API configuration
   */
  const handleSaveConfig = () => {
    chrome.storage.local.set(
      {
        geminiApiKey: apiKey,
        geminiModelName: modelName,
      },
      () => {
        setHasKey(true)
        setShowConfig(false)
        geminiChatRef.current = new GeminiChat({ apiKey, modelName })
      }
    )
  }

  /**
   * Update UI settings
   */
  const updateUISettings = useCallback((updates: Partial<UISettings>) => {
    setUISettings((prev) => {
      const newSettings = { ...prev, ...updates }
      saveUISettings(newSettings)
      return newSettings
    })
  }, [])

  /**
   * Change font size
   */
  const changeFontSize = (delta: number) => {
    const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, uiSettings.fontSize + delta))
    updateUISettings({ fontSize: newSize })
  }

  /**
   * Execute browser actions from function calls.
   * Returns both the raw FunctionCallResult (sent back to Gemini) and a
   * ToolCallLog (shown in the UI / copied to clipboard).
   */
  const executeBrowserAction = useCallback(
    async (
      functionCall: FunctionCall,
      signal?: AbortSignal
    ): Promise<{ result: FunctionCallResult; log: ToolCallLog }> => {
      const startedAt = Date.now()
      const args = (functionCall.args ?? {}) as Record<string, unknown>

      const makeLog = (success: boolean, resultSummary: string): ToolCallLog => ({
        name: functionCall.name,
        args,
        success,
        resultSummary,
        timestamp: startedAt,
        durationMs: Date.now() - startedAt,
      })

      if (signal?.aborted) {
        const summary = 'Aborted by user'
        return {
          result: {
            name: functionCall.name,
            response: { success: false, error: summary },
          },
          log: makeLog(false, summary),
        }
      }

      const browserAction = GeminiChat.functionCallToBrowserAction(functionCall)

      if (!browserAction) {
        const summary = `Unknown function: ${functionCall.name}`
        return {
          result: {
            name: functionCall.name,
            response: { success: false, error: summary },
          },
          log: makeLog(false, summary),
        }
      }

      try {
        const response = await new Promise<MessageResponse<BrowserActionResult>>((resolve) => {
          chrome.runtime.sendMessage(browserAction, (res) => {
            if (chrome.runtime.lastError) {
              resolve({
                success: false,
                error: chrome.runtime.lastError.message || 'Failed to execute action',
              })
            } else {
              resolve(res)
            }
          })
        })

        console.log(`Browser action ${functionCall.name} result:`, response)
        if (response.success) {
          const data = response.data as unknown as Record<string, unknown>
          const succeeded = data.success !== false
          const rawSummary = succeeded
            ? summarizeToolResult(functionCall.name, data, args)
            : `Error: ${(typeof data.error === 'string' ? data.error : undefined) ?? 'Unknown error'}`
          const resultSummary = truncate(rawSummary, 100)
          return {
            result: { name: functionCall.name, response: response.data },
            log: makeLog(succeeded, resultSummary),
          }
        } else {
          const rawSummary = `Error: ${response.error}`
          const resultSummary = truncate(rawSummary, 100)
          return {
            result: {
              name: functionCall.name,
              response: { success: false, error: response.error },
            },
            log: makeLog(false, resultSummary),
          }
        }
      } catch (err) {
        console.error(`Error executing ${functionCall.name}:`, err)
        const msg = err instanceof Error ? err.message : 'Unknown error'
        const rawSummary = `Error: ${msg}`
        const resultSummary = truncate(rawSummary, 100)
        return {
          result: {
            name: functionCall.name,
            response: { success: false, error: msg },
          },
          log: makeLog(false, resultSummary),
        }
      }
    },
    []
  )

  /**
   * Commit the current streaming buffer as an assistant message (used on abort / max turns)
   */
  const commitStreamingAsAssistant = useCallback((suffix?: string, toolCalls?: ToolCallLog[]) => {
    const current = streamingContentRef.current
    const finalText = suffix ? `${current}${current ? '\n\n' : ''}${suffix}` : current
    if (finalText.trim().length > 0) {
      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: finalText,
        timestamp: Date.now(),
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      }
      setMessages((prev) => [...prev, assistantMessage])
    }
    setStreamingContent('')
    streamingContentRef.current = ''
    setCurrentToolCalls([])
    setStreamingToolCalls([])
  }, [])

  /**
   * Send a message to Gemini
   * Always fetches fresh page content when includePageContent is true
   * Supports Function Calling for browser actions
   */
  const handleSendMessage = useCallback(
    async (
      content: string,
      includePageContent: boolean,
      baseMessages?: Message[]
    ) => {
      if (!geminiChatRef.current) {
        setError('Gemini API not configured. Please add your API key.')
        return
      }

      // 古い AbortController があれば破棄して、この送信専用の新しいものを生成
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const signal = controller.signal

      // When baseMessages is provided (edit/resend flow), use it as the prior
      // conversation; otherwise fall back to the current messages state.
      const effectiveMessages: Message[] = baseMessages ?? messages

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      if (baseMessages !== undefined) {
        // Replace the tail of `messages` with the truncated history + new user
        // message in a single setState so the UI stays consistent.
        setMessages([...baseMessages, userMessage])
      } else {
        setMessages((prev) => [...prev, userMessage])
      }
      setIsLoading(true)
      setError(null)
      setStreamingContent('')
      streamingContentRef.current = ''
      setStreamingToolCalls([])

      // If including page content, always fetch fresh content
      let currentPageContent: PageContent | undefined = undefined
      if (includePageContent) {
        try {
          const response = await new Promise<MessageResponse<PageContent>>((resolve) => {
            chrome.runtime.sendMessage({ action: 'GET_PAGE_CONTENT' }, (res) => {
              if (chrome.runtime.lastError) {
                resolve({
                  success: false,
                  error: chrome.runtime.lastError.message || 'Failed to get page content',
                })
              } else {
                resolve(res)
              }
            })
          })

          if (signal.aborted) {
            return
          }

          if (response.success) {
            currentPageContent = response.data
            setPageContent(response.data) // Update stored content too
            console.log('Fresh page content fetched:', response.data.url)
          } else {
            // Failed to get page content - show warning but continue with the message
            console.warn('Failed to get page content:', response.error)
            setError(`Could not include page content: ${response.error}. Sending message without page context.`)
          }
        } catch (err) {
          console.error('Error fetching fresh page content:', err)
          setError('Could not include page content. Sending message without page context.')
        }
      }

      const isAbortError = (error: Error): boolean =>
        (error instanceof DOMException && error.name === 'AbortError') || error.name === 'AbortError'

      // Track repeated identical function calls (same name + same args) to abort
      // infinite loops where the model keeps re-running the exact same call.
      let lastCallSignature: string | null = null
      let repeatCount = 0

      // Track same-name streaks (args ignored) to catch the "Gemini probes with
      // slightly different selectors" failure mode that the full-args loop
      // guard above cannot detect (e.g. find_elements x 14 with varying
      // selectors on Amazon).
      let lastCallName: string | null = null
      let sameNameCount = 0

      // Accumulate every tool call made during this user-turn so we can attach
      // a full ToolCallLog[] to the final assistant Message.
      const turnToolCalls: ToolCallLog[] = []

      // Cost accounting for this single user turn. Each Gemini round trip
      // (initial call + every tool continuation) reports a `usageMetadata`
      // snapshot; we sum them into `turnSpend` and flush to the three state
      // counters + storage once the turn settles (success / abort / error /
      // max turns).
      let turnSpend = 0
      let turnSpendFlushed = false
      const turnModelCost = getCostForModel(geminiChatRef.current.modelName)
      const onUsage = (usage: GeminiUsage): void => {
        const spend = computeSpendUsd(usage, turnModelCost)
        if (spend > 0 && isFinite(spend)) {
          turnSpend += spend
        }
      }
      const flushTurnSpend = () => {
        if (turnSpendFlushed) return
        turnSpendFlushed = true
        setLastCallSpend(turnSpend)
        if (turnSpend > 0) {
          setSessionSpend((prev) => prev + turnSpend)
          setLifetimeSpend((prev) => {
            const next = prev + turnSpend
            chrome.storage.local.set({ lifetimeSpendUsd: next }, () => {
              if (chrome.runtime.lastError) {
                console.warn('[SidePanel cost] failed to persist lifetime spend:', chrome.runtime.lastError)
              }
            })
            return next
          })
        }
      }

      const computeSignature = (calls: FunctionCall[]): string =>
        calls
          .map((fc) => `${fc.name}:${JSON.stringify(fc.args ?? {})}`)
          .join('|')

      const computeNameKey = (calls: FunctionCall[]): string =>
        calls.map((fc) => fc.name).join(',')

      // Handler for function calls with recursion depth cap
      const handleFunctionCalls = async (
        functionCalls: FunctionCall[],
        currentMessages: Message[],
        pageCtx: PageContent | undefined,
        depth: number
      ): Promise<void> => {
        if (signal.aborted) return

        if (depth >= MAX_FUNCTION_CALL_TURNS) {
          commitStreamingAsAssistant(
            `> Reached max function call turns (${MAX_FUNCTION_CALL_TURNS}). Stopping to prevent infinite loop.`,
            turnToolCalls
          )
          setError(`Reached max function call turns (${MAX_FUNCTION_CALL_TURNS}). Stopping to prevent infinite loop.`)
          flushTurnSpend()
          setIsLoading(false)
          abortControllerRef.current?.abort()
          return
        }

        // (1) Exact-signature loop guard (name + args equal 3x in a row)
        const signature = computeSignature(functionCalls)
        if (signature && signature === lastCallSignature) {
          repeatCount += 1
        } else {
          repeatCount = 1
          lastCallSignature = signature
        }
        if (repeatCount >= MAX_REPEATED_FUNCTION_CALL) {
          const repeatedName = functionCalls.map((fc) => fc.name).join(', ') || 'unknown'
          const notice = `I detected the same tool call repeating (${repeatedName}). Stopping to prevent infinite loop. Try a different approach.`
          commitStreamingAsAssistant(`> ${notice}`, turnToolCalls)
          setError(notice)
          flushTurnSpend()
          setIsLoading(false)
          abortControllerRef.current?.abort()
          return
        }

        // (2) Same-name streak guard (args ignored, 5x in a row)
        const nameKey = computeNameKey(functionCalls)
        if (nameKey && nameKey === lastCallName) {
          sameNameCount += 1
        } else {
          sameNameCount = 1
          lastCallName = nameKey
        }
        if (sameNameCount >= MAX_SAME_NAME_STREAK) {
          const toolName = functionCalls.map((fc) => fc.name).join(', ') || 'unknown'
          const notice = `I called '${toolName}' ${MAX_SAME_NAME_STREAK} times in a row. This usually means the model is stuck exploring with slightly different arguments. Stopping. If you want to continue, rephrase your request with more specifics.`
          commitStreamingAsAssistant(`> ${notice}`, turnToolCalls)
          setError(notice)
          flushTurnSpend()
          setIsLoading(false)
          abortControllerRef.current?.abort()
          return
        }

        // Expose the currently-running tool names to the UI (small live badge).
        const runningNames = functionCalls.map((fc) => fc.name)
        setCurrentToolCalls(runningNames)

        // Execute all function calls (pass signal so each can bail early).
        // No longer appends "*Executing: X*" to streamingContent — the UI will
        // render toolCalls separately via MessageBubble.
        const executed = await Promise.all(
          functionCalls.map((fc) => executeBrowserAction(fc, signal))
        )

        if (signal.aborted) {
          setCurrentToolCalls([])
          return
        }

        // Capture each call's log for the final Message.toolCalls[] payload,
        // AND mirror it into React state so the streaming UI can render live
        // progress via ToolCallsPanel.
        for (const { log } of executed) {
          turnToolCalls.push(log)
        }
        setStreamingToolCalls([...turnToolCalls])

        setCurrentToolCalls([])

        const results: FunctionCallResult[] = executed.map((e) => e.result)

        // Send results back to Gemini for continuation
        await geminiChatRef.current!.sendFunctionResults(
          currentMessages,
          pageCtx,
          functionCalls,
          results,
          (chunk) => {
            setStreamingContent((prev) => prev + chunk)
          },
          (fullText) => {
            const assistantMessage: Message = {
              id: generateId(),
              role: 'assistant',
              content: fullText,
              timestamp: Date.now(),
              toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
            }
            setMessages((prev) => [...prev, assistantMessage])
            setStreamingContent('')
            streamingContentRef.current = ''
            setCurrentToolCalls([])
            setStreamingToolCalls([])
            flushTurnSpend()
            setIsLoading(false)
          },
          async (newFunctionCalls) => {
            await handleFunctionCalls(newFunctionCalls, currentMessages, pageCtx, depth + 1)
          },
          (error) => {
            if (isAbortError(error)) {
              commitStreamingAsAssistant('> Stopped by user.', turnToolCalls)
              flushTurnSpend()
              setIsLoading(false)
              return
            }
            setError(error.message || 'An error occurred while processing function results')
            setStreamingContent('')
            streamingContentRef.current = ''
            setCurrentToolCalls([])
            setStreamingToolCalls([])
            flushTurnSpend()
            setIsLoading(false)
          },
          signal,
          onUsage
        )
      }

      try {
        if (browserActionMode) {
          // Use sendMessageWithTools to support function calling (browser actions)
          await geminiChatRef.current.sendMessageWithTools(
            content,
            effectiveMessages,
            currentPageContent,
            (chunk) => {
              setStreamingContent((prev) => prev + chunk)
            },
            (fullText) => {
              // No tool calls happened in this turn (model answered directly).
              const assistantMessage: Message = {
                id: generateId(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
                toolCalls: turnToolCalls.length > 0 ? [...turnToolCalls] : undefined,
              }
              setMessages((prev) => [...prev, assistantMessage])
              setStreamingContent('')
              streamingContentRef.current = ''
              setCurrentToolCalls([])
              setStreamingToolCalls([])
              flushTurnSpend()
              setIsLoading(false)
            },
            async (functionCalls) => {
              await handleFunctionCalls(functionCalls, effectiveMessages, currentPageContent, 0)
            },
            (error) => {
              if (isAbortError(error)) {
                commitStreamingAsAssistant('> Stopped by user.', turnToolCalls)
                flushTurnSpend()
                setIsLoading(false)
                return
              }
              setError(error.message || 'An error occurred while generating a response')
              setStreamingContent('')
              streamingContentRef.current = ''
              setCurrentToolCalls([])
              setStreamingToolCalls([])
              flushTurnSpend()
              setIsLoading(false)
            },
            signal,
            /* forceCall */ true,
            onUsage
          )
        } else {
          // Use regular sendMessageStream (no browser actions)
          await geminiChatRef.current.sendMessageStream(
            content,
            effectiveMessages,
            currentPageContent,
            (chunk) => {
              setStreamingContent((prev) => prev + chunk)
            },
            (fullText) => {
              const assistantMessage: Message = {
                id: generateId(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
              }
              setMessages((prev) => [...prev, assistantMessage])
              setStreamingContent('')
              streamingContentRef.current = ''
              flushTurnSpend()
              setIsLoading(false)
            },
            (error) => {
              if (isAbortError(error)) {
                commitStreamingAsAssistant('> Stopped by user.')
                flushTurnSpend()
                setIsLoading(false)
                return
              }
              setError(error.message || 'An error occurred while generating a response')
              setStreamingContent('')
              streamingContentRef.current = ''
              flushTurnSpend()
              setIsLoading(false)
            },
            signal,
            onUsage
          )
        }
      } catch (err) {
        if (err instanceof Error && isAbortError(err)) {
          commitStreamingAsAssistant('> Stopped by user.')
          flushTurnSpend()
          setIsLoading(false)
          return
        }
        console.error('Chat error:', err)
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setStreamingContent('')
        streamingContentRef.current = ''
        flushTurnSpend()
        setIsLoading(false)
      }
    },
    [messages, executeBrowserAction, browserActionMode, commitStreamingAsAssistant]
  )

  /**
   * Stop the current generation (abort streaming + commit partial output)
   */
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  /**
   * Clear chat history
   */
  const handleClearChat = () => {
    setMessages([])
    setError(null)
    setStreamingContent('')
    setCurrentToolCalls([])
    setStreamingToolCalls([])
    setEditingMessageId(null)
  }

  /**
   * Enter edit mode for a user message. Ignored while streaming so we don't
   * clobber an in-flight turn.
   */
  const handleStartEdit = useCallback(
    (messageId: string) => {
      if (isLoading) return
      const target = messages.find((m) => m.id === messageId)
      if (!target || target.role !== 'user') return
      setEditingMessageId(messageId)
    },
    [isLoading, messages]
  )

  /** Leave edit mode without resending. */
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null)
  }, [])

  /**
   * Commit an edited user message: truncate history to everything before the
   * edited message, then resend the new content through the normal send flow.
   */
  const handleSubmitEdit = useCallback(
    (messageId: string, newContent: string) => {
      if (isLoading) return
      const trimmed = newContent.trim()
      if (!trimmed) return

      const index = messages.findIndex((m) => m.id === messageId)
      if (index < 0) return
      const target = messages[index]
      if (target.role !== 'user') return

      // Keep everything strictly before the edited message; drop the message
      // itself plus any subsequent assistant / user turns.
      const truncated = messages.slice(0, index)

      // Leave edit mode, then resend via the standard pipeline with explicit
      // base history so closures don't see stale state. Default to including
      // fresh page content (matches ChatInput's default) — the user's original
      // send would typically have done the same.
      setEditingMessageId(null)
      handleSendMessage(trimmed, /* includePageContent */ true, truncated)
    },
    [isLoading, messages, handleSendMessage]
  )

  // Theme colors based on effective theme
  const theme = {
    bg: effectiveTheme === 'dark' ? 'bg-gray-900' : 'bg-gray-50',
    bgSecondary: effectiveTheme === 'dark' ? 'bg-gray-800' : 'bg-white',
    bgTertiary: effectiveTheme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-100',
    text: effectiveTheme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    textSecondary: effectiveTheme === 'dark' ? 'text-gray-400' : 'text-gray-600',
    textTertiary: effectiveTheme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    border: effectiveTheme === 'dark' ? 'border-gray-700' : 'border-gray-200',
    input: effectiveTheme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300',
    hover: effectiveTheme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200',
  }

  // Font size style
  const fontSizeStyle = { fontSize: `${uiSettings.fontSize}px` }

  // Configuration view
  if (!hasKey || showConfig) {
    return (
      <div className={cn('w-full h-screen flex flex-col font-sans', theme.bg, theme.text)} style={fontSizeStyle}>
        <header className={cn('p-4 border-b flex justify-between items-center', theme.bgSecondary, theme.border)}>
          <h1 className="text-lg font-semibold text-blue-500">Gemini Assistant</h1>
          {hasKey && (
            <button
              onClick={() => setShowConfig(false)}
              className={cn('text-xs', theme.textSecondary, 'hover:text-blue-500')}
            >
              Back to Chat
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-4">
          <div className="flex flex-col gap-4">
            <div className={cn('p-4 rounded-lg border', 'bg-blue-500/10 border-blue-500/30')}>
              <p className="text-sm mb-2">Configure your Gemini API settings.</p>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                Get API Key from Google AI Studio
              </a>
            </div>

            <div className="space-y-4">
              <div>
                <label className={cn('block text-xs mb-1.5', theme.textSecondary)}>API Key</label>
                <input
                  type="password"
                  className={cn(
                    'w-full p-3 rounded-lg border outline-none transition-colors',
                    'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                    theme.input,
                    theme.text
                  )}
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              <div>
                <label className={cn('block text-xs mb-1.5', theme.textSecondary)}>Model</label>
                <select
                  className={cn(
                    'w-full p-3 rounded-lg border outline-none transition-colors',
                    'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                    theme.input,
                    theme.text
                  )}
                  value={modelSelectValue}
                  onChange={(e) => {
                    const v = e.target.value
                    setModelSelectValue(v)
                    if (v !== CUSTOM_MODEL_VALUE) {
                      setModelName(v)
                    }
                  }}
                >
                  {GEMINI_MODEL_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {modelOptionDisplayLabel(m)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <optgroup label="カスタム">
                    <option value={CUSTOM_MODEL_VALUE}>カスタム (自由入力)</option>
                  </optgroup>
                </select>
                {modelSelectValue === CUSTOM_MODEL_VALUE && (
                  <input
                    type="text"
                    className={cn(
                      'mt-2 w-full p-3 rounded-lg border outline-none transition-colors',
                      'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                      theme.input,
                      theme.text
                    )}
                    placeholder="gemini-2.0-flash"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  />
                )}
                <p className={cn('mt-1.5 text-xs', theme.textTertiary)}>
                  Current: <code>{modelName || '(empty)'}</code>
                </p>
              </div>

              <div>
                <label className={cn('block text-xs mb-1.5', theme.textSecondary)}>Theme</label>
                <div className="flex gap-2">
                  {THEME_MODE_OPTIONS.map((opt) => {
                    const selected = uiSettings.themeMode === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateUISettings({ themeMode: opt.value })}
                        className={cn(
                          'flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors',
                          selected
                            ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'
                            : cn(theme.input, theme.text, theme.hover)
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className={cn('block text-xs mb-1.5', theme.textSecondary)}>
                  Font Size
                </label>
                <div className={cn('flex items-center gap-2 p-2 rounded-lg border', theme.input)}>
                  <button
                    type="button"
                    onClick={() => changeFontSize(-FONT_STEP)}
                    disabled={uiSettings.fontSize <= MIN_FONT_SIZE}
                    className={cn(
                      'p-2 rounded-md transition-colors',
                      theme.textSecondary,
                      theme.hover,
                      'disabled:opacity-30 disabled:cursor-not-allowed'
                    )}
                    title="Decrease font size"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className={cn('flex-1 text-center text-sm tabular-nums', theme.text)}>
                    {uiSettings.fontSize}px
                  </div>
                  <button
                    type="button"
                    onClick={() => changeFontSize(FONT_STEP)}
                    disabled={uiSettings.fontSize >= MAX_FONT_SIZE}
                    className={cn(
                      'p-2 rounded-md transition-colors',
                      theme.textSecondary,
                      theme.hover,
                      'disabled:opacity-30 disabled:cursor-not-allowed'
                    )}
                    title="Increase font size"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <p className={cn('mt-1.5 text-xs', theme.textTertiary)}>
                  Range: {MIN_FONT_SIZE}px – {MAX_FONT_SIZE}px
                </p>
              </div>

              <button
                onClick={handleSaveConfig}
                disabled={!apiKey.trim()}
                className={cn(
                  'w-full py-3 px-4 rounded-lg font-medium transition-colors',
                  'bg-blue-600 hover:bg-blue-500 text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600'
                )}
              >
                Save & Start Chatting
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Chat view
  return (
    <div className={cn('w-full h-screen flex flex-col font-sans', theme.bg, theme.text)} style={fontSizeStyle}>
      {/* Header */}
      <header className={cn('p-3 border-b flex justify-between items-center', theme.bgSecondary, theme.border)}>
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-base font-semibold text-blue-500 flex-shrink-0">Gemini</h1>
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className={cn(
              'text-xs truncate hover:underline focus:outline-none min-w-0',
              theme.textTertiary
            )}
            title={`Current model: ${modelName} (click to change)`}
          >
            {modelName}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* New chat */}
          <button
            onClick={handleClearChat}
            className={cn(
              'p-2 rounded-lg transition-colors',
              theme.textSecondary,
              theme.hover
            )}
            title="New chat"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowConfig(true)}
            className={cn('p-2 rounded-lg transition-colors', theme.textSecondary, theme.hover)}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Page content indicator */}
      {pageContent && (
        <div className={cn('px-3 py-2 border-b text-xs', theme.bgTertiary, theme.border, theme.textSecondary)}>
          <span className="font-medium">Page:</span>{' '}
          <span className="truncate" title={pageContent.url}>
            {pageContent.title || pageContent.url}
          </span>
          <span className={cn('block truncate', theme.textTertiary)} title={pageContent.url}>
            {pageContent.url}
          </span>
        </div>
      )}

      {/* Cost readout: last-call / session / lifetime spend. Rendered
          regardless of pageContent availability so the user can always see
          accumulated spend. Dimmed, mono, minimal. */}
      <div
        className={cn(
          'px-3 py-1 text-[10px] font-mono flex gap-3 border-b',
          theme.bgTertiary,
          theme.border,
          theme.textTertiary
        )}
      >
        <span title="This request (¥1 ≈ $1/150)">直近 {formatJpy(lastCallSpend)}</span>
        <span title="Session total (in-memory)">セッション {formatJpy(sessionSpend)}</span>
        <span title="All-time total (persisted)">累計 {formatJpy(lifetimeSpend)}</span>
      </div>

      {/* Messages area */}
      <main className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mb-4">
              <span className="text-2xl text-white">AI</span>
            </div>
            <h2 className={cn('text-lg font-medium mb-2', theme.text)}>Ready to chat!</h2>
            <p className={cn('text-sm max-w-[280px]', theme.textSecondary)}>
              {pageContent
                ? `Ask me anything about "${pageContent.title}"`
                : 'Navigate to a page to include its content in our conversation.'}
            </p>
            <p className={cn('text-xs mt-4', theme.textTertiary)}>Model: {modelName}</p>
          </div>
        ) : (
          <div className={cn('divide-y', effectiveTheme === 'dark' ? 'divide-gray-800' : 'divide-gray-200')}>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                theme={effectiveTheme}
                fontSize={uiSettings.fontSize}
                isEditing={editingMessageId === message.id}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onSubmitEdit={handleSubmitEdit}
              />
            ))}

            {/* Streaming response — real-time bubble with live tool call log */}
            {isLoading && streamingContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  timestamp: 0,
                  toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
                }}
                theme={effectiveTheme}
                fontSize={uiSettings.fontSize}
                runningToolNames={currentToolCalls}
                live={true}
              />
            )}

            {/* Loading indicator — also shows live tool call log when we have
                already completed some tool calls but no streaming text yet. */}
            {isLoading && !streamingContent && (
              <LoadingIndicator
                theme={effectiveTheme}
                runningToolNames={currentToolCalls}
                toolCalls={streamingToolCalls}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className={cn('mx-4 my-2 p-3 rounded-lg flex items-start gap-2', 'bg-red-500/10 border border-red-500/30')}>
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-400 hover:text-red-300 mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Input area */}
      <ChatInput
        onSend={handleSendMessage}
        onStop={handleStop}
        isLoading={isLoading}
        theme={effectiveTheme}
        browserActionMode={browserActionMode}
        onToggleBrowserActionMode={() => setBrowserActionMode((prev) => !prev)}
        userMessageHistory={messages.filter((m) => m.role === 'user').map((m) => m.content)}
      />
    </div>
  )
}
