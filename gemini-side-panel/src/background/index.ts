import type {
  MessageAction,
  MessageResponse,
  PageContent,
  BrowserActionResult,
  ClickElementAction,
  FillElementAction,
  GetHtmlAction,
  HoverElementAction,
  FocusElementAction,
  BlurElementAction,
  ScrollIntoViewAction,
  RightClickElementAction,
  DoubleClickElementAction,
  SelectTextAction,
  PressKeyAction,
  PressKeyCombinationAction,
  WaitForElementAction,
  ScrollByAction,
  ScrollToBottomAction,
  ScrollToTopAction,
  GetScrollPositionAction,
  ReadPageAction,
  GetTextAction,
  GetAttributeAction,
  FindElementsAction,
  GetAllLinksAction,
  WaitAction,
  NavigateToUrlAction,
  FetchUrlAction,
  RunJsAction,
  ReadPageResult,
  NavigateToUrlResult,
  FetchUrlResult,
  RunJsResult,
} from '../types'
import { nativeInputHandler } from './native-input-handler'

console.log('Gemini Side Panel: Background service worker started')

type BrowserActionMessage =
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

const BROWSER_ACTION_TYPES: ReadonlyArray<BrowserActionMessage['action']> = [
  'CLICK_ELEMENT',
  'FILL_ELEMENT',
  'GET_HTML',
  'HOVER_ELEMENT',
  'FOCUS_ELEMENT',
  'BLUR_ELEMENT',
  'SCROLL_INTO_VIEW',
  'RIGHT_CLICK_ELEMENT',
  'DOUBLE_CLICK_ELEMENT',
  'SELECT_TEXT',
  'PRESS_KEY',
  'PRESS_KEY_COMBINATION',
  'WAIT_FOR_ELEMENT',
  'SCROLL_BY',
  'SCROLL_TO_BOTTOM',
  'SCROLL_TO_TOP',
  'GET_SCROLL_POSITION',
  'READ_PAGE',
  'GET_TEXT',
  'GET_ATTRIBUTE',
  'FIND_ELEMENTS',
  'GET_ALL_LINKS',
  'WAIT',
  'NAVIGATE_TO_URL',
  'FETCH_URL',
  'RUN_JS',
]

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set panel behavior:', error))

chrome.runtime.onInstalled.addListener(() => {
  console.log('Gemini Side Panel: Extension installed')
})

chrome.runtime.onMessage.addListener(
  (
    request: MessageAction & { target?: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<PageContent | BrowserActionResult>) => void
  ) => {
    console.log('Gemini Side Panel Background: Received message', request, 'from', sender)

    if (request.action === 'GET_PAGE_CONTENT') {
      handleGetPageContent(sendResponse as (response: MessageResponse<PageContent>) => void)
      return true
    }

    if ((BROWSER_ACTION_TYPES as string[]).includes(request.action)) {
      handleBrowserAction(
        request as BrowserActionMessage,
        sendResponse as (response: MessageResponse<BrowserActionResult>) => void
      )
      return true
    }

    return false
  }
)

