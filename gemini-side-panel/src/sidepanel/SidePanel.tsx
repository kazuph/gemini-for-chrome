import { useState, useEffect, useRef, useCallback } from 'react'
import { Settings, AlertCircle, Plus, Minus, Sun, Moon, Monitor, PlusCircle } from 'lucide-react'
import type { FunctionCall } from '@google/generative-ai'
import type { Message, PageContent, MessageResponse, UISettings, ThemeMode, BrowserActionResult } from '../types'
import { DEFAULT_UI_SETTINGS } from '../types'
import { GeminiChat, loadGeminiConfig, type FunctionCallResult } from '../lib/gemini'
import { generateId, cn, loadUISettings, saveUISettings, getEffectiveTheme } from '../lib/utils'
import { MessageBubble, ChatInput, LoadingIndicator } from '../components'

const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 26
const FONT_STEP = 4

export default function SidePanel() {
  // API configuration state
  const [apiKey, setApiKey] = useState<string>('')
  const [modelName, setModelName] = useState<string>('gemini-2.0-flash')
  const [hasKey, setHasKey] = useState<boolean>(false)
  const [showConfig, setShowConfig] = useState<boolean>(false)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState<string>('')

  // Page content state
  const [pageContent, setPageContent] = useState<PageContent | null>(null)

  // UI Settings state
  const [uiSettings, setUISettings] = useState<UISettings>(DEFAULT_UI_SETTINGS)
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark')

  // Browser action mode (off by default for safety)
  const [browserActionMode, setBrowserActionMode] = useState<boolean>(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const geminiChatRef = useRef<GeminiChat | null>(null)

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

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

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

  // Load API config and UI settings on mount
  useEffect(() => {
    loadGeminiConfig().then((config) => {
      if (config) {
        setApiKey(config.apiKey)
        setModelName(config.modelName)
        setHasKey(true)
        geminiChatRef.current = new GeminiChat(config)
      }
    })

    loadUISettings().then(setUISettings)
  }, [])

  // Fetch page content when panel opens and listen for tab changes
  useEffect(() => {
    if (hasKey && !showConfig) {
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
   * Cycle through theme modes
   */
  const cycleThemeMode = () => {
    const modes: ThemeMode[] = ['system', 'light', 'dark']
    const currentIndex = modes.indexOf(uiSettings.themeMode)
    const nextIndex = (currentIndex + 1) % modes.length
    updateUISettings({ themeMode: modes[nextIndex] })
  }

  /**
   * Execute browser actions from function calls
   */
  const executeBrowserAction = useCallback(
    async (functionCall: FunctionCall): Promise<FunctionCallResult> => {
      const browserAction = GeminiChat.functionCallToBrowserAction(functionCall)

      if (!browserAction) {
        return {
          name: functionCall.name,
          response: { success: false, error: `Unknown function: ${functionCall.name}` },
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
        return {
          name: functionCall.name,
          response: response.success ? response.data : { success: false, error: response.error },
        }
      } catch (err) {
        console.error(`Error executing ${functionCall.name}:`, err)
        return {
          name: functionCall.name,
          response: { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
        }
      }
    },
    []
  )

  /**
   * Send a message to Gemini
   * Always fetches fresh page content when includePageContent is true
   * Supports Function Calling for browser actions
   */
  const handleSendMessage = useCallback(
    async (content: string, includePageContent: boolean) => {
      if (!geminiChatRef.current) {
        setError('Gemini API not configured. Please add your API key.')
        return
      }

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)
      setError(null)
      setStreamingContent('')

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

      // Handler for function calls
      const handleFunctionCalls = async (
        functionCalls: FunctionCall[],
        currentMessages: Message[],
        pageCtx: PageContent | undefined
      ) => {
        // Show what actions are being executed
        const actionNames = functionCalls.map((fc) => fc.name).join(', ')
        setStreamingContent((prev) => prev + `\n\n*Executing: ${actionNames}...*\n`)

        // Execute all function calls
        const results: FunctionCallResult[] = await Promise.all(
          functionCalls.map((fc) => executeBrowserAction(fc))
        )

        // Show results
        const resultSummary = results
          .map((r) => {
            const res = r.response as { success: boolean; message?: string; error?: string }
            return `- ${r.name}: ${res.success ? res.message || 'Success' : res.error || 'Failed'}`
          })
          .join('\n')
        setStreamingContent((prev) => prev + `\n${resultSummary}\n\n`)

        // Send results back to Gemini for continuation
        await geminiChatRef.current!.sendFunctionResults(
          currentMessages,
          pageCtx,
          functionCalls,
          results,
          // onChunk
          (chunk) => {
            setStreamingContent((prev) => prev + chunk)
          },
          // onComplete
          (fullText) => {
            const assistantMessage: Message = {
              id: generateId(),
              role: 'assistant',
              content: fullText,
              timestamp: Date.now(),
            }
            setMessages((prev) => [...prev, assistantMessage])
            setStreamingContent('')
            setIsLoading(false)
          },
          // onFunctionCall - recursive handling for chained function calls
          async (newFunctionCalls) => {
            await handleFunctionCalls(newFunctionCalls, currentMessages, pageCtx)
          },
          // onError
          (error) => {
            setError(error.message || 'An error occurred while processing function results')
            setStreamingContent('')
            setIsLoading(false)
          }
        )
      }

      try {
        if (browserActionMode) {
          // Use sendMessageWithTools to support function calling (browser actions)
          await geminiChatRef.current.sendMessageWithTools(
            content,
            messages,
            currentPageContent,
            // onChunk
            (chunk) => {
              setStreamingContent((prev) => prev + chunk)
            },
            // onComplete
            (fullText) => {
              const assistantMessage: Message = {
                id: generateId(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
              }
              setMessages((prev) => [...prev, assistantMessage])
              setStreamingContent('')
              setIsLoading(false)
            },
            // onFunctionCall
            async (functionCalls) => {
              await handleFunctionCalls(functionCalls, messages, currentPageContent)
            },
            // onError
            (error) => {
              setError(error.message || 'An error occurred while generating a response')
              setStreamingContent('')
              setIsLoading(false)
            }
          )
        } else {
          // Use regular sendMessageStream (no browser actions)
          await geminiChatRef.current.sendMessageStream(
            content,
            messages,
            currentPageContent,
            // onChunk
            (chunk) => {
              setStreamingContent((prev) => prev + chunk)
            },
            // onComplete
            (fullText) => {
              const assistantMessage: Message = {
                id: generateId(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
              }
              setMessages((prev) => [...prev, assistantMessage])
              setStreamingContent('')
              setIsLoading(false)
            },
            // onError
            (error) => {
              setError(error.message || 'An error occurred while generating a response')
              setStreamingContent('')
              setIsLoading(false)
            }
          )
        }
      } catch (err) {
        console.error('Chat error:', err)
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setStreamingContent('')
        setIsLoading(false)
      }
    },
    [messages, executeBrowserAction, browserActionMode]
  )

  /**
   * Clear chat history
   */
  const handleClearChat = () => {
    setMessages([])
    setError(null)
    setStreamingContent('')
  }

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
                <label className={cn('block text-xs mb-1.5', theme.textSecondary)}>Model Name</label>
                <input
                  type="text"
                  className={cn(
                    'w-full p-3 rounded-lg border outline-none transition-colors',
                    'focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
                    theme.input,
                    theme.text
                  )}
                  placeholder="gemini-2.0-flash"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
                <p className={cn('mt-1.5 text-xs', theme.textTertiary)}>
                  Examples: gemini-2.0-flash, gemini-2.5-flash
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
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-blue-500">Gemini</h1>
        </div>

        <div className="flex items-center gap-1">
          {/* Font size controls */}
          <button
            onClick={() => changeFontSize(-FONT_STEP)}
            disabled={uiSettings.fontSize <= MIN_FONT_SIZE}
            className={cn(
              'p-2 rounded-lg transition-colors',
              theme.textSecondary,
              theme.hover,
              'disabled:opacity-30 disabled:cursor-not-allowed'
            )}
            title="Decrease font size"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className={cn('text-xs w-8 text-center', theme.textTertiary)}>
            {uiSettings.fontSize}
          </span>
          <button
            onClick={() => changeFontSize(FONT_STEP)}
            disabled={uiSettings.fontSize >= MAX_FONT_SIZE}
            className={cn(
              'p-2 rounded-lg transition-colors',
              theme.textSecondary,
              theme.hover,
              'disabled:opacity-30 disabled:cursor-not-allowed'
            )}
            title="Increase font size"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Theme toggle */}
          <button
            onClick={cycleThemeMode}
            className={cn('p-2 rounded-lg transition-colors', theme.textSecondary, theme.hover)}
            title={`Theme: ${uiSettings.themeMode}`}
          >
            {uiSettings.themeMode === 'system' ? (
              <Monitor className="w-4 h-4" />
            ) : uiSettings.themeMode === 'light' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

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
            <PlusCircle className="w-4 h-4" />
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
              <MessageBubble key={message.id} message={message} theme={effectiveTheme} fontSize={uiSettings.fontSize} />
            ))}

            {/* Streaming response */}
            {isLoading && streamingContent && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  timestamp: Date.now(),
                }}
                theme={effectiveTheme}
                fontSize={uiSettings.fontSize}
              />
            )}

            {/* Loading indicator */}
            {isLoading && !streamingContent && <LoadingIndicator theme={effectiveTheme} />}

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
        isLoading={isLoading}
        theme={effectiveTheme}
        browserActionMode={browserActionMode}
        onToggleBrowserAction={() => setBrowserActionMode(!browserActionMode)}
      />
    </div>
  )
}
