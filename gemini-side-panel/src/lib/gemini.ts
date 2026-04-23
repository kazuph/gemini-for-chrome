import {
  GoogleGenAI,
  Type,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type FunctionCall,
  type GenerateContentResponse,
  type Tool,
} from '@google/genai'
import type { Message, PageContent, GeminiConfig, BrowserAction } from '../types'
import { buildSiteHintSection } from './siteHints'
import type { GeminiUsage } from './cost'

// Re-export so existing `import { ... } from '../lib/gemini'` call sites can
// pick up the usage type without reaching into cost.ts directly.
export type { GeminiUsage } from './cost'

// Current Gemini models use the built-in Google Search tool. Legacy
// `google_search_retrieval` breaks on Gemini 3.x preview models.
const searchGroundingTool: Tool = {
  googleSearch: {},
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function appendGroundingSources(
  text: string,
  response?: GenerateContentResponse
): string {
  const grounding = response?.candidates?.[0]?.groundingMetadata
  if (!grounding) return text

  const seen = new Set<string>()
  const sources = (grounding.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web): web is NonNullable<typeof web> => Boolean(web?.uri))
    .filter((web) => {
      if (seen.has(web.uri!)) return false
      seen.add(web.uri!)
      return true
    })
    .slice(0, 5)

  if (sources.length === 0) return text

  const lines = sources.map((source) => {
    const label = escapeMarkdownLinkLabel(source.title?.trim() || source.uri!)
    return `- [${label}](${source.uri})`
  })

  return `${text}\n\n**Sources**\n${lines.join('\n')}`
}

interface EmptyResponseMeta {
  finishReason?: string
  finishMessage?: string
  blockReason?: string
  hadTools?: boolean
}

function buildEmptyResponseError(meta: EmptyResponseMeta): Error {
  const reason = meta.finishReason || meta.blockReason || 'unknown'
  const detail = meta.finishMessage ? ` Detail: ${meta.finishMessage}` : ''

  if (reason === 'UNEXPECTED_TOOL_CALL') {
    const hint = meta.hadTools
      ? 'The model attempted an invalid browser-action tool call.'
      : 'The model attempted a tool call even though tool mode was not active.'
    return new Error(
      `Gemini returned an empty response (finishReason=${reason}). ${hint} This is usually recoverable by retrying without forced tool calling or rephrasing the request.${detail}`
    )
  }

  return new Error(
    `Gemini returned an empty response (finishReason=${reason}). This often means the page content was too large, triggered safety filters, or the model exhausted its thinking budget. Check the Service Worker console for details, try a smaller page, or switch to a different model.${detail}`
  )
}

