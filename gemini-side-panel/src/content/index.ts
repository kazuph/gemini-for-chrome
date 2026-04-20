import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type {
  PageContent,
  MessageAction,
  MessageResponse,
  ClickElementResult,
  FillElementResult,
  GetHtmlResult,
  GenericActionResult,
  ScrollPositionResult,
  ScrollToBottomResult,
  GetTextResult,
  GetAttributeResult,
  FindElementsResult,
  FoundElementInfo,
  GetAllLinksResult,
  LinkInfo,
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
 * Try to extract GitHub README content specifically
 */
function extractGitHubReadme(): string | null {
  // GitHub README selectors (try multiple)
  const selectors = [
    'article.markdown-body',           // Main README content
    '[data-target="readme-toc.content"]', // README with TOC
    '#readme article',                  // README section
    '.Box-body article',                // Boxed article
    '.repository-content .markdown-body', // Repository content
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element && element.innerHTML.trim().length > 100) {
      console.log('Gemini Side Panel: Found GitHub README with selector:', selector)
      return turndownService.turndown(element.innerHTML)
    }
  }

  return null
}

/**
 * Safely clone document for Readability (handles Custom Elements issue)
 */
function safeCloneDocument(): Document | null {
  try {
    // Try standard cloneNode first
    return document.cloneNode(true) as Document
  } catch {
    console.log('Gemini Side Panel: Standard clone failed, trying alternative method')
  }

  try {
    // Alternative: Create a new document and copy innerHTML
    const parser = new DOMParser()
    const doctype = document.doctype
      ? `<!DOCTYPE ${document.doctype.name}>`
      : '<!DOCTYPE html>'
    const html = doctype + document.documentElement.outerHTML
    return parser.parseFromString(html, 'text/html')
  } catch (e) {
    console.error('Gemini Side Panel: Alternative clone also failed', e)
    return null
  }
}

/**
 * Extract main content from the current page using Readability
 */
