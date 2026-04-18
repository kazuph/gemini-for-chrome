import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
  type GenerativeModel,
  type FunctionDeclaration,
  type FunctionCall,
} from '@google/generative-ai'
import type { Message, PageContent, GeminiConfig, BrowserAction } from '../types'

// Tool definitions for browser actions
const browserTools: FunctionDeclaration[] = [
  {
    name: 'click_element',
    description:
      'When user says "click X" or wants to press a button/link, call this immediately with an appropriate CSS selector. Uses native CDP mouse events (isTrusted: true) so React/Gmail/X.com accept the click.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      'When user says "enter X in Y" / "fill Y with X" / "type X into Y", call this immediately. Focuses the element then dispatches per-character native keyDown/keyUp events via CDP (works with React, contenteditable, and Japanese input).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector of the input/textarea/contenteditable',
        },
        value: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector of the element to scroll into view',
        },
        block: {
          type: SchemaType.STRING,
          description: 'Vertical alignment: "start" | "center" | "end" | "nearest" (default: "nearest")',
        },
        behavior: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector of the element whose text should be selected',
        },
        start: {
          type: SchemaType.NUMBER,
          description: 'Optional selection start index (use with end)',
        },
        end: {
          type: SchemaType.NUMBER,
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
      type: SchemaType.OBJECT,
      properties: {
        key: {
          type: SchemaType.STRING,
          description: 'The key to press, e.g. "Enter", "Escape", "ArrowDown", "a"',
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
      type: SchemaType.OBJECT,
      properties: {
        keys: {
          type: SchemaType.ARRAY,
          description:
            'Ordered list, e.g. ["Control", "s"] or ["Meta", "Shift", "p"]. Exactly one non-modifier key.',
          items: { type: SchemaType.STRING },
        },
      },
      required: ['keys'],
    },
  },
]

// Type for function call results
export interface FunctionCallResult {
  name: string
  response: unknown
}