// Tool definitions for browser actions
const browserTools: FunctionDeclaration[] = [
  {
    name: 'click_element',
    description:
      'When user says "click X" or wants to press a button/link, call this immediately with an appropriate CSS selector. Uses native CDP mouse events (isTrusted: true) so React/Gmail/X.com accept the click.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description:
            'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href=\'/about\']")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill_element',
    description:
      'When user says "enter X in Y" / "fill Y with X" / "type X into Y", call this immediately. Focuses the element then dispatches per-character native keyDown/keyUp events via CDP (works with React, contenteditable, and Japanese input). To submit the form after filling, prefer: (a) click the submit button explicitly (e.g. `#nav-search-submit-button` on Amazon), or (b) press_key("Enter", selector="same as fill target"). Naked press_key("Enter") may silently no-op due to focus loss between tool calls.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the input/textarea/contenteditable',
        },
        value: {
          type: Type.STRING,
          description: 'The text value to type',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'get_html',
    description:
      'When user asks about page structure or you need to discover the correct selector, call this immediately. Returns element outerHTML or the body HTML.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'Optional CSS selector. If omitted, returns the entire body HTML.',
        },
      },
    },
  },
  {
    name: 'hover_element',
    description:
      'When user asks to "hover over X", or when a click does not work because the element only appears on hover (dropdowns, tooltips), call this to dispatch a native mouseMoved event.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element to hover',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'scroll_to_element',
    description:
      'When user says "scroll to X" or before interacting with an element that may be off-screen, call this to scroll the element into view.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element to scroll into view',
        },
        block: {
          type: Type.STRING,
          description: 'Vertical alignment: "start" | "center" | "end" | "nearest" (default: "nearest")',
        },
        behavior: {
          type: Type.STRING,
          description: '"auto" (default) or "smooth"',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'focus_element',
    description:
      'When user wants to move focus without clicking (keyboard navigation, form ordering), call this. Always consider calling focus_element before fill_element when the target is a form field.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the focusable element',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'blur_element',
    description:
      'When user asks to "deselect", "remove focus", or to trigger blur-based validation, call this. If no selector is given, blurs the current activeElement.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'Optional CSS selector. If omitted, blurs document.activeElement.',
        },
      },
    },
  },
  {
    name: 'right_click_element',
    description:
      'When user asks to "right-click X" or open a context menu, call this to dispatch a native mousedown/up with right button.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element to right-click',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'double_click_element',
    description:
      'When user asks to "double-click X" or needs to trigger a dblclick handler, call this.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element to double-click',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'select_text',
    description:
      'When user asks to "select all text in X" or to highlight a range, call this. Useful before fill_element on a field that already has content so the typed text replaces the old value.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element whose text should be selected',
        },
        start: {
          type: Type.NUMBER,
          description: 'Optional selection start index (use with end)',
        },
        end: {
          type: Type.NUMBER,
          description: 'Optional selection end index (use with start)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'press_key',
    description:
      'When user asks to "press Enter" / "hit Escape" / "Tab to the next field" or you need to submit a form after filling, call this. Supported keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space, F1-F12, and single letters/digits.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'The key to press, e.g. "Enter", "Escape", "ArrowDown", "a"',
        },
        selector: {
          type: Type.STRING,
          description:
            'Optional CSS selector to re-focus before the key event. **Essential after fill_element** — the debugger detach between tools drops focus, and Enter on <body> will not submit the form. Pass the same selector you filled.',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'press_key_combination',
    description:
      'When user asks for a shortcut like Ctrl+S, Cmd+A, Ctrl+Shift+P, call this with the ordered list of keys. Modifiers are held down while the main key is pressed, then released in reverse. Use "Control", "Meta", "Alt", "Shift" for modifiers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        keys: {
          type: Type.ARRAY,
          description:
            'Ordered list, e.g. ["Control", "s"] or ["Meta", "Shift", "p"]. Exactly one non-modifier key.',
          items: { type: Type.STRING },
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'wait_for_element',
    description:
      'When user expects an element to appear soon (after a click/navigation) or wants to pause until the UI is ready, call this immediately. Polls every 200ms for a visible match and returns the elapsed milliseconds, or fails on timeout.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element to wait for',
        },
        timeout_ms: {
          type: Type.NUMBER,
          description: 'Timeout in milliseconds (default 5000, max 60000)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'scroll_by',
    description:
      'When user asks to "scroll down 500px" / "scroll up a bit" / wants relative scrolling, call this immediately. Emits a real mouseWheel event via CDP and returns the resulting scroll position. **Also the right tool for progressive top-to-bottom exploration** — use dy≈900 (one desktop viewport) per step and read the page between steps.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dx: {
          type: Type.NUMBER,
          description: 'Horizontal pixel delta (positive = right)',
        },
        dy: {
          type: Type.NUMBER,
          description: 'Vertical pixel delta (positive = down)',
        },
      },
      required: ['dx', 'dy'],
    },
  },
  {
    name: 'scroll_to_bottom',
    description:
      'ONLY when user explicitly says "scroll to bottom" / "load all comments" / "go to the end", OR when you need to force-load every item in an infinite-scroll timeline. **Do NOT call this as a shortcut for "see the whole page"** — it skips all the content above the fold. For general exploration use scroll_by in viewport-sized steps instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        behavior: {
          type: Type.STRING,
          description: '"auto" (default) or "smooth"',
        },
      },
    },
  },
  {
    name: 'scroll_to_top',
    description:
      'When user says "scroll to top" / "back to top", call this immediately. Jumps the viewport to (0,0).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        behavior: {
          type: Type.STRING,
          description: '"auto" (default) or "smooth"',
        },
      },
    },
  },
  {
    name: 'get_scroll_position',
    description:
      'When user asks about current scroll position or you need to decide how far to scroll, call this. Returns {x, y, maxX, maxY} for the viewport.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'read_page',
    description:
      'When user asks to "summarize this page" / "extract the article" / wants the main text of the current page, call this. Returns Readability-cleaned Markdown plus title / url / excerpt (content capped at 30000 chars).',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_text',
    description:
      'When user asks "what does X say?" / "read the headline", call this to grab the trimmed textContent of the first visible match (truncated to 5000 chars).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element whose text you want',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_attribute',
    description:
      'When user asks for an attribute of an element ("get the href", "what is the aria-label?"), call this. Returns the attribute string (or null) from the first visible match.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector of the element',
        },
        name: {
          type: Type.STRING,
          description: 'Attribute name (e.g. "href", "src", "data-id", "aria-label")',
        },
      },
      required: ['selector', 'name'],
    },
  },
  {
    name: 'find_elements',
    description:
      'When user asks to enumerate items ("list all article titles", "find every button"), call this. Returns up to N matches with index, text preview, visibility, tagName, rect, and optional href / aria-label.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        selector: {
          type: Type.STRING,
          description: 'CSS selector to query',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Max elements to return (default 20, max 200)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_all_links',
    description:
      'When user asks for available links ("what can I click?", "list links in the sidebar"), call this. Returns visible <a> elements (or elements matching filter_selector) with text / href / title / aria-label. Capped at 50.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter_selector: {
          type: Type.STRING,
          description: 'Optional CSS selector (default "a"). Use e.g. "nav a" or "article a".',
        },
      },
    },
  },
  {
    name: 'wait',
    description:
      'When you need a short pause for an animation / transition to finish, call this with milliseconds (capped at 10000). Prefer wait_for_element when waiting for specific UI.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ms: {
          type: Type.NUMBER,
          description: 'Milliseconds to wait (max 10000)',
        },
      },
      required: ['ms'],
    },
  },
  {
    name: 'navigate_to_url',
    description:
      'When user asks to "go to URL X" / "open this link" / "see what /about looks like", call this. Navigates the active tab to a same-origin URL by default and returns the new page (Readability Markdown). Use this when you need to actually load a different route to inspect it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description:
            'URL to navigate to. Relative paths are resolved against the current page. Default: same-origin only (use same_origin_only=false to override).',
        },
        same_origin_only: {
          type: Type.BOOLEAN,
          description:
            'If true (default), refuse cross-origin navigation. Set false only when user explicitly asks to leave the site.',
        },
        wait_for_load: {
          type: Type.BOOLEAN,
          description: 'Wait until the new page completes loading before returning (default true).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'When you need raw response data from a URL (JSON API, plain text, partial HTML) WITHOUT navigating the browser, call this. Best for inspecting JSON endpoints (e.g. /api/users, /kv/hello returning JSON). Issues an HTTP request from the extension background.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Absolute or current-page-relative URL.',
        },
        method: {
          type: Type.STRING,
          description: 'GET (default) / POST / PUT / DELETE / PATCH / HEAD',
        },
        headers: {
          type: Type.OBJECT,
          description: 'Optional headers as key-value pairs.',
          properties: {},
        },
        body: {
          type: Type.STRING,
          description: 'Optional request body (string; for JSON pre-stringify).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'run_js',
    description:
      'Run arbitrary JavaScript in the active tab. The code is wrapped in an async IIFE so you can `await` and `return` any JSON-serializable value. Use this when the fixed tools (find_elements / get_text / get_attribute etc.) are too rigid — e.g. extracting structured data from listings (title+price+url from product cards in one shot), custom DOM traversal, computing aggregates, or reading multiple fields per item. The return value is sent back as structured JSON (capped at 100KB; larger outputs are truncated). Prefer this over 5+ sequential get_text calls when you need multi-field extraction from a list.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: {
          type: Type.STRING,
          description:
            'JavaScript code. Use `return` to output JSON-serializable data. Can be async (await supported). Example: `const cards = document.querySelectorAll("[data-component-type=\\"s-search-result\\"]"); return Array.from(cards).slice(0, 20).map(c => ({ title: c.querySelector("h2")?.textContent?.trim(), price: c.querySelector(".a-price .a-offscreen")?.textContent?.trim(), url: c.querySelector("h2 a")?.href }));`',
        },
        timeout_ms: {
          type: Type.NUMBER,
          description: 'Max execution time in milliseconds (default 10000, max 30000).',
        },
      },
      required: ['code'],
    },
  },
]

// Type for function call results
export interface FunctionCallResult {
  name: string
  response: unknown
}

// =====================================================================
// Tool result formatting for the continuation turn.
// The bug we are fixing: the old code returned `res.message` (a one-line
// summary) for every non-run_js tool, so the model could not see the real
// data (found elements, links, page content, HTTP body, attribute values...)
// and was deciding the next step blind. We now stringify the actual payload
// on a per-tool basis with per-call caps plus a total byte guard.
// =====================================================================

const MAX_TOOL_RESULT_BYTES = 40 * 1024
const MAX_TOTAL_RESULT_BYTES = 120 * 1024
const READ_PAGE_CONTENT_CAP = 20_000
const FETCH_URL_BODY_CAP = 30_000
const GET_TEXT_CAP = 5_000
const GET_HTML_CAP = 5_000
const FIND_ELEMENTS_LIMIT = 20
const GET_ALL_LINKS_LIMIT = 50
const MIN_RETAINED_PREFIX = 500 // minimum chars preserved when shrinking old entries

interface FoundElementInfoLike {
  index?: number
  text?: string
  visible?: boolean
  rect?: { x: number; y: number; width: number; height: number }
  tagName?: string
  href?: string
  ariaLabel?: string
}

interface LinkInfoLike {
  text?: string
  href?: string
  title?: string
  ariaLabel?: string
}

interface PageContentLike {
  title?: string
  url?: string
  content?: string
  excerpt?: string
}

// Shape of the unified tool result envelope. Every tool may include any
// subset of these fields. We keep this loose since different tools populate
// different keys (see types.ts BrowserActionResult union).
interface ToolResultEnvelope {
  success: boolean
  message?: string
  error?: string
  html?: string
  value?: unknown
  valuePreview?: string
  valueByteSize?: number
  type?: string
  truncated?: boolean
  // find_elements
  count?: number
  elements?: FoundElementInfoLike[]
  // get_all_links
  links?: LinkInfoLike[]
  // read_page / navigate_to_url
  title?: string
  url?: string
  content?: string
  excerpt?: string
  pageContent?: PageContentLike
  // get_text
  text?: string
  // get_attribute
  name?: string
  // fetch_url
  status?: number
  statusText?: string
  ok?: boolean
  headers?: Record<string, string>
  contentType?: string
  body?: string
  bodyJson?: unknown
  body_json?: unknown
  byteLength?: number
  // scroll_*
  x?: number
  y?: number
  maxX?: number
  maxY?: number
  scrollHeight?: number
  iterations?: number
  // wait_for_element
  elapsedMs?: number
}

