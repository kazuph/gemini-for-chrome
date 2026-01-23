import { useState, useRef, useEffect } from 'react'
import { Send, FileText, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface ChatInputProps {
  onSend: (message: string, includePageContent: boolean) => void
  isLoading: boolean
  theme?: 'light' | 'dark'
}

export default function ChatInput({ onSend, isLoading, theme = 'dark' }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [includePageContent, setIncludePageContent] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const colors = {
    bg: theme === 'dark' ? 'bg-gray-800' : 'bg-white',
    border: theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
    input: theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300',
    text: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    placeholder: theme === 'dark' ? 'placeholder-gray-500' : 'placeholder-gray-400',
    textSecondary: theme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    toggleActive: 'bg-blue-600 text-white',
    toggleInactive: theme === 'dark' ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300',
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [message])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedMessage = message.trim()
    if (trimmedMessage && !isLoading) {
      onSend(trimmedMessage, includePageContent)
      setMessage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux)
    // Also check isComposing to avoid interfering with IME input
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('border-t p-4', colors.bg, colors.border)}>
      {/* Page content toggle - always enabled, fetches on send */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setIncludePageContent(!includePageContent)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            includePageContent
              ? colors.toggleActive
              : colors.toggleInactive
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          {includePageContent ? 'Include page' : 'Page excluded'}
        </button>
        {includePageContent && (
          <span className={cn('text-xs', colors.textSecondary)}>
            Fetches on send
          </span>
        )}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this page or anything else..."
            disabled={isLoading}
            rows={1}
            className={cn(
              'w-full px-4 py-3 rounded-xl border',
              colors.input,
              colors.text,
              colors.placeholder,
              'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
              'resize-none transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={!message.trim() || isLoading}
          className={cn(
            'flex-shrink-0 p-3 rounded-xl transition-colors',
            'bg-blue-600 text-white',
            'hover:bg-blue-500',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600'
          )}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Help text */}
      <p className={cn('mt-2 text-xs text-center', colors.textSecondary)}>
        ⌘+Enter / Ctrl+Enter to send
      </p>
    </form>
  )
}