async function handleGetPageContent(
  sendResponse: (response: MessageResponse<PageContent>) => void
): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })

    if (!activeTab?.id) {
      sendResponse({ success: false, error: 'No active tab found' })
      return
    }

    if (
      activeTab.url?.startsWith('chrome://') ||
      activeTab.url?.startsWith('chrome-extension://') ||
      activeTab.url?.startsWith('edge://') ||
      activeTab.url?.startsWith('about:')
    ) {
      sendResponse({
        success: false,
        error: 'Cannot access content on this page (browser internal page)',
      })
      return
    }

    try {
      const response = await chrome.tabs.sendMessage<MessageAction, MessageResponse<PageContent>>(
        activeTab.id,
        { action: 'GET_PAGE_CONTENT' }
      )
      sendResponse(response)
    } catch (error) {
      console.error('Gemini Side Panel Background: Error sending to content script, attempting injection', error)

      try {
        const manifest = chrome.runtime.getManifest()
        const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0]

        if (!contentScriptPath) {
          throw new Error('Content script path not found in manifest')
        }

        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: [contentScriptPath],
        })

        await new Promise((resolve) => setTimeout(resolve, 300))

        let retryResponse: MessageResponse<PageContent> | null = null
        let lastError: unknown = null

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            retryResponse = await chrome.tabs.sendMessage<
              MessageAction,
              MessageResponse<PageContent>
            >(activeTab.id, { action: 'GET_PAGE_CONTENT' })
            if (retryResponse) break
          } catch (retryError) {
            lastError = retryError
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }

        if (retryResponse) {
          sendResponse(retryResponse)
        } else {
          throw lastError || new Error('All retry attempts failed')
        }
      } catch (injectError) {
        const errorMessage = injectError instanceof Error ? injectError.message : String(injectError)
        sendResponse({
          success: false,
          error: `Failed to access page content: ${errorMessage}`,
        })
      }
    }
  } catch (error) {
    console.error('Gemini Side Panel Background: Error in handleGetPageContent', error)
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    })
  }
}

async function fetchPageContentForTab(tabId: number): Promise<PageContent> {
  await ensureContentScript(tabId)
  const response = await chrome.tabs.sendMessage<MessageAction, MessageResponse<PageContent>>(
    tabId,
    { action: 'GET_PAGE_CONTENT' }
  )
  if (!response) throw new Error('No response from content script')
  if (!response.success) throw new Error(response.error)
  return response.data
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'PING' })
  } catch {
    const manifest = chrome.runtime.getManifest()
    const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0]
    if (!contentScriptPath) throw new Error('Content script path not found in manifest')
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptPath],
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

async function sendToContentScript(
  tabId: number,
  action: BrowserActionMessage
): Promise<MessageResponse<BrowserActionResult>> {
  await ensureContentScript(tabId)
  return chrome.tabs.sendMessage<BrowserActionMessage, MessageResponse<BrowserActionResult>>(
    tabId,
    action
  )
}