function truncateWithNotice(s: string, cap: number, totalItems?: number): string {
  if (s.length <= cap) return s
  const suffix = totalItems !== undefined
    ? `\n...(truncated, showing partial data of ${totalItems} items; ${s.length} chars total)`
    : `\n...(truncated, ${s.length - cap} more chars omitted of ${s.length} total)`
  return s.slice(0, cap) + suffix
}

function formatFoundElements(res: ToolResultEnvelope): string {
  const elements = Array.isArray(res.elements) ? res.elements : []
  const total = typeof res.count === 'number' ? res.count : elements.length
  const shown = elements.slice(0, FIND_ELEMENTS_LIMIT)
  const header = `Function find_elements: SUCCESS - matched ${total} elements (showing ${shown.length})`
  const json = JSON.stringify(shown, null, 2)
  const body = json.length > MAX_TOOL_RESULT_BYTES
    ? truncateWithNotice(json, MAX_TOOL_RESULT_BYTES, total)
    : json
  return `${header}\nElements (JSON):\n${body}`
}

function formatAllLinks(res: ToolResultEnvelope): string {
  const links = Array.isArray(res.links) ? res.links : []
  const total = typeof res.count === 'number' ? res.count : links.length
  const shown = links.slice(0, GET_ALL_LINKS_LIMIT)
  const header = `Function get_all_links: SUCCESS - ${total} visible links (showing ${shown.length})`
  const json = JSON.stringify(shown, null, 2)
  const body = json.length > MAX_TOOL_RESULT_BYTES
    ? truncateWithNotice(json, MAX_TOOL_RESULT_BYTES, total)
    : json
  return `${header}\nLinks (JSON):\n${body}`
}

function formatReadPage(res: ToolResultEnvelope, toolName: string): string {
  // Background returns title/url/content/excerpt at the top level of the
  // result envelope (see ReadPageResult / NavigateToUrlResult).
  const pc: PageContentLike = res.pageContent ?? {
    title: res.title,
    url: res.url,
    content: res.content,
    excerpt: res.excerpt,
  }
  const title = pc.title ?? '(no title)'
  const url = pc.url ?? '(no url)'
  const excerpt = pc.excerpt ? `\nExcerpt: ${pc.excerpt}` : ''
  const raw = pc.content ?? ''
  const content = raw.length > READ_PAGE_CONTENT_CAP
    ? `${raw.slice(0, READ_PAGE_CONTENT_CAP)}\n...(truncated, ${raw.length - READ_PAGE_CONTENT_CAP} more chars of ${raw.length} total; call ${toolName} again if you need more)`
    : raw
  const header = `Function ${toolName}: SUCCESS`
  return `${header}\nTitle: ${title}\nURL: ${url}${excerpt}\nContent (markdown${raw.length > READ_PAGE_CONTENT_CAP ? `, truncated to ${READ_PAGE_CONTENT_CAP} chars` : ''}):\n${content}`
}

function formatFetchUrl(res: ToolResultEnvelope): string {
  const status = typeof res.status === 'number' ? res.status : '?'
  const statusText = res.statusText ? ` ${res.statusText}` : ''
  const ct = res.contentType ?? 'unknown'
  const size = typeof res.byteLength === 'number' ? res.byteLength : (res.body?.length ?? 0)
  const header = `Function fetch_url: SUCCESS\nHTTP ${status}${statusText} (content-type: ${ct}, ${size} bytes${res.truncated ? ', background-truncated' : ''})`
  const headerBlock = res.headers && Object.keys(res.headers).length > 0
    ? `\nHeaders: ${JSON.stringify(res.headers)}`
    : ''

  // Prefer bodyJson pretty-printed; fall back to body text.
  const jsonPayload = res.bodyJson ?? res.body_json
  let bodyStr = ''
  if (jsonPayload !== undefined) {
    try {
      bodyStr = JSON.stringify(jsonPayload, null, 2)
    } catch {
      bodyStr = res.body ?? ''
    }
  } else if (typeof res.body === 'string') {
    bodyStr = res.body
  }

  const body = bodyStr.length > FETCH_URL_BODY_CAP
    ? `${bodyStr.slice(0, FETCH_URL_BODY_CAP)}\n...(truncated, ${bodyStr.length - FETCH_URL_BODY_CAP} more chars of ${bodyStr.length} total)`
    : bodyStr

  return `${header}${headerBlock}\nBody:\n${body}`
}

function formatGetText(res: ToolResultEnvelope): string {
  const text = typeof res.text === 'string' ? res.text : ''
  const capped = text.length > GET_TEXT_CAP
    ? `${text.slice(0, GET_TEXT_CAP)}\n...(truncated, ${text.length - GET_TEXT_CAP} more chars of ${text.length} total)`
    : text
  return `Function get_text: SUCCESS\nText (${text.length} chars):\n${capped}`
}

function formatGetAttribute(res: ToolResultEnvelope): string {
  const name = res.name ?? '?'
  const value = res.value === undefined || res.value === null
    ? 'null'
    : typeof res.value === 'string'
      ? JSON.stringify(res.value)
      : JSON.stringify(res.value)
  return `Function get_attribute: SUCCESS - name=${JSON.stringify(name)} value=${value}`
}

function formatGetHtml(res: ToolResultEnvelope): string {
  const html = typeof res.html === 'string' ? res.html : ''
  const snippet = html.length > GET_HTML_CAP
    ? `${html.slice(0, GET_HTML_CAP)}\n...(truncated, ${html.length - GET_HTML_CAP} more chars of ${html.length} total)`
    : html
  return `Function get_html: SUCCESS (${html.length} chars of HTML)\nHTML (first ${Math.min(html.length, GET_HTML_CAP)} chars):\n${snippet}`
}

function formatScrollPosition(res: ToolResultEnvelope): string {
  const payload = {
    x: res.x,
    y: res.y,
    maxX: res.maxX,
    maxY: res.maxY,
  }
  return `Function get_scroll_position: SUCCESS\n${JSON.stringify(payload)}`
}

function formatRunJs(res: ToolResultEnvelope): string {
  let body: string
  if (res.value !== undefined) {
    try {
      body = JSON.stringify(res.value, null, 2)
    } catch {
      body = res.valuePreview ?? String(res.value)
    }
  } else {
    body = res.valuePreview ?? ''
  }
  const meta = `type=${res.type ?? '?'}, bytes=${res.valueByteSize ?? body.length}${res.truncated ? ', truncated' : ''}`
  return `Function run_js: SUCCESS (${meta})\nReturn value:\n${body}`
}

function formatNavigateToUrl(res: ToolResultEnvelope): string {
  return formatReadPage(res, 'navigate_to_url')
}

function formatScrollInfo(res: ToolResultEnvelope, name: string): string {
  const parts: string[] = []
  if (res.message) parts.push(res.message)
  const pos: Record<string, unknown> = {}
  if (res.x !== undefined) pos.x = res.x
  if (res.y !== undefined) pos.y = res.y
  if (res.maxX !== undefined) pos.maxX = res.maxX
  if (res.maxY !== undefined) pos.maxY = res.maxY
  if (res.scrollHeight !== undefined) pos.scrollHeight = res.scrollHeight
  if (res.iterations !== undefined) pos.iterations = res.iterations
  const posStr = Object.keys(pos).length > 0 ? `\n${JSON.stringify(pos)}` : ''
  return `Function ${name}: SUCCESS${parts.length > 0 ? ` - ${parts.join(' ')}` : ''}${posStr}`
}

