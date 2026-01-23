import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type {
  PageContent,
  MessageAction,
  MessageResponse,
  ClickElementResult,
  FillElementResult,
  GetHtmlResult,
} from '../types'

console.log('Gemini Side Panel: Content script loaded')

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// Configure Turndown rules
turndownService.addRule('removeScripts', {
  filter: ['script', 'style', 'noscript', 'iframe'],
  replacement: () => '',
})

/**
 * Extract main content from the current page using Readability
 */
function extractPageContent(): PageContent {
  const title = document.title || 'Untitled'
  const url = window.location.href

  try {
    // Clone the document to avoid modifying the original
    const documentClone = document.cloneNode(true) as Document

    // Use Readability to extract main content
    const reader = new Readability(documentClone, {
      charThreshold: 100,
    })
    const article = reader.parse()

    if (article && article.content) {
      // Convert HTML content to Markdown
      const markdown = turndownService.turndown(article.content)

      return {
        title: article.title || title,
        url,
        content: markdown,
        excerpt: article.excerpt || undefined,
      }
    }

    // Fallback: extract text from body if Readability fails
    const bodyText = document.body?.innerText || ''
    const truncatedText = bodyText.slice(0, 10000) // Limit content size

    return {
      title,
      url,
      content: truncatedText,
    }
  } catch (error) {
    console.error('Gemini Side Panel: Error extracting content', error)

    // Return minimal content on error
    return {
      title,
      url,
      content: `Failed to extract content from this page. URL: ${url}`,
    }
  }
}

/**
 * Click an element matching the given CSS selector
 */
function clickElement(selector: string): ClickElementResult {
  try {
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector}`,
      }
    }

    // Check if element is visible
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return {
        success: false,
        message: `Element is not visible: ${selector}`,
      }
    }

    // Scroll element into view if needed
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Simulate click
    element.click()

    return {
      success: true,
      message: `Clicked element: ${selector}`,
    }
  } catch (error) {
    return {
      success: false,
      message: `Error clicking element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Fill an input element with the given value
 */
function fillElement(selector: string, value: string): FillElementResult {
  try {
    const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null
    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector}`,
      }
    }

    // Check if it's an input or textarea
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      return {
        success: false,
        message: `Element is not an input or textarea: ${selector}`,
      }
    }

    // Focus and fill
    element.focus()
    element.value = value

    // Dispatch input and change events to trigger any listeners
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))

    return {
      success: true,
      message: `Filled element "${selector}" with value: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}`,
    }
  } catch (error) {
    return {
      success: false,
      message: `Error filling element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get HTML content of an element (or entire body if no selector)
 */
function getHtml(selector?: string): GetHtmlResult {
  try {
    if (selector) {
      const element = document.querySelector(selector)
      if (!element) {
        return {
          success: false,
          error: `Element not found: ${selector}`,
        }
      }
      return {
        success: true,
        html: element.outerHTML,
      }
    }

    // Return body HTML (limited to prevent token overflow)
    const bodyHtml = document.body?.outerHTML || ''
    const maxLength = 50000 // Limit to ~50KB
    return {
      success: true,
      html: bodyHtml.length > maxLength ? bodyHtml.slice(0, maxLength) + '...(truncated)' : bodyHtml,
    }
  } catch (error) {
    return {
      success: false,
      error: `Error getting HTML: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// Listen for messages from Side Panel or Background
chrome.runtime.onMessage.addListener(
  (
    request: MessageAction,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<PageContent | ClickElementResult | FillElementResult | GetHtmlResult> | { status: string }) => void
  ) => {
    console.log('Gemini Side Panel: Received message', request)

    if (request.action === 'GET_PAGE_CONTENT') {
      try {
        const content = extractPageContent()
        console.log('Gemini Side Panel: Content extracted', {
          title: content.title,
          contentLength: content.content.length,
        })
        sendResponse({ success: true, data: content })
      } catch (error) {
        console.error('Gemini Side Panel: Error in GET_PAGE_CONTENT', error)
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return true // Keep message channel open for async response
    }

    if (request.action === 'PING') {
      sendResponse({ status: 'PONG' })
      return true
    }

    if (request.action === 'CLICK_ELEMENT') {
      const result = clickElement(request.selector)
      console.log('Gemini Side Panel: CLICK_ELEMENT result', result)
      if (result.success) {
        sendResponse({ success: true, data: result })
      } else {
        sendResponse({ success: false, error: result.message })
      }
      return true
    }

    if (request.action === 'FILL_ELEMENT') {
      const result = fillElement(request.selector, request.value)
      console.log('Gemini Side Panel: FILL_ELEMENT result', result)
      if (result.success) {
        sendResponse({ success: true, data: result })
      } else {
        sendResponse({ success: false, error: result.message })
      }
      return true
    }

    if (request.action === 'GET_HTML') {
      const result = getHtml(request.selector)
      console.log('Gemini Side Panel: GET_HTML result', {
        success: result.success,
        htmlLength: result.html?.length,
      })
      if (result.success) {
        sendResponse({ success: true, data: result })
      } else {
        sendResponse({ success: false, error: result.error || 'Unknown error' })
      }
      return true
    }

    return false
  }
)
