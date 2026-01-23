import type {
  MessageAction,
  MessageResponse,
  PageContent,
  BrowserActionResult,
  ClickElementAction,
  FillElementAction,
  GetHtmlAction,
} from '../types'

console.log('Gemini Side Panel: Background service worker started')

// Helper to open side panel on action click (works in Chrome 116+)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set panel behavior:', error))

chrome.runtime.onInstalled.addListener(() => {
  console.log('Gemini Side Panel: Extension installed')
})

// Message relay between Side Panel and Content Script
chrome.runtime.onMessage.addListener(
  (
    request: MessageAction & { target?: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<PageContent | BrowserActionResult>) => void
  ) => {
    console.log('Gemini Side Panel Background: Received message', request, 'from', sender)

    // Handle GET_PAGE_CONTENT - relay to active tab's content script
    if (request.action === 'GET_PAGE_CONTENT') {
      handleGetPageContent(sendResponse as (response: MessageResponse<PageContent>) => void)
      return true // Keep message channel open for async response
    }

    // Handle browser actions - relay to active tab's content script
    if (
      request.action === 'CLICK_ELEMENT' ||
      request.action === 'FILL_ELEMENT' ||
      request.action === 'GET_HTML'
    ) {
      handleBrowserAction(
        request as ClickElementAction | FillElementAction | GetHtmlAction,
        sendResponse as (response: MessageResponse<BrowserActionResult>) => void
      )
      return true // Keep message channel open for async response
    }

    return false
  }
)

/**
 * Get page content from the active tab's content script
 */
async function handleGetPageContent(
  sendResponse: (response: MessageResponse<PageContent>) => void
): Promise<void> {
  try {
    // Get the active tab
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })

    if (!activeTab?.id) {
      sendResponse({
        success: false,
        error: 'No active tab found',
      })
      return
    }

    // Check if we can inject into this tab (not chrome:// or chrome-extension:// pages)
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

    // Try to send message to content script
    try {
      const response = await chrome.tabs.sendMessage<MessageAction, MessageResponse<PageContent>>(
        activeTab.id,
        { action: 'GET_PAGE_CONTENT' }
      )

      console.log('Gemini Side Panel Background: Got response from content script', response)
      sendResponse(response)
    } catch (error) {
      console.error('Gemini Side Panel Background: Error sending to content script, attempting injection', error)

      // Content script not loaded - try to inject it dynamically
      try {
        // Get the content script path from manifest (handles hashed filenames)
        const manifest = chrome.runtime.getManifest()
        const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0]

        if (!contentScriptPath) {
          throw new Error('Content script path not found in manifest')
        }

        console.log('Gemini Side Panel Background: Injecting content script:', contentScriptPath)

        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: [contentScriptPath],
        })

        // Wait longer for the script to initialize (300ms instead of 100ms)
        await new Promise((resolve) => setTimeout(resolve, 300))

        // Retry with multiple attempts
        let retryResponse: MessageResponse<PageContent> | null = null
        let lastError: unknown = null

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            console.log(`Gemini Side Panel Background: Retry attempt ${attempt + 1}`)
            retryResponse = await chrome.tabs.sendMessage<
              MessageAction,
              MessageResponse<PageContent>
            >(activeTab.id, { action: 'GET_PAGE_CONTENT' })

            if (retryResponse) {
              console.log('Gemini Side Panel Background: Got response after injection', retryResponse)
              break
            }
          } catch (retryError) {
            lastError = retryError
            console.log(`Gemini Side Panel Background: Retry ${attempt + 1} failed:`, retryError)
            // Wait before next retry
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }

        if (retryResponse) {
          sendResponse(retryResponse)
        } else {
          throw lastError || new Error('All retry attempts failed')
        }
      } catch (injectError) {
        console.error('Gemini Side Panel Background: Failed to inject content script', injectError)
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

/**
 * Handle browser actions (click, fill, get_html) by relaying to content script
 */
async function handleBrowserAction(
  action: ClickElementAction | FillElementAction | GetHtmlAction,
  sendResponse: (response: MessageResponse<BrowserActionResult>) => void
): Promise<void> {
  try {
    // Get the active tab
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })

    if (!activeTab?.id) {
      sendResponse({
        success: false,
        error: 'No active tab found',
      })
      return
    }

    // Check if we can inject into this tab
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

    // Try to send message to content script
    try {
      const response = await chrome.tabs.sendMessage<
        ClickElementAction | FillElementAction | GetHtmlAction,
        MessageResponse<BrowserActionResult>
      >(activeTab.id, action)

      console.log('Gemini Side Panel Background: Browser action response', response)
      sendResponse(response)
    } catch (error) {
      console.error('Gemini Side Panel Background: Error sending browser action, attempting injection', error)

      // Content script not loaded - try to inject it dynamically
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

        // Wait for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 300))

        // Retry sending the action
        const retryResponse = await chrome.tabs.sendMessage<
          ClickElementAction | FillElementAction | GetHtmlAction,
          MessageResponse<BrowserActionResult>
        >(activeTab.id, action)

        sendResponse(retryResponse)
      } catch (injectError) {
        console.error('Gemini Side Panel Background: Failed to inject for browser action', injectError)
        sendResponse({
          success: false,
          error: `Failed to execute action: ${injectError instanceof Error ? injectError.message : String(injectError)}`,
        })
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
