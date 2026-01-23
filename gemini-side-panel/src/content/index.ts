import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type { PageContent, MessageAction, MessageResponse } from '../types'

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

// Listen for messages from Side Panel or Background
chrome.runtime.onMessage.addListener(
  (
    request: MessageAction,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<PageContent> | { status: string }) => void
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

    return false
  }
)