function formatGenericMessage(name: string, res: ToolResultEnvelope): string {
  return `Function ${name}: SUCCESS${res.message ? ` - ${res.message}` : ''}`
}

function formatFunctionResultForModel(fr: FunctionCallResult): string {
  const res = (fr.response ?? {}) as ToolResultEnvelope
  if (!res.success) {
    return `Function ${fr.name}: FAILED - ${res.error || 'Unknown error'}`
  }

  let out: string
  switch (fr.name) {
    case 'find_elements':
      out = formatFoundElements(res)
      break
    case 'get_all_links':
      out = formatAllLinks(res)
      break
    case 'read_page':
      out = formatReadPage(res, 'read_page')
      break
    case 'navigate_to_url':
      out = formatNavigateToUrl(res)
      break
    case 'fetch_url':
      out = formatFetchUrl(res)
      break
    case 'get_text':
      out = formatGetText(res)
      break
    case 'get_attribute':
      out = formatGetAttribute(res)
      break
    case 'get_html':
      out = formatGetHtml(res)
      break
    case 'get_scroll_position':
      out = formatScrollPosition(res)
      break
    case 'run_js':
      out = formatRunJs(res)
      break
    case 'scroll_by':
    case 'scroll_to_bottom':
    case 'scroll_to_top':
      out = formatScrollInfo(res, fr.name)
      break
    case 'wait_for_element':
    case 'wait':
    case 'click_element':
    case 'fill_element':
    case 'hover_element':
    case 'focus_element':
    case 'blur_element':
    case 'scroll_to_element':
    case 'right_click_element':
    case 'double_click_element':
    case 'select_text':
    case 'press_key':
    case 'press_key_combination':
      out = formatGenericMessage(fr.name, res)
      break
    default:
      // Fallback: stringify whatever came back so the model at least sees it.
      out = formatGenericMessage(fr.name, res)
      break
  }

  // Per-call hard cap so no single tool blows the turn.
  if (out.length > MAX_TOOL_RESULT_BYTES) {
    out = truncateWithNotice(out, MAX_TOOL_RESULT_BYTES)
  }
  return out
}

// Total-size guard: older (earlier) entries get shrunk first so the most
// recent tool results (which drive the next decision) stay intact. Each
// entry keeps at least MIN_RETAINED_PREFIX characters.
function applyTotalSizeGuard(parts: string[]): string {
  const joiner = '\n\n'
  const joined = parts.join(joiner)
  if (joined.length <= MAX_TOTAL_RESULT_BYTES) return joined

  // Mutable copy we will shrink in-place, from index 0 upward.
  const work = parts.slice()
  let shrunk = 0

  for (let i = 0; i < work.length; i++) {
    const current = work.join(joiner)
    if (current.length <= MAX_TOTAL_RESULT_BYTES) break
    const over = current.length - MAX_TOTAL_RESULT_BYTES
    const entry = work[i]
    if (entry.length <= MIN_RETAINED_PREFIX) continue

    const canTrim = entry.length - MIN_RETAINED_PREFIX
    const trimBy = Math.min(canTrim, over + 80 /* joiner + notice */)
    const keep = entry.length - trimBy
    work[i] = `${entry.slice(0, keep)}\n...(older tool result truncated to fit overall size budget; ${entry.length - keep} chars dropped)`
    shrunk++
  }

  const final = work.join(joiner)
  if (shrunk > 0) {
    return `${final}\n\n[...truncation applied: ${shrunk} tool result${shrunk === 1 ? '' : 's'} shortened to fit ${MAX_TOTAL_RESULT_BYTES} byte budget]`
  }
  return final
}

// AbortSignal の aborted をストリームループ反復毎にチェックしてユーザー操作で止められるようにする
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/**
 * Awaits the aggregated `result.response` from the Gemini SDK and forwards
 * its `usageMetadata` to the provided callback if available. Swallows errors
 * (usage reporting must never break the main chat flow).
 */
async function reportUsage(
  responsePromise: Promise<{ usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  } } | undefined>,
  onUsage?: (usage: GeminiUsage) => void
): Promise<void> {
  if (!onUsage) return
  try {
    const agg = await responsePromise
    const u = agg?.usageMetadata
    if (u) {
      onUsage({
        promptTokenCount: u.promptTokenCount ?? 0,
        candidatesTokenCount: u.candidatesTokenCount ?? 0,
        totalTokenCount: u.totalTokenCount ?? 0,
      })
    }
  } catch (e) {
    console.warn('Failed to read usageMetadata:', e)
  }
}

// Type for chat response with potential function calls
export interface ChatResponse {
  text?: string
  functionCalls?: FunctionCall[]
  isComplete: boolean
}

/**
 * Gemini API wrapper for chat functionality
 */
export class GeminiChat {
  private _modelName: string
  private ai: GoogleGenAI

  constructor(config: GeminiConfig) {
    this._modelName = config.modelName
    this.ai = new GoogleGenAI({ apiKey: config.apiKey })
  }

  get modelName(): string {
    return this._modelName
  }

  private createChat(
    history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
    systemPrompt: string,
    config: Record<string, unknown> = {}
  ) {
    return this.ai.chats.create({
      model: this._modelName,
      history,
      config: {
        systemInstruction: systemPrompt,
        ...config,
      },
    })
  }