function extractPageContent(): PageContent {
  const title = document.title || 'Untitled'
  const url = window.location.href

  try {
    // Special handling for GitHub (do this BEFORE Readability to avoid clone issues)
    if (url.includes('github.com')) {
      const readmeContent = extractGitHubReadme()
      if (readmeContent) {
        console.log('Gemini Side Panel: Successfully extracted GitHub README')
        return {
          title,
          url,
          content: readmeContent,
        }
      }
      console.log('Gemini Side Panel: GitHub README not found, trying fallback')
    }

    // Try to clone the document safely
    const documentClone = safeCloneDocument()

    if (documentClone) {
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
    }

    // Fallback: extract text from body if Readability fails or clone failed
    console.log('Gemini Side Panel: Using innerText fallback')
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
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector}`,
      }
    }

    // Focus the element first
    element.focus()

    // Handle contenteditable elements (like X.com's tweet input)
    if (element.getAttribute('contenteditable') === 'true') {
      // Clear existing content first using Selection API
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(range)

      // Use execCommand to simulate human typing (works better with React)
      // This triggers proper input events that React can detect
      document.execCommand('delete', false)
      document.execCommand('insertText', false, value)

      // Also dispatch events for frameworks that need them
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }))

      return {
        success: true,
        message: `Filled contenteditable element "${selector}" with value: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}`,
      }
    }

    // Check if it's an input or textarea
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      return {
        success: false,
        message: `Element is not an input, textarea, or contenteditable: ${selector}`,
      }
    }

    // Fill input/textarea
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
 * Hover (fallback): dispatch mouseover/mouseenter/mousemove events.
 * Note: these are isTrusted:false and may be ignored by bot-resistant sites.
 */
function hoverElement(selector: string): GenericActionResult {
  try {
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) return { success: false, message: `Element not found: ${selector}` }
    const rect = element.getBoundingClientRect()
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    }
    element.dispatchEvent(new MouseEvent('mouseover', opts))
    element.dispatchEvent(new MouseEvent('mouseenter', opts))
    element.dispatchEvent(new MouseEvent('mousemove', opts))
    return { success: true, message: `Hovered element (fallback): ${selector}` }
  } catch (error) {
    return {
      success: false,
      message: `Error hovering element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function focusElement(selector: string): GenericActionResult {
  try {
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) return { success: false, message: `Element not found: ${selector}` }
    if (typeof element.focus !== 'function') {
      return { success: false, message: `Element is not focusable: ${selector}` }
    }
    element.focus()
    element.scrollIntoView({ block: 'nearest' })
    return { success: true, message: `Focused element (fallback): ${selector}` }
  } catch (error) {
    return {
      success: false,
      message: `Error focusing element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function blurElement(selector?: string): GenericActionResult {
  try {
    const element = selector
      ? (document.querySelector(selector) as HTMLElement | null)
      : (document.activeElement as HTMLElement | null)
    if (!element) {
      return {
        success: false,
        message: selector ? `Element not found: ${selector}` : 'No active element to blur',
      }
    }
    if (typeof element.blur !== 'function') {
      return { success: false, message: `Element cannot blur: ${selector ?? 'activeElement'}` }
    }
    element.blur()
    return {
      success: true,
      message: `Blurred (fallback): ${selector ?? 'activeElement'}`,
    }
  } catch (error) {
    return {
      success: false,
      message: `Error blurring element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function scrollIntoView(
  selector: string,
  behavior?: 'auto' | 'smooth',
  block?: 'start' | 'center' | 'end' | 'nearest'
): GenericActionResult {
  try {
    const element = document.querySelector(selector) as HTMLElement | null
    if (!element) return { success: false, message: `Element not found: ${selector}` }
    element.scrollIntoView({ behavior: behavior ?? 'auto', block: block ?? 'nearest' })
    return { success: true, message: `Scrolled (fallback): ${selector}` }
  } catch (error) {
    return {
      success: false,
      message: `Error scrolling element: ${error instanceof Error ? error.message : String(error)}`,
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

function isVisibleElement(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function scrollByFallback(dx: number, dy: number): ScrollPositionResult {
  try {
    window.scrollBy(dx, dy)
    return {
      success: true,
      message: `Scrolled by (${dx}, ${dy}) [fallback]`,
      x: window.scrollX,
      y: window.scrollY,
      maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function scrollToBottomFallback(behavior: 'auto' | 'smooth' = 'auto'): ScrollToBottomResult {
  try {
    let lastHeight = -1
    let iterations = 0
    for (let i = 0; i < 3; i++) {
      iterations = i + 1
      const height = document.body.scrollHeight
      window.scrollTo({ top: height, left: 0, behavior })
      if (height === lastHeight) break
      lastHeight = height
    }
    return {
      success: true,
      message: `Scrolled to bottom [fallback, iterations=${iterations}]`,
      x: window.scrollX,
      y: window.scrollY,
      maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      scrollHeight: document.body.scrollHeight,
      iterations,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function scrollToTopFallback(behavior: 'auto' | 'smooth' = 'auto'): ScrollPositionResult {
  try {
    window.scrollTo({ top: 0, left: 0, behavior })
    return {
      success: true,
      message: 'Scrolled to top [fallback]',
      x: window.scrollX,
      y: window.scrollY,
      maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function getScrollPositionFallback(): ScrollPositionResult {
  try {
    return {
      success: true,
      message: 'Scroll position read [fallback]',
      x: window.scrollX,
      y: window.scrollY,
      maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function getTextFallback(selector: string): GetTextResult {
  try {
    const nodes = document.querySelectorAll(selector)
    for (const el of nodes) {
      if (isVisibleElement(el)) {
        const text = (el.textContent || '').trim()
        return { success: true, text: text.slice(0, 5000) }
      }
    }
    return {
      success: false,
      error: `No visible element found for selector: ${selector} (matched ${nodes.length})`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function getAttributeFallback(selector: string, name: string): GetAttributeResult {
  try {
    const nodes = document.querySelectorAll(selector)
    for (const el of nodes) {
      if (isVisibleElement(el)) {
        return { success: true, name, value: el.getAttribute(name) }
      }
    }
    return {
      success: false,
      error: `No visible element found for selector: ${selector} (matched ${nodes.length})`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function findElementsFallback(selector: string, limit: number): FindElementsResult {
  try {
    const cappedLimit = Math.max(1, Math.min(limit, 200))
    const nodes = Array.from(document.querySelectorAll(selector)).slice(0, cappedLimit)
    const elements: FoundElementInfo[] = nodes.map((el, index) => {
      const r = el.getBoundingClientRect()
      const info: FoundElementInfo = {
        index,
        text: (el.textContent || '').trim().slice(0, 200),
        visible: isVisibleElement(el),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        tagName: el.tagName.toLowerCase(),
      }
      const href = el.getAttribute('href')
      if (href) info.href = href
      const aria = el.getAttribute('aria-label')
      if (aria) info.ariaLabel = aria
      return info
    })
    return { success: true, count: elements.length, elements }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function getAllLinksFallback(filterSelector?: string): GetAllLinksResult {
  try {
    const sel = filterSelector ?? 'a'
    const nodes = Array.from(document.querySelectorAll(sel))
    const links: LinkInfo[] = []
    for (const el of nodes) {
      if (!isVisibleElement(el)) continue
      const rawHref = el.getAttribute('href') ?? (el instanceof HTMLAnchorElement ? el.href : '')
      const href = rawHref?.toString() ?? ''
      if (!href) continue
      const link: LinkInfo = {
        text: (el.textContent || '').trim().slice(0, 200),
        href,
      }
      const title = el.getAttribute('title')
      if (title) link.title = title
      const aria = el.getAttribute('aria-label')
      if (aria) link.ariaLabel = aria
      links.push(link)
      if (links.length >= 50) break
    }
    return { success: true, count: links.length, links }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function waitFallback(ms: number): Promise<GenericActionResult> {
  const capped = Math.max(0, Math.min(ms, 10_000))
  return new Promise((resolve) => {
    setTimeout(() => resolve({ success: true, message: `Waited ${capped}ms [fallback]` }), capped)
  })
}

// Test bridge for E2E testing (allows Playwright to trigger content script functions)
// This listens for window.postMessage and executes the corresponding action
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return

    const { type, action, selector, value, testId } = event.data || {}

    // Only respond to our test messages
    if (type !== 'GEMINI_TEST_BRIDGE') return

    console.log('Gemini Test Bridge: Received', { action, selector, value, testId })

    let result: { success: boolean; message?: string; error?: string; html?: string }

    switch (action) {
      case 'CLICK_ELEMENT':
        result = clickElement(selector)
        break
      case 'FILL_ELEMENT':
        result = fillElement(selector, value)
        break
      case 'GET_HTML':
        result = getHtml(selector)
        break
      default:
        result = { success: false, error: `Unknown action: ${action}` }
    }

    // Send result back
    window.postMessage(
      { type: 'GEMINI_TEST_BRIDGE_RESULT', testId, result },
      '*'
    )
  })
  console.log('Gemini Side Panel: Test bridge initialized')
}

/**
 * Show fullscreen Mermaid diagram overlay with Figma-like pan/zoom controls
 */
function showMermaidOverlay(svgContent: string): void {
  // Remove existing overlay if any
  const existingOverlay = document.getElementById('gemini-mermaid-overlay')
  if (existingOverlay) {
    existingOverlay.remove()
  }

  // State for pan and zoom
  let zoom = 1
  let panX = 0
  let panY = 0
  let isDragging = false
  let lastMouseX = 0
  let lastMouseY = 0

  // Create overlay container
  const overlay = document.createElement('div')
  overlay.id = 'gemini-mermaid-overlay'
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.95);
    overflow: hidden;
    cursor: grab;
  `

  // Create close button
  const closeBtn = document.createElement('button')
  closeBtn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `
  closeBtn.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 8px;
    width: 40px;
    height: 40px;
    cursor: pointer;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    z-index: 10;
  `
  closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'
  closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'

  // Create zoom indicator
  const zoomIndicator = document.createElement('div')
  zoomIndicator.style.cssText = `
    position: absolute;
    bottom: 16px;
    right: 16px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px 12px;
    color: white;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    z-index: 10;
  `
  const updateZoomIndicator = () => {
    zoomIndicator.textContent = `${Math.round(zoom * 100)}%`
  }
  updateZoomIndicator()

  // Create canvas container (for pan/zoom)
  const canvas = document.createElement('div')
  canvas.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `

  // Create SVG wrapper (this gets transformed)
  const svgWrapper = document.createElement('div')
  svgWrapper.style.cssText = `
    transform-origin: center center;
    transition: none;
  `
  svgWrapper.innerHTML = svgContent

  // Style SVG
  const svg = svgWrapper.querySelector('svg')
  let svgWidth = 800
  let svgHeight = 600
  if (svg) {
    svg.style.cssText = `
      display: block;
      max-width: none;
      max-height: none;
    `
    // Get or set viewBox
    if (!svg.getAttribute('viewBox')) {
      const bbox = svg.getBBox?.()
      if (bbox && bbox.width && bbox.height) {
        svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`)
        svgWidth = bbox.width
        svgHeight = bbox.height
      }
    } else {
      const vb = svg.getAttribute('viewBox')?.split(' ').map(Number)
      if (vb && vb.length === 4) {
        svgWidth = vb[2]
        svgHeight = vb[3]
      }
    }
    // Set initial size
    svg.setAttribute('width', String(svgWidth))
    svg.setAttribute('height', String(svgHeight))
  }

  // Update transform
  const updateTransform = () => {
    svgWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
    updateZoomIndicator()
    updateMinimap()
  }

  // Create minimap
  const minimap = document.createElement('div')
  minimap.style.cssText = `
    position: absolute;
    top: 16px;
    left: 16px;
    width: 180px;
    height: 120px;
    background: rgba(30, 30, 30, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    overflow: hidden;
    z-index: 10;
  `

  // Minimap SVG (scaled down version)
  const minimapContent = document.createElement('div')
  minimapContent.style.cssText = `
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    box-sizing: border-box;
  `
  minimapContent.innerHTML = svgContent
  const minimapSvg = minimapContent.querySelector('svg')
  if (minimapSvg) {
    minimapSvg.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      opacity: 0.7;
    `
    minimapSvg.removeAttribute('width')
    minimapSvg.removeAttribute('height')
  }

  // Viewport indicator on minimap
  const viewportIndicator = document.createElement('div')
  viewportIndicator.style.cssText = `
    position: absolute;
    border: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.1);
    pointer-events: none;
    transition: none;
  `

  const updateMinimap = () => {
    const minimapWidth = 180 - 16 // padding
    const minimapHeight = 120 - 16
    const scaleX = minimapWidth / svgWidth
    const scaleY = minimapHeight / svgHeight
    const scale = Math.min(scaleX, scaleY)

    // Viewport size in SVG coordinates
    const viewW = window.innerWidth / zoom
    const viewH = window.innerHeight / zoom

    // Center offset
    const centerX = svgWidth / 2
    const centerY = svgHeight / 2

    // Viewport position in SVG coordinates
    const viewX = centerX - panX / zoom - viewW / 2
    const viewY = centerY - panY / zoom - viewH / 2

    // Convert to minimap coordinates
    const offsetX = (minimapWidth - svgWidth * scale) / 2 + 8
    const offsetY = (minimapHeight - svgHeight * scale) / 2 + 8

    viewportIndicator.style.left = `${offsetX + viewX * scale}px`
    viewportIndicator.style.top = `${offsetY + viewY * scale}px`
    viewportIndicator.style.width = `${Math.max(10, viewW * scale)}px`
    viewportIndicator.style.height = `${Math.max(10, viewH * scale)}px`
  }

  minimap.appendChild(minimapContent)
  minimap.appendChild(viewportIndicator)

  // Pan with mouse drag
  const onMouseDown = (e: MouseEvent) => {
    if (e.target === closeBtn || closeBtn.contains(e.target as Node)) return
    isDragging = true
    lastMouseX = e.clientX
    lastMouseY = e.clientY
    overlay.style.cursor = 'grabbing'
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return
    const dx = e.clientX - lastMouseX
    const dy = e.clientY - lastMouseY
    panX += dx
    panY += dy
    lastMouseX = e.clientX
    lastMouseY = e.clientY
    updateTransform()
  }

  const onMouseUp = () => {
    isDragging = false
    overlay.style.cursor = 'grab'
  }

  // Zoom with wheel (Ctrl/Shift) or pan without modifier
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()

    if (e.ctrlKey || e.shiftKey || e.metaKey) {
      // Zoom
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.1, Math.min(10, zoom * zoomDelta))

      // Zoom toward mouse position
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - rect.width / 2
      const mouseY = e.clientY - rect.top - rect.height / 2

      panX = mouseX - (mouseX - panX) * (newZoom / zoom)
      panY = mouseY - (mouseY - panY) * (newZoom / zoom)
      zoom = newZoom
    } else {
      // Pan
      panX -= e.deltaX
      panY -= e.deltaY
    }

    updateTransform()
  }

  // Pinch to zoom (gesture events for Safari/macOS)
  let lastScale = 1
  const onGestureStart = (e: Event) => {
    e.preventDefault()
    lastScale = 1
  }

  const onGestureChange = (e: Event) => {
    e.preventDefault()
    const ge = e as unknown as { scale: number }
    const scaleDelta = ge.scale / lastScale
    lastScale = ge.scale

    const newZoom = Math.max(0.1, Math.min(10, zoom * scaleDelta))
    zoom = newZoom
    updateTransform()
  }

  // Close handlers
  const closeOverlay = () => {
    document.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    overlay.remove()
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeOverlay()
    }
    // Reset view with 0 or Home
    if (e.key === '0' || e.key === 'Home') {
      zoom = 1
      panX = 0
      panY = 0
      updateTransform()
    }
    // Zoom with +/-
    if (e.key === '=' || e.key === '+') {
      zoom = Math.min(10, zoom * 1.2)
      updateTransform()
    }
    if (e.key === '-') {
      zoom = Math.max(0.1, zoom / 1.2)
      updateTransform()
    }
  }

  closeBtn.onclick = (e) => {
    e.stopPropagation()
    closeOverlay()
  }

  // Attach events
  overlay.addEventListener('mousedown', onMouseDown)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  overlay.addEventListener('wheel', onWheel, { passive: false })
  overlay.addEventListener('gesturestart', onGestureStart)
  overlay.addEventListener('gesturechange', onGestureChange)
  document.addEventListener('keydown', handleKeydown)

  // Assemble
  canvas.appendChild(svgWrapper)
  overlay.appendChild(canvas)
  overlay.appendChild(minimap)
  overlay.appendChild(closeBtn)
  overlay.appendChild(zoomIndicator)
  document.body.appendChild(overlay)

  // Focus and initialize
  overlay.setAttribute('tabindex', '-1')
  overlay.focus()
  updateMinimap()

  console.log('Gemini Side Panel: Mermaid overlay shown with pan/zoom controls')
}

// Listen for messages from Side Panel or Background
chrome.runtime.onMessage.addListener(
  (
    request: MessageAction,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (
      response:
        | MessageResponse<
            | PageContent
            | ClickElementResult
            | FillElementResult
            | GetHtmlResult
            | GenericActionResult
            | ScrollPositionResult
            | ScrollToBottomResult
            | GetTextResult
            | GetAttributeResult
            | FindElementsResult
            | GetAllLinksResult
          >
        | { status: string }
    ) => void
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

    if (request.action === 'SHOW_MERMAID_OVERLAY') {
      if (request.svgContent) {
        showMermaidOverlay(request.svgContent)
        sendResponse({ status: 'OK' })
      } else {
        sendResponse({ status: 'ERROR', error: 'No SVG content provided' } as { status: string })
      }
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

    if (request.action === 'HOVER_ELEMENT') {
      const r = hoverElement(request.selector)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.message })
      return true
    }

    if (request.action === 'FOCUS_ELEMENT') {
      const r = focusElement(request.selector)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.message })
      return true
    }

    if (request.action === 'BLUR_ELEMENT') {
      const r = blurElement(request.selector)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.message })
      return true
    }

    if (request.action === 'SCROLL_INTO_VIEW') {
      const r = scrollIntoView(request.selector, request.behavior, request.block)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.message })
      return true
    }

    if (
      request.action === 'RIGHT_CLICK_ELEMENT' ||
      request.action === 'DOUBLE_CLICK_ELEMENT' ||
      request.action === 'SELECT_TEXT' ||
      request.action === 'PRESS_KEY' ||
      request.action === 'PRESS_KEY_COMBINATION' ||
      request.action === 'WAIT_FOR_ELEMENT'
    ) {
      sendResponse({
        success: false,
        error: `Action ${request.action} requires CDP; content-script fallback is not supported.`,
      })
      return true
    }

    if (request.action === 'SCROLL_BY') {
      const r = scrollByFallback(request.dx, request.dy)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'SCROLL_TO_BOTTOM') {
      const r = scrollToBottomFallback(request.behavior)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'SCROLL_TO_TOP') {
      const r = scrollToTopFallback(request.behavior)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'GET_SCROLL_POSITION') {
      const r = getScrollPositionFallback()
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'GET_TEXT') {
      const r = getTextFallback(request.selector)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'GET_ATTRIBUTE') {
      const r = getAttributeFallback(request.selector, request.name)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'FIND_ELEMENTS') {
      const r = findElementsFallback(request.selector, request.limit ?? 20)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'GET_ALL_LINKS') {
      const r = getAllLinksFallback(request.filterSelector)
      sendResponse(r.success ? { success: true, data: r } : { success: false, error: r.error || 'Failed' })
      return true
    }

    if (request.action === 'WAIT') {
      waitFallback(request.ms).then((r) => {
        sendResponse({ success: true, data: r })
      })
      return true
    }

    if (request.action === 'READ_PAGE') {
      sendResponse({
        success: false,
        error: 'READ_PAGE is handled in background script; content script does not respond to it directly.',
      })
      return true
    }

    if (request.action === 'RUN_JS') {
      sendResponse({
        success: false,
        error: 'RUN_JS requires CDP; content-script fallback is not supported.',
      })
      return true
    }

    return false
  }
)
