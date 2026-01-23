import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type FunctionDeclaration,
  type FunctionCall,
} from '@google/generative-ai'
import type { Message, PageContent, GeminiConfig, BrowserAction } from '../types'

// Tool definitions for browser actions
const browserTools: FunctionDeclaration[] = [
  {
    name: 'click_element',
    description: 'Click an element on the page using a CSS selector. Use this to interact with buttons, links, or other clickable elements.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href=\'/about\']")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill_element',
    description: 'Fill an input or textarea element with text using a CSS selector. Use this to enter text into form fields.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'CSS selector for the input element to fill (e.g., "input[name=\'email\']", "#search-box", "textarea.comment")',
        },
        value: {
          type: SchemaType.STRING,
          description: 'The text value to enter into the element',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'get_html',
    description: 'Get the HTML content of an element or the entire page. Use this to inspect page structure or get specific element content.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        selector: {
          type: SchemaType.STRING,
          description: 'Optional CSS selector for a specific element. If omitted, returns the entire page body HTML.',
        },
      },
    },
  },
]

// Type for function call results
export interface FunctionCallResult {
  name: string
  response: unknown
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
Format your responses in Markdown when appropriate.`

    if (enableTools) {
      systemPrompt += `

## Browser Actions
You have access to browser automation tools:
- **click_element**: Click buttons, links, or other interactive elements
- **fill_element**: Enter text into input fields or textareas
- **get_html**: Get the HTML structure of elements for inspection

When the user asks you to interact with the page (click something, fill a form, etc.), use these tools.
Always confirm what action you're about to take before executing it.`
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
    onError: (error: Error) => void
  ): Promise<void> {
    try {
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
        const chunkText = chunk.text()
        fullText += chunkText
        onChunk(chunkText)
      }

      onComplete(fullText)
    } catch (error) {
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
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const modelWithTools = this.genAI.getGenerativeModel({
        model: this._modelName,
        tools: [{ functionDeclarations: browserTools }],
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
        onFunctionCall(functionCalls)
      } else {
        onComplete(fullText)
      }
    } catch (error) {
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
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const systemPrompt = this.buildSystemPrompt(pageContent, true)
      const chatHistory = this.buildChatHistory(history)

      const modelWithTools = this.genAI.getGenerativeModel({
        model: this._modelName,
        tools: [{ functionDeclarations: browserTools }],
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
      console.error('Gemini API Error sending function results:', error)
      onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Convert function call to browser action
   */
  static functionCallToBrowserAction(functionCall: FunctionCall): BrowserAction | null {
    const args = functionCall.args as Record<string, string>

    switch (functionCall.name) {
      case 'click_element':
        return {
          action: 'CLICK_ELEMENT',
          selector: args.selector,
        }
      case 'fill_element':
        return {
          action: 'FILL_ELEMENT',
          selector: args.selector,
          value: args.value,
        }
      case 'get_html':
        return {
          action: 'GET_HTML',
          selector: args.selector,
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