// AbortSignal の aborted をストリームループ反復毎にチェックしてユーザー操作で止められるようにする
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
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
  private model: GenerativeModel
  private _modelName: string
  private genAI: GoogleGenerativeAI

  constructor(config: GeminiConfig) {
    this._modelName = config.modelName
    this.genAI = new GoogleGenerativeAI(config.apiKey)
    this.model = this.genAI.getGenerativeModel({
      model: config.modelName,
    })
  }

  get modelName(): string {
    return this._modelName
  }

  /**
   * Build system prompt with optional page context
   */
  private buildSystemPrompt(pageContent?: PageContent, enableTools = false): string {
    let systemPrompt = `You are a helpful AI assistant powered by Gemini.
You help users understand and work with web content.
Be concise but thorough in your responses.
Format your responses in Markdown when appropriate.
ALWAYS respond in the same language as the user's message.

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

## Browser Automation Tools (CDP-powered, isTrusted:true)

Pointer tools:
- **click_element**: click any button/link
- **right_click_element**: open context menu
- **double_click_element**: trigger dblclick
- **hover_element**: dispatch mouseMoved (use to reveal hover-only menus/tooltips)

Scroll & focus:
- **scroll_to_element**: bring an element into view (use before interacting with off-screen items)
- **focus_element**: move focus without clicking
- **blur_element**: drop focus (commit blur-based validation)

Text editing:
- **select_text**: highlight text (full element or range)
- **fill_element**: type into input/textarea/contenteditable

Keyboard:
- **press_key**: Enter / Tab / Escape / Arrow keys / single char
- **press_key_combination**: Ctrl+S, Cmd+A, etc. (modifiers + one key)

Inspection:
- **get_html**: inspect structure when a selector guess fails

### How to decide
1. Act immediately for action requests; do not ask clarifying questions first.
2. Choose the most likely CSS selector and try the direct tool (e.g. click_element).
3. If a click does not react (menus, dropdowns), call hover_element first, then click_element.
4. Before filling a form field, prefer focus_element (and select_text when replacing existing text) then fill_element.
5. To submit a form after fill_element, call press_key with "Enter".
6. If the target is off-screen, call scroll_to_element before clicking/typing.
7. On failure, call get_html (with a nearby selector) to discover the real markup, then retry (max 3 attempts).

### Selector guidance
- Prefer unique attributes: id, name, data-testid, aria-label.
- Avoid chaining more than 3 levels.
- For Gmail/X.com/React apps, text-based selectors break often; use stable attributes.`
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
    pageContent?: PageContent
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(pageContent)
    const chatHistory = this.buildChatHistory(history)

    const chat = this.model.startChat({
      history: chatHistory,
      systemInstruction: {
        role: 'user',
        parts: [{ text: systemPrompt }],
      },
    })

    const result = await chat.sendMessage(userMessage)
    const response = result.response
    return response.text()
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
    signal?: AbortSignal
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent)
      const chatHistory = this.buildChatHistory(history)

      const chat = this.model.startChat({
        history: chatHistory,
        systemInstruction: {
          role: 'user',
          parts: [{ text: systemPrompt }],
        },
      })

      const result = await chat.sendMessageStream(userMessage)
      let fullText = ''

      for await (const chunk of result.stream) {
        throwIfAborted(signal)
        const chunkText = chunk.text()
        fullText += chunkText
        onChunk(chunkText)
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
    signal?: AbortSignal
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const modelWithTools = this.genAI.getGenerativeModel({
        model: this._modelName,
        tools: [{ functionDeclarations: browserTools }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingMode.AUTO, // Let model decide, but with aggressive prompting
          },
        },
      })

      const chat = modelWithTools.startChat({
        history: chatHistory,
        systemInstruction: {
          role: 'user',
          parts: [{ text: systemPrompt }],
        },
      })

      const result = await chat.sendMessageStream(userMessage)
      let fullText = ''
      let functionCalls: FunctionCall[] = []

      for await (const chunk of result.stream) {
        throwIfAborted(signal)
        const chunkText = chunk.text()
        if (chunkText) {
          fullText += chunkText
          onChunk(chunkText)
        }

        // Check for function calls in the chunk
        const chunkFunctionCalls = chunk.functionCalls()
        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          functionCalls = chunkFunctionCalls
        }
      }

      // If there are function calls, return them for execution
      if (functionCalls.length > 0) {
        console.log('Gemini returned function calls:', JSON.stringify(functionCalls, null, 2))
        onFunctionCall(functionCalls)
      } else {
        console.log('Gemini returned text only (no function calls)')
        onComplete(fullText)
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
    signal?: AbortSignal
  ): Promise<void> {
    try {
      throwIfAborted(signal)
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const modelWithTools = this.genAI.getGenerativeModel({
        model: this._modelName,
        tools: [{ functionDeclarations: browserTools }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingMode.AUTO, // Let model decide, but with aggressive prompting
          },
        },
      })

      const chat = modelWithTools.startChat({
        history: chatHistory,
        systemInstruction: {
          role: 'user',
          parts: [{ text: systemPrompt }],
        },
      })

      // Format function results as a message
      const resultMessage = functionResults
        .map((fr) => {
          const res = fr.response as { success: boolean; message?: string; error?: string; html?: string }
          if (res.success) {
            const details = res.html ? `\nHTML (truncated): ${res.html.slice(0, 500)}...` : ''
            return `Function ${fr.name}: SUCCESS${res.message ? ` - ${res.message}` : ''}${details}`
          } else {
            return `Function ${fr.name}: FAILED - ${res.error || 'Unknown error'}`
          }
        })
        .join('\n')

      const continuationMessage = `I executed the requested browser actions. Here are the results:\n\n${resultMessage}\n\nPlease provide a summary of what was done and any next steps if needed.`

      const result = await chat.sendMessageStream(continuationMessage)

      let fullText = ''
      let newFunctionCalls: FunctionCall[] = []

      for await (const chunk of result.stream) {
        throwIfAborted(signal)
        const chunkText = chunk.text()
        if (chunkText) {
          fullText += chunkText
          onChunk(chunkText)
        }

        const chunkFunctionCalls = chunk.functionCalls()
        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          newFunctionCalls = chunkFunctionCalls
        }
      }

      if (newFunctionCalls.length > 0) {
        onFunctionCall(newFunctionCalls)
      } else {
        onComplete(fullText)
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
        return { action: 'PRESS_KEY', key: str(args.key) }
      case 'press_key_combination': {
        const keys = Array.isArray(args.keys)
          ? args.keys.filter((k): k is string => typeof k === 'string')
          : []
        return { action: 'PRESS_KEY_COMBINATION', keys }
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