  /**
   * Build system prompt with optional page context
   */
  private buildSystemPrompt(pageContent?: PageContent, enableTools = false): string {
    let systemPrompt = `You are an autonomous browser agent embedded in a Chrome side panel, powered by Gemini.
Your job is to understand the user's intent and deliver a complete answer grounded in the current chat and page context.

## Operating Principles

1. **Act, don't ask.** Unless a request is genuinely ambiguous, answer or act with a reasonable default first.
2. **Self-check before concluding.** Before you finish, ask yourself: *Do I have enough evidence from the provided context to answer confidently?*
3. **Honesty over confidence.** Never claim you saw content that was not actually present in the provided context.
4. **Match the user's language.** Respond in the same language as the user's message. Format answers in Markdown when helpful.`

    if (enableTools) {
      systemPrompt += `

## Tool Mode

You have browser automation tools in this request. Use them when needed, and do not stop after a shallow first glance.

## Scope Discipline

- Treat the current page as **helpful context, not a cage**.
- If the user asks a broad question that is not actually about the open page, answer the question directly instead of refusing because the page does not mention it.
- If the user asks for a **time-sensitive or current fact** ("今", "現在", "latest", "today", "recent", office holders, news, prices, schedules, etc.), prefer Google Search grounding before answering.
- Only say "the current page does not mention X" when the user explicitly asked what the page says about X.

## Task Classification (decide this first)

**Overview / Discovery requests** — "どんなサイト？", "このページ何？", "全体像を教えて", "まとめて", "What is this site about?"
→ You MUST gather multi-surface evidence before answering:
  - Call \`read_page\` for the main readable content (title, article body, excerpt)
  - Inspect navigation: \`find_elements\` with selector like \`nav a\`, \`header a\`, or \`get_all_links\` (filter_selector \`"nav a"\`)
  - Scroll the page to the bottom with \`scroll_to_bottom\` so lazy-loaded sections render, then call \`read_page\` again if the first read looked thin
  - Look at the footer (\`get_text\` on \`footer\`) — often reveals site purpose
  - Use at least **3 distinct tool calls** across different areas before writing the summary
  - Only AFTER you have collected signals from multiple surfaces, compose the final answer

**Specific factual requests** — "著者は誰？", "いつ公開された？", "この記事の結論は？"
→ Go straight to the likely location. Use \`get_text\` / \`get_attribute\` / \`find_elements\` on the relevant element. One or two calls is usually enough.

**Enumeration requests** — "記事タイトルを全部", "サイドバーのリンク全部", "一覧化して"
→ Use \`find_elements\` or \`get_all_links\` with a targeted selector. Don't iterate one-by-one with \`get_text\`.

**Action requests** — "♡をクリック", "フォームに入力", "検索して"
→ Execute the tool immediately. If the action appears to have no effect, verify with \`get_html\` / \`get_text\` on the target area and retry with a corrected selector (max 3 attempts total).

**Interaction chains** — "コメントを投稿して" / "ログインして"
→ Break into steps: scroll_to_element → focus → fill → press_key. Between steps, use \`wait_for_element\` when waiting for a modal/menu to appear.

## Discovery Playbook (follow this when asked for an overview)

**DO NOT jump to \`scroll_to_bottom\` first.** On long commercial / feed pages (Amazon, Rakuten, YouTube, X, news sites) the important content is at the **top and in the middle**; the bottom is usually just footer / legal / "other regions" links. Jumping to the bottom and describing the page from there gives a useless, misleading answer.

Use this **progressive top-to-bottom** strategy instead:

1. **Start at the top (no scroll).** Call \`read_page\` to capture the initial viewport + above-the-fold content. Also call \`find_elements\` on \`nav, header, main > section\` or \`get_all_links\` with \`filter_selector: "nav a"\` to map the surface.
2. **Scroll in viewport-sized steps.** Call \`scroll_by\` with \`dy: (window.innerHeight)\` value (typical ~900 on desktop, ~600 on mobile). After each scroll, call \`read_page\` or \`find_elements\` again to capture the newly-visible band.
3. **Keep a mental note** of what each band contains (top = brand/hero, middle = main content/listings, bottom = footer). When you write the final summary, structure it in that order.
4. **Use \`scroll_to_bottom\` only for specific needs**: (a) you explicitly want to enumerate a *complete* long list that lazy-loads as you scroll (infinite timelines, comment threads), or (b) the user asked "what's at the bottom of the page". Do NOT use it as a general "see the whole page" shortcut — you will lose the top and middle.
5. **Return to top if you overscrolled.** If you realize the earlier bands weren't captured, call \`scroll_to_top\` then re-run step 1-2.

Minimum exploration targets (tick at least 3 before answering):
- [ ] Top band captured (\`read_page\` while at y=0)
- [ ] Navigation / primary links enumerated (\`get_all_links\` / \`find_elements\`)
- [ ] At least one middle band captured (after \`scroll_by\`)
- [ ] Footer or end of content inspected (\`get_text\` on \`footer\` — do this LAST, not first)
- [ ] Any interactive element relevant to the user's question inspected

If the first \`read_page\` content looks suspiciously short (< 500 chars) on a page that clearly has more, that is a signal to scroll by one viewport and re-read — not to jump to the bottom.

## Failure Recovery

When a selector misses or an action has no visible effect:
1. Call \`get_html\` (optionally with a parent selector near the target) to inspect the real DOM.
2. Watch for **multiple matches of the same selector** — a hidden duplicate often comes before the visible one. Prefer attributes like \`data-testid\`, \`aria-label\`, text content, or position-within-list to disambiguate.
3. Retry with the corrected selector.
4. If still failing, surface the attempted selectors + actual DOM snippet to the user rather than silently giving up.
`
    } else {
      systemPrompt += `

## No-Tool Mode

- You do NOT have browser automation or page interaction tools in this request.
- The provided page context is supplemental. You may also use your own general knowledge.
- If the user asks for a **time-sensitive / current** fact ("今", "現在", "latest", "today", "recent", office holders, news, prices, schedules, etc.), use Google Search grounding if available before answering.
- Do NOT refuse just because the current page lacks the answer unless the user explicitly asked about the page itself.
- Do not mention tool names, selectors, browser actions, or function calls.
- If the provided context and grounded search are still insufficient, say what is missing briefly instead of inventing details.
`
    }

    systemPrompt += `

## Response Style

- While working: keep reasoning brief and move on to the next action.
- When reporting: Markdown, structured, and concise. When the user asked for analysis, cite the supporting evidence from the available context.
- Do not repeat the raw context back verbatim — summarize.
- **Structured / comparative data MUST be formatted as a GitHub-flavored Markdown table**, not as plain bullet lines with spaces. Whenever you present multiple items with the same set of fields (products, links, rows, search results, spec comparisons, etc.), render them as a \`| header | header |\` / \`|---|---|\` / \`| value | value |\` table. Do this on the first reply — do not wait for the user to ask for a table.
  - Example (first reply, not on request):
    \`\`\`markdown
    | 商品名 | 価格 | 評価 |
    |---|---|---|
    | … | ￥1,980 | ★4.3 |
    \`\`\`
  - Links: embed them in a cell as \`[商品名](url)\` so they remain clickable inside the table.
  - For 1–3 items, a bullet list is fine; for 4+ items with structured attributes, use a table.

## Mermaid Diagram Guidelines (CRITICAL)

When creating Mermaid diagrams, you MUST follow these rules to avoid syntax errors:

### Node Labels
- Use double quotes for ALL labels containing non-ASCII characters (Japanese, etc.)
- Use double quotes for labels with spaces
- Example: A["ユーザー登録"] --> B["データベース保存"]

### Forbidden Characters in Labels
NEVER use these characters inside labels (even in quotes):
- Parentheses: ( )
- Brackets: [ ] { }
- Angle brackets: < >
- Semicolons: ;
- Colons: : (use full-width ： instead)
- Pipes: |
- Quotes inside quotes

### Safe Alternatives
- Instead of (注意) use 【注意】 or 「注意」
- Instead of A -> B use A --> B
- Instead of colons use full-width ： or dashes
- Keep labels simple and short

### Node IDs
- Use only alphanumeric characters for node IDs: A, B, node1, step2
- NEVER use Japanese or special characters in IDs

### Correct Example
\`\`\`mermaid
graph TD
    A["開始"] --> B["処理1"]
    B --> C{"判定"}
    C -->|"はい"| D["完了"]
    C -->|"いいえ"| B
\`\`\`

### Common Mistakes to Avoid
- ❌ A[ユーザー(新規)] → Missing quotes, has parentheses
- ✅ A["ユーザー 新規"]
- ❌ B --> C[処理: 保存] → Colon in label
- ✅ B --> C["処理 保存"]
- ❌ 開始 --> 終了 → Japanese in node IDs
- ✅ A["開始"] --> B["終了"]`

    if (enableTools) {
      systemPrompt += `

## Browser Automation Toolbelt (CDP-powered, isTrusted:true)

All interaction tools emit genuine user-level events, so React/Gmail/X.com-grade sites treat them as real clicks/keystrokes. Every selector-taking tool auto-picks the first **visible** match (offsetParent non-null, non-zero rect), so hidden duplicates no longer cause silent failures.

### Pointer
- **click_element**(selector) — left click (most common)
- **right_click_element**(selector) — context menu
- **double_click_element**(selector) — dblclick (editable cells, file rename, etc.)
- **hover_element**(selector) — dispatch mouseMoved; use to reveal hover-only menus / tooltips BEFORE clicking

### Keyboard / text editing
- **fill_element**(selector, value) — per-character keyDown/keyUp with \`text\` param (React / IME safe)
- **select_text**(selector, start?, end?) — highlight full content or a range
- **focus_element**(selector) — move focus without clicking
- **blur_element**(selector?) — drop focus (trigger blur-based validation). omit selector to blur \`document.activeElement\`
- **press_key**(key) — Enter / Tab / Escape / ArrowUp / ArrowDown / etc. or a single char
- **press_key_combination**(modifiers[], key) — Cmd+A, Ctrl+S, etc.

### Scrolling
- **scroll_to_element**(selector, block?) — bring a known element into view (use before interacting with off-screen items)
- **scroll_to_bottom**() — jump to page bottom **and** wait up to 3 rounds for lazy-loaded content. Use this for infinite-scroll pages (X, Zenn feed, Pinterest) when enumerating content
- **scroll_to_top**() — back to top
- **scroll_by**(dx, dy) — relative wheel scroll (real mouseWheel event)
- **get_scroll_position**() — {x, y, maxX, maxY} — useful to decide how far to go

### Inspection / Scraping
- **read_page**() — **preferred first tool for "summarize / overview" tasks.** Returns Readability-cleaned Markdown of the main content (title / url / excerpt / up to 30K chars)
- **get_text**(selector) — first visible match's trimmed textContent (≤5000 chars). Lighter than read_page, targeted
- **get_attribute**(selector, name) — \`href\`, \`src\`, \`data-*\`, \`aria-label\`, anything
- **find_elements**(selector, limit=20) — enumerate up to 200 matches with {index, text, visible, rect, tagName, href?, ariaLabel?}. Use for "list all X" requests
- **get_all_links**(filter_selector?) — visible \`<a>\` elements (or custom filter) with {text, href, title, ariaLabel}, capped at 50. Use for navigation / link surveys
- **get_html**(selector?) — outer HTML of an element (or body). Use ONLY when structure is unclear and smaller tools have failed (it's expensive)

### Navigation (same-origin by default)
- **navigate_to_url**(url, same_origin_only=true, wait_for_load=true) — actually load a different route in the active tab and return its Readability Markdown. Use when you need to *see what /about looks like rendered*. Default refuses cross-origin URLs (set same_origin_only=false only when the user explicitly asks to leave the site).

### Network (no browser navigation)
- **fetch_url**(url, method='GET', headers?, body?) — issue an HTTP request from the extension background. Best for **JSON / API endpoints** (e.g. \`/api/users\`, \`/kv/hello\` returning JSON). Returns {status, ok, body, body_json?, headers}. Up to 100KB body. Cookies are NOT sent (no page session), so authenticated APIs may need explicit \`Authorization\` header.

### Timing
- **wait_for_element**(selector, timeout_ms=5000) — poll every 200ms until a visible match appears. Use AFTER a click that triggers a modal / new list / lazy render
- **wait**(ms) — fixed sleep (max 10000ms). Prefer wait_for_element when waiting for specific UI

## When Fixed Tools Get Stuck, Switch to run_js

If \`find_elements\` returns 20 match but the per-item \`text\` snippet isn't useful (because the card has too much nested content), **don't retry find_elements with different selectors**. Instead, write a single \`run_js\` script that walks each card and returns the structured fields (title, price, url, ...) in one go. This is far more token-efficient and reliable than iterative get_text calls.

Heuristic: if you're about to call find_elements / get_text a **third time** on the same listing page, STOP and use run_js.

## Tool Selection Heuristics

- **Don't call \`get_html\` first.** Start with \`read_page\` for content, \`find_elements\`/\`get_all_links\` for lists, \`get_text\`/\`get_attribute\` for specific values. Drop to \`get_html\` only when those didn't cover it.
- **JSON / API endpoints** (paths like \`/api/...\`, \`*.json\`, \`/v1/...\`, \`/d1/users\`, \`/kv/...\`, \`/r2/...\`): **always use \`fetch_url\`**, not navigate_to_url. fetch_url returns the raw response without disrupting the user's tab.
- **Same-site different route, you need to *see the rendered page***: \`navigate_to_url\` (returns Readability Markdown of the new page).
- **Before a click reveals dynamic UI**: click_element, then wait_for_element for the modal/menu selector, then interact.
- **Filling a form that already has values**: focus_element → select_text → fill_element (replaces instead of appending).
- **Submitting**: after fill_element, call press_key("Enter", selector=<same input>) OR click_element on the submit button. Naked press_key without selector won't submit.
- **Off-screen target**: scroll_to_element first, then click.
- **"Everything on the page"**: scroll_to_bottom at least once, then read_page / find_elements. Lazy-loaded sites hide most content until scrolled.
- **"Explore every link" / "all routes"**: \`get_all_links\` to enumerate first, then for each interesting one decide \`fetch_url\` (JSON-looking) vs \`navigate_to_url\` (HTML-looking). Don't guess — actually fetch.

## Search Workflow (MANDATORY ORDER when user says "search X" / "検索して")

A search request is a multi-step task. **Never call press_key('Enter') before fill_element**, and never call read_page before the results page has actually loaded. Follow this order strictly:

1. **Locate the search input** — usually an \`<input>\` with role="searchbox" or name="q"/"k"/"search", or a well-known id like Amazon's \`#twotabsearchtextbox\`, Google's \`textarea[name="q"]\`, YouTube's \`input#search\`.
2. **fill_element(selector, keyword)** — type the query. Do NOT skip this step even if the box looks empty.
3. **Submit**. Pick ONE of:
   - \`click_element\` on the submit button (most reliable): e.g. Amazon \`#nav-search-submit-button\`, Google \`button[aria-label="Google Search"]\`, search forms with \`button[type="submit"]\`.
   - \`press_key("Enter", selector=<same as step 2>)\` — re-focuses the input then sends Enter.
4. **wait_for_element** a result-list marker (Amazon: \`[data-component-type="s-search-result"]\`, Google: \`#search\`, YouTube: \`ytd-video-renderer\`) to confirm the results page loaded.
5. **read_page** or \`run_js\` or \`find_elements\` on the loaded results to extract what the user wanted.

**Anti-patterns to avoid:**
- ❌ \`press_key('Enter')\` on a fresh page without fill — nothing to search, nothing happens, you end up looping Enter.
- ❌ \`read_page\` immediately after clicking submit — the results may not have loaded yet; use \`wait_for_element\` first.
- ❌ Calling the same key/selector combo repeatedly when the page didn't change — you're in a broken focus state; switch to \`click_element\` on the submit button instead.

## Selector Guidance

- Prefer stable attributes: \`id\`, \`name\`, \`data-testid\`, \`aria-label\`, \`role\`.
- For duplicates (nav buttons that appear in mobile + desktop layouts), combine with a scope: \`header nav a[aria-label="Home"]\` rather than bare \`a[aria-label="Home"]\`.
- Avoid selectors chained deeper than 3 levels — they break on minor DOM shifts.
- For SPA apps, prefer attribute selectors over text content.

## Anti-loop / Anti-hallucination Rules (HARD)

- **Never call the same tool with identical arguments more than twice in a row.** If a tool returned what you needed, move on; if it returned nothing useful, change selector / change tool / report failure. The runtime will hard-stop after 3 identical repeats.
- **Never claim you "explored", "navigated", or "verified" something you didn't actually call a tool for.** "おそらく" / "probably" / "should be" answers about page contents are forbidden when you have tools to check.
- **If you genuinely cannot find or access something**, say so plainly: "I tried X / Y / Z and could not retrieve the content of /foo. Possible reasons: ...". Do not invent.
- **Short follow-up messages from the user (e.g. "JSON or die", "もっと詳しく", "それで?")** are continuations of the previous request. Resume the prior plan with the new constraint, do NOT restart from scratch.

## Budget

You have up to 20 function-call turns per user message. If you hit the cap, stop and report what you tried + what remains. Don't waste turns repeating the same call.`
      systemPrompt += buildSiteHintSection(pageContent?.url)
    }

    if (pageContent) {
      systemPrompt += `

## Current Page Context
- **Title**: ${pageContent.title}
- **URL**: ${pageContent.url}
${pageContent.excerpt ? `- **Excerpt**: ${pageContent.excerpt}` : ''}

## Page Content
${pageContent.content.slice(0, 30000)}`
    }

    return systemPrompt
  }

