import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import type { Message, PageContent, GeminiConfig } from '../types'

/**
 * Gemini API wrapper for chat functionality
 */
export class GeminiChat {
  private model: GenerativeModel
  private _modelName: string

  constructor(config: GeminiConfig) {
    this._modelName = config.modelName
    const genAI = new GoogleGenerativeAI(config.apiKey)
    this.model = genAI.getGenerativeModel({
      model: config.modelName,
    })
  }

  get modelName(): string {
    return this._modelName
  }

  /**
   * Build system prompt with optional page context
   */
  private buildSystemPrompt(pageContent?: PageContent): string {
    let systemPrompt = `You are a helpful AI assistant powered by Gemini.
You help users understand and work with web content.
Be concise but thorough in your responses.
Format your responses in Markdown when appropriate.`

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