async function handleBrowserAction(
  action: BrowserActionMessage,
  sendResponse: (response: MessageResponse<BrowserActionResult>) => void
): Promise<void> {
  try {
    if (action.action === 'FETCH_URL') {
      await handleFetchUrl(action, sendResponse)
      return
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!activeTab?.id) {
      sendResponse({ success: false, error: 'No active tab found' })
      return
    }

    if (action.action === 'NAVIGATE_TO_URL') {
      await handleNavigateToUrl(action, activeTab, sendResponse)
      return
    }

    if (
      activeTab.url?.startsWith('chrome://') ||
      activeTab.url?.startsWith('chrome-extension://') ||
      activeTab.url?.startsWith('edge://') ||
      activeTab.url?.startsWith('about:')
    ) {
      sendResponse({
        success: false,
        error: 'Cannot perform actions on browser internal pages',
      })
      return
    }

    const tabId = activeTab.id

    switch (action.action) {
      case 'CLICK_ELEMENT': {
        try {
          await nativeInputHandler.click(tabId, action.selector)
          sendResponse({
            success: true,
            data: { success: true, message: `Clicked element via CDP: ${action.selector}` },
          })
          return
        } catch (err) {
          console.warn('CDP click failed, falling back to content script', err)
          try {
            const res = await sendToContentScript(tabId, action)
            sendResponse(res)
          } catch (fallbackErr) {
            sendResponse({
              success: false,
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            })
          }
        }
        return
      }

      case 'FILL_ELEMENT': {
        try {
          await nativeInputHandler.type(tabId, action.selector, action.value)
          const preview = action.value.slice(0, 50) + (action.value.length > 50 ? '...' : '')
          sendResponse({
            success: true,
            data: { success: true, message: `Filled element via CDP: ${action.selector} = ${preview}` },
          })
          return
        } catch (err) {
          console.warn('CDP fill failed, falling back to content script', err)
          try {
            const res = await sendToContentScript(tabId, action)
            sendResponse(res)
          } catch (fallbackErr) {
            sendResponse({
              success: false,
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            })
          }
        }
        return
      }

      case 'GET_HTML': {
        try {
          const res = await sendToContentScript(tabId, action)
          sendResponse(res)
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }

      case 'HOVER_ELEMENT': {
        await runCdpAction(sendResponse, () => nativeInputHandler.hover(tabId, action.selector), `Hovered: ${action.selector}`)
        return
      }
      case 'FOCUS_ELEMENT': {
        await runCdpAction(sendResponse, () => nativeInputHandler.focus(tabId, action.selector), `Focused: ${action.selector}`)
        return
      }
      case 'BLUR_ELEMENT': {
        await runCdpAction(
          sendResponse,
          () => nativeInputHandler.blur(tabId, action.selector),
          action.selector ? `Blurred: ${action.selector}` : 'Blurred active element'
        )
        return
      }
      case 'SCROLL_INTO_VIEW': {
        await runCdpAction(
          sendResponse,
          () =>
            nativeInputHandler.scroll(tabId, action.selector, {
              behavior: action.behavior,
              block: action.block,
            }),
          `Scrolled to: ${action.selector}`
        )
        return
      }
      case 'RIGHT_CLICK_ELEMENT': {
        await runCdpAction(sendResponse, () => nativeInputHandler.rightClick(tabId, action.selector), `Right-clicked: ${action.selector}`)
        return
      }
      case 'DOUBLE_CLICK_ELEMENT': {
        await runCdpAction(sendResponse, () => nativeInputHandler.doubleClick(tabId, action.selector), `Double-clicked: ${action.selector}`)
        return
      }
      case 'SELECT_TEXT': {
        await runCdpAction(
          sendResponse,
          () => nativeInputHandler.selectText(tabId, action.selector, action.start, action.end),
          `Selected text in: ${action.selector}`
        )
        return
      }
      case 'PRESS_KEY': {
        await runCdpAction(
          sendResponse,
          () => nativeInputHandler.press(tabId, action.key, action.selector),
          action.selector
            ? `Pressed key: ${action.key} on ${action.selector}`
            : `Pressed key: ${action.key}`
        )
        return
      }
      case 'PRESS_KEY_COMBINATION': {
        await runCdpAction(
          sendResponse,
          () => nativeInputHandler.pressKeyCombination(tabId, action.keys),
          `Pressed combination: ${action.keys.join('+')}`
        )
        return
      }
      case 'WAIT_FOR_ELEMENT': {
        try {
          const elapsedMs = await nativeInputHandler.waitForElement(
            tabId,
            action.selector,
            action.timeoutMs ?? 5000
          )
          sendResponse({
            success: true,
            data: {
              success: true,
              message: `Element became visible after ${elapsedMs}ms: ${action.selector}`,
              elapsedMs,
            },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'SCROLL_BY': {
        try {
          const pos = await nativeInputHandler.scrollBy(tabId, action.dx, action.dy)
          sendResponse({
            success: true,
            data: {
              success: true,
              message: `Scrolled by (${action.dx}, ${action.dy})`,
              ...pos,
            },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'SCROLL_TO_BOTTOM': {
        try {
          const info = await nativeInputHandler.scrollToBottom(tabId, action.behavior ?? 'auto')
          sendResponse({
            success: true,
            data: {
              success: true,
              message: `Scrolled to bottom (iterations=${info.iterations}, scrollHeight=${info.scrollHeight})`,
              ...info,
            },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'SCROLL_TO_TOP': {
        try {
          const pos = await nativeInputHandler.scrollToTop(tabId, action.behavior ?? 'auto')
          sendResponse({
            success: true,
            data: { success: true, message: 'Scrolled to top', ...pos },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'GET_SCROLL_POSITION': {
        try {
          const pos = await nativeInputHandler.getScrollPosition(tabId)
          sendResponse({
            success: true,
            data: {
              success: true,
              message: `Position x=${pos.x}, y=${pos.y} (max ${pos.maxX}, ${pos.maxY})`,
              ...pos,
            },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'READ_PAGE': {
        try {
          const page = await fetchPageContentForTab(tabId)
          const MAX = 30_000
          const content = page.content.length > MAX ? page.content.slice(0, MAX) : page.content
          const result: ReadPageResult = {
            success: true,
            title: page.title,
            url: page.url,
            content,
            excerpt: page.excerpt,
          }
          sendResponse({ success: true, data: result })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'GET_TEXT': {
        try {
          const text = await nativeInputHandler.getText(tabId, action.selector)
          sendResponse({ success: true, data: { success: true, text } })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'GET_ATTRIBUTE': {
        try {
          const value = await nativeInputHandler.getAttribute(tabId, action.selector, action.name)
          sendResponse({
            success: true,
            data: { success: true, name: action.name, value },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'FIND_ELEMENTS': {
        try {
          const elements = await nativeInputHandler.findElements(
            tabId,
            action.selector,
            action.limit ?? 20
          )
          sendResponse({
            success: true,
            data: { success: true, count: elements.length, elements },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'GET_ALL_LINKS': {
        try {
          const links = await nativeInputHandler.getAllLinks(tabId, action.filterSelector)
          sendResponse({
            success: true,
            data: { success: true, count: links.length, links },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'WAIT': {
        try {
          const waited = await nativeInputHandler.wait(action.ms)
          sendResponse({
            success: true,
            data: { success: true, message: `Waited ${waited}ms` },
          })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      case 'RUN_JS': {
        try {
          const outcome = await nativeInputHandler.runJs(
            tabId,
            action.code,
            action.timeout_ms ?? 10_000
          )
          const result: RunJsResult = {
            success: outcome.success,
            value: outcome.value,
            valuePreview: outcome.valuePreview,
            valueByteSize: outcome.valueByteSize,
            type: outcome.type,
            truncated: outcome.truncated,
            error: outcome.error,
            durationMs: outcome.durationMs,
          }
          sendResponse({ success: true, data: result })
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return
      }
      default: {
        const never: never = action
        void never
        sendResponse({ success: false, error: 'Unknown browser action' })
      }
    }
  } catch (error) {
    console.error('Gemini Side Panel Background: Error in handleBrowserAction', error)
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    })
  }
}

const FETCH_URL_MAX_BODY_CHARS = 102_400
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const
const PASSTHROUGH_HEADERS = new Set(['content-type', 'content-length', 'location'])

async function handleNavigateToUrl(
  action: NavigateToUrlAction,
  activeTab: chrome.tabs.Tab,
  sendResponse: (response: MessageResponse<BrowserActionResult>) => void
): Promise<void> {
  const tabId = activeTab.id
  if (!tabId) {
    sendResponse({ success: false, error: 'No active tab found' })
    return
  }

  const sameOriginOnly = action.sameOriginOnly !== false
  const waitForLoad = action.waitForLoad !== false
  const currentUrl = activeTab.url ?? ''

  let targetUrl: string
  try {
    targetUrl = currentUrl ? new URL(action.url, currentUrl).toString() : new URL(action.url).toString()
  } catch (err) {
    sendResponse({
      success: false,
      error: `Invalid URL: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  if (sameOriginOnly) {
    try {
      const currentOrigin = new URL(currentUrl).origin
      const targetOrigin = new URL(targetUrl).origin
      if (currentOrigin !== targetOrigin) {
        const result: NavigateToUrlResult = {
          success: false,
          error: `Cross-origin navigation blocked (current=${currentOrigin}, target=${targetOrigin}). Set same_origin_only=false to override.`,
        }
        sendResponse({ success: true, data: result })
        return
      }
    } catch (err) {
      sendResponse({
        success: false,
        error: `Failed to parse origin for same-origin check: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }
  }

  try {
    const loadPromise = waitForLoad ? waitForTabLoad(tabId, 5000) : Promise.resolve()
    await chrome.tabs.update(tabId, { url: targetUrl })
    if (waitForLoad) {
      await loadPromise
    }
  } catch (err) {
    sendResponse({
      success: false,
      error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  let page: PageContent | null = null
  try {
    page = await fetchPageContentForTab(tabId)
  } catch (err) {
    console.warn('navigate_to_url: fetchPageContentForTab failed', err)
  }

  const MAX = 30_000
  const result: NavigateToUrlResult = {
    success: true,
    url: page?.url ?? targetUrl,
    title: page?.title,
    content: page ? (page.content.length > MAX ? page.content.slice(0, MAX) : page.content) : undefined,
    excerpt: page?.excerpt,
  }
  sendResponse({ success: true, data: result })
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish()
      }
    }
    const timer = setTimeout(finish, timeoutMs)
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function handleFetchUrl(
  action: FetchUrlAction,
  sendResponse: (response: MessageResponse<BrowserActionResult>) => void
): Promise<void> {
  const methodRaw = (action.method ?? 'GET').toUpperCase()
  const method = (ALLOWED_METHODS as readonly string[]).includes(methodRaw) ? methodRaw : 'GET'

  const init: RequestInit = { method }
  if (action.headers && Object.keys(action.headers).length > 0) {
    init.headers = action.headers
  }
  if (method !== 'GET' && method !== 'HEAD' && typeof action.body === 'string') {
    init.body = action.body
  }

  try {
    const response = await fetch(action.url, init)
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (PASSTHROUGH_HEADERS.has(lower) || lower.startsWith('x-')) {
        headers[key] = value
      }
    })
    const contentType = response.headers.get('content-type') ?? ''
    const lowerType = contentType.toLowerCase()

    const result: FetchUrlResult = {
      success: true,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url,
      headers,
      contentType: contentType || undefined,
    }

    const isJson = lowerType.includes('application/json') || lowerType.includes('+json')
    const isText =
      lowerType.startsWith('text/') ||
      lowerType.includes('javascript') ||
      lowerType.includes('xml') ||
      contentType === ''
    const isHead = method === 'HEAD'

    if (isHead) {
      result.body = ''
      result.byteLength = 0
    } else if (isJson) {
      const raw = await response.text()
      result.byteLength = raw.length
      let parsed: unknown = undefined
      try {
        parsed = JSON.parse(raw)
        result.bodyJson = parsed
        const pretty = JSON.stringify(parsed, null, 2)
        if (pretty.length > FETCH_URL_MAX_BODY_CHARS) {
          result.body = pretty.slice(0, FETCH_URL_MAX_BODY_CHARS)
          result.truncated = true
        } else {
          result.body = pretty
        }
      } catch {
        if (raw.length > FETCH_URL_MAX_BODY_CHARS) {
          result.body = raw.slice(0, FETCH_URL_MAX_BODY_CHARS)
          result.truncated = true
        } else {
          result.body = raw
        }
      }
    } else if (isText) {
      const raw = await response.text()
      result.byteLength = raw.length
      if (raw.length > FETCH_URL_MAX_BODY_CHARS) {
        result.body = raw.slice(0, FETCH_URL_MAX_BODY_CHARS)
        result.truncated = true
      } else {
        result.body = raw
      }
    } else {
      const buf = await response.arrayBuffer()
      result.byteLength = buf.byteLength
      result.body = `<binary content ${buf.byteLength} bytes>`
    }

    sendResponse({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendResponse({
      success: true,
      data: { success: false, error: `Network error: ${message}` } satisfies FetchUrlResult,
    })
  }
}

async function runCdpAction(
  sendResponse: (response: MessageResponse<BrowserActionResult>) => void,
  execute: () => Promise<void>,
  successMessage: string
): Promise<void> {
  try {
    await execute()
    sendResponse({ success: true, data: { success: true, message: successMessage } })
  } catch (err) {
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