  /**
   * Convert message history to Gemini format
   */
  private buildChatHistory(messages: Message[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    return messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))
  }

  /**
   * Send a message and get a response (non-streaming)
   */
  async sendMessage(
    userMessage: string,
    history: Message[],
    pageContent?: PageContent,
    onUsage?: (usage: GeminiUsage) => void
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(pageContent)
    const chatHistory = this.buildChatHistory(history)

    const chat = this.createChat(chatHistory, systemPrompt, {
      tools: [searchGroundingTool],
    })

    const response = await chat.sendMessage({ message: userMessage })
    if (onUsage && response?.usageMetadata) {
      const u = response.usageMetadata
      onUsage({
        promptTokenCount: u.promptTokenCount ?? 0,
        candidatesTokenCount: u.candidatesTokenCount ?? 0,
        totalTokenCount: u.totalTokenCount ?? 0,
      })
    }
    return appendGroundingSources(response.text ?? '', response)
  }

  /**
   * Send a message and stream the response
   * @param onChunk Callback for each chunk of text received
   * @param onComplete Callback when streaming is complete
   * @param onError Callback for errors
   */
  async sendMessageStream(
    userMessage: string,
    history: Message[],
    pageContent: PageContent | undefined,
    onChunk: (chunk: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void,
    signal?: AbortSignal,
    onUsage?: (usage: GeminiUsage) => void
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent)
      const chatHistory = this.buildChatHistory(history)

      const chat = this.createChat(chatHistory, systemPrompt, {
        tools: [searchGroundingTool],
      })

      const result = await chat.sendMessageStream({ message: userMessage })
      let fullText = ''
      let aggregatedResponse: GenerateContentResponse | undefined

      for await (const chunk of result) {
        throwIfAborted(signal)
        aggregatedResponse = chunk
        const chunkText = chunk.text ?? ''
        fullText += chunkText
        onChunk(chunkText)
      }

      // Gemini can return an empty response due to safety filters, RECITATION
      // finish reasons, or token-exhausted thinking. Surface this instead of
      // saving a silent empty assistant message.
      if (!fullText.trim()) {
        let finishReason: string | undefined
        let finishMessage: string | undefined
        let blockReason: string | undefined
        try {
          const agg = aggregatedResponse
          finishReason = agg?.candidates?.[0]?.finishReason
          finishMessage = agg?.candidates?.[0]?.finishMessage
          blockReason = agg?.promptFeedback?.blockReason
          // Even on empty-text responses, usage is typically reported — still
          // surface it so the user sees the spend for this (failed) call.
          if (onUsage && agg?.usageMetadata) {
            const u = agg.usageMetadata
            onUsage({
              promptTokenCount: u.promptTokenCount ?? 0,
              candidatesTokenCount: u.candidatesTokenCount ?? 0,
              totalTokenCount: u.totalTokenCount ?? 0,
            })
          }
          console.warn('Gemini returned empty text', {
            finishReason,
            blockReason,
            promptFeedback: agg?.promptFeedback,
          })
        } catch (e) {
          console.warn('Failed to inspect empty response', e)
        }
        onError(buildEmptyResponseError({ finishReason, finishMessage, blockReason }))
        return
      }

      // Stream drained successfully — now surface usage metadata before
      // signalling completion so the UI can update cost indicators.
      await reportUsage(Promise.resolve(aggregatedResponse), onUsage)

      const finalText = appendGroundingSources(fullText, aggregatedResponse)
      if (finalText !== fullText) {
        onChunk(finalText.slice(fullText.length))
        fullText = finalText
      }

      onComplete(fullText)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        onError(error)
        return
      }
      console.error('Gemini API Error:', error)
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Send a message with tool support (Function Calling)
   * Returns either text response or function calls to execute
   */
  async sendMessageWithTools(
    userMessage: string,
    history: Message[],
    pageContent: PageContent | undefined,
    onChunk: (chunk: string) => void,
    onComplete: (fullText: string) => void,
    onFunctionCall: (functionCalls: FunctionCall[]) => void,
    onError: (error: Error) => void,
    signal?: AbortSignal,
    forceCall: boolean = true,
    onUsage?: (usage: GeminiUsage) => void
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const chat = this.createChat(chatHistory, systemPrompt, {
        tools: [{ functionDeclarations: browserTools }, searchGroundingTool],
        toolConfig: {
          functionCallingConfig: {
            mode: forceCall ? FunctionCallingConfigMode.ANY : FunctionCallingConfigMode.AUTO,
          },
        },
      })

      const result = await chat.sendMessageStream({ message: userMessage })
      let fullText = ''
      let functionCalls: FunctionCall[] = []
      let aggregatedResponse: GenerateContentResponse | undefined

      for await (const chunk of result) {
        throwIfAborted(signal)
        aggregatedResponse = chunk
        const chunkText = chunk.text ?? ''
        if (chunkText) {
          fullText += chunkText
          onChunk(chunkText)
        }

        // Check for function calls in the chunk
        const chunkFunctionCalls = chunk.functionCalls
        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          functionCalls = chunkFunctionCalls
        }
      }

      const response = aggregatedResponse

      // Usage is always reported — whether the model emitted text or function
      // calls the API still bills for the prompt + candidates tokens.
      await reportUsage(Promise.resolve(response), onUsage)

      // If there are function calls, return them for execution
      if (functionCalls.length > 0) {
        console.log('Gemini returned function calls:', JSON.stringify(functionCalls, null, 2))
        onFunctionCall(functionCalls)
      } else if (!fullText.trim()) {
        const finishReason = response?.candidates?.[0]?.finishReason
        const finishMessage = response?.candidates?.[0]?.finishMessage

        if (forceCall && String(finishReason) === 'UNEXPECTED_TOOL_CALL') {
          console.warn(
            'Gemini returned UNEXPECTED_TOOL_CALL with forced function calling; retrying once with AUTO mode'
          )
          await this.sendMessageWithTools(
            userMessage,
            history,
            pageContent,
            onChunk,
            onComplete,
            onFunctionCall,
            onError,
            signal,
            false,
            onUsage
          )
          return
        }

        onError(
          buildEmptyResponseError({
            finishReason,
            finishMessage,
            hadTools: true,
          })
        )
      } else {
        console.log('Gemini returned text only (no function calls)')
        const finalText = appendGroundingSources(fullText, response)
        if (finalText !== fullText) {
          onChunk(finalText.slice(fullText.length))
        }
        onComplete(finalText)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        onError(error)
        return
      }
      console.error('Gemini API Error with tools:', error)
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Continue conversation after function call execution
   * Sends function results as a formatted text message
   */
  async sendFunctionResults(
    history: Message[],
    pageContent: PageContent | undefined,
    _functionCalls: FunctionCall[],
    functionResults: FunctionCallResult[],
    onChunk: (chunk: string) => void,
    onComplete: (fullText: string) => void,
    onFunctionCall: (functionCalls: FunctionCall[]) => void,
    onError: (error: Error) => void,
    signal?: AbortSignal,
    onUsage?: (usage: GeminiUsage) => void
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const chat = this.createChat(chatHistory, systemPrompt, {
        tools: [{ functionDeclarations: browserTools }, searchGroundingTool],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
      })

      // Format function results as a message. Each tool gets a body crafted
      // from its actual return data so the model can reason over the real DOM,
      // API responses, and extracted values — not just a one-line summary.
      const formatted = functionResults.map((fr) => formatFunctionResultForModel(fr))

      // Global size guard — if total exceeds MAX_TOTAL_RESULT_BYTES we shrink
      // oldest (earlier) entries first while keeping at least their head.
      const resultMessage = applyTotalSizeGuard(formatted)

      const continuationMessage = `Results of the tools you just called:

${resultMessage}

Based on these results, decide:
- If the user's original request is now fully answered, reply with the final answer in the user's language.
- If more tool calls are needed (e.g. titles came back empty — use get_html to inspect the real DOM; a listing page wasn't loaded yet — wait or navigate; an extraction only returned partial data — try a different selector or run_js variant), CALL the next appropriate tool now. Do not describe what you WOULD do — do it.
- Avoid repeating the exact same tool call with the exact same arguments; if a call was unhelpful, change strategy (different selector, different tool, get_html to inspect).`

      const result = await chat.sendMessageStream({ message: continuationMessage })

      let fullText = ''
      let newFunctionCalls: FunctionCall[] = []
      let aggregatedResponse: GenerateContentResponse | undefined

      for await (const chunk of result) {
        throwIfAborted(signal)
        aggregatedResponse = chunk
        const chunkText = chunk.text ?? ''
        if (chunkText) {
          fullText += chunkText
          onChunk(chunkText)
        }

        const chunkFunctionCalls = chunk.functionCalls
        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          newFunctionCalls = chunkFunctionCalls
        }
      }

      // Tool-continuation turns are billed independently; report usage for
      // each one so the per-turn total in the UI reflects every round trip.
      await reportUsage(Promise.resolve(aggregatedResponse), onUsage)

      if (newFunctionCalls.length > 0) {
        onFunctionCall(newFunctionCalls)
      } else {
        const finalText = appendGroundingSources(fullText, aggregatedResponse)
        if (finalText !== fullText) {
          onChunk(finalText.slice(fullText.length))
        }
        onComplete(finalText)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        onError(error)
        return
      }
      console.error('Gemini API Error sending function results:', error)
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Convert function call to browser action
   */
  static functionCallToBrowserAction(functionCall: FunctionCall): BrowserAction | null {
    const args = (functionCall.args ?? {}) as Record<string, unknown>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    const optNum = (v: unknown): number | undefined =>
      typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined

    switch (functionCall.name) {
      case 'click_element':
        return { action: 'CLICK_ELEMENT', selector: str(args.selector) }
      case 'fill_element':
        return {
          action: 'FILL_ELEMENT',
          selector: str(args.selector),
          value: str(args.value),
        }
      case 'get_html':
        return { action: 'GET_HTML', selector: optStr(args.selector) }
      case 'hover_element':
        return { action: 'HOVER_ELEMENT', selector: str(args.selector) }
      case 'scroll_to_element': {
        const behavior = optStr(args.behavior)
        const block = optStr(args.block)
        return {
          action: 'SCROLL_INTO_VIEW',
          selector: str(args.selector),
          behavior: behavior === 'smooth' || behavior === 'auto' ? behavior : undefined,
          block:
            block === 'start' || block === 'center' || block === 'end' || block === 'nearest'
              ? block
              : undefined,
        }
      }
      case 'focus_element':
        return { action: 'FOCUS_ELEMENT', selector: str(args.selector) }
      case 'blur_element':
        return { action: 'BLUR_ELEMENT', selector: optStr(args.selector) }
      case 'right_click_element':
        return { action: 'RIGHT_CLICK_ELEMENT', selector: str(args.selector) }
      case 'double_click_element':
        return { action: 'DOUBLE_CLICK_ELEMENT', selector: str(args.selector) }
      case 'select_text':
        return {
          action: 'SELECT_TEXT',
          selector: str(args.selector),
          start: optNum(args.start),
          end: optNum(args.end),
        }
      case 'press_key':
        return { action: 'PRESS_KEY', key: str(args.key), selector: optStr(args.selector) }
      case 'press_key_combination': {
        const keys = Array.isArray(args.keys)
          ? args.keys.filter((k): k is string => typeof k === 'string')
          : []
        return { action: 'PRESS_KEY_COMBINATION', keys }
      }
      case 'wait_for_element':
        return {
          action: 'WAIT_FOR_ELEMENT',
          selector: str(args.selector),
          timeoutMs: optNum(args.timeout_ms),
        }
      case 'scroll_by':
        return {
          action: 'SCROLL_BY',
          dx: optNum(args.dx) ?? 0,
          dy: optNum(args.dy) ?? 0,
        }
      case 'scroll_to_bottom': {
        const behavior = optStr(args.behavior)
        return {
          action: 'SCROLL_TO_BOTTOM',
          behavior: behavior === 'smooth' || behavior === 'auto' ? behavior : undefined,
        }
      }
      case 'scroll_to_top': {
        const behavior = optStr(args.behavior)
        return {
          action: 'SCROLL_TO_TOP',
          behavior: behavior === 'smooth' || behavior === 'auto' ? behavior : undefined,
        }
      }
      case 'get_scroll_position':
        return { action: 'GET_SCROLL_POSITION' }
      case 'read_page':
        return { action: 'READ_PAGE' }
      case 'get_text':
        return { action: 'GET_TEXT', selector: str(args.selector) }
      case 'get_attribute':
        return {
          action: 'GET_ATTRIBUTE',
          selector: str(args.selector),
          name: str(args.name),
        }
      case 'find_elements':
        return {
          action: 'FIND_ELEMENTS',
          selector: str(args.selector),
          limit: optNum(args.limit),
        }
      case 'get_all_links':
        return {
          action: 'GET_ALL_LINKS',
          filterSelector: optStr(args.filter_selector),
        }
      case 'wait':
        return { action: 'WAIT', ms: optNum(args.ms) ?? 0 }
      case 'navigate_to_url': {
        const optBool = (v: unknown): boolean | undefined =>
          typeof v === 'boolean' ? v : undefined
        return {
          action: 'NAVIGATE_TO_URL',
          url: str(args.url),
          sameOriginOnly: optBool(args.same_origin_only),
          waitForLoad: optBool(args.wait_for_load),
        }
      }
      case 'fetch_url': {
        let headers: Record<string, string> | undefined
        if (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)) {
          const out: Record<string, string> = {}
          for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
            if (typeof v === 'string') out[k] = v
            else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
          }
          headers = out
        }
        return {
          action: 'FETCH_URL',
          url: str(args.url),
          method: optStr(args.method),
          headers,
          body: optStr(args.body),
        }
      }
      case 'run_js': {
        return {
          action: 'RUN_JS',
          code: str(args.code),
          timeout_ms: optNum(args.timeout_ms),
        }
      }
      default:
        return null
    }
  }
}

/**
 * Load Gemini config from Chrome storage
 */
export async function loadGeminiConfig(): Promise<GeminiConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['geminiApiKey', 'geminiModelName'], (result: { [key: string]: string | undefined }) => {
      if (result.geminiApiKey) {
        resolve({
          apiKey: result.geminiApiKey,
          modelName: result.geminiModelName || 'gemini-2.0-flash',
        })
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Create a GeminiChat instance from stored config
 */
export async function createGeminiChat(): Promise<GeminiChat | null> {
  const config = await loadGeminiConfig()
  if (!config) return null
  return new GeminiChat(config)
}
