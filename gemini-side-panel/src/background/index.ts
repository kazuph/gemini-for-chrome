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
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

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
        await runCdpAction(sendResponse, () => nativeInputHandler.press(tabId, action.key), `Pressed key: ${action.key}`)
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
